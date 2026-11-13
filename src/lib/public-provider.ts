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
 * Why a vendor failed an order, in words a customer can act on. Read from its
 * text, not its code: one number means different things per model (413 from
 * Suno's Cover is a fingerprint match, not "too large"). First match wins, so
 * the narrower reasons come first. Written from what production has stored.
 */
const VENDOR_REASONS: { says: RegExp; msg: Msg }[] = [
  {
    says: /matches an existing recording/i,
    msg: {
      th: 'ไฟล์เสียงนี้ตรงกับเพลงที่มีอยู่แล้วในฐานข้อมูลเพลง จึงนำมาทำต่อไม่ได้ ลองใช้เพลงที่คุณแต่งหรืออัดเอง — คืนเครดิตให้แล้ว',
      en: 'This audio matches an existing recording, so it can’t be used. Try a song you wrote or recorded yourself — your credits have been refunded.',
    },
  },
  {
    says: /copyright/i,
    msg: {
      th: 'เพลงที่ได้ไม่ผ่านการตรวจลิขสิทธิ์ ลองเปลี่ยนเนื้อเพลงหรือสไตล์แล้วสั่งใหม่ — คืนเครดิตให้แล้ว',
      en: 'The result didn’t pass the copyright check. Change the lyrics or the style and order again — your credits have been refunded.',
    },
  },
  {
    says: /flagged|sensitive|moderation|safety|nsfw|content (?:policy|security)/i,
    msg: {
      th: 'เนื้อหาไม่ผ่านการตรวจของระบบ ลองปรับข้อความหรือไฟล์ที่ใส่แล้วสั่งใหม่ — คืนเครดิตให้แล้ว',
      en: 'The content didn’t pass the safety check. Change the text or the file and order again — your credits have been refunded.',
    },
  },
  {
    says: /timed? ?out/i,
    msg: {
      th: 'ใช้เวลาสร้างนานเกินกำหนด ลองสั่งใหม่อีกครั้ง — คืนเครดิตให้แล้ว',
      en: 'It took longer than allowed. Please order again — your credits have been refunded.',
    },
  },
  {
    says: /no output/i,
    msg: {
      th: 'ระบบสร้างงานไม่ส่งผลลัพธ์กลับมา ลองสั่งใหม่อีกครั้ง — คืนเครดิตให้แล้ว',
      en: 'No result came back. Please order again — your credits have been refunded.',
    },
  },
];

/** The reason inside a vendor's wording: "generation failed (413: reason)", "error 422: reason". */
function vendorReason(text: string): string {
  const wrapped = text.match(/^generation failed\s*\((?:\d{3}\s*:\s*)?([\s\S]*)\)$/i);
  const reason = wrapped ? wrapped[1] : text.replace(/^(?:generation failed|error)\b[\s:]*(?:\d{3}\b[\s:]*)?/i, '');
  return reason.replace(/[.\s]+$/, '').slice(0, 200);
}

/**
 * A failed order's message as the customer may read it, in `locale`. They are
 * always told why. Our own refusals pass through (stored in both languages, or
 * a known Thai one); a vendor's failure becomes its reason in their language
 * (`VENDOR_REASONS`), or its own words with its name, task ids and URLs taken
 * out; and an account problem of ours becomes a plain "busy".
 */
export function publicErrorMessage(stored: string | null | undefined, locale: Locale = 'th'): string | null {
  if (!stored) return null;
  const message = readStoredMessage(stored, locale) ?? stored;
  if (ACCOUNT_TROUBLE.test(message)) return pick(BUSY_MSG, locale);
  // Every message of ours holds Thai; a vendor writes English.
  const ours = /[฀-๿]/.test(stored);
  const known = ours ? undefined : VENDOR_REASONS.find((r) => r.says.test(message));
  if (known) return pick(known.msg, locale);
  const cleaned = message
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\btask\s+[\w-]{6,}/gi, 'task')
    .replace(VENDOR_TAG, '')
    .replace(VENDOR_WORD, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:·,-]+/, '')
    .trim();
  if (ours) return cleaned || pick(FAILED_MSG, locale);
  const reason = vendorReason(cleaned);
  if (!reason) return pick(FAILED_MSG, locale);
  return pick({ th: `สร้างงานไม่สำเร็จ: ${reason} — คืนเครดิตให้แล้ว`, en: `Creating failed: ${reason} — your credits have been refunded.` }, locale);
}

/** `publicErrorMessage` in both languages, for a row that stores what the customer reads. */
export function publicErrorPair(stored: string | null | undefined): Msg | null {
  const th = publicErrorMessage(stored, 'th');
  const en = publicErrorMessage(stored, 'en');
  return th && en ? { th, en } : null;
}
