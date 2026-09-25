/**
 * GPUxMINE — is what a home PC handed back a real render?
 *
 * The owner of a community node holds a token the relay accepts, so a modified
 * agent can answer /history with "success" and /view with any bytes it likes,
 * under any Content-Type it likes. Before a community render reaches the
 * customer, and before its owner is paid for it, the bytes are looked at: what
 * they actually are (magic bytes, never the node's word for it), whether they
 * are empty, tiny or one flat colour, and whether the render came back faster
 * than any card could have made it.
 *
 * Two outcomes besides "fine":
 *  - reject: not delivered at all. The bytes are not the kind of media the
 *    model makes — empty, HTML, an archive, an image that does not decode,
 *    audio from an image model. Serving them from our storage would hand the
 *    customer junk (or a script), so the job goes to another machine, and the
 *    node is paid nothing because it delivered nothing.
 *  - review: delivered, because it is a real file of the right kind, but the
 *    earning waits for an admin (gpu_job_earnings.status = 'review',
 *    review_reason in Thai). An honest node never trips these; a cheap cheat
 *    does, and its money is held instead of paid.
 *
 * Everything here is a decision on facts passed in, except `inspectImage`,
 * which decodes with sharp.
 */

export type MediaKind = 'image' | 'video' | 'audio';

export interface SniffedMedia {
  /** The Content-Type the bytes really are — what the file is stored and served as. */
  mime: string;
  kind: MediaKind;
}

function ascii(buf: Uint8Array, from: number, length: number): string {
  if (buf.length < from + length) return '';
  let out = '';
  for (let i = from; i < from + length; i++) out += String.fromCharCode(buf[i]);
  return out;
}

function startsWith(buf: Uint8Array, bytes: readonly number[], at = 0): boolean {
  if (buf.length < at + bytes.length) return false;
  return bytes.every((b, i) => buf[at + i] === b);
}

