import prisma from '@/lib/db';

/**
 * "Someone is on the studio with this model selected."
 *
 * A rented machine boots in ~2 min, so the idle timeout can be short — but the
 * customer who watches a clip and orders again a few minutes later would pay
 * for that saving with a fresh boot. The studio pings while it is visible; the
 * idle reaper then grants up to `presenceExtensionMinutes` past the idle
 * timeout, and only while pings keep coming. It never starts a machine and
 * never extends one past that bound, so a tab left open costs at most a few
 * minutes of one card.
 *
 * Kept in `ai_settings`, not a module-level Map: the reaper runs from the
 * scheduler that `instrumentation.ts` starts, which Next bundles separately
 * from route handlers — the two would each see their own Map.
 */

const GROUP = 'gpu_presence';
const keyFor = (modelKey: string) => `gpu_presence_${modelKey}`;

/** The studio pings every 30 s; older than this means the customer left. */
export const PRESENCE_FRESH_MS = 75_000;

/** Many open tabs must not mean many writes: at most one per model per 20 s. */
const WRITE_EVERY_MS = 20_000;

const store = globalThis as unknown as { __studioPresenceWrites?: Map<string, number> };
const lastWrites = (store.__studioPresenceWrites ??= new Map<string, number>());

export async function touchStudioPresence(modelKey: string, now = Date.now()): Promise<void> {
  if (now - (lastWrites.get(modelKey) ?? 0) < WRITE_EVERY_MS) return;
  lastWrites.set(modelKey, now);
  await prisma.aiSetting.upsert({
    where: { key: keyFor(modelKey) },
    update: { value: String(now) },
    create: { key: keyFor(modelKey), value: String(now), type: 'number', group: GROUP },
  });
}

export async function isStudioPresent(modelKey: string, now = Date.now()): Promise<boolean> {
  const row = await prisma.aiSetting.findUnique({ where: { key: keyFor(modelKey) } });
  const seen = Number(row?.value);
  return Number.isFinite(seen) && seen > 0 && now - seen < PRESENCE_FRESH_MS;
}
