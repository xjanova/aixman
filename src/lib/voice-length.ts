/**
 * How long a lip-sync render will be, from the length of the voice it speaks.
 *
 * Pure and dependency-free, like pricing.ts: GenerationService decides the
 * length it charges for and renders with this, and the studio shows the same
 * number before the order, so the price on the button is the price charged.
 */

import type { Msg } from '@/lib/i18n/locale';

export interface LengthFromAudio {
  /** Shorter than this and there is too little to animate. */
  minSeconds: number;
  /** The model's frame grid in seconds (LTX at 24 fps: 1/3 s). */
  stepSeconds: number;
}

/** A refusal carries both languages: `msg` for the visitor, `message` its Thai (server callers, logs). */
export type VoiceLength =
  | { ok: true; seconds: number }
  | { ok: false; code: 'voice-unreadable' | 'voice-too-short' | 'voice-too-long'; message: string; msg: Msg };

const secondsEn = (n: number) => `${n} ${n === 1 ? 'second' : 'seconds'}`;

/**
 * MP3 encoders pad the end with up to a frame or two of silence that is
 * counted as length (audio-duration.ts); a recording trimmed to exactly the
 * ceiling must not be refused for it.
 */
const OVERRUN_TOLERANCE_SECONDS = 0.25;

/**
 * The seconds an order renders and is priced at, or why it cannot be taken.
 *
 * Rounded *down* to the model's grid, so the voice is never shorter than the
 * clip; a fraction of a step at the end is usually the breath after the last
 * word. Then nudged up at the fourth decimal: the template multiplies seconds
 * by the frame rate and ComfyUI truncates the product to an integer, and
 * 23/3 × 24 in floating point is 183.99999… — one frame, and one latent step,
 * short of the 8k+1 grid.
 */
export function voiceRenderSeconds(
  measured: number | null,
  rule: LengthFromAudio,
  maxSeconds: number | null | undefined
): VoiceLength {
  if (measured === null || !Number.isFinite(measured) || measured <= 0) {
    const msg = {
      th: 'อ่านความยาวไฟล์เสียงไม่ได้ กรุณาแปลงเป็น MP3 หรือ WAV แล้วอัปโหลดใหม่',
      en: "Couldn't read how long the audio file is. Convert it to MP3 or WAV and upload it again.",
    };
    return { ok: false, code: 'voice-unreadable', message: msg.th, msg };
  }
  if (measured < rule.minSeconds) {
    const msg = {
      th: `ไฟล์เสียงสั้นเกินไป ต้องยาวอย่างน้อย ${rule.minSeconds} วินาที`,
      en: `The audio file is too short — it must be at least ${secondsEn(rule.minSeconds)}.`,
    };
    return { ok: false, code: 'voice-too-short', message: msg.th, msg };
  }
  const max = maxSeconds && maxSeconds > 0 ? maxSeconds : null;
  if (max !== null && measured > max + OVERRUN_TOLERANCE_SECONDS) {
    const msg = {
      th: `ไฟล์เสียงยาว ${measured.toFixed(1)} วินาที เกินที่รองรับ (สูงสุด ${max} วินาที) กรุณาตัดให้สั้นลงแล้วอัปโหลดใหม่`,
      en: `The audio file is ${measured.toFixed(1)} seconds long, over the limit (${secondsEn(max)} max). Trim it and upload it again.`,
    };
    return { ok: false, code: 'voice-too-long', message: msg.th, msg };
  }
  const usable = max !== null ? Math.min(measured, max) : measured;
  const steps = Math.max(1, Math.floor(usable / rule.stepSeconds + 1e-9));
  const seconds = Math.max(rule.minSeconds, steps * rule.stepSeconds);
  return { ok: true, seconds: Math.ceil(seconds * 10_000) / 10_000 };
}