/** A short ASCII marker somewhere in the first `within` bytes. */
function contains(buf: Uint8Array, marker: string, within: number): boolean {
  const end = Math.min(buf.length, within) - marker.length;
  for (let i = 0; i <= end; i++) {
    let hit = true;
    for (let j = 0; j < marker.length; j++) {
      if (buf[i + j] !== marker.charCodeAt(j)) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * What the bytes are, from their first few bytes; null when they are no media
 * type a model here produces. Order matters only where two formats share a
 * prefix (RIFF: WebP / WAV / AVI; 0xFF: JPEG / AAC / MP3).
 */
export function sniffMedia(buf: Uint8Array): SniffedMedia | null {
  if (buf.length < 4) return null;

  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', kind: 'image' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', kind: 'image' };
  const gif = ascii(buf, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return { mime: 'image/gif', kind: 'image' };

  if (ascii(buf, 0, 4) === 'RIFF') {
    const form = ascii(buf, 8, 4);
    if (form === 'WEBP') return { mime: 'image/webp', kind: 'image' };
    if (form === 'WAVE') return { mime: 'audio/wav', kind: 'audio' };
    if (form === 'AVI ') return { mime: 'video/x-msvideo', kind: 'video' };
    return null;
  }

  // ISO base media (MP4, MOV, M4A, AVIF): a size, then 'ftyp' and a brand.
  if (ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', kind: 'image' };
    if (brand === 'M4A ' || brand === 'M4B ' || brand === 'M4P ') return { mime: 'audio/mp4', kind: 'audio' };
    if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video' };
    return { mime: 'video/mp4', kind: 'video' };
  }

  // EBML: WebM, or Matroska in general.
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    return contains(buf, 'webm', 64) ? { mime: 'video/webm', kind: 'video' } : { mime: 'video/x-matroska', kind: 'video' };
  }

  if (ascii(buf, 0, 4) === 'fLaC') return { mime: 'audio/flac', kind: 'audio' };
  if (ascii(buf, 0, 4) === 'OggS') {
    return contains(buf, 'OpusHead', 64) ? { mime: 'audio/opus', kind: 'audio' } : { mime: 'audio/ogg', kind: 'audio' };
  }
  if (ascii(buf, 0, 3) === 'ID3') return { mime: 'audio/mpeg', kind: 'audio' };
  if (buf[0] === 0xff) {
    // ADTS AAC: sync 0xFFF, layer 00.
    if ((buf[1] & 0xf6) === 0xf0) return { mime: 'audio/aac', kind: 'audio' };
    // MPEG audio frame: sync 0xFFE, layer not "reserved".
    if ((buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return { mime: 'audio/mpeg', kind: 'audio' };
  }
  return null;
}

/**
 * Whether media of this kind is what a model producing `expected` hands back.
 * A video model may save an animated GIF or WebP; nothing else crosses kinds.
 */
export function acceptableFor(expected: MediaKind | null | undefined, sniffed: SniffedMedia): boolean {
  if (!expected) return true;
  if (sniffed.kind === expected) return true;
  return expected === 'video' && (sniffed.mime === 'image/gif' || sniffed.mime === 'image/webp');
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/** Smaller than this is not a render of its kind, whatever it decodes to. */
export const MIN_OUTPUT_BYTES: Record<MediaKind, number> = {
  image: 1_024,
  audio: 8_192,
  video: 16_384,
};

/** An image narrower or shorter than this is a placeholder, not a render. */
export const MIN_IMAGE_SIDE_PX = 64;

/**
 * Colour channels whose standard deviation (0-255) all stay under this are
 * one flat colour: a black frame, a white page, a grey square.
 */
export const FLAT_STDEV = 2;

/**
 * Largest image decoded to look at it. Far above any render here (community
 * models stop at 1024²), and low enough that a decompression bomb — a few KB
 * of PNG claiming 50,000² pixels — is refused before it takes the process's
 * memory. Refused means undecodable, which means rejected.
 */
export const MAX_INSPECT_PIXELS = 40_000_000;

export interface ImageFacts {
  width: number;
  height: number;
  /** Every colour channel is (nearly) one value. */
  flat: boolean;
}

export interface OutputFacts {
  bytes: number;
  sniffed: SniffedMedia | null;
  /**
   * For an image: what decoding it found. null = it did not decode;
   * undefined = not examined (not an image, or no decoder available).
   */
  image?: ImageFacts | null;
}

export interface OutputVerdict {
  /** Not delivered: English, for the job's error message and the admin. */
  reject?: string;
  /** Delivered, earning held for an admin: Thai, for review_reason. */
  review?: string;
}

export function judgeOutput(output: OutputFacts, expected: MediaKind | null | undefined): OutputVerdict {
  if (output.bytes <= 0) return { reject: 'the node returned an empty file' };
  if (!output.sniffed) return { reject: 'the node returned a file that is not image, video or audio' };
  if (!acceptableFor(expected, output.sniffed)) {
    return { reject: `the node returned ${output.sniffed.mime} for a model that makes ${expected}` };
  }
  if (output.sniffed.kind === 'image' && output.image === null) {
    return { reject: `the node returned an ${output.sniffed.mime} that does not decode` };
  }

  const kind = output.sniffed.kind;
  if (output.bytes < MIN_OUTPUT_BYTES[kind]) {
    return { review: `ไฟล์ผลงานเล็กผิดปกติ (${output.bytes} ไบต์ · ${output.sniffed.mime})` };
  }
  if (output.image) {
    const { width, height, flat } = output.image;
    if (width < MIN_IMAGE_SIDE_PX || height < MIN_IMAGE_SIDE_PX) {
      return { review: `ภาพผลงานเล็กผิดปกติ (${width}×${height} พิกเซล)` };
    }
    if (flat) return { review: `ภาพผลงานเป็นสีเดียวทั้งภาพ (${width}×${height})` };
  }
  return {};
}

/**
 * Decode an image just far enough to judge it. null when it does not decode
 * (or is bigger than MAX_INSPECT_PIXELS); undefined when sharp is unavailable,
 * so a missing native module holds nothing back.
 */
export async function inspectImage(buffer: Buffer): Promise<ImageFacts | null | undefined> {
  type Sharp = typeof import('sharp');
  let sharp: Sharp;
  try {
    // A CommonJS module: its function is `default` when imported as ESM.
    const mod = (await import('sharp')) as unknown as Sharp & { default?: Sharp };
    sharp = mod.default ?? mod;
  } catch {
    return undefined;
  }
  try {
    const image = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_INSPECT_PIXELS });
    const meta = await image.metadata();
    const stats = await image.stats();
    const colour = stats.channels.slice(0, meta.hasAlpha ? Math.max(1, stats.channels.length - 1) : stats.channels.length);
    return {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      flat: colour.length > 0 && colour.every((c) => c.stdev < FLAT_STDEV),
    };
  } catch {
    return null;
  }
}

/**
 * Thrown while collecting a community render whose bytes are not the model's
 * media: the render is not delivered, and the job moves to another machine.
 */
export class RejectedOutputError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'RejectedOutputError';
  }
}

export function isRejectedOutput(error: unknown): error is RejectedOutputError {
  return error instanceof RejectedOutputError || (error as { name?: unknown } | null)?.name === 'RejectedOutputError';
}

export interface ExaminedOutput extends OutputVerdict {
  /** What to store and serve the file as: the sniffed type, never the node's header. */
  mime: string;
}

/** One downloaded community file, judged: sniff, decode an image, apply judgeOutput. */
export async function examineOutput(buffer: Buffer, expected: MediaKind | null | undefined): Promise<ExaminedOutput> {
  const sniffed = sniffMedia(buffer);
  const image = sniffed?.kind === 'image' ? await inspectImage(buffer) : undefined;
  const verdict = judgeOutput({ bytes: buffer.byteLength, sniffed, image }, expected);
  return { ...verdict, mime: sniffed?.mime ?? 'application/octet-stream' };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * How much faster than the catalogue's reference card (baselineSecondsPerUnit)
 * a node in each lane can plausibly be. A full-lane node may be a card far
 * above the reference, and a customer may ask for fewer steps than the
 * default, so the bar is low: forty times. A slow-lane node measured itself
 * slower than a waiting customer accepts; ten times the reference is already
 * implausible for it.
 */
export const LANE_SPEEDUP_CAP: Record<'full' | 'slow', number> = { full: 40, slow: 10 };

/** No render of anything here finishes in under a second, on any card. */
export const MIN_RENDER_SECONDS = 1;

export function minPlausibleRenderSeconds(baselineSecondsPerUnit: number | null | undefined, lane: string | null | undefined): number {
  const baseline = Number(baselineSecondsPerUnit);
  if (!Number.isFinite(baseline) || baseline <= 0) return MIN_RENDER_SECONDS;
  const cap = lane === 'slow' ? LANE_SPEEDUP_CAP.slow : LANE_SPEEDUP_CAP.full;
  return Math.max(MIN_RENDER_SECONDS, baseline / cap);
}

/**
 * The review reason when a render came back faster than its lane allows, or
 * null. `observedSeconds` is the shortest honest reading available: the
 * wall-clock from claim to delivery is an upper bound on the render, and the
 * node's own execution timestamps, when it sends them, are tighter still.
 */
export function judgeRenderTime(input: {
  observedSeconds: number | null | undefined;
  baselineSecondsPerUnit: number | null | undefined;
  lane: string | null | undefined;
}): string | null {
  // Unknown is not zero: Number(null) would read a missing clock as an
  // instant render.
  const seconds = input.observedSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const floor = minPlausibleRenderSeconds(input.baselineSecondsPerUnit, input.lane);
  if (seconds >= floor) return null;
  const lane = input.lane === 'slow' ? 'slow' : 'full';
  return `เรนเดอร์เสร็จเร็วผิดปกติ (${seconds.toFixed(1)} วินาที · ต่ำสุดที่เป็นไปได้ของเลน ${lane} ${floor.toFixed(1)} วินาที)`;
}

/** Joins review reasons into what fits gpu_job_earnings.review_reason (VARCHAR 255). */
export function joinReviewReasons(reasons: readonly (string | null | undefined)[]): string | null {
  const unique = [...new Set(reasons.filter((r): r is string => typeof r === 'string' && r.trim() !== ''))];
  if (unique.length === 0) return null;
  const joined = unique.join(' · ');
  return joined.length > 255 ? `${joined.slice(0, 254)}…` : joined;
}
