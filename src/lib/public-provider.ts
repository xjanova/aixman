import { getGpuProvider } from '@/lib/gpu';
import { pick, type Locale, type Msg } from '@/lib/i18n/locale';
import { readStoredMessage, registerStoredMsgs } from '@/lib/i18n/messages';
import { modelDescription, modelName } from '@/lib/i18n/model-text';

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
const PUBLIC_COPY: Record<string, { name: Msg; description: Msg }> = {
  flux: {
    name: { th: 'FLUX ฟรี', en: 'FLUX Free' },
    description: {
      th: 'สร้างภาพฟรี • คิวและความละเอียดจำกัด • เหมาะลองไอเดียเร็ว ๆ',
      en: 'Free pictures • limited queue and resolution • good for trying ideas quickly',
    },
  },
};

const VENDOR = String.raw`(?:kie(?:\.ai)?|fal(?:\.ai)?|replicate|pollinations|byteplus|simplepod|runpod|vast(?:\.ai)?|verda)`;
const VENDOR_TAG = new RegExp(String.raw`\s*\(\s*${VENDOR}\s*\)`, 'gi');
const VIA_VENDOR = new RegExp(String.raw`\s*(?:ผ่าน|via|on|from)\s+${VENDOR}\b`, 'gi');
const VENDOR_WORD = new RegExp(String.raw`\b${VENDOR}\b`, 'gi');

/** Free text that may carry a model's stored name ("FLUX Dev (fal) - image generation"), without the vendor tag. */
export function withoutVendorTags(text: string): string {
  return text.replace(VENDOR_TAG, '').replace(VIA_VENDOR, '');
}

/** A model's name for customers in `locale` (English from `i18n/model-text.ts` when the row's has Thai). */
export function publicModelName(modelId: string, name: string, locale: Locale = 'th'): string {
  const copy = PUBLIC_COPY[modelId];
  if (copy) return pick(copy.name, locale);
  return modelName(modelId, name.replace(VENDOR_TAG, '').trim() || name, locale);
}

export function publicModelDescription(modelId: string, description: string | null, locale: Locale = 'th'): string | null {
  const copy = PUBLIC_COPY[modelId];
  if (copy) return pick(copy.description, locale);
  const text = modelDescription(modelId, description, locale);
  return text === null ? null : text.replace(VIA_VENDOR, '').replace(VENDOR_TAG, '');
}

/**
 * A row's params as the model list sends them. The KIE price table is stored
 * under the vendor's key; it travels as `priceTable` instead, so the key is dropped.
 */
export function publicDefaultParams<T>(params: T): T {
  if (!params || typeof params !== 'object' || Array.isArray(params) || !('kie' in params)) return params;
  const rest = { ...(params as Record<string, unknown>) };
  delete rest.kie;
  return rest as T;
}

/** The vendor's own account trouble — its key, balance or rate limit — which is ours to fix, not the customer's. */
const ACCOUNT_TROUBLE =
  /\b(?:401|402|403|429|455)\b|api[ _-]?key|insufficient|rate[ _-]?limit|quota|balance|no available api accounts|unauthori[sz]ed/i;

const BUSY_MSG: Msg = {
  th: 'ระบบไม่ว่างชั่วคราว — คืนเครดิตให้แล้ว ลองสั่งใหม่อีกครั้งในอีกสักครู่',
  en: 'We’re busy for the moment — your credits have been refunded. Please order again in a little while.',
};
const FAILED_MSG: Msg = { th: 'สร้างงานไม่สำเร็จ — คืนเครดิตให้แล้ว', en: 'Creating failed — your credits have been refunded.' };
registerStoredMsgs(BUSY_MSG, FAILED_MSG);

export const BUSY_MESSAGE = BUSY_MSG.th;

/**
 * A failed order's message as the customer may read it, in `locale`. Our own
 * refusals pass through (stored in both languages, or a known Thai one); a
 * vendor's message keeps its reason (a refused prompt says why) with the
 * vendor's name, task ids and URLs taken out, and an account problem of ours
 * becomes a plain "busy".
 */
export function publicErrorMessage(stored: string | null | undefined, locale: Locale = 'th'): string | null {
  if (!stored) return null;
  const message = readStoredMessage(stored, locale) ?? stored;
  if (ACCOUNT_TROUBLE.test(message)) return pick(BUSY_MSG, locale);
  const cleaned = message
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\btask\s+[\w-]{6,}/gi, 'task')
    .replace(VENDOR_TAG, '')
    .replace(VENDOR_WORD, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:·,-]+/, '')
    .trim();
  return cleaned || pick(FAILED_MSG, locale);
}
