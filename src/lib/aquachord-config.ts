import { randomBytes } from 'crypto';
import prisma from '@/lib/db';
import { decrypt, encrypt } from '@/lib/utils/encryption';

/**
 * The switch and the signing key behind "แกะคอร์ดใน AquaChord"
 * (aquachord-handoff.ts holds the pure token code).
 *
 * The key only ever signs and checks our own links — AquaChord never sees it —
 * so it needs no setup: the first link generates one and keeps it encrypted in
 * `ai_settings`. AQUACHORD_HANDOFF_SECRET, when set, still wins. The switch is
 * Admin → ตั้งค่า → เชื่อมต่อภายนอก; off hides the button and refuses links,
 * including ones already handed out.
 */

export const HANDOFF_ENABLED_KEY = 'aquachord_handoff_enabled';
const SECRET_KEY = 'aquachord_handoff_secret';
const GROUP = 'integration';

/** On unless an admin switched it off. The row is created on first read so the switch shows up on the settings page. */
export async function handoffEnabled(): Promise<boolean> {
  const row = await prisma.aiSetting.findUnique({ where: { key: HANDOFF_ENABLED_KEY } }).catch(() => null);
  if (row) return row.value !== 'false';
  await prisma.aiSetting
    .create({ data: { key: HANDOFF_ENABLED_KEY, value: 'true', type: 'boolean', group: GROUP } })
    .catch(() => null); // a concurrent first read made it
  return true;
}

async function savedKey(): Promise<string | null> {
  const row = await prisma.aiSetting.findUnique({ where: { key: SECRET_KEY } });
  if (!row?.value) return null;
  try {
    return decrypt(row.value);
  } catch {
    // ENCRYPTION_KEY rotated: links already out die anyway, so start a new key.
    console.error('[aquachord] the saved handoff key cannot be decrypted — replacing it');
    return null;
  }
}

/** The key links are signed and checked with: env, else the saved one, else a new one saved now. */
export async function handoffKey(): Promise<string | null> {
  const env = process.env.AQUACHORD_HANDOFF_SECRET?.trim();
  if (env) return env;
  const saved = await savedKey().catch(() => null);
  if (saved) return saved;
  const fresh = randomBytes(32).toString('base64url');
  try {
    // Only one first link wins; everyone then reads the stored key back.
    await prisma.aiSetting.upsert({
      where: { key: SECRET_KEY },
      update: {},
      create: { key: SECRET_KEY, value: encrypt(fresh), type: 'encrypted', group: GROUP },
    });
    const stored = await savedKey();
    if (stored) return stored;
    // The row held an undecryptable key: overwrite it.
    await prisma.aiSetting.update({ where: { key: SECRET_KEY }, data: { value: encrypt(fresh) } });
    return fresh;
  } catch (error) {
    console.error('[aquachord] could not save a handoff key', (error as Error).message);
    return null;
  }
}
