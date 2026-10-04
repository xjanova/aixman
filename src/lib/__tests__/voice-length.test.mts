/**
 * The length a lip-sync order renders and is priced at.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/voice-length.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { voiceRenderSeconds } from '@/lib/voice-length';

const LTX = { minSeconds: 1, stepSeconds: 1 / 3 };

const seconds = (r: ReturnType<typeof voiceRenderSeconds>) => {
  assert.equal(r.ok, true, r.ok ? '' : r.message);
  return r.ok ? r.seconds : NaN;
};

test('a voice is rounded down to the 1/3 s frame grid, never past its end', () => {
  assert.equal(seconds(voiceRenderSeconds(7.9, LTX, 15)), 7.6667);
  assert.equal(seconds(voiceRenderSeconds(5, LTX, 15)), 5);
  assert.equal(seconds(voiceRenderSeconds(1.2, LTX, 15)), 1);
});

test('every length lands on 8k+1 frames once the template truncates seconds × 24 + 1', () => {
  for (let tenths = 10; tenths <= 150; tenths++) {
    const s = seconds(voiceRenderSeconds(tenths / 10, LTX, 15));
    const frames = Math.trunc(s * 24 + 1);
    assert.equal((frames - 1) % 8, 0, `${tenths / 10}s → ${s}s → ${frames} frames`);
    assert.ok(s <= tenths / 10 + 0.001, `${s}s renders past a ${tenths / 10}s voice`);
  }
});

test('a recording at the ceiling plus MP3 padding is taken at the ceiling', () => {
  assert.equal(seconds(voiceRenderSeconds(15.12, LTX, 15)), 15);
});

test('too long, too short or unreadable is refused in Thai, before any charge', () => {
  const long = voiceRenderSeconds(16.4, LTX, 15);
  assert.equal(long.ok, false);
  assert.equal(long.ok ? '' : long.code, 'voice-too-long');
  assert.match(long.ok ? '' : long.message, /16\.4 วินาที.*สูงสุด 15 วินาที/);

  const short = voiceRenderSeconds(0.6, LTX, 15);
  assert.equal(short.ok ? '' : short.code, 'voice-too-short');

  for (const bad of [null, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = voiceRenderSeconds(bad, LTX, 15);
    assert.equal(r.ok ? '' : r.code, 'voice-unreadable');
  }
});
