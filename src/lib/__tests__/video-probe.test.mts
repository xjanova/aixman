/**
 * Reading a clip's length and picture size from its headers.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/video-probe.test.mts)
 *
 * The fixtures were made with ffmpeg 8 and the expected numbers are what
 * ffprobe reports for them: a faststart MP4, an MP4 with its `moov` after the
 * media (ffmpeg's default, and what many phones write), a QuickTime file with
 * a 90° display rotation, and a VP9 WebM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { bufferSource, probeVideo, probeVideoBuffer, type ByteSource } from '@/lib/video-probe';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/video/${name}`, import.meta.url)));

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `expected ~${expected}s, got ${actual}s`);

test('a faststart MP4', async () => {
  const p = await probeVideoBuffer(fixture('faststart.mp4'), 'mp4');
  assert.ok(p);
  near(p.seconds, 2.4);
  assert.deepEqual([p.width, p.height], [320, 180]);
});

test('an MP4 whose moov comes after the media', async () => {
  const p = await probeVideoBuffer(fixture('moov-at-end.mp4'), 'mp4');
  assert.ok(p);
  near(p.seconds, 3);
  assert.deepEqual([p.width, p.height], [320, 180]);
});

test('a phone-style rotation reports the picture as shown', async () => {
  const p = await probeVideoBuffer(fixture('rotated.mov'), 'mp4');
  assert.ok(p);
  near(p.seconds, 3);
  assert.deepEqual([p.width, p.height], [180, 320]);
});

test('a WebM', async () => {
  const p = await probeVideoBuffer(fixture('clip.webm'), 'webm');
  assert.ok(p);
  near(p.seconds, 2);
  assert.deepEqual([p.width, p.height], [320, 180]);
});

test('reads only the box headers and the moov, not the media', async () => {
  const buf = fixture('moov-at-end.mp4');
  const moovAt = buf.indexOf('moov') - 4;
  const reads: [number, number][] = [];
  const counting: ByteSource = {
    size: buf.length,
    read: async (offset, length) => {
      reads.push([offset, length]);
      return buf.subarray(offset, Math.min(buf.length, offset + length));
    },
  };
  const p = await probeVideo(counting, 'mp4');
  assert.ok(p);
  // Every read is a 16-byte header except the one that loads the moov.
  for (const [offset, length] of reads) {
    assert.ok(length === 16 || offset === moovAt, `unexpected read of ${length} bytes at ${offset}`);
  }
});

test('anything uncertain is null, never a guess', async () => {
  const mp4 = fixture('faststart.mp4');
  assert.equal(await probeVideoBuffer(mp4.subarray(0, 200), 'mp4'), null); // cut inside the moov
  assert.equal(await probeVideoBuffer(Buffer.alloc(64), 'mp4'), null);
  assert.equal(await probeVideoBuffer(Buffer.from('not a video at all, just words'), 'webm'), null);
  assert.equal(await probeVideo(bufferSource(Buffer.alloc(0)), 'mp4'), null);
});

// ---------------------------------------------------------------------------
// Matroska built by hand: what a browser's MediaRecorder writes has no Duration
// ---------------------------------------------------------------------------

function vint(n: number): Buffer {
  // 1-byte size up to 126, else 4 bytes — enough for these few elements.
  return n < 127 ? Buffer.from([0x80 | n]) : Buffer.from([0x10 | (n >>> 24), (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function el(id: number[], ...body: Buffer[]): Buffer {
  const content = Buffer.concat(body);
  return Buffer.concat([Buffer.from(id), vint(content.length), content]);
}
const u8 = (n: number) => Buffer.from([n]);
const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
function f64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n);
  return b;
}

function matroska(withDuration: boolean): Buffer {
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from('webm')));
  const info = el(
    [0x15, 0x49, 0xa9, 0x66],
    el([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])), // TimestampScale 1,000,000
    ...(withDuration ? [el([0x44, 0x89], f64(4500))] : []) // 4.5 s in ms ticks
  );
  const tracks = el(
    [0x16, 0x54, 0xae, 0x6b],
    el([0xae], el([0x83], u8(2))), // an audio track first
    el([0xae], el([0x83], u8(1)), el([0xe0], el([0xb0], u16(1280)), el([0xba], u16(720))))
  );
  // A live recording's Segment has an unknown size (all ones).
  const segment = Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), info, tracks]);
  return Buffer.concat([ebml, segment]);
}

test('a Matroska Segment of unknown size, with and without a Duration', async () => {
  const p = await probeVideoBuffer(matroska(true), 'webm');
  assert.ok(p);
  near(p.seconds, 4.5);
  assert.deepEqual([p.width, p.height], [1280, 720]);
  assert.equal(await probeVideoBuffer(matroska(false), 'webm'), null);
});
