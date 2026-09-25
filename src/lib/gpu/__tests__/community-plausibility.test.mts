/**
 * What a home PC hands back, judged before the customer sees it and before its
 * owner is paid for it.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/community-plausibility.test.mts)
 *
 * A node's owner can run a modified agent that answers "success" with any
 * bytes under any Content-Type. Bytes that are not the model's media — or,
 * from an image model, a blank, a sliver or a scrap — are never delivered
 * (reject); a real file that looks odd where an honest node can land too (a
 * short song, a GIF fading in from black, a render faster than its lane) is
 * delivered but its earning is held for an admin (review).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';

// worker-client imports the override store, whose Prisma adapter wants a URL
// at import time. Nothing here queries a database.
process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';

const {
  acceptableFor,
  communityOutputBudget,
  examineOutput,
  inspectImage,
  isRejectedOutput,
  joinReviewReasons,
  judgeOutput,
  judgeRenderTime,
  MAX_COMMUNITY_OUTPUT_BYTES,
  MAX_COMMUNITY_OUTPUTS,
  minPlausibleRenderSeconds,
  MIN_OUTPUT_BYTES,
  oversizeReason,
  RejectedOutputError,
  sniffMedia,
} = await import('@/lib/gpu/community-plausibility');
const { comfyExecutionSeconds } = await import('@/lib/gpu/worker-client');
const sharp = (await import('sharp')).default;

const bytes = (...parts: (number[] | string)[]) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const pad = (buf: Buffer, size = 64) => Buffer.concat([buf, Buffer.alloc(Math.max(0, size - buf.length))]);

// ---------------------------------------------------------------------------
// Sniffing
// ---------------------------------------------------------------------------

test('the bytes say what a file is, for every format a model here makes', () => {
  const cases: [Buffer, string | null][] = [
    [pad(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png'],
    [pad(bytes([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg'],
    [pad(bytes('GIF89a')), 'image/gif'],
    [pad(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')), 'image/webp'],
    [pad(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt ')), 'audio/wav'],
    [pad(bytes([0, 0, 0, 0x18], 'ftypisom')), 'video/mp4'],
    [pad(bytes([0, 0, 0, 0x14], 'ftypqt  ')), 'video/quicktime'],
    [pad(bytes([0, 0, 0, 0x20], 'ftypM4A ')), 'audio/mp4'],
    [pad(bytes([0, 0, 0, 0x1c], 'ftypavif')), 'image/avif'],
    [pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01], 'B\x82\x84webm')), 'video/webm'],
    [pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01], 'B\x82\x88matroska')), 'video/x-matroska'],
    [pad(bytes('fLaC')), 'audio/flac'],
    [pad(bytes('OggS', [0, 2], 'xxxxxxxxxxxxxxxxxxxxxxxxOpusHead')), 'audio/opus'],
    [pad(bytes('OggS', [0, 2])), 'audio/ogg'],
    [pad(bytes('ID3', [4, 0])), 'audio/mpeg'],
    [pad(bytes([0xff, 0xfb, 0x90, 0x64])), 'audio/mpeg'],
    [pad(bytes([0xff, 0xf1, 0x50, 0x80])), 'audio/aac'],
    // Not media: never stored as an image, however the node labels it.
    [pad(bytes('<!DOCTYPE html><script>alert(1)</script>')), null],
    [pad(bytes('<svg xmlns="http://www.w3.org/2000/svg">')), null],
    [pad(bytes('PK', [3, 4])), null],
    [pad(bytes('RIFF', [0, 0, 0, 0], 'XXXX')), null],
    [bytes([0x89, 0x50]), null],
    [Buffer.alloc(0), null],
  ];
  for (const [buf, mime] of cases) {
    assert.equal(sniffMedia(buf)?.mime ?? null, mime, `expected ${mime} for ${buf.subarray(0, 12).toString('hex')}`);
  }
});

test('a model may only hand back its own kind of media (an animated GIF/WebP counts as video)', () => {
  assert.equal(acceptableFor('image', { mime: 'image/png', kind: 'image' }), true);
  assert.equal(acceptableFor('image', { mime: 'audio/flac', kind: 'audio' }), false);
  assert.equal(acceptableFor('image', { mime: 'video/mp4', kind: 'video' }), false);
  assert.equal(acceptableFor('video', { mime: 'image/gif', kind: 'image' }), true);
  assert.equal(acceptableFor('video', { mime: 'image/png', kind: 'image' }), false);
  assert.equal(acceptableFor(null, { mime: 'audio/wav', kind: 'audio' }), true);
});

// ---------------------------------------------------------------------------
// The verdict on a file
// ---------------------------------------------------------------------------

const png = { mime: 'image/png', kind: 'image' as const };

test('nothing that is not the model’s media is delivered', () => {
  assert.match(judgeOutput({ bytes: 0, sniffed: null }, 'image').reject ?? '', /empty/);
  assert.match(judgeOutput({ bytes: 5_000, sniffed: null }, 'image').reject ?? '', /not image, video or audio/);
  assert.match(
    judgeOutput({ bytes: 500_000, sniffed: { mime: 'audio/flac', kind: 'audio' } }, 'image').reject ?? '',
    /audio\/flac for a model that makes image/
  );
  assert.match(judgeOutput({ bytes: 500_000, sniffed: png, image: null }, 'image').reject ?? '', /does not decode/);
});

test('from an image model, a blank, a sliver or a scrap is not delivered — the customer would pay for nothing', () => {
  // A modified node's cheapest "render": a valid solid-grey PNG. It used to
  // reach the customer as their result, with only the node's pay held.
  const tiny = judgeOutput({ bytes: 300, sniffed: png, image: { width: 1024, height: 1024, flat: false } }, 'image');
  assert.equal(tiny.review, undefined);
  assert.match(tiny.reject ?? '', /300-byte image\/png, too small/);

  const thumb = judgeOutput({ bytes: 40_000, sniffed: png, image: { width: 32, height: 1024, flat: false } }, 'image');
  assert.match(thumb.reject ?? '', /32×1024/);

  const flat = judgeOutput({ bytes: 40_000, sniffed: png, image: { width: 1024, height: 1024, flat: true } }, 'image');
  assert.match(flat.reject ?? '', /flat colour/);
});

test('from a video or music model, an odd-looking file is delivered, but its earning held for review', () => {
  // A GIF that fades in from black has a flat first frame; a short clip is small.
  const gif = { mime: 'image/gif', kind: 'image' as const };
  const fadeIn = judgeOutput({ bytes: 40_000, sniffed: gif, image: { width: 512, height: 512, flat: true } }, 'video');
  assert.equal(fadeIn.reject, undefined);
  assert.match(fadeIn.review ?? '', /สีเดียว/);

  const tinyGif = judgeOutput({ bytes: 900, sniffed: gif, image: { width: 512, height: 512, flat: false } }, 'video');
  assert.match(tinyGif.review ?? '', /เล็กผิดปกติ/);

  const shortSong = judgeOutput({ bytes: MIN_OUTPUT_BYTES.audio - 1, sniffed: { mime: 'audio/flac', kind: 'audio' } }, 'audio');
  assert.equal(shortSong.reject, undefined);
  assert.match(shortSong.review ?? '', /audio\/flac/);

  // No catalogue entry to say what the model makes: held, not refused.
  assert.match(judgeOutput({ bytes: 300, sniffed: png, image: { width: 1024, height: 1024, flat: false } }, null).review ?? '', /เล็กผิดปกติ/);
});

test('a job’s files have a ceiling far above any render, and a count', () => {
  assert.equal(communityOutputBudget('image'), MAX_COMMUNITY_OUTPUT_BYTES.image);
  assert.ok(MAX_COMMUNITY_OUTPUT_BYTES.image >= 32 * 1_048_576, 'a 1024² PNG is ~2 MB: the ceiling is nowhere near an honest render');
  assert.ok(MAX_COMMUNITY_OUTPUT_BYTES.audio > MAX_COMMUNITY_OUTPUT_BYTES.image);
  assert.equal(communityOutputBudget(null), Math.max(...Object.values(MAX_COMMUNITY_OUTPUT_BYTES)));
  assert.ok(MAX_COMMUNITY_OUTPUTS >= 1 && MAX_COMMUNITY_OUTPUTS <= 8);
  assert.match(oversizeReason(64 * 1_048_576, 2 * 1024 ** 3), /offered 2048 MB .* 64 MB/);
  assert.match(oversizeReason(64 * 1_048_576), /more than 64 MB/);
});

test('an ordinary render passes untouched', () => {
  assert.deepEqual(judgeOutput({ bytes: 1_400_000, sniffed: png, image: { width: 1024, height: 1024, flat: false } }, 'image'), {});
  // Not examined (no decoder): judged on what is known.
  assert.deepEqual(judgeOutput({ bytes: 1_400_000, sniffed: png }, 'image'), {});
});

// ---------------------------------------------------------------------------
// Decoding (sharp)
// ---------------------------------------------------------------------------

const noisy = async (w: number, h: number) => {
  const raw = Buffer.alloc(w * h * 3);
  let x = 12345;
  for (let i = 0; i < raw.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = x & 0xff;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
};
const flatPng = (w: number, h: number, alpha = false) =>
  sharp({
    create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 10, g: 10, b: 10, alpha: 1 } : { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();

/** A syntactically valid PNG whose header claims `side`² pixels, with almost no data. */
function claimedPng(side: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(64))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('a flat frame is found flat, a real picture is not', async () => {
  const black = await inspectImage(await flatPng(512, 512));
  assert.deepEqual(black, { width: 512, height: 512, flat: true });

  const withAlpha = await inspectImage(await flatPng(256, 256, true));
  assert.equal(withAlpha?.flat, true, 'the alpha channel is not colour');

  const picture = await inspectImage(await noisy(128, 128));
  assert.equal(picture?.flat, false);
  assert.equal(picture?.width, 128);
});

