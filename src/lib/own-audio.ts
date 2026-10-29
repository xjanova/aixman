/**
 * Which audio files a customer's browser may read through our own origin.
 *
 * R2 sends no CORS header, so the page can play a file there but not read its
 * bytes — and a waveform needs the bytes. `/api/studio/audio/file` hands them
 * over for the caller's own files only, decided from the object key alone:
 * keys are `uploads/<userId>/audio/<file>` (what they uploaded) and
 * `generations/<userId>/<generationId>/<file>` (what their orders delivered).
 * Pure: tests use it.
 */

/** Types an audio file is served as, by its extension. */
export const AUDIO_TYPE: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
};

/** Whether `key` (from `keyFromPublicUrl`) is one of `userId`'s uploads or results. */
export function isOwnAudioKey(key: string | null | undefined, userId: number): boolean {
  if (!key || !Number.isInteger(userId) || userId <= 0 || key.includes('..') || key.includes('%')) return false;
  return new RegExp(`(^|/)(?:uploads/${userId}/audio|generations/${userId}/\\d+)/[A-Za-z0-9][A-Za-z0-9._-]*$`).test(key);
}

/**
 * The type to serve `key` as, or null when it is not audio. By its extension;
 * a file copied in as `.bin` before audio types had names (media-type.ts) is
 * served as the type it was stored with, when that is audio.
 */
export function audioTypeFor(key: string, storedType: string | null | undefined): string | null {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(key)?.[1]?.toLowerCase() ?? '';
  if (AUDIO_TYPE[ext]) return AUDIO_TYPE[ext];
  const stored = (storedType ?? '').split(';')[0].trim().toLowerCase();
  return ext === 'bin' && /^audio\/[a-z0-9.+-]+$/.test(stored) ? stored : null;
}

/** The same-origin address of an audio file's bytes; a page-local URL (blob:, data:, ours) is already readable. */
export function readableAudioUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/studio/audio/file?src=${encodeURIComponent(url)}` : url;
}
