/**
 * What the studio may put back when a past order is reopened.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/order-inputs.test.mts)
 *
 * Whatever comes back here is shown in the studio and then sent to
 * /api/generate as-is, so it must be exactly what that route accepts: our own
 * uploads for audio, video and the end frame, and an image data URL or one of
 * ours for the start/reference image.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orderInputs } from '@/lib/order-inputs';

const OURS = 'https://cdn.example.test/aixman/uploads/7/';
const isOurs = (url: string) => url.startsWith(OURS);

test('a lip-sync order gives back its voice track and its clip', () => {
  const out = orderInputs(
    {
      inputImage: null,
      params: { duration: 5, inputAudio: `${OURS}voice.mp3`, inputVideo: `${OURS}clip.mp4` },
    },
    isOurs
  );
  assert.deepEqual(out, {
    inputImage: null,
    inputImageEnd: null,
    inputAudio: `${OURS}voice.mp3`,
    inputVideo: `${OURS}clip.mp4`,
  });
});

test('a first-and-last-frame clip gives back both frames', () => {
  const start = 'data:image/png;base64,iVBORw0KGgo=';
  const out = orderInputs({ inputImage: start, params: { inputImageEnd: `${OURS}end.webp` } }, isOurs);
  assert.equal(out.inputImage, start);
  assert.equal(out.inputImageEnd, `${OURS}end.webp`);
});

test('an image of ours (a result carried into the next step) is kept', () => {
  const out = orderInputs({ inputImage: `${OURS}result.webp`, params: null }, isOurs);
  assert.equal(out.inputImage, `${OURS}result.webp`);
});

test('anything /api/generate would refuse is dropped, not shown', () => {
  const out = orderInputs(
    {
      inputImage: 'https://provider.example/expired.png',
      params: {
        inputAudio: 'https://elsewhere.example/song.mp3',
        inputVideo: 42,
        inputImageEnd: '',
      },
    },
    isOurs
  );
  assert.deepEqual(out, { inputImage: null, inputImageEnd: null, inputAudio: null, inputVideo: null });
});

test('a data URL that is not a picture is not an image input', () => {
  const out = orderInputs({ inputImage: 'data:text/html;base64,PHNjcmlwdD4=', params: {} }, isOurs);
  assert.equal(out.inputImage, null);
});

test('params that are not an object are read as no uploads', () => {
  for (const params of [null, 'inputAudio', [`${OURS}a.mp3`]]) {
    const out = orderInputs({ inputImage: null, params }, isOurs);
    assert.equal(out.inputAudio, null);
  }
});
