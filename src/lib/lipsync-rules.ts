/**
 * What a video lip-sync model takes — a clip to re-dub and a voice to put in
 * its mouth — checked and priced before any credit moves.
 *
 * The limits are the vendor's (Kling refuses a clip outside 2–10 s or
 * 720–1920 px after we have paid for the attempt) or what a rented card can
 * hold. They are checked against the numbers read from the stored files
 * (video-probe.ts, audio-duration.ts), never against what a client says.
 *
 * Shared by the API rows below (keyed by `ai_models.modelId`) and by the
 * self-hosted catalogue entry's `sourceVideo` clip rule.
 */

import type { VideoProbe } from './video-probe';

export interface ClipRule {
  minSeconds?: number;
  maxSeconds: number;
  /** Both sides of the picture must lie within this range, in pixels. */
  minSide?: number;
  maxSide?: number;
  maxBytes?: number;
  /** Containers taken, by upload extension (`mp4` covers MOV); any when unset. */
  containers?: string[];
}

export interface VoiceRule {
  minSeconds?: number;
  maxSeconds: number;
  maxBytes?: number;
  /** The clip sets the output's length, so speech past its end would be lost. */
  notLongerThanClip?: boolean;
}

export type LipsyncBilling =
  /** One price per order, whatever the length (fal LatentSync: $0.20 up to 40 s). */
  | { kind: 'flat' }
  /** `creditsPerUnit` per started block of the source clip (Kling bills 5 s blocks of input video). */
  | { kind: 'clipBlocks'; blockSeconds: number };

export interface VideoLipsyncRule {
  clip: ClipRule;
  voice: VoiceRule;
  billing: LipsyncBilling;
  /** How long to wait on the vendor before calling the order failed. */
  maxWaitSeconds: number;
}

const MB = 1024 * 1024;

/**
 * Video lip-sync models reached through an inference API. Off until an API
 * key for their provider is in the account pool; a row starts `tuning`, so
 * only an admin can order it until its first order delivers.
 */
export const API_VIDEO_LIPSYNC: Record<string, VideoLipsyncRule> = {
  // https://fal.ai/models/fal-ai/kling-video/lipsync/audio-to-video — video
  // 2–10 s, 720p/1080p (each side 720–1920 px), .mp4/.mov, ≤100 MB; audio
  // 2–60 s, ≤5 MB; $0.014 per second of input video, rounded up to 5 s.
  // About 12 minutes a render, so the wait is generous.
  'fal-ai/kling-video/lipsync/audio-to-video': {
    clip: { minSeconds: 2, maxSeconds: 10, minSide: 720, maxSide: 1920, maxBytes: 100 * MB, containers: ['mp4'] },
    voice: { minSeconds: 2, maxSeconds: 60, maxBytes: 5 * MB, notLongerThanClip: true },
    billing: { kind: 'clipBlocks', blockSeconds: 5 },
    maxWaitSeconds: 30 * 60,
  },
  // https://fal.ai/models/fal-ai/latentsync — $0.20 for videos up to 40 s,
  // $0.005/s past that; the picture loops when the voice is longer. Both are
  // held to 40 s so the flat price is the price.
  'fal-ai/latentsync': {
    clip: { maxSeconds: 40 },
    voice: { minSeconds: 1, maxSeconds: 40 },
    billing: { kind: 'flat' },
    maxWaitSeconds: 20 * 60,
  },
  // KIE `volcengine/video-to-video-lip-sync` (docs.kie.ai/market/volcengine/
  // video-to-video-lip-sync) — video 360p–1080p (above is scaled down, below
  // refused), MP4/MOV; voice over 1 s, up to 210 s in basic mode; $0.04 per
  // second. Held to 60 s, and the voice to the clip, so billing every started
  // second of the clip covers whatever KIE measures.
  'kie/volcengine-lipsync': {
    clip: { minSeconds: 1, maxSeconds: 60, minSide: 360, maxBytes: 200 * MB, containers: ['mp4'] },
    voice: { minSeconds: 1.1, maxSeconds: 60, notLongerThanClip: true },
    billing: { kind: 'clipBlocks', blockSeconds: 1 },
    maxWaitSeconds: 40 * 60,
  },
};

export function apiVideoLipsyncRule(modelId: string): VideoLipsyncRule | undefined {
  return Object.hasOwn(API_VIDEO_LIPSYNC, modelId) ? API_VIDEO_LIPSYNC[modelId] : undefined;
}

export interface ClipFacts extends VideoProbe {
  bytes: number;
  ext: string;
}

