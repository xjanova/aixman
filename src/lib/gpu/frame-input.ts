import { keyFromPublicUrl } from '@/lib/storage/r2';
import { MAX_BYTES, sniff, type SniffResult } from '@/lib/uploads';
import { bufferSource, type ByteSource } from '@/lib/video-probe';

/**
 * First/last-frame stills for a rented-GPU video job.
 *
 * The worker cannot fetch the still itself (it would need our R2 credentials or
 * a public URL of the customer's choosing), so the server reads it and uploads
 * the bytes into ComfyUI's input dir. That makes this a server-side fetch of a
 * caller-supplied value — so only two sources are accepted:
 *
 *  - an image `data:` URL (how the studio has always sent its start frame), or
 *  - a URL minted by our own `/api/uploads` (`keyFromPublicUrl` answers null for
 *    anything outside our bucket).
 *
 * Anything else would let a caller aim our server at any host they like.
 */

const DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/i;
const FETCH_TIMEOUT_MS = 60_000;

export function isAcceptedFrameSource(src: unknown): src is string {
  if (typeof src !== 'string' || src.length === 0) return false;
  if (DATA_URL.test(src)) return true;
  return keyFromPublicUrl(src) !== null;
}

/** Read a frame still into memory and confirm, from its bytes, that it is an image. */
export async function readFrameSource(src: string): Promise<{ bytes: Buffer } & SniffResult> {
  let bytes: Buffer;
  if (DATA_URL.test(src)) {
    bytes = Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
  } else if (keyFromPublicUrl(src) !== null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(src, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not read the frame image (HTTP ${res.status})`);
      bytes = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  } else {
    throw new Error('Frame image must be an upload of ours or an image data URL');
  }

  if (bytes.length === 0 || bytes.length > MAX_BYTES.image) {
    throw new Error('Frame image is empty or larger than the upload limit');
  }
  // What the bytes say, not what the URL or data-URL header claimed.
  const kind = sniff(bytes, 'image');
  if (!kind) throw new Error('Frame image is not a PNG, JPEG or WebP');
  return { bytes, ...kind };
}

/**
 * Same contract for the song a cover is built from: only our own uploads.
 *
 * No data-URL branch here on purpose — a track is megabytes, and the studio
 * already puts audio through `/api/uploads` before it ever reaches a job.
 */
export function isAcceptedAudioSource(src: unknown): src is string {
  return typeof src === 'string' && src.length > 0 && keyFromPublicUrl(src) !== null;
}

export async function readAudioSource(src: string): Promise<{ bytes: Buffer } & SniffResult> {
  if (!isAcceptedAudioSource(src)) {
    throw new Error('Reference song must be an upload of ours');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let bytes: Buffer;
  try {
    const res = await fetch(src, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not read the reference song (HTTP ${res.status})`);
    bytes = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }

  if (bytes.length === 0 || bytes.length > MAX_BYTES.audio) {
    throw new Error('Reference song is empty or larger than the upload limit');
  }
  const kind = sniff(bytes, 'audio');
  if (!kind) throw new Error('Reference song is not a recognised audio file');
  return { bytes, ...kind };
}

/**
 * Same contract for a clip to re-dub: only our own uploads. A clip is up to
 * MAX_BYTES.video, so the order path probes it through range requests
 * (`openVideoSource`) and only a worker that renders it reads it whole.
 */
export function isAcceptedVideoSource(src: unknown): src is string {
  return typeof src === 'string' && src.length > 0 && keyFromPublicUrl(src) !== null;
}

/** The first chunk read of a clip: holds the container's signature and a WebM's headers. */
const VIDEO_HEAD_BYTES = 1024 * 1024;

/**
 * A stored clip as random-access bytes, for video-probe.ts: one range request
 * for the head, and another only for what lies past it (an MP4's moov after
 * its media). A bucket that ignores Range answers with the whole file, which
 * is then read from memory.
 */
export async function openVideoSource(src: string): Promise<{ source: ByteSource; bytes: number } & SniffResult> {
  if (!isAcceptedVideoSource(src)) throw new Error('Source clip must be an upload of ours');

  const fetchRange = async (start: number, end: number): Promise<{ body: Buffer; total: number | null; partial: boolean }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(src, { signal: controller.signal, cache: 'no-store', headers: { Range: `bytes=${start}-${end}` } });
      if (res.status !== 206 && res.status !== 200) throw new Error(`Could not read the source clip (HTTP ${res.status})`);
      const total = Number(res.headers.get('content-range')?.split('/')[1]);
      const body = Buffer.from(await res.arrayBuffer());
      return { body, total: Number.isFinite(total) && total > 0 ? total : null, partial: res.status === 206 };
    } finally {
      clearTimeout(timer);
    }
  };

  const head = await fetchRange(0, VIDEO_HEAD_BYTES - 1);
  const bytes = head.partial ? head.total ?? head.body.length : head.body.length;
  if (bytes === 0 || bytes > MAX_BYTES.video) throw new Error('Source clip is empty or larger than the upload limit');
  const kind = sniff(head.body, 'video');
  if (!kind) throw new Error('Source clip is not a recognised video file');

  if (!head.partial || head.body.length >= bytes) return { source: bufferSource(head.body), bytes, ...kind };
  const source: ByteSource = {
    size: bytes,
    read: async (offset, length) => {
      const end = Math.min(bytes, offset + length);
      if (end <= head.body.length) return head.body.subarray(offset, end);
      if (end <= offset) return Buffer.alloc(0);
      return (await fetchRange(offset, end - 1)).body;
    },
  };
  return { source, bytes, ...kind };
}

/** A clip whole, for the worker that renders it; confirmed from its bytes to be a video. */
export async function readVideoSource(src: string): Promise<{ bytes: Buffer } & SniffResult> {
  if (!isAcceptedVideoSource(src)) throw new Error('Source clip must be an upload of ours');
  const controller = new AbortController();
  // A clip is far larger than a still or a voice; give it a few minutes.
  const timer = setTimeout(() => controller.abort(), 4 * FETCH_TIMEOUT_MS);
  let bytes: Buffer;
  try {
    const res = await fetch(src, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not read the source clip (HTTP ${res.status})`);
    bytes = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
  if (bytes.length === 0 || bytes.length > MAX_BYTES.video) {
    throw new Error('Source clip is empty or larger than the upload limit');
  }
  const kind = sniff(bytes, 'video');
  if (!kind) throw new Error('Source clip is not a recognised video file');
  return { bytes, ...kind };
}
