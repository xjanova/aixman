import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continuityContext, episodeLedger, shootingScript, type ScriptProject } from '@/lib/story/shooting';
import { CAMERA_ANGLES } from '@/lib/story/angles';
import { filmPlannerMessages, parseFilmPlan, buildShotPrompt, type PlanInput } from '@/lib/story/cinematic';
import { keyframePrompt, structureMessages } from '@/lib/story/library';

const project: ScriptProject = {
  id: 1, title: 'ตราหยก', episodeNumber: 1,
  characters: [{ id: 9, kind: 'character', name: 'หลิน', description: 'Blue hanfu' }, { id: 10, kind: 'prop', name: 'ตราหยก', description: 'Green seal' }, { id: 11, kind: 'location', name: 'ศาลา', description: 'Wooden pavilion' }],
  scenes: [{ id: 5, sceneNumber: 1, title: 'พบตราหยก', locationId: 11, timeOfDay: 'night' }],
  shots: [1, 2].map((n) => ({ id: n, shotNumber: n, sceneId: 5, characterIds: [9], propIds: [10], locationId: null, speakerId: 9,
    visualPrompt: 'Lin discovers a jade seal.', narration: n === 2 ? 'นี่คือตราของอาจารย์' : null, sound: null, shotSize: 'close', camera: 'static',
    angle: 'low', continuityNote: n === 2 ? 'หลินรู้ว่าตราหยกเป็นของอาจารย์' : '', durationSec: 4, status: n === 1 ? 'done' : 'pending', mediaUrl: n === 1 ? 'https://bucket/one.mp4' : null })),
};
test('the ledger follows edited shot scripts and distinguishes completed takes from plans', () => {
  const ledger = episodeLedger(project);
  assert.match(ledger, /rendered; script description/);
  assert.match(ledger, /planned; not rendered/);
  assert.match(ledger, /ศาลา; night; cast: หลิน; props: ตราหยก/);
  assert.match(ledger, /หลินรู้ว่าตราหยกเป็นของอาจารย์/);
  assert.doesNotMatch(ledger, /cast: 9/);
  const changed = episodeLedger({ ...project, shots: [{ ...project.shots[1], continuityNote: 'หลินทิ้งตราหยก' }] });
  assert.match(changed, /หลินทิ้งตราหยก/);
  assert.doesNotMatch(changed, /รู้ว่าตราหยก/);
  const long = episodeLedger({ ...project, shots: Array.from({ length: 60 }, (_, k) => ({ ...project.shots[0], shotNumber: k + 1, continuityNote: 'x'.repeat(500) })) }, 1800);
  assert.ok(long.length <= 1800);
  assert.match(long, /Shot 60/);
  assert.match(long, /earlier shots omitted/);
});
test('all film planning stages receive current episode continuity and dialogue coverage rules', () => {
  const input: PlanInput = { mode: 'film', brief: 'หลินพบตราหยก', characters: [{ id: 9, name: 'หลิน', description: 'Blue hanfu', hasReference: true }], look: 'wuxia', mood: '', songSeconds: 0,
    continuityContext: continuityContext([episodeLedger(project)]) };
  assert.match(filmPlannerMessages(input).user, /หลินรู้ว่าตราหยก/);
  assert.match(structureMessages({ ...input, props: [], locations: [] }).user, /หลินรู้ว่าตราหยก/);
  assert.match(filmPlannerMessages(input).system, /ONE speaker/);
  assert.match(filmPlannerMessages(input).system, /180-degree/);
  const plan = parseFilmPlan(JSON.stringify({ shots: [{ visual: 'Lin replies.', speaker: 1, characters: [], line: 'ข้ารู้แล้ว', angle: 'over-shoulder', continuity: 'หลินรู้ความจริง' }] }), input)!;
  assert.deepEqual(plan.shots[0].characterIds, [9]);
  assert.equal(plan.shots[0].continuityNote, 'หลินรู้ความจริง');
  assert.match(buildShotPrompt('minimax-h3', plan.shots[0], { ...input, hasFirstFrame: true }), /Over-the-shoulder/);
  assert.match(keyframePrompt([], { ...input, aspect: '9:16', shotSize: 'close', angle: 'low', visual: 'Lin replies', characters: [], props: [], location: null, timeOfDay: null }), /Low angle/);
});
test('the shooting script uses shot order, actual durations, camera angles and translated headings', () => {
  const text = shootingScript({ ...project, shots: [...project.shots].reverse() }, 'th');
  assert.ok(text.indexOf('ช็อต 1') < text.indexOf('ช็อต 2'));
  assert.match(text, /4.00–8.00s/);
  assert.match(text, /มุมต่ำ/);
  assert.match(text, /หลิน: นี่คือตราของอาจารย์/);
  assert.match(shootingScript(project, 'en'), /State change/);
  for (const angle of Object.values(CAMERA_ANGLES)) assert.ok(angle.label.th && angle.label.en && angle.prompt);
});
