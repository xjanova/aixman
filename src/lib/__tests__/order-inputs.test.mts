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
    referenceImages: [],
    mashWith: null,
    replace: null,
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
  assert.deepEqual(out, { inputImage: null, inputImageEnd: null, inputAudio: null, inputVideo: null, referenceImages: [], mashWith: null, replace: null });
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

test('a several-reference picture gives back its references in order', () => {
  const refs = [`${OURS}a.webp`, `${OURS}b.webp`, `${OURS}c.webp`];
  const out = orderInputs({ inputImage: refs[0], params: { referenceImages: refs } }, isOurs);
  assert.deepEqual(out.referenceImages, refs);
});

test('a reference list with a stranger in it is not put back at all', () => {
  const out = orderInputs(
    { inputImage: null, params: { referenceImages: [`${OURS}a.webp`, 'https://elsewhere.example/b.png'] } },
    isOurs
  );
  assert.deepEqual(out.referenceImages, []);
});

test('a reference list that is not a list is ignored', () => {
  const out = orderInputs({ inputImage: null, params: { referenceImages: `${OURS}a.webp` } }, isOurs);
  assert.deepEqual(out.referenceImages, []);
});

test('a mashup gives back its second song, when it is ours', () => {
  const out = orderInputs({ inputImage: null, params: { inputAudio: `${OURS}a.mp3`, suno: { mashWith: `${OURS}b.mp3` } } }, isOurs);
  assert.equal(out.inputAudio, `${OURS}a.mp3`);
  assert.equal(out.mashWith, `${OURS}b.mp3`);
  const foreign = orderInputs({ inputImage: null, params: { suno: { mashWith: 'https://elsewhere.example/b.mp3' } } }, isOurs);
  assert.equal(foreign.mashWith, null);
});

test("a part picked by lines gives back its seconds, its lines and the song's own words", () => {
  const suno = { replaceFrom: 29.65, replaceTo: 41.2, replaceLines: [2, 3], originalLyrics: '[Verse]\nก\nข', fullLyrics: '[Verse]\nก\nใหม่' };
  const out = orderInputs({ inputImage: null, params: { suno } }, isOurs);
  assert.deepEqual(out.replace, { from: 29.65, to: 41.2, lines: [2, 3], original: '[Verse]\nก\nข' });
});

test("a part set by the seconds gives back the whole song's words as typed", () => {
  const out = orderInputs({ inputImage: null, params: { suno: { replaceFrom: 10, replaceTo: 22, fullLyrics: 'ทั้งเพลง' } } }, isOurs);
  assert.deepEqual(out.replace, { from: 10, to: 22, lines: null, original: 'ทั้งเพลง' });
});

test('lines without the words they index fall back to the seconds and the whole song', () => {
  const out = orderInputs({ inputImage: null, params: { suno: { replaceFrom: 10, replaceTo: 22, replaceLines: [1, 2], fullLyrics: 'หลังแก้' } } }, isOurs);
  assert.deepEqual(out.replace, { from: 10, to: 22, lines: null, original: 'หลังแก้' });
});

test('a replace part that is not a part is not put back', () => {
  for (const suno of [
    { replaceFrom: 20, replaceTo: 10, fullLyrics: 'x' },
    { replaceFrom: '10', replaceTo: 20, fullLyrics: 'x' },
    { replaceFrom: 10, replaceTo: 20 },
    { replaceFrom: 10, replaceTo: 20, replaceLines: [3, 1], originalLyrics: 'x' },
    'replace',
  ]) {
    assert.equal(orderInputs({ inputImage: null, params: { suno } }, isOurs).replace, null);
  }
});