test('an image that does not decode, or claims more pixels than any render, is undecodable', async () => {
  const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4_000, 7)]);
  assert.equal(await inspectImage(broken), null);
  // A decompression bomb: a few hundred bytes claiming 50,000² pixels.
  assert.equal(await inspectImage(claimedPng(50_000)), null);
});

test('examineOutput: stores the sniffed type, never the node’s, and rejects what is not the model’s', async () => {
  const good = await examineOutput(await noisy(128, 128), 'image');
  assert.deepEqual(good, { mime: 'image/png' });

  // A solid-grey 1024² PNG decodes fine — and is still not a render.
  const blank = await examineOutput(await flatPng(1024, 1024), 'image');
  assert.equal(blank.review, undefined);
  assert.match(blank.reject ?? '', /flat colour|too small/);
  assert.equal(blank.mime, 'image/png');

  const html = await examineOutput(Buffer.from('<html><body>not a picture</body></html>'.repeat(100)), 'image');
  assert.equal(html.mime, 'application/octet-stream');
  assert.match(html.reject ?? '', /not image, video or audio/);

  const bomb = await examineOutput(claimedPng(50_000), 'image');
  assert.match(bomb.reject ?? '', /does not decode/);
});

test('a rejected output is recognisable after crossing an async boundary', () => {
  const error = new RejectedOutputError('the node returned an empty file');
  assert.equal(isRejectedOutput(error), true);
  assert.equal(isRejectedOutput(Object.assign(new Error('x'), { name: 'RejectedOutputError' })), true);
  assert.equal(isRejectedOutput(new Error('Failed to download render (HTTP 502)')), false);
});

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

