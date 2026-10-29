/**
 * Customers never learn which vendor serves a model (public-provider.ts).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/public-provider.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSY_MESSAGE,
  publicDefaultParams,
  publicErrorMessage,
  publicModelDescription,
  publicModelId,
  publicModelName,
  publicProvider,
  matchesModelId,
} from '@/lib/public-provider';
import { KIE_CATALOG } from '@/lib/providers/kie-catalog';

const VENDOR = /\bkie\b|kie\.ai|fal\.ai|\(fal\)|replicate|pollinations|simplepod|runpod|vast\.ai/i;

/** Every non-KIE model id on production (2026-10-29), from the seed and the GPU catalogue. */
const OTHER_IDS = [
  'ace-step-1.5', 'fal-ai/creative-upscaler', 'dall-e-3', 'dall-e-3-hd', 'black-forest-labs/flux-1.1-pro',
  'black-forest-labs/flux-1.1-pro-ultra', 'black-forest-labs/flux-dev', 'fal-ai/flux/dev', 'fal-ai/flux-pro/v1.1',
  'black-forest-labs/flux-schnell', 'fal-ai/flux/schnell', 'gen3a_turbo', 'gen4_turbo', 'gpt-image-1', 'gpt-image-1-mini',
  'stable-image-upscale', 'stable-image-inpaint', 'kino-xl', 'kling-v1.6', 'kling-v2.5', 'kling-v2.5-pro', 'kolors',
  'leonardo-diffusion-xl', 'ltx-2.5', 'MiniMax-H3', 'minimax-h3', 'minimax/video-01', 'stable-image-outpaint', 'phoenix-1.0',
  'flux', 'qwen-image', 'ray-2', 'ray-2-flash', 'fal-ai/recraft-v3', 'remove-background', 'sdxl-community',
  'seedance-1.0-lite', 'seedance-2.0', 'seedream-3.0', 'seedream-5.0', 'seedream-5.0-lite', 'sora-2', 'sd3.5-large',
  'sd3.5-medium', 'stable-image-core', 'stable-image-ultra', 'yue2-music', 'yue2-cover', 'latentsync-1.6',
  'fal-ai/latentsync', 'fal-ai/infinitalk', 'hunyuan3d-2.1', 'fal-ai/kling-video/lipsync/audio-to-video',
];

test('every provider is shown as our own brand', () => {
  for (const slug of ['kie', 'fal', 'replicate', 'pollinations', 'simplepod', 'openai']) {
    assert.deepEqual(publicProvider({ name: slug.toUpperCase(), slug, logo: 'x.png' }), { name: 'X-DREAMER', slug: 'xdreamer', logo: null });
  }
});

test('model ids lose the vendor namespace and never collide', () => {
  assert.equal(publicModelId('kie/veo-3-1'), 'xd/veo-3-1');
  assert.equal(publicModelId('fal-ai/flux/dev'), 'flux/dev');
  assert.equal(publicModelId('minimax-h3'), 'minimax-h3');
  const all = [...KIE_CATALOG.map((e) => e.key), ...OTHER_IDS];
  const shownAs = new Map(all.map((id) => [id, publicModelId(id).toLowerCase()]));
  for (const [id, shown] of shownAs) {
    assert.ok(!/^(kie|fal-ai)\//.test(shown), `${id} still shows its vendor`);
    if (shown === id.toLowerCase()) continue;
    // A rewritten id must not land on another row's (MiniMax-H3 / minimax-h3 differ in case only, from before).
    const clash = [...shownAs].find(([other, s]) => other !== id && s === shown);
    assert.equal(clash, undefined, `${id} and ${clash?.[0]} both show as ${shown}`);
  }
});

test('a caller may name a model by its public id or, as before, its real one', () => {
  assert.ok(matchesModelId('kie/z-image', 'xd/z-image'));
  assert.ok(matchesModelId('kie/z-image', 'kie/z-image'));
  assert.ok(matchesModelId('fal-ai/flux/dev', 'flux/dev'));
  assert.ok(!matchesModelId('kie/z-image', 'z-image'));
});

test('names and descriptions drop the vendor', () => {
  assert.equal(publicModelName('fal-ai/flux/dev', 'FLUX Dev (fal)'), 'FLUX Dev');
  assert.equal(publicModelName('kie/minimax-h3', 'MiniMax H3 (KIE)'), 'MiniMax H3');
  assert.equal(publicModelName('flux', 'Pollinations Free'), 'FLUX ฟรี');
  assert.equal(publicModelName('kling-v2.5', 'Kling 2.5'), 'Kling 2.5');
  assert.equal(publicModelDescription('kie/minimax-h3', 'MiniMax H3 ผ่าน KIE — ถึง 2K'), 'MiniMax H3 — ถึง 2K');
  assert.ok(!VENDOR.test(publicModelDescription('flux', 'ใส่ token ที่ Account Pool') ?? ''));
  assert.equal(publicModelDescription('kolors', null), null);
});

test('the catalogue names no vendor in what customers read', () => {
  for (const e of KIE_CATALOG) {
    assert.ok(!VENDOR.test(e.name), `${e.key} name: ${e.name}`);
    assert.ok(!VENDOR.test(e.description), `${e.key} description: ${e.description}`);
  }
});

test('the model list sends no params under a vendor key', () => {
  assert.deepEqual(publicDefaultParams({ kie: { tiers: [] }, maxReferenceImages: 14 }), { maxReferenceImages: 14 });
  const plain = { steps: 4 };
  assert.equal(publicDefaultParams(plain), plain);
  assert.equal(publicDefaultParams(null), null);
});

test('a failed order reads without the vendor, its ids or its account trouble', () => {
  assert.equal(publicErrorMessage(null), null);
  assert.equal(publicErrorMessage('KIE 402 insufficient credits: top up'), BUSY_MESSAGE);
  assert.equal(publicErrorMessage('KIE 429 rate limit'), BUSY_MESSAGE);
  assert.equal(publicErrorMessage('No available API accounts for this provider. Please try again later.'), BUSY_MESSAGE);
  assert.equal(publicErrorMessage('KIE generation failed (prompt flagged by safety system)'), 'generation failed (prompt flagged by safety system)');
  assert.equal(publicErrorMessage('KIE task 7f3a9c1e2b timed out'), 'task timed out');
  assert.equal(publicErrorMessage('Replicate error: see https://replicate.com/p/abc for details'), 'error: see for details');
  assert.equal(publicErrorMessage('ไม่พบใบหน้าในคลิป — คืนเครดิตแล้ว'), 'ไม่พบใบหน้าในคลิป — คืนเครดิตแล้ว');
  assert.equal(publicErrorMessage('KIE'), 'สร้างงานไม่สำเร็จ — คืนเครดิตให้แล้ว');
});
