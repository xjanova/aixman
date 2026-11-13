/**
 * Series and short dramas: the bible, the episodes' briefs and plans, and the
 * library an episode starts with.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/story/__tests__/series.test.mts)
 *
 * What must hold: the head writer's answer is never trusted field by field;
 * a batch continues the episodes before it and never leaves a gap; an
 * episode's brief always fits the planner and carries its hook and
 * cliffhanger; an episode opens on its hook instead of an establishing shot
 * and stops on its cliffhanger; faces made in one episode carry into the next.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BIBLE_BATCH,
  SERIES_LIMITS,
  batchFrom,
  bibleMessages,
  bibleOf,
  castOf,
  editEpisodes,
  episodeBrief,
  episodeCountOf,
  episodeLibrary,
  episodePlanOf,
  episodeSecondsOf,
  episodeTitle,
  firstUnwritten,
  mergeBible,
  nextBatch,
  parseBible,
  seriesLanguage,
  writtenCount,
  type BibleInput,
  type EpisodeOutline,
  type LibrarySeed,
  type SeriesBible,
} from '@/lib/story/series';
import { LIMITS, filmOutlineMessages, filmPlannerMessages, type PlanInput } from '@/lib/story/cinematic';
import { structureMessages, type StructureInput } from '@/lib/story/library';

const ep = (k: number, extra: Partial<EpisodeOutline> = {}): EpisodeOutline => ({
  title: `ตอน ${k}`,
  summary: `เรื่องของตอน ${k}`,
  hook: `ฉากเปิด ${k}`,
  cliffhanger: `ปมค้าง ${k}`,
  ...extra,
});

const input: BibleInput = {
  title: '',
  premise: 'สาวออฟฟิศถูกแฟนหักหลังในงานแต่ง แล้วพบว่าตัวเองเป็นทายาทเศรษฐี',
  format: 'short',
  genre: 'revenge',
  language: 'th',
  episodeSeconds: 60,
  count: 10,
  cast: [{ name: 'มายา', description: 'young Thai woman, office clothes', referenceUrl: null }],
  characters: [],
  done: [],
  from: 1,
  to: 8,
};

test('parseBible: fields are clipped, a cast name is not re-added, characters keep to the room left', () => {
  const answer = `Sure! {"title":"เจ้าสาวทวงแค้น","logline":"${'ก'.repeat(900)}","characters":[{"name":"มายา","description":"dup"},{"name":"ธาม","description":"cold CEO, 30s"},{"name":"ธาม","description":"again"}],"episodes":[{"title":"งานแต่งพัง","summary":"${'ข'.repeat(3000)}","hook":"ตบหน้าเจ้าบ่าว","cliffhanger":"ชายแปลกหน้าเรียกเธอว่าคุณหนู"},{"title":"ทายาท","summary":"เธอรู้ความจริง","hook":"h","cliffhanger":"c"}]}`;
  const batch = parseBible(answer, input)!;
  assert.equal(batch.title, 'เจ้าสาวทวงแค้น');
  assert.equal(batch.logline.length, SERIES_LIMITS.logline);
  assert.equal(batch.episodes.length, 2);
  assert.equal(batch.episodes[0].summary.length, SERIES_LIMITS.episodeSummary);
  assert.deepEqual(batch.characters.map((c) => c.name), ['ธาม']);

  const full = { ...input, cast: Array.from({ length: LIMITS.characters }, (_, k) => ({ name: `c${k}`, description: '', referenceUrl: null })) };
  assert.deepEqual(parseBible(answer, full)!.characters, [], 'a full cast leaves no room');
});

test('parseBible: junk, no episodes, or an unwritten first episode give nothing; a gap ends the batch', () => {
  assert.equal(parseBible('no json here', input), null);
  assert.equal(parseBible('{"episodes": []}', input), null);
  assert.equal(parseBible('{"episodes": [{"hook": "only a hook"}]}', input), null);
  const gap = parseBible('{"episodes": [{"title": "1"}, {"hook": "x"}, {"title": "3"}]}', input)!;
  assert.equal(gap.episodes.length, 1, 'episode 3 would follow an episode nobody wrote');
  const extra = parseBible(`{"episodes": [${Array.from({ length: 12 }, (_, k) => `{"title":"${k}"}`).join(',')}]}`, { ...input, from: 1, to: 3 })!;
  assert.equal(extra.episodes.length, 3, 'never more than asked');
});

test('mergeBible: the first batch brings the logline and new people; later batches continue; a rewrite drops what followed', () => {
  const first = mergeBible(null, { title: 'T', logline: 'L', characters: [{ name: 'ธาม', description: 'd' }], episodes: [ep(1), ep(2), ep(3)] }, 1, 10);
  assert.equal(first.logline, 'L');
  assert.equal(first.episodes.length, 3);

  const next = mergeBible(first, { title: 'ignored', logline: 'ignored', characters: [{ name: 'x', description: '' }], episodes: [ep(4), ep(5)] }, 4, 10);
  assert.equal(next.logline, 'L');
  assert.deepEqual(next.characters.map((c) => c.name), ['ธาม']);
  assert.deepEqual(next.episodes.map((o) => o.title), ['ตอน 1', 'ตอน 2', 'ตอน 3', 'ตอน 4', 'ตอน 5']);

  const rewrite = mergeBible(next, { title: '', logline: '', characters: [], episodes: [ep(2, { title: 'ใหม่ 2' })] }, 2, 10);
  assert.deepEqual(rewrite.episodes.map((o) => o.title), ['ตอน 1', 'ใหม่ 2'], 'episodes 3–5 followed the old episode 2');

  const capped = mergeBible(null, { title: '', logline: '', characters: [], episodes: [ep(1), ep(2), ep(3)] }, 1, 2);
  assert.equal(capped.episodes.length, 2, 'never more episodes than the series has');
});

test('writtenCount and nextBatch: AI writes on from the first episode without an outline, BIBLE_BATCH at a time', () => {
  const bible: SeriesBible = { logline: '', characters: [], episodes: [ep(1), ep(2)] };
  assert.equal(writtenCount(bible), 2);
  assert.equal(writtenCount(null), 0);
  assert.deepEqual(nextBatch(3, 30), { from: 3, to: 2 + BIBLE_BATCH });
  assert.deepEqual(nextBatch(9, 10), { from: 9, to: 10 });
  assert.equal(nextBatch(11, 10), null);
  assert.equal(nextBatch(0, 10), null);
});

test('filling gaps never overwrites an outline the customer wrote; a rewrite runs on regardless', () => {
  // Episodes 1–2 by AI, 5 by hand; 3, 4 and 6 onward have none.
  const bible: SeriesBible = { logline: 'L', characters: [], episodes: [ep(1), ep(2), { title: '', summary: '', hook: '', cliffhanger: '' }, { title: '', summary: '', hook: '', cliffhanger: '' }, ep(5, { title: 'มือ' })] };
  assert.equal(firstUnwritten(bible, 1, 10), 3);
  assert.equal(firstUnwritten(bible, 5, 10), 6);
  assert.equal(firstUnwritten(bible, 1, 2), 3, 'count + 1 when every episode has one');
  assert.deepEqual(batchFrom(bible, 3, 10, true), { from: 3, to: 4 }, 'stops before the hand-written episode 5');
  assert.deepEqual(batchFrom(bible, 3, 10, false), { from: 3, to: 3 + BIBLE_BATCH - 1 });

  const filled = mergeBible(bible, { title: '', logline: '', characters: [], episodes: [ep(3), ep(4)] }, 3, 10, true);
  assert.deepEqual(filled.episodes.map((o) => o.title), ['ตอน 1', 'ตอน 2', 'ตอน 3', 'ตอน 4', 'มือ']);
  const short = mergeBible(bible, { title: '', logline: '', characters: [], episodes: [ep(3)] }, 3, 10, true);
  assert.equal(short.episodes[4].title, 'มือ', 'a batch that came back short keeps what follows too');
  assert.equal(writtenCount(short), 3);
});

test('editEpisodes: only the fields sent change; an episode may be written by hand ahead; nothing past the count', () => {
  const bible: SeriesBible = { logline: 'L', characters: [], episodes: [ep(1)] };
  const edited = editEpisodes(bible, [{ number: 1, hook: 'ใหม่' }, { number: 3, title: 'สาม' }, { number: 99, title: 'no' }, { number: 'x' }], 10);
  assert.equal(edited.episodes[0].title, 'ตอน 1');
  assert.equal(edited.episodes[0].hook, 'ใหม่');
  assert.equal(edited.episodes[1].title, '', 'episode 2 stays unwritten');
  assert.equal(edited.episodes[2].title, 'สาม');
  assert.equal(edited.episodes.length, 3);
  assert.equal(writtenCount(edited), 1, 'AI continues at episode 2');

  const cleared = editEpisodes(edited, [{ number: 3, title: '' }], 10);
  assert.equal(cleared.episodes.length, 1, 'an emptied last episode is dropped');
  assert.equal(editEpisodes(null, [{ number: 1, summary: 's' }], 5).episodes[0].summary, 's');

  // A hook or cliffhanger alone is not an outline: nothing half-kept for AI to write over.
  assert.equal(editEpisodes(null, [{ number: 1, hook: 'h', cliffhanger: 'c' }], 5).episodes.length, 0);
  const stripped = editEpisodes(edited, [{ number: 1, title: '', summary: '' }], 10);
  assert.equal(stripped.episodes[0].hook, '', 'clearing the title and summary clears the episode');
  assert.equal(bibleOf({ episodes: [{ hook: 'only' }, { title: 'two' }] })!.episodes[0].hook, '');
});

test('bibleOf and castOf: stored JSON is never trusted', () => {
  assert.equal(bibleOf(null), null);
  assert.equal(bibleOf([1, 2]), null);
  const b = bibleOf({ logline: 5, characters: 'x', episodes: [{ title: 'a' }, 'just a summary', null, { title: '' }] })!;
  assert.equal(b.logline, '');
  assert.deepEqual(b.characters, []);
  assert.equal(b.episodes.length, 2);
  assert.equal(b.episodes[1].summary, 'just a summary');
  assert.deepEqual(castOf([{ name: 'a', referenceUrl: 7 }, { name: '' }, 'x']), [{ name: 'a', description: '', referenceUrl: null }]);
  assert.deepEqual(castOf('nope'), []);
});

test('bibleMessages: the first batch asks for the bible, later ones continue the story, the last one ends it', () => {
  const first = bibleMessages(input);
  assert.match(first.system, /"logline": string/);
  assert.match(first.system, /"characters"/);
  assert.match(first.system, /episodes 1 to 8 of 10/);
  assert.match(first.system, /Thai/);
  assert.doesNotMatch(first.system, /finale/);
  assert.match(first.user, /มายา/);

  const later = bibleMessages({ ...input, from: 9, to: 10, done: Array.from({ length: 8 }, (_, k) => ep(k + 1)), characters: [{ name: 'ธาม', description: 'cold CEO' }] });
  assert.doesNotMatch(later.system, /"logline"/);
  assert.match(later.system, /Add no new main characters/);
  assert.match(later.system, /finale/);
  assert.match(later.user, /Episodes so far:\n1\. ตอน 1/);
  assert.match(later.user, /ธาม — cold CEO/);

  const long = bibleMessages({ ...input, count: 30, from: 29, to: 30, done: Array.from({ length: 28 }, (_, k) => ep(k + 1, { summary: 'ค'.repeat(1200) })) });
  assert.ok(long.user.length < 12_000, `the story so far is squeezed (${long.user.length})`);
  assert.match(long.user, /28\. ตอน 28 — ค+/, 'the newest episode stays in full');
});

test('episodeBrief: carries the hook, the cliffhanger and the episode before, and always fits the planner', () => {
  const series = { title: 'เจ้าสาวทวงแค้น', premise: input.premise, format: 'short', genre: 'revenge', language: 'th', aspectRatio: '9:16', episodeCount: 10 };
  const bible: SeriesBible = { logline: 'ทายาทเศรษฐีทวงคืน', characters: [], episodes: [ep(1), ep(2), ep(3)] };
  const brief = episodeBrief(series, bible, 3);
  assert.match(brief, /ตอนที่ 3 จาก 10: ตอน 3/);
  assert.match(brief, /เปิดตอนด้วย: ฉากเปิด 3/);
  assert.match(brief, /ปมค้าง 3/);
  assert.match(brief, /2\. ตอน 2 — เรื่องของตอน 2 \(จบที่: ปมค้าง 2\)/);

  const huge: SeriesBible = { logline: 'ล'.repeat(400), characters: [], episodes: Array.from({ length: 30 }, (_, k) => ep(k + 1, { summary: 'ส'.repeat(1200), cliffhanger: 'ป'.repeat(300) })) };
  const last = episodeBrief({ ...series, episodeCount: 30 }, huge, 30);
  assert.ok(last.length <= LIMITS.brief, `brief fits (${last.length})`);
  assert.match(last, /29\. ตอน 29 — ส+/, 'the episode before survives in full');
  assert.match(last, /ตอนจบของเรื่อง/);

  const en = episodeBrief({ ...series, language: 'en' }, bible, 1);
  assert.match(en, /Episode 1 of 10/);
  assert.doesNotMatch(en, /Previously/, 'episode 1 has nothing before it');
});

test('episodePlanOf and the planners: an episode opens on its hook, picks up the last cliffhanger and stops on its own', () => {
  const bible: SeriesBible = { logline: '', characters: [], episodes: [ep(1), ep(2)] };
  const plan = episodePlanOf({ format: 'short', episodeCount: 10, aspectRatio: '9:16' }, bible, 2);
  assert.equal(plan.previously, 'ปมค้าง 1');
  assert.equal(plan.vertical, true);

  const base: PlanInput = { mode: 'film', brief: 'story', characters: [], look: 'drama', mood: '', songSeconds: 0, targetSeconds: 60, episode: plan };
  const { system } = filmPlannerMessages(base);
  assert.doesNotMatch(system, /establishing shot\./);
  assert.match(system, /hook within the first 3 seconds — no slow establishing shot: ฉากเปิด 2/);
  assert.match(system, /cliffhanger, unresolved, cutting at its peak: ปมค้าง 2/);
  assert.match(system, /picks up straight from how the last episode ended: ปมค้าง 1/);
  assert.match(system, /Vertical 9:16/);

  const part = filmPlannerMessages(base, { index: 0, count: 2, summary: 's', seconds: 30, outline: ['a', 'b'], maxShots: 4 });
  assert.match(part.system, /hook within the first 3 seconds/);
  assert.match(part.system, /Do not end the film/, 'the first of two parts does not end the episode');

  const finale = filmPlannerMessages({ ...base, episode: { ...plan, number: 10 } });
  assert.match(finale.system, /This is the finale/);

  const outline = filmOutlineMessages({ ...base, targetSeconds: 180 }, 3);
  assert.match(outline.system, /opens on its hook \(ฉากเปิด 2\)/);

  const structure: StructureInput = { ...base, props: [], locations: [] };
  const s = structureMessages(structure);
  assert.match(s.system, /The first scene opens on the episode's hook: ฉากเปิด 2/);
  assert.match(s.system, /The last scene stops on the cliffhanger, unresolved: ปมค้าง 2/);

  // A standalone film is planned exactly as before, word for word.
  const before = 'the whole story with a beginning, middle and end. Open on an establishing shot; vary sizes (wide → medium → close-up) and give every camera move a reason.';
  const film = filmPlannerMessages({ ...base, episode: undefined });
  assert.ok(film.system.includes(`seconds that tell ${before}`), film.system);
  assert.ok(filmPlannerMessages({ ...base, targetSeconds: null, episode: undefined }).system.includes(`- 4 to 12 shots that tell ${before}`));
  assert.match(filmPlannerMessages({ ...base, episode: undefined }, { index: 0, count: 2, summary: 's', seconds: 30, outline: ['a', 'b'], maxShots: 4 }).system, /Open the film on an establishing shot\. Do not end the film; stop where/);
  assert.doesNotMatch(film.system, /episode/);
  assert.doesNotMatch(structureMessages({ ...structure, episode: undefined }).system, /episode/);
});

test('episodeLibrary: the made episode carries over whole, missing cast join by name, characters capped', () => {
  const made: LibrarySeed[] = [
    { kind: 'character', name: 'มายา', description: 'd', origin: 'uploaded', referenceUrl: 'https://cdn/x.png', images: ['https://cdn/y.png'], voiceId: null },
    { kind: 'location', name: 'คฤหาสน์', description: 'mansion', origin: 'planned', referenceUrl: null, images: null, voiceId: null },
  ];
  const lib = episodeLibrary(made, [{ name: ' มายา ', description: 'other', referenceUrl: null }, { name: 'แม่', description: 'mother', referenceUrl: 'https://cdn/m.png' }], [{ name: 'ธาม', description: 'ceo' }]);
  assert.deepEqual(lib.map((s) => s.name), ['มายา', 'คฤหาสน์', 'แม่', 'ธาม']);
  assert.deepEqual(lib[0].images, ['https://cdn/y.png'], 'the drawn angles come along');
  assert.equal(lib[3].origin, 'planned');

  const crowd = Array.from({ length: 12 }, (_, k) => ({ name: `p${k}`, description: '', referenceUrl: null }));
  const capped = episodeLibrary([], crowd, []);
  assert.equal(capped.filter((s) => s.kind === 'character').length, LIMITS.characters);
});

test('counts, lengths, language and titles stay inside what the planner and the table take', () => {
  assert.equal(episodeCountOf(1, 10), SERIES_LIMITS.minEpisodes);
  assert.equal(episodeCountOf(500, 10), SERIES_LIMITS.maxEpisodes);
  assert.equal(episodeCountOf('abc', 7), 7);
  assert.equal(episodeCountOf(null, 7), 7);
  assert.equal(episodeSecondsOf(180, 60), 180);
  assert.equal(episodeSecondsOf(45, 60), 60, 'only film lengths the planner aims at');
  assert.equal(seriesLanguage('สวัสดี'), 'th');
  assert.equal(seriesLanguage('Hello'), 'en');
  assert.equal(episodeTitle('ซีรีส์', 3, ep(3)), 'ซีรีส์ · EP.3 ตอน 3');
  assert.ok(episodeTitle('ก'.repeat(200), 3, ep(3)).length <= LIMITS.title);
});
