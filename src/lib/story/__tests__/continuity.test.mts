import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterAngle, characterPicturePrompt, continuityBlock, continuitySettings, continuityState, currentKeyframe, endingFrame, keyframeReferenceBlock, keyframeSignature, missingFaces } from '@/lib/story/continuity';

function fixture() {
  const shot = { id: 1, shotNumber: 1, sceneId: 1, characterIds: [10], propIds: [20], locationId: null,
    visualPrompt: 'Mali draws a sword in the temple', shotSize: 'medium', keyframeStatus: 'done', keyframeUrl: 'opening-1', keyframeUse: true,
    keyframeMeta: { signature: '', review: 'approved', references: [10] } };
  const project = { mode: 'film', templateKey: 'wuxia', mood: null, aspectRatio: '9:16', scriptJson: { continuity: { enabled: true, endingFrame: true } },
    characters: [
      { id: 10, kind: 'character', name: 'Mali', description: 'woman in red', referenceUrl: 'face' as string | null, images: ['profile'] },
      { id: 20, kind: 'prop', name: 'Sword', description: 'silver sword', referenceUrl: 'sword', images: [] },
      { id: 30, kind: 'location', name: 'Temple', description: 'stone temple', referenceUrl: 'temple', images: [] },
    ], scenes: [{ id: 1, locationId: 30 as number | null, timeOfDay: 'day' }], shots: [shot] };
  shot.keyframeMeta.signature = keyframeSignature(shot, project);
  return { shot, project };
}

test('continuity is opt-in and accepts only explicit boolean settings', () => {
  assert.deepEqual(continuitySettings(null), { enabled: false, endingFrame: false });
  assert.deepEqual(continuitySettings({ continuity: { enabled: 'true', endingFrame: 1 } }), { enabled: false, endingFrame: false });
  const { shot, project } = fixture();
  project.scriptJson.continuity.enabled = false;
  shot.keyframeStatus = 'failed';
  assert.equal(continuityState(shot, project), 'off');
  assert.equal(continuityBlock(shot, project), null);
});

test('review is invalidated by shot composition, references, scene light, frame and look', () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
    ({ shot }) => { shot.visualPrompt += ' at the gate'; },
    ({ shot }) => { shot.shotSize = 'close'; },
    ({ shot }) => { shot.propIds = []; },
    ({ project }) => { project.characters[0].referenceUrl = 'new-face'; },
    ({ project }) => { project.characters[0].images.push('new-angle'); },
    ({ project }) => { project.characters[1].description = 'bronze sword'; },
    ({ project }) => { project.scenes[0].timeOfDay = 'night'; },
    ({ project }) => { project.scenes[0].locationId = null; },
    ({ project }) => { project.aspectRatio = '16:9'; },
    ({ project }) => { project.templateKey = 'palace'; },
  ];
  for (const change of changes) {
    const f = fixture();
    assert.equal(continuityState(f.shot, f.project), 'approved');
    change(f);
    assert.equal(currentKeyframe(f.shot, f.project), false);
    assert.equal(continuityState(f.shot, f.project), 'stale');
    assert.ok(continuityBlock(f.shot, f.project));
  }
});

test('unrelated library items and audio changes keep an approved composition', () => {
  const { shot, project } = fixture();
  project.characters.push({ id: 99, kind: 'character', name: 'Extra', description: 'changed', referenceUrl: null, images: [] });
  Object.assign(shot, { narration: 'บทพูดใหม่', durationSec: 7, delivery: 'angry', camera: 'pan', modelId: 4 });
  assert.equal(continuityState(shot, project), 'approved');
});

test('missing, deleted or omitted faces block preparation before credits move', () => {
  const { shot, project } = fixture();
  shot.characterIds = [10, 99];
  assert.deepEqual(missingFaces(shot, project), ['#99']);
  assert.ok(keyframeReferenceBlock(shot, project, 10));
  shot.characterIds = [10, 11];
  project.characters.push({ ...project.characters[0], id: 11, name: 'Ton' });
  assert.ok(keyframeReferenceBlock(shot, project, 1));
  assert.equal(keyframeReferenceBlock(shot, project, 2), null);
  shot.keyframeMeta.signature = keyframeSignature(shot, project);
  assert.equal(currentKeyframe(shot, project), false, 'a picture made without the second face cannot be approved after enabling checks');
  project.characters[0].referenceUrl = null;
  project.characters[0].images = [];
  assert.deepEqual(missingFaces(shot, project), ['Mali']);
});

test('new, in-flight, legacy and flagged pictures each require the correct next action', () => {
  const { shot, project } = fixture();
  shot.keyframeMeta.review = 'pending';
  assert.equal(continuityState(shot, project), 'unreviewed');
  shot.keyframeMeta.review = 'flagged';
  assert.equal(continuityState(shot, project), 'flagged');
  shot.keyframeStatus = 'rendering';
  assert.equal(continuityState(shot, project), 'rendering');
  shot.keyframeStatus = 'failed';
  assert.equal(continuityState(shot, project), 'missing');
  shot.keyframeStatus = 'done';
  shot.keyframeMeta.signature = '';
  assert.equal(continuityState(shot, project), 'stale');
  shot.keyframeMeta.signature = keyframeSignature(shot, project);
  shot.keyframeMeta.review = 'approved';
  shot.keyframeUse = false;
  assert.equal(continuityState(shot, project), 'unreviewed');
  shot.characterIds = [];
  assert.equal(continuityState(shot, project), 'none');
});

test('ending anchor is the immediately next approved shot in the same scene with the same cast', () => {
  const { shot, project } = fixture();
  const next = { ...structuredClone(shot), id: 2, shotNumber: 2, keyframeUrl: 'opening-2' };
  project.shots.push(next);
  assert.deepEqual(endingFrame(shot, project, true), { url: 'opening-2', shotNumber: 2 });
  assert.equal(endingFrame(shot, project, false), null);
  next.sceneId = 2;
  assert.equal(endingFrame(shot, project, true), null);
  next.sceneId = 1;
  next.keyframeMeta.review = 'flagged';
  assert.equal(endingFrame(shot, project, true), null);
  next.keyframeMeta.review = 'approved';
  next.visualPrompt = 'changed';
  assert.equal(endingFrame(shot, project, true), null);
  next.keyframeMeta.signature = keyframeSignature(next, project);
  next.characterIds = [];
  assert.equal(endingFrame(shot, project, true), null);
  next.characterIds = [10];
  assert.ok(endingFrame(shot, project, true));
  project.scriptJson.continuity.endingFrame = false;
  assert.equal(endingFrame(shot, project, true), null);
});

test('character angles produce single-view references with a visible face and fixed identity', () => {
  assert.equal(characterAngle('toString'), 'front');
  assert.equal(characterAngle('profile'), 'profile');
  assert.match(characterPicturePrompt('Mali', 'red hanfu', 'front'), /face large and clearly visible/);
  assert.match(characterPicturePrompt('Mali', 'red hanfu', 'profile'), /90 degrees/);
  assert.match(characterPicturePrompt('Mali', 'red hanfu', 'full'), /entire costume/);
  assert.match(characterPicturePrompt('Mali', 'red hanfu', 'threequarter'), /no collage.*Preserve the same facial proportions/);
});