export type RuleCheck = { ok: true } | { ok: false; code: string; message: string };

const secs = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const mb = (n: number) => `${Math.round(n / MB)} MB`;

/** Whether a stored clip fits, in Thai a customer can act on. */
export function checkClip(rule: ClipRule, clip: ClipFacts): RuleCheck {
  if (rule.containers && !rule.containers.includes(clip.ext)) {
    return { ok: false, code: 'clip-container', message: 'โมเดลนี้รับคลิปเฉพาะไฟล์ MP4 หรือ MOV กรุณาแปลงไฟล์แล้วอัปโหลดใหม่' };
  }
  if (rule.maxBytes && clip.bytes > rule.maxBytes) {
    return { ok: false, code: 'clip-bytes', message: `ไฟล์คลิปใหญ่เกินไป (${mb(clip.bytes)}) — โมเดลนี้รับได้ไม่เกิน ${mb(rule.maxBytes)}` };
  }
  if (rule.minSeconds && clip.seconds < rule.minSeconds) {
    return { ok: false, code: 'clip-short', message: `คลิปสั้นเกินไป (${secs(clip.seconds)} วินาที) — โมเดลนี้ต้องการคลิปอย่างน้อย ${rule.minSeconds} วินาที` };
  }
  if (clip.seconds > rule.maxSeconds + 0.05) {
    return {
      ok: false,
      code: 'clip-long',
      message: `คลิปยาวเกินไป (${secs(clip.seconds)} วินาที) — โมเดลนี้รับได้สูงสุด ${rule.maxSeconds} วินาที ตัดคลิปให้สั้นลงแล้วอัปโหลดใหม่`,
    };
  }
  const small = Math.min(clip.width, clip.height);
  const large = Math.max(clip.width, clip.height);
  if ((rule.minSide && small < rule.minSide) || (rule.maxSide && large > rule.maxSide)) {
    const range = rule.minSide && rule.maxSide ? `ด้านละ ${rule.minSide}–${rule.maxSide} พิกเซล` : rule.maxSide ? `ไม่เกิน ${rule.maxSide} พิกเซล` : `อย่างน้อย ${rule.minSide} พิกเซล`;
    return { ok: false, code: 'clip-size', message: `ความละเอียดคลิป ${clip.width}×${clip.height} ไม่ตรงกับที่โมเดลรับ (${range})` };
  }
  return { ok: true };
}

/** Whether a voice track fits beside its clip. */
export function checkVoice(rule: VoiceRule, voice: { seconds: number; bytes: number }, clipSeconds: number): RuleCheck {
  if (rule.maxBytes && voice.bytes > rule.maxBytes) {
    return { ok: false, code: 'voice-bytes', message: `ไฟล์เสียงใหญ่เกินไป (${mb(voice.bytes)}) — โมเดลนี้รับได้ไม่เกิน ${mb(rule.maxBytes)}` };
  }
  if (rule.minSeconds && voice.seconds < rule.minSeconds) {
    return { ok: false, code: 'voice-short', message: `เสียงสั้นเกินไป (${secs(voice.seconds)} วินาที) — ต้องยาวอย่างน้อย ${rule.minSeconds} วินาที` };
  }
  if (voice.seconds > rule.maxSeconds + 0.05) {
    return { ok: false, code: 'voice-long', message: `เสียงยาวเกินไป (${secs(voice.seconds)} วินาที) — โมเดลนี้รับได้สูงสุด ${rule.maxSeconds} วินาที` };
  }
  if (rule.notLongerThanClip && voice.seconds > clipSeconds + 0.25) {
    return {
      ok: false,
      code: 'voice-past-clip',
      message: `เสียงยาวกว่าคลิป (${secs(voice.seconds)} กับ ${secs(clipSeconds)} วินาที) — โมเดลนี้ทำได้แค่ความยาวของคลิป คำพูดส่วนเกินจะหายไป ใช้คลิปที่ยาวกว่าหรือตัดเสียงให้สั้นลง`,
    };
  }
  return { ok: true };
}

/** Credits for an order: the row's `creditsPerUnit`, times the blocks it bills when it bills by length. */
export function lipsyncCredits(billing: LipsyncBilling, creditsPerUnit: number, clipSeconds: number): number {
  if (billing.kind === 'flat') return creditsPerUnit;
  // A hair over a block boundary from rounding in the header is not a block.
  const blocks = Math.max(1, Math.ceil(clipSeconds / billing.blockSeconds - 1e-3));
  return creditsPerUnit * blocks;
}
