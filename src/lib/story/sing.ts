/**
 * MV lip-sync (ลิปซิงก์เสียงร้อง) — pure, so the page, the API, the cut and the
 * tests share it.
 *
 * The song's lead vocal is taken out once per project (vocals.ts: Demucs on
 * our server, or a stem the customer uploads). Each singing shot gets the
 * slice of it under its place in the song, and LatentSync re-dubs the shot's
 * clip to that slice — an ordinary studio order, priced by the voice.
 */
import { SHOT_SIZES } from './cinematic';

export const LIPSYNC_MODEL_KEY = 'latentsync-1.6';
/** LatentSync renders at most this much voice (catalog LS_MAX_SECONDS). */
export const LIPSYNC_MAX_SECONDS = 20;
/** Its `lengthFromAudio.minSeconds`. */
export const LIPSYNC_MIN_SECONDS = 1;
/** A slice quieter than this (mean, dBFS) has no singing for a mouth to follow. */
export const SILENT_MEAN_DB = -45;
/** An uploaded stem may differ from the song by this much and still line up. */
export const STEM_TOLERANCE_SECONDS = 2;

export type VoiceWindow = { ok: true; start: number; seconds: number } | { ok: false; message: string };

/** The stretch of the vocal a shot mouths: its own place in the song. */
export function voiceWindow(startSec: number | null, durationSec: number): VoiceWindow {
  if (startSec === null || !Number.isFinite(startSec) || startSec < 0) {
    return { ok: false, message: 'ช็อตนี้ไม่มีตำแหน่งในเพลง ให้ AI วางช็อตใหม่ก่อน' };
  }
  if (!Number.isFinite(durationSec) || durationSec < LIPSYNC_MIN_SECONDS) {
    return { ok: false, message: `ช็อตสั้นกว่า ${LIPSYNC_MIN_SECONDS} วินาที ลิปซิงก์ไม่ได้` };
  }
  if (durationSec > LIPSYNC_MAX_SECONDS) {
    return { ok: false, message: `ช็อตยาวเกิน ${LIPSYNC_MAX_SECONDS} วินาที แบ่งเป็นสองช็อตก่อน` };
  }
  return { ok: true, start: Math.round(startSec * 1000) / 1000, seconds: Math.round(durationSec * 1000) / 1000 };
}

/**
 * Worth a dub by default: a lyric line, someone on screen, and a frame tight
 * enough to see a mouth. Wide and full shots are left out — the face is too
 * small to read, and LatentSync refuses a frame with no face it can find.
 */
export function suggestedForLipsync(shot: { line: string; characterIds: number[]; shotSize: string }): boolean {
  return Boolean(shot.line.trim()) && shot.characterIds.length > 0 && SHOT_SIZES[shot.shotSize]?.tight === true;
}

export interface DubFields {
  mediaUrl: string | null;
  lipsyncStatus: string | null;
  lipsyncUrl: string | null;
  lipsyncSourceUrl: string | null;
  lipsyncUse: boolean;
}

export type DubState = 'none' | 'rendering' | 'done' | 'stale' | 'failed';

export function dubState(s: DubFields): DubState {
  if (s.lipsyncStatus === 'rendering') return 'rendering';
  if (s.lipsyncStatus === 'failed') return 'failed';
  if (s.lipsyncStatus === 'done' && s.lipsyncUrl) return s.lipsyncSourceUrl === s.mediaUrl ? 'done' : 'stale';
  return 'none';
}

/** The dub the cut uses: finished, made from the clip the shot has now, and switched on. */
export function usableDub(s: DubFields): boolean {
  return s.lipsyncUse && dubState(s) === 'done';
}

/** `mean_volume` from ffmpeg's volumedetect, or null. */
export function meanVolumeDb(ffmpegLog: string): number | null {
  const m = /mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/.exec(ffmpegLog);
  if (!m) return null;
  return m[1] === '-inf' ? -Infinity : Number(m[1]);
}

export type VocalsState = 'none' | 'separating' | 'done' | 'failed' | 'stale';

/**
 * The project's vocal as the page shows it. `stale`: it was taken from
 * another song than the one the project has now. A separation that has run
 * past `staleMs` died with the process and counts as failed.
 */
export function vocalsState(
  p: { vocalsStatus: string | null; vocalsUrl: string | null; vocalsSongUrl: string | null; songUrl: string | null; vocalsStartedAt: Date | null },
  staleMs: number,
  now = Date.now()
): VocalsState {
  if (p.vocalsStatus === 'separating') {
    return p.vocalsStartedAt && now - p.vocalsStartedAt.getTime() > staleMs ? 'failed' : 'separating';
  }
  if (p.vocalsStatus === 'failed') return 'failed';
  if (p.vocalsStatus === 'done' && p.vocalsUrl) return p.vocalsSongUrl === p.songUrl ? 'done' : 'stale';
  return 'none';
}
