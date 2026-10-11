/**
 * What a video lip-sync order may send, and what it costs.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/lipsync-rules.test.mts)
 *
 * Kling's limits are fal's published ones; refusing here is what keeps a
 * customer from paying for an attempt the vendor turns away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apiVideoLipsyncRule, checkClip, checkVoice, lipsyncCredits, type ClipFacts } from '@/lib/lipsync-rules';

const KLING = apiVideoLipsyncRule('fal-ai/kling-video/lipsync/audio-to-video')!;
const LATENTSYNC = apiVideoLipsyncRule('fal-ai/latentsync')!;
const MB = 1024 * 1024;

const clip = (over: Partial<ClipFacts> = {}): ClipFacts => ({ seconds: 6, width: 1280, height: 720, bytes: 8 * MB, ext: 'mp4', ...over });

test('both API rows are known, and nothing else is', () => {
  assert.ok(KLING && LATENTSYNC);
  assert.equal(apiVideoLipsyncRule('fal-ai/infinitalk'), undefined);
  assert.equal(apiVideoLipsyncRule('constructor'), undefined);
});

test('Kling takes a 2–10 s clip at 720p–1080p, as an MP4 or MOV', () => {
  assert.deepEqual(checkClip(KLING.clip, clip()), { ok: true });
  assert.deepEqual(checkClip(KLING.clip, clip({ width: 1080, height: 1920 })), { ok: true });
  assert.equal((checkClip(KLING.clip, clip({ seconds: 1.5 })) as { code: string }).code, 'clip-short');
  assert.equal((checkClip(KLING.clip, clip({ seconds: 12 })) as { code: string }).code, 'clip-long');
  assert.deepEqual(checkClip(KLING.clip, clip({ seconds: 10.04 })), { ok: true }); // a header's rounding
  assert.equal((checkClip(KLING.clip, clip({ width: 640, height: 360 })) as { code: string }).code, 'clip-size');
  assert.equal((checkClip(KLING.clip, clip({ width: 3840, height: 2160 })) as { code: string }).code, 'clip-size');
  assert.equal((checkClip(KLING.clip, clip({ ext: 'webm' })) as { code: string }).code, 'clip-container');
  assert.equal((checkClip(KLING.clip, clip({ bytes: 101 * MB })) as { code: string }).code, 'clip-bytes');
});

test('a Kling voice must fit inside its clip', () => {
  assert.deepEqual(checkVoice(KLING.voice, { seconds: 6, bytes: MB }, 6), { ok: true });
  assert.deepEqual(checkVoice(KLING.voice, { seconds: 6.2, bytes: MB }, 6), { ok: true });
  assert.equal((checkVoice(KLING.voice, { seconds: 8, bytes: MB }, 6) as { code: string }).code, 'voice-past-clip');
  assert.equal((checkVoice(KLING.voice, { seconds: 1, bytes: MB }, 6) as { code: string }).code, 'voice-short');
  assert.equal((checkVoice(KLING.voice, { seconds: 6, bytes: 6 * MB }, 6) as { code: string }).code, 'voice-bytes');
});

test('LatentSync loops the picture, so its voice may be longer — up to 40 s', () => {
  assert.deepEqual(checkClip(LATENTSYNC.clip, clip({ seconds: 3, width: 640, height: 360, ext: 'webm' })), { ok: true });
  assert.deepEqual(checkVoice(LATENTSYNC.voice, { seconds: 30, bytes: MB }, 3), { ok: true });
  assert.equal((checkVoice(LATENTSYNC.voice, { seconds: 41, bytes: MB }, 3) as { code: string }).code, 'voice-long');
  assert.equal((checkClip(LATENTSYNC.clip, clip({ seconds: 45 })) as { code: string }).code, 'clip-long');
});

test('refusals are Thai sentences, not codes', () => {
  const r = checkClip(KLING.clip, clip({ seconds: 12 }));
  assert.ok(!r.ok && /คลิปยาวเกินไป/.test(r.message) && r.message.includes('10'));
});

test('Kling is billed per started 5 s of clip; LatentSync is one price', () => {
  assert.equal(lipsyncCredits(KLING.billing, 13, 2), 13);
  assert.equal(lipsyncCredits(KLING.billing, 13, 5), 13);
  assert.equal(lipsyncCredits(KLING.billing, 13, 5.0004), 13);
  assert.equal(lipsyncCredits(KLING.billing, 13, 5.04), 26);
  assert.equal(lipsyncCredits(KLING.billing, 13, 10), 26);
  assert.equal(lipsyncCredits(LATENTSYNC.billing, 36, 38), 36);
});
