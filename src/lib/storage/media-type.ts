/**
 * What to name a file we copy into R2, and what type to store it as.
 *
 * The extension is read from the type the source answered with. Audio was
 * missing from this table, so every song, voice and stem an API vendor sent
 * was stored as `….bin` (its type was still right): downloads were saved as
 * `.bin` and the studio's audio routes refused them. A vendor that answers
 * `application/octet-stream` is named by the extension of its own URL instead,
 * when that is a type we know. Pure: tests use it.
 */

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
};

/** The type each known extension is stored as (the first type that names it). */
const EXT_MIME: Record<string, string> = {};
for (const [mime, ext] of Object.entries(MIME_EXT)) EXT_MIME[ext] ??= mime;

const UNTYPED = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

function pathExt(src: string): string | null {
  let path = src;
  try {
    path = new URL(src).pathname;
  } catch {
    /* keep the raw string */
  }
  return /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase() ?? null;
}

/** `contentType` as the source sent it (no parameters); `src` its URL. */
export function assetType(contentType: string | null | undefined, src: string): { contentType: string; ext: string } {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const known = MIME_EXT[type];
  if (known) return { contentType: type, ext: known };
  if (UNTYPED.has(type)) {
    const ext = src.startsWith('data:') ? null : pathExt(src);
    if (ext && EXT_MIME[ext]) return { contentType: EXT_MIME[ext], ext };
  }
  return { contentType: type || 'application/octet-stream', ext: 'bin' };
}
