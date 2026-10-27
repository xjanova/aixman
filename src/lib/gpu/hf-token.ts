import prisma from '@/lib/db';
import { decrypt, encrypt } from '@/lib/utils/encryption';
import { MODEL_CATALOG } from '@/lib/gpu/catalog';

/**
 * The Hugging Face token rented machines download weights with.
 *
 * Gated repos (Lightricks/LTX-2.5) answer 401 without one, and the boot dies
 * at the first file. It used to live only in GPU_HF_TOKEN, which prod never
 * had — the first LTX-2.5 rental (2026-10-27) failed for exactly that. Now it
 * is saved from Admin → GPU, encrypted in `ai_settings` like the Telegram bot
 * token, never returned by any API; the environment variable stays the fallback.
 */

const TOKEN_KEY = 'gpu_hf_token';
const SETTING_GROUP = 'gpu';
/** HF user access tokens: `hf_` then ~34 letters and digits. */
const TOKEN_RE = /^hf_[A-Za-z0-9]{20,}$/;
const CHECK_TIMEOUT_MS = 10_000;

export interface HfTokenStatus {
  configured: boolean;
  source: 'settings' | 'env' | null;
}

export interface HfTokenCheck {
  /** The HF account the token belongs to, when it is valid at all. */
  account: string | null;
  /** Catalogue repos the token cannot download from (gated, licence not accepted). */
  refused: { repo: string; status: number }[];
  checked: number;
}

async function loadSaved(): Promise<string | null> {
  const row = await prisma.aiSetting.findUnique({ where: { key: TOKEN_KEY } });
  if (!row?.value) return null;
  try {
    return decrypt(row.value);
  } catch {
    // ENCRYPTION_KEY rotated since it was saved. Say so without the value.
    console.error('[hf-token] the saved token cannot be decrypted — save it again on /admin/gpu');
    return null;
  }
}

/** The token a new machine gets: the saved one, else GPU_HF_TOKEN. */
export async function getHfToken(): Promise<string | undefined> {
  const saved = await loadSaved().catch(() => null);
  if (saved) return saved;
  return process.env.GPU_HF_TOKEN?.trim() || undefined;
}

export async function getHfTokenStatus(): Promise<HfTokenStatus> {
  const saved = await loadSaved().catch(() => null);
  if (saved) return { configured: true, source: 'settings' };
  if (process.env.GPU_HF_TOKEN?.trim()) return { configured: true, source: 'env' };
  return { configured: false, source: null };
}

/** An empty string removes the saved token (the env fallback then applies). */
export async function saveHfToken(input: unknown): Promise<HfTokenStatus> {
  if (typeof input !== 'string') throw new Error('ไม่มีโทเค็น');
  const token = input.trim();
  if (token === '') {
    await prisma.aiSetting.deleteMany({ where: { key: TOKEN_KEY } });
    return getHfTokenStatus();
  }
  if (!TOKEN_RE.test(token)) {
    throw new Error('โทเค็นไม่ถูกต้อง — ต้องขึ้นต้นด้วย hf_ (สร้างที่ huggingface.co/settings/tokens แบบ Read)');
  }
  const value = encrypt(token);
  await prisma.aiSetting.upsert({
    where: { key: TOKEN_KEY },
    update: { value },
    create: { key: TOKEN_KEY, value, type: 'encrypted', group: SETTING_GROUP },
  });
  return getHfTokenStatus();
}

/** One file per catalogue repo — enough to learn whether the token may download it. */
function catalogueProbes(): { repo: string; file: string }[] {
  const byRepo = new Map<string, string>();
  for (const entry of MODEL_CATALOG) {
    for (const d of entry.downloads ?? []) {
      if (!byRepo.has(d.repo)) byRepo.set(d.repo, d.file);
    }
  }
  return [...byRepo].map(([repo, file]) => ({ repo, file }));
}

async function headStatus(url: string, token: string): Promise<number> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      // A permitted file answers with a redirect to the CDN; following it
      // only costs time.
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * Who the token belongs to, and which catalogue repos it still cannot read.
 * Read-only: nothing is downloaded.
 */
export async function checkHfToken(): Promise<HfTokenCheck> {
  const token = await getHfToken();
  if (!token) throw new Error('ยังไม่ได้ใส่โทเค็น Hugging Face');

  let account: string | null = null;
  try {
    const res = await fetch('https://huggingface.co/api/whoami-v2', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as { name?: unknown };
      account = typeof body.name === 'string' ? body.name : null;
    }
  } catch {
    // Reported below as an invalid token.
  }
  if (!account) throw new Error('Hugging Face ไม่รับโทเค็นนี้ — ตรวจว่าคัดลอกครบและยังไม่ถูกลบ');

  const probes = catalogueProbes();
  const statuses = await Promise.all(
    probes.map((p) =>
      headStatus(`https://huggingface.co/${p.repo}/resolve/main/${p.file.split('/').map(encodeURIComponent).join('/')}`, token)
    )
  );
  const refused = probes
    .map((p, i) => ({ repo: p.repo, status: statuses[i] }))
    .filter((r) => r.status === 401 || r.status === 403);
  return { account, refused, checked: probes.length };
}
