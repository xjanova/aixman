/**
 * How long a voice track runs, read from the file's own headers — no decoding.
 *
 * A lip-sync render is as long as its voice track: the customer's recording
 * decides how many frames are made, so it decides what the GPU time costs and
 * what the order is priced at. The studio measures it in the browser before
 * uploading, but anyone can post an order without the studio, so the server
 * reads the length itself from the bytes it stored and never from a number
 * the client sends.
 *
 * Covers exactly the containers `/api/uploads` accepts for audio (uploads.ts
 * `SIGNATURES.audio`): MP3, WAV, FLAC, Ogg (Vorbis or Opus) and M4A. Written
 * here rather than pulled from a package because the media libraries that do
 * this need Node 22 and production runs 20, and each format below needs only
 * a few header fields.
 *
 * Returns null whenever the answer is not certain — an unknown container, a
 * truncated header, a stream with no frames. The caller refuses the order on
 * null rather than guessing a length and pricing the guess.
 */

export type AudioExt = 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a';

/** Longer than any upload the size cap allows at a sane bitrate; past it the header is lying. */
const MAX_PLAUSIBLE_SECONDS = 6 * 60 * 60;

export function audioDurationSeconds(bytes: Uint8Array, ext: string): number | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let seconds: number | null;
  try {
    switch (ext) {
      case 'mp3':
        seconds = mp3Duration(buf);
        break;
      case 'wav':
        seconds = wavDuration(buf);
        break;
      case 'flac':
        seconds = flacDuration(buf);
        break;
      case 'ogg':
        seconds = oggDuration(buf);
        break;
      case 'm4a':
      case 'mp4':
        seconds = mp4Duration(buf);
        break;
      default:
        seconds = null;
    }
  } catch {
    // A header that points past the end of the buffer throws a RangeError on
    // read; that is a file we cannot vouch for, not a server error.
    seconds = null;
  }
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_PLAUSIBLE_SECONDS) return null;
  return seconds;
}

// ---------------------------------------------------------------------------
// MP3 — walk every frame header and add up the samples
// ---------------------------------------------------------------------------
// A Xing/VBRI header would give the frame count at once, but not every encoder
// writes one, and a CBR estimate from file size is wrong for VBR files. Walking
// the frames is exact for both and cheap at the sizes the upload cap allows.

const MP3_BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

const MP3_SAMPLE_RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
};

interface Mp3Frame {
  /** 1, 2 or 25 (MPEG-2.5). */
  version: number;
  layer: number;
  sampleRate: number;
  samples: number;
  length: number;
}

