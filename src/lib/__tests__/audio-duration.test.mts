/**
 * Reading a voice track's length from its headers.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/audio-duration.test.mts)
 *
 * The length decides what a lip-sync order costs and how many frames are
 * rendered, so a wrong answer is either a loss on every order or a voice cut
 * off mid-word. MP3 is encoded for real with lamejs (the studio's own encoder);
 * the other containers are built byte by byte from their specs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mp3Encoder } from '@breezystack/lamejs';

import { audioDurationSeconds } from '@/lib/audio-duration';

const near = (actual: number | null, expected: number, tolerance: number) => {
  assert.ok(actual !== null, 'expected a duration, got null');
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ~${expected}s, got ${actual}s`);
};

function mp3(seconds: number, sampleRate: number, kbps: number, channels = 1): Buffer {
  const encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const pcm = new Int16Array(Math.round(seconds * sampleRate));
  // A tone rather than silence, so the encoder does real work on every frame.
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * 220) * 8000);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const chunk = pcm.subarray(i, i + 1152);
    parts.push(channels === 2 ? encoder.encodeBuffer(chunk, chunk) : encoder.encodeBuffer(chunk));
  }
  parts.push(encoder.flush());
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

function id3v2(payloadBytes: number): Buffer {
  const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  const size = payloadBytes;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  // A cover image's worth of bytes, including a stray 0xFFE0 that is not a frame.
  const payload = Buffer.alloc(payloadBytes, 0x20);
  payload[100] = 0xff;
  payload[101] = 0xfb;
  return Buffer.concat([header, payload]);
}

function wav(seconds: number, sampleRate: number, channels: number, bits: number, dataSize?: number): Buffer {
  const byteRate = sampleRate * channels * (bits / 8);
  const data = Buffer.alloc(Math.round(seconds * byteRate));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(byteRate, 8);
  fmt.writeUInt16LE(channels * (bits / 8), 12);
  fmt.writeUInt16LE(bits, 14);
  const chunk = (id: string, body: Buffer, declared = body.length) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'latin1');
    head.writeUInt32LE(declared, 4);
    return Buffer.concat([head, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  // A LIST chunk before data, with an odd length, as many editors write.
  const list = chunk('LIST', Buffer.from('INFOISFT', 'latin1').subarray(0, 7));
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), chunk('fmt ', fmt), list, chunk('data', data, dataSize ?? data.length)]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function flac(sampleRate: number, totalSamples: number): Buffer {
  const info = Buffer.alloc(34);
  info.writeUInt16BE(4096, 0);
  info.writeUInt16BE(4096, 2);
  // 20 bits rate, 3 bits channels-1, 5 bits bps-1, 36 bits total samples.
  info[10] = (sampleRate >> 12) & 0xff;
  info[11] = (sampleRate >> 4) & 0xff;
  info[12] = ((sampleRate & 0x0f) << 4) | ((1 & 0x07) << 1) | ((15 >> 4) & 1);
  info[13] = ((15 & 0x0f) << 4) | Math.floor(totalSamples / 2 ** 32);
  info.writeUInt32BE(totalSamples % 2 ** 32, 14);
  return Buffer.concat([Buffer.from('fLaC', 'latin1'), Buffer.from([0x80, 0, 0, 34]), info, Buffer.alloc(64)]);
}

function oggPage(serial: number, granule: bigint, payload: Buffer): Buffer {
  const head = Buffer.alloc(27);
  head.write('OggS', 0, 'latin1');
  head.writeBigInt64LE(granule, 6);
  head.writeUInt32LE(serial, 14);
  head[26] = 1;
  return Buffer.concat([head, Buffer.from([payload.length]), payload]);
}

function oggVorbis(sampleRate: number, lastGranule: number): Buffer {
  const id = Buffer.alloc(30);
  id[0] = 0x01;
  id.write('vorbis', 1, 'latin1');
  id[11] = 1;
  id.writeUInt32LE(sampleRate, 12);
  return Buffer.concat([
    oggPage(77, BigInt(0), id),
    oggPage(77, BigInt(lastGranule - 1000), Buffer.alloc(200)),
    // A page that finishes no packet carries granule −1 and must be skipped.
    oggPage(77, BigInt(lastGranule), Buffer.alloc(200)),
    oggPage(77, BigInt(-1), Buffer.alloc(200)),
  ]);
}

function oggOpus(preSkip: number, lastGranule: number): Buffer {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'latin1');
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(44100, 12);
  return Buffer.concat([oggPage(5, BigInt(0), head), oggPage(5, BigInt(lastGranule), Buffer.alloc(100))]);
}

function box(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function m4a(timescale: number, duration: number, version: 0 | 1 = 0): Buffer {
  let mvhd: Buffer;
  if (version === 0) {
    mvhd = Buffer.alloc(100);
    mvhd.writeUInt32BE(timescale, 12);
    mvhd.writeUInt32BE(duration, 16);
  } else {
    mvhd = Buffer.alloc(112);
    mvhd[0] = 1;
    mvhd.writeUInt32BE(timescale, 20);
    mvhd.writeBigUInt64BE(BigInt(duration), 24);
  }
  const ftyp = box('ftyp', Buffer.from('M4A \0\0\0\0isomM4A ', 'latin1'));
  // mdat before moov: the layout of a file that was never "fast-started".
  const mdat = box('mdat', Buffer.alloc(5000));
  return Buffer.concat([ftyp, mdat, box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', Buffer.alloc(40))]))]);
}

test('an MP3 voice note is measured to within a frame', () => {
  near(audioDurationSeconds(mp3(7.5, 44100, 64), 'mp3'), 7.5, 0.06);
  near(audioDurationSeconds(mp3(12, 48000, 128, 2), 'mp3'), 12, 0.06);
});

test('a phone recording at an MPEG-2 rate is measured too', () => {
  // 16 kHz / 24 kHz are MPEG-2 rates: 576 samples a frame, not 1152. The
  // encoder's delay and end padding are real frames in the file, and at 16 kHz
  // they come to ~0.1 s — counted, as the render will be that long too.
  // (Checked against ffprobe on ffmpeg's own files: WAV, FLAC, M4A and Ogg
  // agree exactly; MP3 reads up to 0.12 s longer for this padding, and a VBR
  // file without a Xing header is read right where ffprobe guessed 0.8 s short.)
  near(audioDurationSeconds(mp3(4, 16000, 32), 'mp3'), 4, 0.15);
  near(audioDurationSeconds(mp3(3, 24000, 48), 'mp3'), 3, 0.15);
});

test('an ID3 tag with a picture in it is skipped, not read as audio', () => {
  const file = Buffer.concat([id3v2(30_000), mp3(5, 44100, 96)]);
  near(audioDurationSeconds(file, 'mp3'), 5, 0.06);
});

test('an ID3v1 tag at the end does not stretch the length', () => {
  const tag = Buffer.concat([Buffer.from('TAG', 'latin1'), Buffer.alloc(125, 0x41)]);
  near(audioDurationSeconds(Buffer.concat([mp3(6, 44100, 128), tag]), 'mp3'), 6, 0.06);
});

test('bytes that are not MP3 at all have no length', () => {
  assert.equal(audioDurationSeconds(Buffer.alloc(4096, 0x41), 'mp3'), null);
  assert.equal(audioDurationSeconds(id3v2(2000), 'mp3'), null);
});

test('a WAV is data size over byte rate, past any chunk before the data', () => {
  near(audioDurationSeconds(wav(9.25, 44100, 2, 16), 'wav'), 9.25, 0.001);
  near(audioDurationSeconds(wav(2, 16000, 1, 16), 'wav'), 2, 0.001);
});

test('a WAV whose recorder never patched the data size runs to the end of the file', () => {
  near(audioDurationSeconds(wav(3, 22050, 1, 16, 0xffffffff), 'wav'), 3, 0.001);
  near(audioDurationSeconds(wav(3, 22050, 1, 16, 0), 'wav'), 3, 0.001);
});

test('a FLAC reads its total sample count', () => {
  near(audioDurationSeconds(flac(48000, 48000 * 11), 'flac'), 11, 0.0001);
  assert.equal(audioDurationSeconds(flac(48000, 0), 'flac'), null);
});

test('Ogg Vorbis and Opus read the last finished page', () => {
  near(audioDurationSeconds(oggVorbis(44100, 44100 * 8), 'ogg'), 8, 0.0001);
  near(audioDurationSeconds(oggOpus(312, 48000 * 6 + 312), 'ogg'), 6, 0.0001);
});

test('an M4A reads the movie header, wherever moov sits', () => {
  near(audioDurationSeconds(m4a(44100, 44100 * 13), 'm4a'), 13, 0.0001);
  near(audioDurationSeconds(m4a(1000, 14_500, 1), 'm4a'), 14.5, 0.0001);
});

test('a truncated or unknown file is null, never a guess', () => {
  assert.equal(audioDurationSeconds(wav(3, 22050, 1, 16).subarray(0, 30), 'wav'), null);
  assert.equal(audioDurationSeconds(m4a(44100, 44100 * 13).subarray(0, 200), 'm4a'), null);
  assert.equal(audioDurationSeconds(flac(48000, 480000).subarray(0, 12), 'flac'), null);
  assert.equal(audioDurationSeconds(Buffer.from('OggS'), 'ogg'), null);
  assert.equal(audioDurationSeconds(mp3(2, 44100, 64), 'aac'), null);
});
