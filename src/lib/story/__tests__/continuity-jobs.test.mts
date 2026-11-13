import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('picture and video orders enforce continuity before charging, claim once, and pass both frames', () => {
  const result = spawnSync(process.execPath, [
    '--experimental-test-module-mocks', '--experimental-transform-types',
    '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--import', './scripts/alias-loader.mjs', '--input-type=module', '-e', String.raw`
import { mock } from 'node:test';
import assert from 'node:assert/strict';
let serial = 100, orders = [], fail = false, holdNext = false, releaseOld;
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (key === 'AND') return value.every((v) => matches(row, v));
  if (key === 'OR') return value.some((v) => matches(row, v));
  if (value instanceof Date) return row[key]?.getTime() === value.getTime();
  if (value && typeof value === 'object') {
    if ('path' in value) return row[key]?.[value.path.slice(2)] === value.equals;
    if ('not' in value) return row[key] !== null && row[key] !== value.not;
    if ('in' in value) return value.in.includes(row[key]);
  }
  return row[key] === value;
});
const update = (rows) => async ({ where, data }) => {
  const found = rows.filter((row) => matches(row, where));
  found.forEach((r) => Object.assign(r, data, { updatedAt: data.updatedAt ?? new Date(++serial) }));
  return { count: found.length };
};
const shot = { id: 1, projectId: 7, shotNumber: 1, sceneId: 1, characterIds: [10], propIds: [], locationId: null,
  visualPrompt: 'A swordswoman draws a sword', shotSize: 'medium', camera: 'static', narration: null, sound: null, speakerId: null,
  startSec: null, durationSec: 6, modelId: 5, status: 'pending', dubStatus: null, lipsyncStatus: null,
  keyframeStatus: null, keyframeGenerationId: null, keyframeUrl: null, keyframeUse: true, keyframeMeta: null, updatedAt: new Date(++serial) };
const asset = { id: 10, projectId: 7, kind: 'character', name: 'Mali', description: 'woman in red hanfu', referenceUrl: 'https://bucket/face.png', images: [], imageStatus: null, imageGenerationId: null, updatedAt: new Date(++serial) };
const rows = [shot], assets = [asset];
const project = () => ({ id: 7, userId: 3, mode: 'film', title: 'Drama', status: 'draft', templateKey: 'wuxia', aspectRatio: '9:16', mood: null,
  scriptJson: { continuity: { enabled: true, endingFrame: true } }, characters: structuredClone(assets), shots: structuredClone(rows),
  scenes: [{ id: 1, locationId: null, timeOfDay: 'day' }] });
mock.module('@/lib/db', { defaultExport: {
  aiStoryShot: { updateMany: update(rows) }, aiStoryCharacter: { updateMany: update(assets) },
  aiStoryProject: { updateMany: async () => ({ count: 1 }) },
  aiGeneration: { findMany: async () => [{ id: 801, status: 'completed', resultUrl: 'https://bucket/opening.png', creditsRefunded: 0 }] },
} });
mock.module('@/lib/services/generation', { namedExports: { GenerationService: { generate: async (user, input, options) => {
  orders.push({ user, input, options }); const id = 800 + orders.length;
  if (holdNext) { holdNext = false; await new Promise((resolve) => { releaseOld = resolve; }); }
  if (fail) throw new Error('provider unavailable'); return { id };
} } } });
mock.module('@/lib/services/prompt-enhancer', { namedExports: { chatViaPool: async () => null } });
mock.module('@/lib/services/generation-errors', { namedExports: { generationErrorResponse: () => null } });
const { orderKeyframe, syncPictures, orderAssetPicture } = await import('@/lib/story/keyframes');
const { renderShot } = await import('@/lib/story/service');
const { keyframeSignature, continuityState } = await import('@/lib/story/continuity');
const image = { id: 4, key: 'image', name: 'Image', refs: 4, label: { th: '', en: '' }, orderable: true, reason: null, credits: 3 };
const video = [{ id: 5, key: 'minimax-h3', name: 'Video', creditsPerUnit: 10, orderable: true }];

await assert.rejects(() => renderShot(3, false, project(), 1, video));
assert.equal(orders.length, 0, 'video cannot charge before opening picture approval');
const snapshot = project();
const claims = await Promise.allSettled([orderKeyframe(3, false, snapshot, 1, image), orderKeyframe(3, false, snapshot, 1, image)]);
assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
assert.equal(orders.length, 1, 'two tabs cannot charge twice for the same opening picture');
assert.deepEqual(orders[0].input.referenceImages, ['https://bucket/face.png']);
assert.deepEqual(shot.keyframeMeta.references, [10]);
assert.equal(shot.keyframeMeta.review, 'pending');
assert.equal(await syncPictures(project()), true);
assert.equal(shot.keyframeStatus, 'done');
assert.equal(continuityState(shot, project()), 'unreviewed');
await assert.rejects(() => renderShot(3, false, project(), 1, video));
assert.equal(orders.length, 1);
shot.keyframeMeta.review = 'approved';
const next = { ...structuredClone(shot), id: 2, shotNumber: 2, keyframeUrl: 'https://bucket/next.png' };
rows.push(next);
await renderShot(3, false, project(), 1, video);
assert.equal(orders[1].input.inputImage, 'https://bucket/opening.png');
assert.equal(orders[1].input.inputImageEnd, 'https://bucket/next.png');

shot.status = 'pending'; shot.keyframeMeta.review = 'flagged';
await assert.rejects(() => renderShot(3, false, project(), 1, video));
assert.equal(orders.length, 2, 'reported drift is never sent to a paid video order');
shot.keyframeMeta.review = 'approved'; asset.description = 'woman in blue hanfu';
await assert.rejects(() => renderShot(3, false, project(), 1, video));
assert.equal(orders.length, 2, 'changed references invalidate an old approval');
shot.keyframeMeta.signature = keyframeSignature(shot, project());
next.keyframeMeta.signature = keyframeSignature(next, project());
fail = true;
await assert.rejects(() => orderKeyframe(3, false, project(), 1, image));
assert.equal(shot.keyframeStatus, 'failed', 'refused picture orders release their claim');
assert.equal(shot.keyframeMeta.review, 'pending', 'a remake resets the old approval');
fail = false;
holdNext = true;
const oldOrder = orderKeyframe(3, false, project(), 1, image);
await new Promise((resolve) => setImmediate(resolve));
const oldClaim = shot.keyframeMeta.claimId;
shot.updatedAt = new Date(Date.now() - 11 * 60_000);
await syncPictures(project());
assert.equal(shot.keyframeStatus, 'failed', 'an orphan is released');
await orderKeyframe(3, false, project(), 1, image);
const newGeneration = shot.keyframeGenerationId;
assert.notEqual(shot.keyframeMeta.claimId, oldClaim);
releaseOld(); await oldOrder;
assert.equal(shot.keyframeGenerationId, newGeneration, 'a slow old response cannot attach to the replacement claim');
const count = orders.length;
shot.keyframeStatus = 'failed'; shot.keyframeGenerationId = null;
asset.referenceUrl = null;
await assert.rejects(() => orderKeyframe(3, false, project(), 1, image));
assert.equal(orders.length, count, 'missing face reference is rejected before charging');
asset.referenceUrl = 'https://bucket/face.png';
await assert.rejects(() => orderAssetPicture(3, false, project(), 10, { ...image, refs: 0 }, '', 'profile'));
assert.equal(orders.length, count, 'a new character angle must preserve its reference');
await orderAssetPicture(3, false, project(), 10, image, '', 'profile');
assert.match(orders.at(-1).input.prompt, /90 degrees/);
assert.deepEqual(orders.at(-1).input.referenceImages, ['https://bucket/face.png']);
console.log('Continuity job scenarios passed');
`], { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Continuity job scenarios passed/);
});