function mp3Frame(buf: Buffer, pos: number): Mp3Frame | null {
  if (pos + 4 > buf.length) return null;
  const b1 = buf[pos + 1];
  const b2 = buf[pos + 2];
  if (buf[pos] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  if (versionBits === 1 || layerBits === 0) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
  const layer = 4 - layerBits;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const rateIndex = (b2 >> 2) & 3;
  // Free-format streams carry no bitrate to size a frame by.
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;

  const kbps = MP3_BITRATES[`${version === 1 ? 1 : 2}-${layer}`][bitrateIndex];
  const sampleRate = MP3_SAMPLE_RATES[version][rateIndex];
  const padding = (b2 >> 1) & 1;
  const bps = kbps * 1000;

  let samples: number;
  let length: number;
  if (layer === 1) {
    samples = 384;
    length = (Math.floor((12 * bps) / sampleRate) + padding) * 4;
  } else if (layer === 2 || version === 1) {
    samples = 1152;
    length = Math.floor((144 * bps) / sampleRate) + padding;
  } else {
    samples = 576;
    length = Math.floor((72 * bps) / sampleRate) + padding;
  }
  if (length < 4) return null;
  return { version, layer, sampleRate, samples, length };
}

function sameStream(a: Mp3Frame, b: Mp3Frame): boolean {
  return a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate;
}

/** A frame header that the next frame confirms — a lone 0xFFEx in tag data is not one. */
function confirmedFrame(buf: Buffer, pos: number): Mp3Frame | null {
  const frame = mp3Frame(buf, pos);
  if (!frame) return null;
  const next = pos + frame.length;
  // The last frame of the file has nothing after it to confirm it.
  if (next >= buf.length - 4) return frame;
  const following = mp3Frame(buf, next);
  return following && sameStream(frame, following) ? frame : null;
}

function skipId3v2(buf: Buffer): number {
  let pos = 0;
  // Some files carry more than one tag back to back.
  while (pos + 10 <= buf.length && buf.toString('latin1', pos, pos + 3) === 'ID3') {
    const size = ((buf[pos + 6] & 0x7f) << 21) | ((buf[pos + 7] & 0x7f) << 14) | ((buf[pos + 8] & 0x7f) << 7) | (buf[pos + 9] & 0x7f);
    const footer = buf[pos + 5] & 0x10 ? 10 : 0;
    pos += 10 + size + footer;
  }
  return pos;
}

/** Bytes searched for the next frame after junk mid-stream before giving up. */
const MP3_RESYNC_WINDOW = 8192;

function mp3Duration(buf: Buffer): number | null {
  let pos = skipId3v2(buf);

  let first: Mp3Frame | null = null;
  const searchEnd = Math.min(buf.length, pos + 64 * 1024);
  for (; pos < searchEnd; pos++) {
    first = confirmedFrame(buf, pos);
    if (first) break;
  }
  if (!first) return null;

  let samples = 0;
  let frames = 0;
  while (pos < buf.length) {
    const frame = mp3Frame(buf, pos);
    if (frame && sameStream(first, frame) && pos + frame.length <= buf.length) {
      samples += frame.samples;
      frames += 1;
      pos += frame.length;
      continue;
    }
    // ID3v1 / APE tags close the stream.
    const tag = buf.toString('latin1', pos, pos + 8);
    if (tag.startsWith('TAG') || tag === 'APETAGEX') break;
    let resynced = -1;
    for (let p = pos + 1; p < Math.min(buf.length, pos + MP3_RESYNC_WINDOW); p++) {
      const candidate = confirmedFrame(buf, p);
      if (candidate && sameStream(first, candidate)) {
        resynced = p;
        break;
      }
    }
    if (resynced < 0) break;
    pos = resynced;
  }
  return frames > 0 ? samples / first.sampleRate : null;
}

// ---------------------------------------------------------------------------
// WAV — data size over byte rate
// ---------------------------------------------------------------------------

function wavDuration(buf: Buffer): number | null {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let byteRate = 0;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === 'data') {
      if (byteRate <= 0) return null;
      // A recorder that never patched the header (0 or 0xFFFFFFFF) leaves the
      // data running to the end of the file.
      const available = buf.length - body;
      const dataBytes = size === 0 || size === 0xffffffff || size > available ? available : size;
      return dataBytes / byteRate;
    }
    // Chunks are padded to an even length.
    pos = body + size + (size & 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// FLAC — STREAMINFO carries the total sample count
// ---------------------------------------------------------------------------

function flacDuration(buf: Buffer): number | null {
  if (buf.toString('latin1', 0, 4) !== 'fLaC') return null;
  const header = 4;
  // STREAMINFO is required to be the first metadata block.
  if ((buf[header] & 0x7f) !== 0) return null;
  const info = header + 4;
  const sampleRate = (buf[info + 10] << 12) | (buf[info + 11] << 4) | (buf[info + 12] >> 4);
  const totalSamples = (buf[info + 13] & 0x0f) * 2 ** 32 + buf.readUInt32BE(info + 14);
  // Zero means "unknown" in the spec — an encoder streaming to a pipe.
  if (sampleRate <= 0 || totalSamples <= 0) return null;
  return totalSamples / sampleRate;
}

// ---------------------------------------------------------------------------
// Ogg — granule position of the last page
// ---------------------------------------------------------------------------

function oggDuration(buf: Buffer): number | null {
  if (buf.toString('latin1', 0, 4) !== 'OggS') return null;
  const serial = buf.readUInt32LE(14);
  const segments = buf[26];
  const data = 27 + segments;

  let rate: number;
  let preSkip = 0;
  if (buf[data] === 0x01 && buf.toString('latin1', data + 1, data + 7) === 'vorbis') {
    rate = buf.readUInt32LE(data + 12);
  } else if (buf.toString('latin1', data, data + 8) === 'OpusHead') {
    // Opus granules always count 48 kHz samples, whatever the input rate was.
    rate = 48000;
    preSkip = buf.readUInt16LE(data + 10);
  } else {
    return null;
  }
  if (rate <= 0) return null;

  // Last page of this stream that finishes a packet (granule −1 means none does).
  for (let pos = buf.length - 27; pos >= 0; pos--) {
    if (buf[pos] !== 0x4f || buf.toString('latin1', pos, pos + 4) !== 'OggS') continue;
    if (buf.readUInt32LE(pos + 14) !== serial) continue;
    const granule = buf.readBigInt64LE(pos + 6);
    if (granule < BigInt(0)) continue;
    const samples = Number(granule) - preSkip;
    return samples > 0 ? samples / rate : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// M4A / MP4 — the movie header's duration over its timescale
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

function mp4Duration(buf: Buffer): number | null {
  for (const box of boxes(buf, 0, buf.length)) {
    if (box.type !== 'moov') continue;
    for (const child of boxes(buf, box.body, box.end)) {
      if (child.type !== 'mvhd') continue;
      const version = buf[child.body];
      const timescale = version === 1 ? buf.readUInt32BE(child.body + 20) : buf.readUInt32BE(child.body + 12);
      const duration = version === 1 ? Number(buf.readBigUInt64BE(child.body + 24)) : buf.readUInt32BE(child.body + 16);
      if (timescale <= 0) return null;
      return duration / timescale;
    }
  }
  return null;
}
