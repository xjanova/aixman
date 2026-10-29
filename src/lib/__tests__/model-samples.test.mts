/**
 * Which picture each model shows on the studio's model picker.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/model-samples.test.mts)
 *
 * Every bundled path must exist on disk — a typo is a broken image on every
 * customer's studio — and the two pictures whose licence requires a credit
 * must carry it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { modelPreview } from '@/lib/model-samples';

const LIVE_IDS = [
  'ace-step-1.5', 'fal-ai/creative-upscaler', 'dall-e-3', 'dall-e-3-hd', 'black-forest-labs/flux-1.1-pro',
  'black-forest-labs/flux-1.1-pro-ultra', 'black-forest-labs/flux-dev', 'fal-ai/flux/dev', 'fal-ai/flux-pro/v1.1',
  'black-forest-labs/flux-schnell', 'fal-ai/flux/schnell', 'gen3a_turbo', 'gen4_turbo', 'gpt-image-1', 'gpt-image-1-mini',
  'stable-image-upscale', 'stable-image-inpaint', 'kino-xl', 'kling-v1.6', 'kling-v2.5', 'kling-v2.5-pro', 'kolors',
  'leonardo-diffusion-xl', 'ltx-2.5', 'MiniMax-H3', 'minimax-h3', 'minimax/video-01', 'stable-image-outpaint',
  'phoenix-1.0', 'flux', 'qwen-image', 'ray-2', 'ray-2-flash', 'fal-ai/recraft-v3', 'remove-background',
  'sdxl-community', 'seedance-1.0-lite', 'seedance-2.0', 'seedream-3.0', 'seedream-5.0', 'seedream-5.0-lite', 'sora-2',
  'sd3.5-large', 'sd3.5-medium', 'stable-image-core', 'stable-image-ultra', 'yue2-music', 'yue2-cover',
  'latentsync-1.6', 'fal-ai/latentsync', 'fal-ai/infinitalk', 'hunyuan3d-2.1', 'fal-ai/kling-video/lipsync/audio-to-video',
  // Every KIE catalogue key (kie-catalog.ts) — kept in step by the KIE test.
  'kie/nano-banana-2-1', 'kie/nano-banana-pro', 'kie/gpt-image-2-5', 'kie/seedream-5-pro', 'kie/seedream-5-flash',
  'kie/flux-3-klein', 'kie/flux-2-pro', 'kie/ideogram-v3', 'kie/qwen-image-3', 'kie/grok-imagine-image-2', 'kie/z-image',
  'kie/nano-banana-2-1-edit', 'kie/flux-3-klein-edit', 'kie/recraft-remove-background', 'kie/recraft-crisp-upscale',
  'kie/topaz-image-upscale', 'kie/kling-3', 'kie/kling-4', 'kie/veo-3-1-fast', 'kie/veo-3-1-lite', 'kie/veo-3-1',
  'kie/seedance-2-fast', 'kie/seedance-2-mini', 'kie/seedance-2-5', 'kie/minimax-h3', 'kie/wan-3', 'kie/grok-imagine-video',
  'kie/pixverse-v6-max', 'kie/kling-avatar', 'kie/infinitalk', 'kie/volcengine-lipsync', 'kie/suno-v6',
];

test('every bundled picture and clip a model points at is on disk', () => {
  for (const id of LIVE_IDS) {
    const p = modelPreview(id, null);
    if (!p) continue;
    assert.ok(existsSync(path.join('public', p.src)), `${id} → ${p.src}`);
    if (p.video) assert.ok(existsSync(path.join('public', p.video)), `${id} → ${p.video}`);
  }
});

test('families resolve to their own picture', () => {
  assert.equal(modelPreview('black-forest-labs/flux-1.1-pro-ultra', null)?.src, '/model-samples/flux-pro.webp');
  assert.equal(modelPreview('fal-ai/flux/schnell', null)?.src, '/model-samples/flux-schnell.webp');
  assert.equal(modelPreview('fal-ai/flux/dev', null)?.src, '/model-samples/flux-dev.webp');
  assert.equal(modelPreview('MiniMax-H3', null)?.src, '/model-samples/minimax-h3.webp');
  assert.equal(modelPreview('kling-v2.5-pro', null)?.src, '/model-samples/kling-video.webp');
  assert.equal(modelPreview('fal-ai/kling-video/lipsync/audio-to-video', null)?.src, '/model-samples/kling-lipsync.webp');
  assert.equal(modelPreview('ltx-2.5', null)?.src, '/model-samples/ltx.webp');
  assert.equal(modelPreview('kie/kling-3', null)?.src, '/model-samples/kling-video.webp');
  assert.equal(modelPreview('kie/kling-avatar', null)?.src, '/model-samples/kling-lipsync.webp');
  assert.equal(modelPreview('kie/seedream-5-pro', null)?.src, '/model-samples/seedream-5.webp');
  assert.equal(modelPreview('kie/minimax-h3', null)?.src, '/model-samples/minimax-h3.webp');
  assert.equal(modelPreview('kie/recraft-crisp-upscale', null)?.src, '/model-samples/upscale.webp');
  // No published sample for these families yet: the category art.
  assert.equal(modelPreview('kie/veo-3-1-fast', null), null);
  assert.equal(modelPreview('kie/suno-v6', null), null);
});

test('a family with no published example falls back to the category art', () => {
  assert.equal(modelPreview('stable-image-ultra', null), null);
  assert.equal(modelPreview('ace-step-1.5', null), null);
  assert.equal(modelPreview('some-unknown-model', null), null);
});

test("an admin's thumbnail wins and carries no bundled credit", () => {
  assert.deepEqual(modelPreview('seedream-5.0', ' https://cdn.example.com/x.webp '), { src: 'https://cdn.example.com/x.webp', video: null, credit: null });
  assert.equal(modelPreview('seedream-5.0', '   ')?.src, '/model-samples/seedream-5.webp');
});

test('CC BY / BY-SA pictures carry their credit', () => {
  assert.match(modelPreview('seedream-5.0-lite', null)?.credit ?? '', /VulcanSphere.*CC BY 4\.0/);
  assert.match(modelPreview('leonardo-diffusion-xl', null)?.credit ?? '', /CC BY-SA 4\.0/);
  assert.equal(modelPreview('qwen-image', null)?.credit, null);
});
