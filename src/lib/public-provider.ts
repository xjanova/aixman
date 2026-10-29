import { getGpuProvider } from '@/lib/gpu';

/**
 * How the services behind a model are shown to customers: not at all.
 *
 * Every model is presented as ours. Which API reseller, inference host or
 * rented GPU actually serves an order is a trade secret — "KIE.ai" or
 * "SimplePod (เช่า GPU)" beside a model tells a competitor exactly how the
 * service is built, and the owner ruled (2026-10-29) that customers must not
 * learn which vendors we connect to. Model makers (Kling, Veo, FLUX…) are the
 * product and stay in model names.
 *
 * Everything a customer can read goes through here: `/api/models`, the gallery,
 * an order's status, MCP. Admin pages read the provider rows directly.
 */
export const IN_HOUSE_PROVIDER = { name: 'X-DREAMER', slug: 'xdreamer', logo: null } as const;

export function isInHouse(slug: string): boolean {
  return getGpuProvider(slug) !== null;
}

// The provider row is taken so callers keep passing what they have; nothing of it is shown.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function publicProvider(_provider: { name: string; slug: string; logo?: string | null }): {
  name: string;
  slug: string;
  logo: string | null;
} {
  return { ...IN_HOUSE_PROVIDER };
}

/**
 * A model id as customers and API callers see it. A vendor's namespace is
 * replaced (`kie/veo-3-1` → `xd/veo-3-1`) or dropped (`fal-ai/flux/dev` →
 * `flux/dev`). The two cannot collide: only KIE rows start with `xd/`, and no
 * bare id equals a fal one without its prefix (a test pins this on the seed).
 */
export function publicModelId(modelId: string): string {
  if (modelId.startsWith('kie/')) return `xd/${modelId.slice(4)}`;
  if (modelId.startsWith('fal-ai/')) return modelId.slice(7);
  return modelId;
}

/** Whether `wanted` (already lower-cased) names this row: its public id or, for old callers, its real one. */
export function matchesModelId(modelId: string, wanted: string): boolean {
  return modelId.toLowerCase() === wanted || publicModelId(modelId).toLowerCase() === wanted;
}

/** Rows whose stored copy describes the vendor rather than the model. */
const PUBLIC_COPY: Record<string, { name: string; description: string }> = {
  flux: { name: 'FLUX ฟรี', description: 'สร้างภาพฟรี • คิวและความละเอียดจำกัด • เหมาะลองไอเดียเร็ว ๆ' },
};

const VENDOR = String.raw`(?:kie(?:\.ai)?|fal(?:\.ai)?|replicate|pollinations|byteplus|simplepod|runpod|vast(?:\.ai)?|verda)`;
const VENDOR_TAG = new RegExp(String.raw`\s*\(\s*${VENDOR}\s*\)`, 'gi');
const VIA_VENDOR = new RegExp(String.raw`\s*(?:ผ่าน|via|on|from)\s+${VENDOR}\b`, 'gi');
const VENDOR_WORD = new RegExp(String.raw`\b${VENDOR}\b`, 'gi');

export function publicModelName(modelId: string, name: string): string {
  return PUBLIC_COPY[modelId]?.name ?? (name.replace(VENDOR_TAG, '').trim() || name);
}

export function publicModelDescription(modelId: string, description: string | null): string | null {
  if (PUBLIC_COPY[modelId]) return PUBLIC_COPY[modelId].description;
  return description === null ? null : description.replace(VIA_VENDOR, '').replace(VENDOR_TAG, '');
}

/** The vendor's own account trouble — its key, balance or rate limit — which is ours to fix, not the customer's. */
const ACCOUNT_TROUBLE =
  /\b(?:401|402|403|429|455)\b|api[ _-]?key|insufficient|rate[ _-]?limit|quota|balance|no available api accounts|unauthori[sz]ed/i;

export const BUSY_MESSAGE = 'ระบบไม่ว่างชั่วคราว — คืนเครดิตให้แล้ว ลองสั่งใหม่อีกครั้งในอีกสักครู่';

/**
 * A failed order's message as the customer may read it. Our own Thai refusals
 * pass through; a vendor's message keeps its reason (a refused prompt says why)
 * with the vendor's name, task ids and URLs taken out, and an account problem of
 * ours becomes a plain "busy".
 */
export function publicErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  if (ACCOUNT_TROUBLE.test(message)) return BUSY_MESSAGE;
  const cleaned = message
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\btask\s+[\w-]{6,}/gi, 'task')
    .replace(VENDOR_TAG, '')
    .replace(VENDOR_WORD, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:·,-]+/, '')
    .trim();
  return cleaned || 'สร้างงานไม่สำเร็จ — คืนเครดิตให้แล้ว';
}
