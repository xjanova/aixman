import { TYPE_MISMATCH_MESSAGE } from '@/lib/services/generation';
import { RENDERING_PAUSED_MSG } from '@/lib/services/gpu-balance';
import { TUNING_MSG } from '@/lib/services/model-readiness';
import { isOrderRefused } from '@/lib/services/order-refusal';
import { errorMsg, messageFor } from '@/lib/i18n/messages';
import { pick, type Locale, type Msg } from '@/lib/i18n/locale';

/** Plain-Thai messages GenerationService throws as `Error`, with their English. */
const KNOWN: Msg[] = [
  TUNING_MSG,
  RENDERING_PAUSED_MSG,
  { th: TYPE_MISMATCH_MESSAGE, en: 'This model doesn’t do this kind of work.' },
  { th: 'โมเดลนี้ยังตั้งค่าไม่เสร็จ กรุณาติดต่อผู้ดูแลระบบ', en: 'This model isn’t fully set up yet. Please contact support.' },
  { th: 'ไฟล์ภาพที่แนบไม่ถูกต้อง กรุณาอัปโหลดใหม่', en: 'The attached picture isn’t valid. Please upload it again.' },
];

const say = (msg: Msg, locale: Locale) => pick(msg, locale);
const known = (message: string) => KNOWN.find((m) => m.th === message || message.startsWith(m.th)) ?? null;

/**
 * What a customer may be told when GenerationService refuses or fails an
 * order, as a status and a body in the visitor's language — shared by
 * /api/generate and the movie studio, so one order fails the same way
 * wherever it was placed. Null means "unexpected": log it and answer with a
 * generic failure.
 */
export function generationErrorResponse(
  error: unknown,
  locale: Locale = 'th'
): { status: number; body: { error: string; code?: string } } | null {
  // Refused before any credit moved, in words the customer can act on:
  // forbidden content (terms §6), or an order a community-only model
  // cannot take (content-tier.ts, community-dispatch.ts).
  if (isOrderRefused(error)) {
    return { status: error.httpStatus, body: { error: messageFor(error, locale), code: error.code } };
  }
  const message = (error as Error)?.message ?? '';
  // A customer-facing error that carries both languages (UserMessageError).
  const pair = errorMsg(error);

  // Only expose known user-facing error messages
  // "Insufficient credits. Need N, have M" — kept as it is: the studios and
  // the app read the two figures out of it and word it themselves.
  if (message.includes('Insufficient credits')) return { status: 402, body: { error: message } };
  if (message.includes('not found') || message.includes('inactive')) {
    return { status: 404, body: { error: say({ th: 'โมเดลนี้ไม่พร้อมให้บริการ', en: 'Model not available' }, locale) } };
  }
  if (message.includes('unavailable') || message.includes('No available API accounts')) {
    return {
      status: 503,
      body: { error: say({ th: 'ระบบไม่ว่างชั่วคราว กรุณาลองใหม่ภายหลัง', en: 'Service temporarily unavailable. Please try again later.' }, locale) },
    };
  }
  if (pair) return { status: 400, body: { error: say(pair, locale) } };
  const thai = known(message);
  if (!thai) return null;
  // Model still being tuned / not set up (ModelReadiness) → 409; rendering
  // paused until the vendor balance is topped up (gpu-balance.ts), refused
  // before any credit moved → 503; a 3D order sent to a picture model, or a
  // frame the rented worker could not read (frame-input.ts) → 400.
  const status = thai === RENDERING_PAUSED_MSG ? 503 : thai === TUNING_MSG || thai === KNOWN[3] ? 409 : 400;
  return { status, body: { error: say(thai, locale) } };
}
