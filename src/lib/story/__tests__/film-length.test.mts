/**
 * Long films: the length the customer asks for, the outline-then-parts plan,
 * and the in-process plan slot.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/story/__tests__/film-length.test.mts)
 *
 * What must hold: only a listed length is ever stored; a long film is planned
 * in parts no longer than FILM_PART_SECONDS; the shots' lengths land near the
 * target without leaving what a shot may render; one plan runs per project.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FILM_PART_SECONDS,
  LIMITS,
  filmOutlineMessages,
  filmPartCount,
  filmPlannerMessages,
  filmTarget,
  fitToTarget,
  parseFilmOutline,
  parseFilmPlan,
  partShotBudget,
  planFromRules,
  salvageArray,
  type PlanInput,
  withTargetSeconds,
  type ShotDraft,
} from '@/lib/story/cinematic';
import { MAX_FILM_SECONDS } from '@/lib/story/edit';
import { claimPlan, finishPlan, planJob } from '@/lib/story/plan-jobs';

const input: PlanInput = {
  mode: 'film',
  brief: 'มายาเดินในตลาดน้ำ. เธอเจอชายแก่ขายว่าว. "ว่าวตัวนี้บินได้ไกลไหม" เธอถาม. เขายิ้มแล้วยื่นว่าวให้.',
  characters: [{ id: 7, name: 'มายา', description: 'young Thai woman, red dress', hasReference: true }],
  look: 'film',
  mood: '',
  songSeconds: 0,
  targetSeconds: 600,
};

const shot = (durationSec: number): ShotDraft => ({
  characterIds: [],
  speakerId: null,
  shotSize: 'medium',
  camera: 'static',
  durationSec,
  startSec: null,
  visual: 'x',
  line: '',
  sound: '',
});

test('only a listed length is read back or stored', () => {
  assert.equal(filmTarget({ targetSeconds: 600 }), 600);
  assert.equal(filmTarget({ targetSeconds: 599 }), null);
  assert.equal(filmTarget({ targetSeconds: '600' }), 600);
  assert.equal(filmTarget(null), null);
  assert.deepEqual(withTargetSeconds({ edit: { subtitles: true } }, '600'), { edit: { subtitles: true }, targetSeconds: 600 });
  assert.deepEqual(withTargetSeconds(null, '9999'), { targetSeconds: null });
  assert.deepEqual(withTargetSeconds(null, '__proto__'), { targetSeconds: null });
});

test('a 10-minute film fits the cut and the shot cap', () => {
  assert.equal(MAX_FILM_SECONDS, 600);
  assert.ok(LIMITS.shotsFilm * LIMITS.maxShotSeconds >= 600);
});

test('a long film is planned in parts of at most one part\'s length', () => {
  assert.equal(filmPartCount(null), 0);
  assert.equal(filmPartCount(60), 0);
  assert.equal(filmPartCount(FILM_PART_SECONDS), 0);
  assert.equal(filmPartCount(180), 3);
  assert.equal(filmPartCount(600), 10);
  const head = filmOutlineMessages(input, 10);
  assert.match(head.system, /exactly 10 parts/);
  assert.match(head.user, /มายา/);
});

test('the parts share the shot cap, so the ending is never cut off', () => {
  for (const target of [180, 300, 600]) {
    const parts = filmPartCount(target);
    assert.ok(partShotBudget(parts) * parts <= LIMITS.shotsFilm);
    // Enough shots, at the longest a shot may be, to fill the length.
    assert.ok(partShotBudget(parts) * parts * LIMITS.maxShotSeconds >= target, `target ${target}`);
  }
});

test('a part asks for its own shots and knows where it sits', () => {
  const outline = ['a', 'b', 'c'];
  const first = filmPlannerMessages(input, { index: 0, count: 3, summary: 'a', seconds: 120, outline, maxShots: 20 });
  assert.match(first.system, /part 1 of 3/);
  assert.match(first.system, /15 shots \(never more\)/);
  // The part's share of the film caps what it may ask for.
  assert.match(filmPlannerMessages(input, { index: 0, count: 10, summary: 'a', seconds: 60, outline, maxShots: 6 }).system, /6 shots \(never more\)/);
  assert.match(first.system, /establishing shot/);
  assert.match(first.system, /Do not end the film/);
  const last = filmPlannerMessages(input, { index: 2, count: 3, summary: 'c', seconds: 120, outline, maxShots: 20 });
  assert.match(last.system, /End the film\./);
  assert.match(last.user, /Write part 3: c/);
  // A short film keeps its own brief.
  assert.match(filmPlannerMessages({ ...input, targetSeconds: null }).system, /4 to 12 shots/);
});

test('an answer cut off mid-way keeps the shots written in full', () => {
  const cut = '{"title":"ว่าว","shots":[{"visual":"A {brace} in text \\"quoted\\"","duration":5},{"visual":"Second shot","line":"สวัสดี","duration":8},{"visual":"Third sh';
  assert.deepEqual(salvageArray(cut, 'shots').map((s) => (s as { visual: string }).visual), ['A {brace} in text "quoted"', 'Second shot']);
  const plan = parseFilmPlan(cut, input);
  assert.equal(plan?.shots.length, 2);
  assert.equal(plan?.shots[1].line, 'สวัสดี');
  assert.deepEqual(salvageArray('no array here', 'shots'), []);
  assert.equal(parseFilmPlan('{"title":"x","shots":[{"visual":"cut', input), null);
});

test('the outline is read when it has every part, strings or objects', () => {
  assert.deepEqual(parseFilmOutline('{"title":"ว่าว","parts":["หนึ่ง","สอง"]}', 2), { title: 'ว่าว', parts: ['หนึ่ง', 'สอง'] });
  assert.deepEqual(parseFilmOutline('```json\n{"parts":[{"summary":"หนึ่ง"},{"summary":"สอง"},{"summary":"สาม"}]}\n```', 2)?.parts, ['หนึ่ง', 'สอง']);
  assert.equal(parseFilmOutline('{"parts":["หนึ่ง"]}', 2), null);
  assert.equal(parseFilmOutline('no json', 2), null);
});

test('shot lengths are pulled toward the target within what a shot renders', () => {
  const near = [shot(8), shot(8), shot(8)];
  assert.equal(fitToTarget(near, 25), near);
  const stretched = fitToTarget([shot(5), shot(5), shot(5), shot(5)], 40);
  assert.deepEqual(stretched.map((s) => s.durationSec), [10, 10, 10, 10]);
  const capped = fitToTarget([shot(5), shot(5)], 600);
  assert.deepEqual(capped.map((s) => s.durationSec), [LIMITS.maxShotSeconds, LIMITS.maxShotSeconds]);
  const shrunk = fitToTarget([shot(10), shot(10), shot(10)], 9);
  assert.deepEqual(shrunk.map((s) => s.durationSec), [LIMITS.minShotSeconds, LIMITS.minShotSeconds, LIMITS.minShotSeconds]);
});

test('the rules aim at the length too, one shot per sentence at most', () => {
  const shots = planFromRules({ ...input, targetSeconds: 40 });
  assert.ok(shots.length >= 1 && shots.length <= 4);
  const total = shots.reduce((n, s) => n + s.durationSec, 0);
  assert.ok(total >= 36 && total <= 44, `total ${total}`);
});

test('one plan runs per project; a dead one frees the slot', () => {
  const t = Date.UTC(2026, 9, 27, 12);
  assert.equal(planJob(901, t), null);
  assert.equal(claimPlan(901, t), true);
  assert.equal(claimPlan(901, t + 1000), false);
  assert.equal(planJob(901, t)?.state, 'planning');
  finishPlan(901, { shots: 58, rules: false });
  assert.deepEqual(planJob(901, t + 1000), { state: 'done', error: null, shots: 58, rules: false });
  assert.equal(claimPlan(901, t + 2000), true);
  // Ran past its time: shown as failed, and another may start.
  assert.equal(planJob(901, t + 2000 + 11 * 60_000)?.state, 'failed');
  assert.equal(claimPlan(901, t + 2000 + 11 * 60_000), true);
  finishPlan(901, { error: 'มีช็อตกำลังสร้างอยู่' });
  assert.equal(planJob(901, t + 2000 + 11 * 60_000)?.error, 'มีช็อตกำลังสร้างอยู่');
});
