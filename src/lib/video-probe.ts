/**
 * How long a video runs and how big its picture is, read from the container's
 * headers — no decoding.
 *
 * A clip to re-dub is priced and checked by these numbers (Kling's lip-sync
 * takes 2–10 s at 720–1920 px; a rented card holds only so many frames), and
 * anyone can post an order without the studio, so the server reads them from
 * the bytes it stored and never takes a client's word for them.
 *
 * Covers the containers `/api/uploads` accepts for video (uploads.ts
 * `SIGNATURES.video`): ISO BMFF (MP4, and MOV, which phones write with an
 * `ftyp` too) and Matroska/WebM. Hand-written for the same reason as
 * audio-duration.ts: production runs Node 20, and the few fields needed are a
 * page of code.
 *
 * Reads through `ByteSource`, so a stored upload is probed with a couple of
 * HTTP range requests instead of fetching up to 120 MB: an MP4's `moov` can
 * sit after the media data, and only its offset is known up front.
 *
 * Returns null whenever the answer is not certain — the caller refuses on
 * null rather than pricing a guess.
 */

export interface VideoProbe {
  seconds: number;
  /** Displayed size: a phone clip stored landscape with a 90° rotation reports portrait. */
  width: number;
  height: number;
}

/** Random access to a file's bytes; may return fewer than asked at the end. */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

/** Longer than any clip the upload cap allows; past it a header is lying. */
const MAX_PLAUSIBLE_SECONDS = 6 * 60 * 60;
/** A `moov` larger than this is not one we will load (hours of sample tables). */
const MAX_MOOV_BYTES = 48 * 1024 * 1024;
/** Matroska keeps Info and Tracks near the start; this much always holds them. */
const WEBM_HEAD_BYTES = 1024 * 1024;

export function bufferSource(buf: Buffer): ByteSource {
  return { size: buf.length, read: async (offset, length) => buf.subarray(offset, Math.min(buf.length, offset + length)) };
}

export async function probeVideo(source: ByteSource, ext: string): Promise<VideoProbe | null> {
  let probe: VideoProbe | null;
  try {
    probe = ext === 'webm' || ext === 'mkv' ? await probeMatroska(source) : await probeIsoBmff(source);
  } catch {
    return null;
  }
  if (!probe) return null;
  const { seconds, width, height } = probe;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_PLAUSIBLE_SECONDS) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    return null;
  }
  return probe;
}

/** Same as probeVideo, for a file already in memory (the upload route). */
export function probeVideoBuffer(buf: Buffer, ext: string): Promise<VideoProbe | null> {
  return probeVideo(bufferSource(buf), ext);
}

// ---------------------------------------------------------------------------
// MP4 / MOV — mvhd for the length, the video track's tkhd for the picture
// ---------------------------------------------------------------------------

interface Box {
  type: string;
  body: number;
  end: number;
}

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header) return;
    yield { type, body: pos + header, end: Math.min(end, pos + size) };
    pos += size;
  }
}

/** Walk the top level by box headers alone, then load only `moov`. */
async function probeIsoBmff(source: ByteSource): Promise<VideoProbe | null> {
  let pos = 0;
  for (let guard = 0; guard < 64 && pos + 8 <= source.size; guard++) {
    const head = await source.read(pos, 16);
    if (head.length < 8) return null;
    let size = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    if (size === 1) {
      if (head.length < 16) return null;
      size = Number(head.readBigUInt64BE(8));
    } else if (size === 0) {
      size = source.size - pos;
    }
    if (size < 8) return null;
    if (type === 'moov') {
      if (size > MAX_MOOV_BYTES) return null;
      const moov = await source.read(pos, size);
      if (moov.length < size) return null;
      return parseMoov(moov);
    }
    pos += size;
  }
  return null;
}

function parseMoov(buf: Buffer): VideoProbe | null {
  const [moov] = [...boxes(buf, 0, buf.length)];
  if (!moov || moov.type !== 'moov') return null;
  let seconds: number | null = null;
  let picture: { width: number; height: number } | null = null;
  for (const child of boxes(buf, moov.body, moov.end)) {
    if (child.type === 'mvhd') seconds = mvhdSeconds(buf, child);
    else if (child.type === 'trak' && !picture) picture = videoTrackSize(buf, child);
  }
  return seconds !== null && picture ? { seconds, ...picture } : null;
}

function mvhdSeconds(buf: Buffer, box: Box): number | null {
  const version = buf[box.body];
  const timescale = version === 1 ? buf.readUInt32BE(box.body + 20) : buf.readUInt32BE(box.body + 12);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(box.body + 24)) : buf.readUInt32BE(box.body + 16);
  return timescale > 0 ? duration / timescale : null;
}

