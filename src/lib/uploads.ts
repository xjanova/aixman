/**
 * Rules for user-supplied input files (reference images, voice tracks, clips
 * to re-dub).
 *
 * Everything here treats the browser as hostile. The filename, the MIME type
 * in the multipart part, and the `Content-Length` are all attacker-controlled,
 * so the only fact we trust is the first few bytes of the body — which is what
 * `sniff()` reads. The declared type is used solely to pick which signatures
 * are allowed to match, never as the answer.
 */

export type UploadKind = 'image' | 'audio' | 'video';

export const UPLOAD_KINDS: UploadKind[] = ['image', 'audio', 'video'];

export function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === 'string' && (UPLOAD_KINDS as string[]).includes(value);
}

/**
 * Per-kind ceilings, in bytes.
 *
 * The audio cap is the one that guards spend, not just storage. A lip-sync
 * render is billed on the length of its **output**, and the output follows the
 * voice track — so the voice track is what decides the invoice, while credits
 * are charged flat per generation. 12 MB is comfortably more than forty
 * seconds in any sane format (uncompressed 44.1 kHz stereo WAV is ~7 MB) and
 * far less than the tens of minutes that would turn a 36-credit job into a
 * multi-dollar one.
 *
 * It is a bound, not an exact limit: a deliberately low-bitrate file could
 * still be long. The studio probes duration in the browser before uploading,
 * which catches the honest mistake, and the real fix — decoding server-side —
 * is not worth a media pipeline here. Whoever raises this number should know
 * they are raising the worst-case bill with it.
 *
 * Video only bounds egress and storage: a longer source does not make the
 * render longer, because the voice still decides that.
 */
export const MAX_BYTES: Record<UploadKind, number> = {
  image: 12 * 1024 * 1024,
  audio: 12 * 1024 * 1024,
  video: 120 * 1024 * 1024,
};

/** Thai copy for the cap, so the route does not have to format it. */
export function maxBytesLabel(kind: UploadKind): string {
  return `${Math.round(MAX_BYTES[kind] / (1024 * 1024))} MB`;
}

interface Signature {
  /** Byte pattern; `null` matches any byte at that offset. */
  magic: (number | null)[];
  offset: number;
  contentType: string;
  ext: string;
  /** Extra bytes that must appear further in, e.g. 'WEBP' after 'RIFF'. */
  also?: { offset: number; ascii: string };
}

/**
 * Signatures we accept, grouped by the kind the caller declared.
 *
 * `ftyp` boxes cover MP4, M4A and MOV, which share a container: the brand that
 * follows decides whether it holds video or only audio, and we cannot tell
 * cheaply. They are therefore listed under both kinds and the distinction is
 * left to the model that receives the file — an audio-only MP4 handed to a
 * lip-sync endpoint fails there with a clear message, which is a better place
 * to fail than a byte-level guess here that rejects legitimate recordings.
 */
const SIGNATURES: Record<UploadKind, Signature[]> = {
  image: [
    { magic: [0xff, 0xd8, 0xff], offset: 0, contentType: 'image/jpeg', ext: 'jpg' },
    { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0, contentType: 'image/png', ext: 'png' },
    {
      magic: [0x52, 0x49, 0x46, 0x46],
      offset: 0,
      contentType: 'image/webp',
      ext: 'webp',
      also: { offset: 8, ascii: 'WEBP' },
    },
  ],
  audio: [
    { magic: [0x49, 0x44, 0x33], offset: 0, contentType: 'audio/mpeg', ext: 'mp3' },
    // A frame header with no ID3 tag: 11 sync bits, so the second byte varies.
    { magic: [0xff, null], offset: 0, contentType: 'audio/mpeg', ext: 'mp3' },
    {
      magic: [0x52, 0x49, 0x46, 0x46],
      offset: 0,
      contentType: 'audio/wav',
      ext: 'wav',
      also: { offset: 8, ascii: 'WAVE' },
    },
    { magic: [0x4f, 0x67, 0x67, 0x53], offset: 0, contentType: 'audio/ogg', ext: 'ogg' },
    { magic: [0x66, 0x4c, 0x61, 0x43], offset: 0, contentType: 'audio/flac', ext: 'flac' },
    { magic: [0x66, 0x74, 0x79, 0x70], offset: 4, contentType: 'audio/mp4', ext: 'm4a' },
  ],
  video: [
    { magic: [0x66, 0x74, 0x79, 0x70], offset: 4, contentType: 'video/mp4', ext: 'mp4' },
    { magic: [0x1a, 0x45, 0xdf, 0xa3], offset: 0, contentType: 'video/webm', ext: 'webm' },
  ],
};

export interface SniffResult {
  contentType: string;
  ext: string;
}

/**
 * Identify a buffer against the signatures allowed for `kind`.
 *
 * Returns null when nothing matches, which the caller must treat as a refusal
 * rather than falling back to the declared type — accepting an unrecognised
 * body under a caller-supplied `Content-Type` is how a bucket ends up serving
 * `text/html` from a URL we hand out and vouch for.
 */
export function sniff(buffer: Buffer, kind: UploadKind): SniffResult | null {
  for (const sig of SIGNATURES[kind]) {
    const end = sig.offset + sig.magic.length;
    if (buffer.length < end) continue;

    let matched = true;
    for (let i = 0; i < sig.magic.length; i++) {
      const expected = sig.magic[i];
      if (expected !== null && buffer[sig.offset + i] !== expected) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    if (sig.also) {
      const tail = buffer.subarray(sig.also.offset, sig.also.offset + sig.also.ascii.length);
      if (tail.toString('ascii') !== sig.also.ascii) continue;
    }

    return { contentType: sig.contentType, ext: sig.ext };
  }

  return null;
}

/**
 * Object key for a verified upload.
 *
 * The caller's filename never reaches this — it is the one field a browser
 * lets an attacker fill freely, and a `../` in it would place the object
 * outside the prefix the retention sweep scans. The extension comes from the
 * sniffed signature instead, so the key always describes the actual bytes.
 */
export function uploadKey(userId: number, kind: UploadKind, ext: string): string {
  const id = globalThis.crypto.randomUUID();
  return `uploads/${userId}/${kind}/${id}.${ext}`;
}
