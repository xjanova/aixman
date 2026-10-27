import { TYPE_MISMATCH_MESSAGE } from '@/lib/services/generation';
import { RENDERING_PAUSED_MESSAGE } from '@/lib/services/gpu-balance';
import { isOrderRefused } from '@/lib/services/order-refusal';

/**
 * What a customer may be told when GenerationService refuses or fails an
 * order, as a status and a body — shared by /api/generate and the movie
 * studio, so one order fails the same way wherever it was placed. Null means
 * "unexpected": log it and answer with a generic failure.
 */
export function generationErrorResponse(error: unknown): { status: number; body: { error: string; code?: string } } | null {
  // Refused before any credit moved, in Thai the customer can act on:
  // forbidden content (terms §6), or an order a community-only model
  // cannot take (content-tier.ts, community-dispatch.ts).
  if (isOrderRefused(error)) {
    return { status: error.httpStatus, body: { error: error.message, code: error.code } };
  }
  const message = (error as Error)?.message ?? '';

  // Only expose known user-facing error messages
  if (message.includes('Insufficient credits')) return { status: 402, body: { error: message } };
  if (message.includes('not found') || message.includes('inactive')) return { status: 404, body: { error: 'Model not available' } };
  if (message.includes('unavailable') || message.includes('No available API accounts')) {
    return { status: 503, body: { error: 'Service temporarily unavailable. Please try again later.' } };
  }
  // Already user-facing Thai copy from ModelReadiness — pass it through rather
  // than flattening it into a generic failure.
  if (message.includes('กำลังปรับแต่ง') || message.includes('ยังตั้งค่าไม่เสร็จ')) return { status: 409, body: { error: message } };
  // A 3D order sent to a picture model, or the other way round.
  if (message === TYPE_MISMATCH_MESSAGE) return { status: 400, body: { error: message } };
  // A frame still the rented worker could not read (frame-input.ts) — the
  // customer can fix it by uploading again, so say so instead of "failed".
  if (message.includes('ไฟล์ภาพที่แนบไม่ถูกต้อง')) return { status: 400, body: { error: message } };
  // Rendering paused until the vendor balance is topped up (gpu-balance.ts).
  // Refused before any credit moved; a retry later will work.
  if (message === RENDERING_PAUSED_MESSAGE) return { status: 503, body: { error: message } };
  return null;
}