/** The track's picture, if it is a video track; rotated by its matrix. */
function videoTrackSize(buf: Buffer, trak: Box): { width: number; height: number } | null {
  let tkhd: Box | undefined;
  let isVideo = false;
  for (const child of boxes(buf, trak.body, trak.end)) {
    if (child.type === 'tkhd') tkhd = child;
    if (child.type === 'mdia') {
      for (const m of boxes(buf, child.body, child.end)) {
        // hdlr: version/flags, pre_defined, then the handler type.
        if (m.type === 'hdlr' && buf.toString('latin1', m.body + 8, m.body + 12) === 'vide') isVideo = true;
      }
    }
  }
  if (!tkhd || !isVideo) return null;
  const v1 = buf[tkhd.body] === 1;
  // version/flags, two times, track id, reserved, duration (32 or 64 bit),
  // 8 reserved, layer, group, volume, 2 reserved, then the 3x3 matrix.
  const matrix = tkhd.body + (v1 ? 52 : 40);
  const sizeAt = matrix + 36;
  if (sizeAt + 8 > tkhd.end) return null;
  const width = Math.round(buf.readUInt32BE(sizeAt) / 65536);
  const height = Math.round(buf.readUInt32BE(sizeAt + 4) / 65536);
  // a b u / c d v / x y w — a 90° or 270° turn puts the cosine terms at zero.
  const a = buf.readInt32BE(matrix);
  const b = buf.readInt32BE(matrix + 4);
  const quarterTurn = a === 0 && Math.abs(b) === 65536;
  return quarterTurn ? { width: height, height: width } : { width, height };
}

// ---------------------------------------------------------------------------
// Matroska / WebM — Segment > Info (scale, duration) and Tracks > video size
// ---------------------------------------------------------------------------

const ID = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackType: 0x83,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
} as const;

interface Element {
  id: number;
  body: number;
  /** Null when the size is "unknown" (a live recording's Segment or Cluster). */
  end: number | null;
}

/** An EBML element ID keeps its length marker; the size drops it. */
function readId(buf: Buffer, pos: number): { value: number; length: number } | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (length < 1 || length > 4 || pos + length > buf.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i];
  return { value, length };
}

function readSize(buf: Buffer, pos: number): { value: number | null; length: number } | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (length < 1 || length > 8 || pos + length > buf.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value: allOnes ? null : value, length };
}

function* elements(buf: Buffer, start: number, end: number): Generator<Element> {
  let pos = start;
  while (pos < end) {
    const id = readId(buf, pos);
    if (!id) return;
    const size = readSize(buf, pos + id.length);
    if (!size) return;
    const body = pos + id.length + size.length;
    const elEnd = size.value === null ? null : body + size.value;
    yield { id: id.value, body, end: elEnd === null ? null : Math.min(elEnd, end) };
    if (elEnd === null) return; // an unknown-size child runs to its parent's end
    pos = elEnd;
  }
}

function readUint(buf: Buffer, el: Element): number {
  let value = 0;
  for (let i = el.body; i < (el.end ?? el.body); i++) value = value * 256 + buf[i];
  return value;
}

function readFloat(buf: Buffer, el: Element): number | null {
  const length = (el.end ?? el.body) - el.body;
  if (length === 4) return buf.readFloatBE(el.body);
  if (length === 8) return buf.readDoubleBE(el.body);
  return null;
}

async function probeMatroska(source: ByteSource): Promise<VideoProbe | null> {
  const buf = await source.read(0, Math.min(source.size, WEBM_HEAD_BYTES));
  let segment: Element | undefined;
  for (const el of elements(buf, 0, buf.length)) {
    if (el.id === ID.Segment) {
      segment = el;
      break;
    }
  }
  if (!segment) return null;

  let scale = 1_000_000;
  let duration: number | null = null;
  let picture: { width: number; height: number } | null = null;
  for (const el of elements(buf, segment.body, segment.end ?? buf.length)) {
    if (el.id === ID.Cluster) break; // media from here on; the headers are behind us
    if (el.end === null) continue;
    if (el.id === ID.Info) {
      for (const f of elements(buf, el.body, el.end)) {
        if (f.id === ID.TimestampScale) scale = readUint(buf, f) || scale;
        if (f.id === ID.Duration) duration = readFloat(buf, f);
      }
    } else if (el.id === ID.Tracks && !picture) {
      picture = matroskaVideoSize(buf, el);
    }
  }
  // A browser's MediaRecorder writes no Duration; the length would have to be
  // read off the last cluster, so such a file is refused rather than guessed.
  if (duration === null || !picture) return null;
  return { seconds: (duration * scale) / 1e9, ...picture };
}

function matroskaVideoSize(buf: Buffer, tracks: Element): { width: number; height: number } | null {
  for (const entry of elements(buf, tracks.body, tracks.end ?? buf.length)) {
    if (entry.id !== ID.TrackEntry || entry.end === null) continue;
    let type = 0;
    let video: Element | undefined;
    for (const f of elements(buf, entry.body, entry.end)) {
      if (f.id === ID.TrackType) type = readUint(buf, f);
      if (f.id === ID.Video) video = f;
    }
    if (type !== 1 || !video || video.end === null) continue;
    // The pixel grid, which is what a model is fed; DisplayWidth/Height are
    // only an aspect hint.
    let width = 0;
    let height = 0;
    for (const f of elements(buf, video.body, video.end)) {
      if (f.id === ID.PixelWidth) width = readUint(buf, f);
      if (f.id === ID.PixelHeight) height = readUint(buf, f);
    }
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}