test('the fastest plausible render depends on the lane', () => {
  // SDXL (community): 60 s on the reference card.
  assert.equal(minPlausibleRenderSeconds(60, 'full'), 1.5);
  assert.equal(minPlausibleRenderSeconds(60, 'slow'), 6);
  assert.equal(minPlausibleRenderSeconds(60, undefined), 1.5, 'no lane reads as full');
  assert.equal(minPlausibleRenderSeconds(undefined, 'full'), 1, 'never below a second');
  assert.equal(minPlausibleRenderSeconds(20, 'full'), 1);
});

test('a render faster than its lane allows is held; a normal one is not', () => {
  assert.equal(judgeRenderTime({ observedSeconds: 14, baselineSecondsPerUnit: 60, lane: 'full' }), null);
  assert.equal(judgeRenderTime({ observedSeconds: 2, baselineSecondsPerUnit: 60, lane: 'full' }), null);
  assert.match(judgeRenderTime({ observedSeconds: 0.4, baselineSecondsPerUnit: 60, lane: 'full' }) ?? '', /เร็วผิดปกติ/);
  // A slow-lane card said it takes minutes; five seconds is not that card.
  assert.match(judgeRenderTime({ observedSeconds: 5, baselineSecondsPerUnit: 60, lane: 'slow' }) ?? '', /slow/);
  assert.equal(judgeRenderTime({ observedSeconds: null, baselineSecondsPerUnit: 60, lane: 'full' }), null);
  assert.equal(judgeRenderTime({ observedSeconds: Number.NaN, baselineSecondsPerUnit: 60, lane: 'full' }), null);
});

test('ComfyUI’s own execution timestamps give the render time, when both are there', () => {
  const messages = [
    ['execution_start', { prompt_id: 'p', timestamp: 1_700_000_000_000 }],
    ['execution_cached', { nodes: [], prompt_id: 'p', timestamp: 1_700_000_000_010 }],
    ['execution_success', { prompt_id: 'p', timestamp: 1_700_000_012_500 }],
  ];
  assert.equal(comfyExecutionSeconds(messages), 12.5);
  assert.equal(comfyExecutionSeconds(messages.slice(0, 2)), null, 'no success yet');
  assert.equal(comfyExecutionSeconds([['execution_start', { timestamp: 'soon' }], messages[2]]), null);
  assert.equal(
    comfyExecutionSeconds([
      ['execution_start', { timestamp: 2_000 }],
      ['execution_success', { timestamp: 1_000 }],
    ]),
    null,
    'a clock that runs backwards says nothing'
  );
  assert.equal(comfyExecutionSeconds(undefined), null);
});

test('review reasons are joined once each and fit the column', () => {
  assert.equal(joinReviewReasons([null, undefined, '  ']), null);
  assert.equal(joinReviewReasons(['a', 'b', 'a']), 'a · b');
  const long = joinReviewReasons(['x'.repeat(200), 'y'.repeat(200)]);
  assert.equal(long?.length, 255);
  assert.ok(long?.endsWith('…'));
});
