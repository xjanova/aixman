/**
 * The reference library, acts and scenes, and the opening picture.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/story/__tests__/library.test.mts)
 *
 * What must hold: a model never gets more pictures than it takes, and the
 * faces go first; the structure step is never trusted field by field and a
 * new place or prop it names is created once; re-planned shots take the old
 * ones' place in the film; how many references a model takes is what our
 * adapter can forward, not what the vendor advertises.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assetPictures,
  groupScenes,
  keyframePrompt,
  parseStructure,
  pickReferences,
  referencesWanted,
  spliceScene,
  type LibraryAsset,
  type StructureInput,
} from '@/lib/story/library';
import { buildShotPrompt, parseFilmPlan, filmPlannerMessages, type ShotDraft } from '@/lib/story/cinematic';
import { referenceCaps, referenceLabel } from '@/lib/reference-caps';

const lib: LibraryAsset[] = [
  { id: 1, kind: 'character', name: 'Mali', description: 'young Thai woman, red dress', pictures: ['m1', 'm2'] },
  { id: 2, kind: 'character', name: 'Ton', description: 'old fisherman', pictures: ['t1'] },
  { id: 3, kind: 'prop', name: 'Sword', description: 'curved steel sword with gold hilt', pictures: ['s1', 's2', 's3'] },
  { id: 4, kind: 'location', name: 'Temple', description: 'ruined stone temple in the jungle', pictures: ['l1'] },
  { id: 5, kind: 'prop', name: 'Letter', description: 'old folded letter', pictures: [] },
];

test('every item main picture first, characters lead, then other angles until the model is full', () => {
  const shot = { characterIds: [2, 1], propIds: [3, 5], locationId: 4 };
  assert.deepEqual(pickReferences(shot, lib, 4).map((r) => r.url), ['t1', 'm1', 'l1', 's1']);
  assert.deepEqual(pickReferences(shot, lib, 6).map((r) => r.url), ['t1', 'm1', 'l1', 's1', 'm2', 's2']);
  assert.equal(pickReferences(shot, lib, 0).length, 0);
  // The letter has no picture: it is left to the words.
  assert.equal(referencesWanted(shot, lib), 7);
});

test('an id of the wrong kind is ignored', () => {
  // A prop named as cast, a character named as the place.
  assert.deepEqual(pickReferences({ characterIds: [3], propIds: [1], locationId: 2 }, lib, 10), []);
});

test('pictures come main first, without blanks or repeats, at most four', () => {
  assert.deepEqual(assetPictures({ referenceUrl: 'a', images: ['b', 'a', '', 7, 'c', 'd', 'e'] }), ['a', 'b', 'c', 'd']);
  assert.deepEqual(assetPictures({ referenceUrl: null, images: null }), []);
});

test('the opening picture prompt numbers the references as sent and names what has no picture', () => {
  const shot = { characterIds: [1], propIds: [3, 5], locationId: 4 };
  const refs = pickReferences(shot, lib, 3);
  const text = keyframePrompt(refs, {
    mode: 'film',
    look: 'film',
    mood: '',
    aspect: '16:9',
    shotSize: 'medium',
    visual: 'Mali lifts the sword in the temple.',
    timeOfDay: 'night',
    characters: [lib[0]],
    props: [lib[2], lib[4]],
    location: lib[3],
  });
  assert.match(text, /Image 1 is Mali/);
  assert.match(text, /Image 2 is the place, Temple/);
  assert.match(text, /Image 3 is Sword/);
  assert.match(text, /Letter \(no picture\): old folded letter/);
  assert.match(text, /At night/);
  assert.match(text, /No text/);
});

const input: StructureInput = {
  mode: 'film',
  brief: 'Mali finds a sword in a temple.',
  characters: [
    { id: 1, name: 'Mali', description: '', hasReference: true },
    { id: 2, name: 'Ton', description: '', hasReference: true },
  ],
  props: [{ id: 3, name: 'Sword', description: '', hasReference: true }],
  locations: [{ id: 4, name: 'Temple', description: '', hasReference: true }],
  look: 'film',
  mood: '',
  songSeconds: 0,
  targetSeconds: 120,
};

test('structure: library numbers and names resolve, new things are created once, junk is dropped', () => {
  const answer = JSON.stringify({
    title: 'ดาบ',
    acts: [
      {
        title: 'เริ่ม',
        summary: 'x',
        scenes: [
          { title: 'วัด', summary: 'มะลิเข้าวัด', location: 1, time: 'night', cast: [1, 9], props: [1, 'จดหมาย'], seconds: 30 },
          { title: 'ท่าเรือ', summary: 'ต้นรอ', location: 'ท่าเรือเก่า', time: 'noon', cast: [2], props: ['Sword', 'จดหมาย'], seconds: 30 },
          { title: '', summary: '' },
        ],
      },
      { title: 'จบ', scenes: [{ title: 'กลับวัด', summary: 'y', location: 'temple', cast: [1], seconds: 60 }] },
    ],
    newLocations: [{ name: 'ท่าเรือเก่า', description: 'old wooden pier' }],
    newProps: [{ name: 'จดหมาย', description: 'folded letter' }],
  });
  const plan = parseStructure(answer, input)!;
  assert.ok(plan);
  assert.equal(plan.acts.length, 2);
  const [a, b] = plan.acts[0].scenes;
  assert.equal(plan.acts[0].scenes.length, 2);
  assert.equal(a.locationRef, 4);
  assert.equal(a.timeOfDay, 'night');
  assert.deepEqual(a.cast, [1]);
  assert.deepEqual(a.props, [3, -1]);
  assert.equal(b.locationRef, -1);
  assert.equal(b.timeOfDay, null);
  assert.deepEqual(b.props, [3, -1]);
  // A place named like a library one (any case) is that one.
  assert.equal(plan.acts[1].scenes[0].locationRef, 4);
  assert.deepEqual(plan.newLocations, [{ name: 'ท่าเรือเก่า', description: 'old wooden pier' }]);
  assert.deepEqual(plan.newProps, [{ name: 'จดหมาย', description: 'folded letter' }]);
  // 30 + 30 + 60 = 120: already the asked-for length.
  assert.deepEqual(plan.acts.flatMap((x) => x.scenes.map((s) => s.seconds)), [30, 30, 60]);
});

test('structure: scenes are scaled toward the asked-for length; nothing usable is null', () => {
  const answer = JSON.stringify({ acts: [{ title: 'x', scenes: [{ title: 'a', seconds: 20 }, { title: 'b', seconds: 20 }] }] });
  const plan = parseStructure(answer, input)!;
  assert.deepEqual(plan.acts[0].scenes.map((s) => s.seconds), [60, 60]);
  assert.equal(parseStructure('no json here', input), null);
  assert.equal(parseStructure(JSON.stringify({ acts: [{ scenes: [] }] }), input), null);
});

test('scenes are grouped into planning calls of about a part each', () => {
  assert.deepEqual(groupScenes([30, 20, 20, 90, 10], 60), [[0, 1], [2], [3], [4]]);
  assert.deepEqual(groupScenes([], 60), []);
});

test('re-planned shots take the old ones place; an empty scene follows the scenes before it', () => {
  const shots = [
    { key: 1, sceneOrder: 1, inScene: false },
    { key: 2, sceneOrder: 2, inScene: true },
    { key: 3, sceneOrder: 2, inScene: true },
    { key: 4, sceneOrder: 3, inScene: false },
  ];
  assert.deepEqual(spliceScene(shots, [9, 10, 11], 2), [1, 9, 10, 11, 4]);
  const none = shots.map((s) => ({ ...s, inScene: false }));
  assert.deepEqual(spliceScene(none, [9], 2.5), [1, 2, 3, 9, 4]);
  assert.deepEqual(spliceScene(none, [9], 7), [1, 2, 3, 4, 9]);
});

test('the shot planner tags shots with their scene and props when told the scenes', () => {
  const part = {
    index: 0,
    count: 1,
    summary: 'วัด',
    seconds: 30,
    outline: ['วัด: มะลิเข้าวัด'],
    maxShots: 4,
    scenes: [{ number: 3, title: 'วัด', summary: 'มะลิเข้าวัด', place: 'Temple', time: 'at night', seconds: 30, cast: [1], props: [1] }],
  };
  const { system, user } = filmPlannerMessages(input, part);
  assert.match(system, /"scene": number/);
  assert.match(system, /"props": \[numbers\]/);
  assert.match(user, /Scene 3 "วัด"/);
  const plan = parseFilmPlan(JSON.stringify({ shots: [{ scene: 3, characters: [1], props: [1, 7], visual: 'Mali enters.' }] }), input)!;
  assert.equal(plan.shots[0].scene, 3);
  assert.deepEqual(plan.shots[0].propIds, [3]);
});

test('a clip that opens on a composed picture is told to keep everything in it', () => {
  const shot: ShotDraft = { characterIds: [1], speakerId: null, shotSize: 'wide', camera: 'static', durationSec: 5, startSec: null, visual: 'x', line: '', sound: '', propIds: [3], locationId: 4 };
  const ctx = { mode: 'film' as const, look: 'film', mood: '', characters: input.characters, hasFirstFrame: true, keyframe: true, props: [{ ...input.props[0], description: 'gold sword' }], locations: [{ ...input.locations[0], description: 'stone temple' }] };
  const text = buildShotPrompt('ltx-2.5', shot, ctx);
  assert.match(text, /opens exactly on the first frame/);
  assert.match(text, /Sword \(gold sword\)/);
  assert.match(text, /Temple \(stone temple\)/);
});

test('reference caps: what the adapter forwards, an admin may lower or raise within it', () => {
  const img = (providerSlug: string, modelId: string, defaultParams?: unknown) => referenceCaps({ providerSlug, modelId, category: 'image', defaultParams }).images;
  assert.equal(img('byteplus', 'seedream-5.0'), 10);
  assert.equal(img('byteplus', 'seedream-4.5', { maxReferenceImages: 14 }), 14);
  assert.equal(img('byteplus', 'seedream-5.0', { maxReferenceImages: 99 }), 14);
  assert.equal(img('byteplus', 'seedream-5.0', { maxReferenceImages: 0 }), 0);
  assert.equal(img('byteplus', 'seedream-3.0'), 0);
  assert.equal(img('openai', 'gpt-image-1'), 16);
  assert.equal(img('openai', 'dall-e-3'), 0);
  assert.equal(img('fal', 'fal-ai/flux/dev'), 0);
  assert.equal(img('fal', 'fal-ai/flux-pro/kontext'), 1);
  assert.equal(img('simplepod', 'qwen-image'), 0);
  assert.equal(img('pollinations', 'flux'), 0);
  const ltx = referenceCaps({ providerSlug: 'simplepod', modelId: 'ltx-2.5', category: 'video' });
  assert.equal(ltx.firstFrame, true);
  assert.match(referenceLabel(ltx), /เฟรมแรก/);
  assert.equal(referenceLabel({ images: 10, firstFrame: false, lastFrame: false }), 'รับภาพอ้างอิงได้ 10 ภาพ');
  assert.equal(referenceLabel({ images: 0, firstFrame: false, lastFrame: false }), 'ไม่รับภาพอ้างอิง');
});
