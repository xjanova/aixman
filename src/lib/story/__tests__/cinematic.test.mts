/**
 * The movie / MV storyboard writer.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/story/__tests__/cinematic.test.mts)
 *
 * What must hold: an MV's shots cover the whole song in order without gaps or
 * blinks; a model's storyboard is never trusted field by field; a shot led by
 * a character never zooms into a face it has to invent; every prompt forbids
 * the subtitles LTX burns in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS,
  buildShotPrompt,
  parseFilmPlan,
  parseLyrics,
  parseMvPlan,
  planFromRules,
  renderSeconds,
  safeCamera,
  songTimeline,
  type CharacterLite,
  type PlanInput,
} from '@/lib/story/cinematic';

const MISA: CharacterLite = { id: 11, name: 'Misa', description: 'young woman, blonde-to-pink twin tails, red gothic lolita dress', hasReference: true };
const KAI: CharacterLite = { id: 12, name: 'Kai', description: 'tall man in a black leather jacket', hasReference: false };

const LYRICS = `[Intro]
[Verse 1]
กุหลาบแดงที่เธอให้ฉันในวันนั้น
ยังเก็บไว้ในใจไม่เคยลืมเลือน
[Chorus]
กุหลาบแดง กุหลาบแดง
หนามแหลมทิ่มใจให้เจ็บช้ำ
[Guitar Solo]
[Chorus]
กุหลาบแดง กุหลาบแดง
หนามแหลมทิ่มใจให้เจ็บช้ำ
[Outro]`;

test('lyrics split into tagged sections, sung lines only', () => {
  const sections = parseLyrics(LYRICS);
  assert.deepEqual(sections.map((s) => s.tag), ['intro', 'verse 1', 'chorus', 'guitar solo', 'chorus', 'outro']);
  assert.equal(sections[1].lines.length, 2);
  assert.equal(sections[3].lines.length, 0);
});

test('an MV timeline covers the whole song, in order, with no gaps and no blink shots', () => {
  for (const seconds of [45, 180, 240, 360]) {
    const slots = songTimeline(LYRICS, seconds);
    assert.ok(slots.length > 0);
    assert.equal(slots[0].start, 0);
    let end = 0;
    for (const s of slots) {
      assert.ok(Math.abs(s.start - end) < 0.05, `gap before ${s.start} (prev end ${end})`);
      assert.ok(s.duration >= LIMITS.minShotSeconds - 0.01, `blink of ${s.duration}s`);
      end = s.start + s.duration;
    }
    assert.ok(Math.abs(end - seconds) < 0.2, `ends at ${end}, song is ${seconds}`);
    assert.ok(slots.length <= LIMITS.shotsMv);
    // Every sung line lands somewhere.
    const sung = slots.map((s) => s.line).join(' / ');
    assert.match(sung, /กุหลาบแดงที่เธอให้ฉัน/);
    assert.ok(slots.some((s) => s.instrumental && s.section === 'guitar solo'));
  }
});

test('lyrics without tags still get an intro and an outro', () => {
  const slots = songTimeline('บรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม', 60);
  assert.equal(slots[0].section, 'intro');
  assert.equal(slots.at(-1)!.section, 'outro');
});

test('a too-short song makes no shots, a too-long one is cut at the limit', () => {
  assert.deepEqual(songTimeline(LYRICS, 1), []);
  const slots = songTimeline(LYRICS, 9999);
  const end = slots.at(-1)!.start + slots.at(-1)!.duration;
  assert.ok(end <= LIMITS.maxSongSeconds + 0.1);
});

test('a character-led wide shot never pushes in; a close one may', () => {
  assert.equal(safeCamera('wide', 'push-in', true), 'static');
  assert.equal(safeCamera('full', 'push-in', true), 'static');
  assert.equal(safeCamera('close', 'push-in', true), 'push-in');
  assert.equal(safeCamera('wide', 'push-in', false), 'push-in');
  assert.equal(safeCamera('wide', 'no-such-move', false), 'static');
});

test('render length is whole seconds within the limits and never shorter than the slot', () => {
  assert.equal(renderSeconds(4.2), 5);
  assert.equal(renderSeconds(5.0), 5);
  assert.equal(renderSeconds(1), LIMITS.minShotSeconds);
  assert.equal(renderSeconds(14), LIMITS.maxShotSeconds);
});

const filmInput: PlanInput = {
  mode: 'film',
  brief: 'มิสะเดินเข้าโบสถ์ร้าง Misa พูดว่า "ฉันกลับมาแล้ว" Kai ยืนรออยู่ในเงามืด',
  characters: [MISA, KAI],
  look: 'drama',
  mood: '',
  songSeconds: 0,
};

test('a model storyboard is clamped field by field and unknown values fall back', () => {
  const reply = `Here you go:
\`\`\`json
{"title": "กลับบ้าน", "shots": [
  {"characters": [1, 9, 1], "speaker": 1, "duration": 42, "size": "wide", "camera": "push-in", "visual": "Misa walks into a ruined chapel.", "line": "ฉันกลับมาแล้ว", "sound": "wind"},
  {"characters": [], "speaker": null, "duration": "x", "size": "huge", "camera": "spin", "visual": "", "line": ""},
  {"characters": [2], "speaker": 5, "duration": 5, "size": "close", "camera": "push-in", "visual": "Kai's eyes in the dark.", "line": "", "sound": ""}
]}
\`\`\``;
  const plan = parseFilmPlan(reply, filmInput);
  assert.ok(plan);
  assert.equal(plan.title, 'กลับบ้าน');
  assert.equal(plan.shots.length, 2, 'a shot with no visual is dropped');
  const [a, b] = plan.shots;
  assert.deepEqual(a.characterIds, [11], 'unknown and repeated cast numbers are dropped');
  assert.equal(a.speakerId, 11);
  assert.equal(a.durationSec, LIMITS.maxShotSeconds);
  assert.equal(a.camera, 'static', 'wide + push-in on a character is made static');
  assert.equal(b.speakerId, null, 'no line, no speaker');
  assert.equal(b.camera, 'push-in');
  assert.equal(parseFilmPlan('sorry, I cannot', filmInput), null);
});

test('an MV plan keeps our timing and is refused when a slot has no picture', () => {
  const input: PlanInput = { mode: 'mv', brief: LYRICS, characters: [MISA], look: '', mood: 'dark', songSeconds: 60 };
  const slots = songTimeline(LYRICS, 60);
  const good = JSON.stringify({ title: 'x', shots: slots.map(() => ({ characters: [1], size: 'medium', camera: 'orbit', visual: 'Misa sings in the cathedral.' })) });
  const plan = parseMvPlan(good, input, slots);
  assert.ok(plan);
  assert.deepEqual(plan.shots.map((s) => s.startSec), slots.map((s) => s.start));
  assert.deepEqual(plan.shots.map((s) => s.line), slots.map((s) => s.line));
  const short = JSON.stringify({ shots: slots.slice(1).map(() => ({ visual: 'x' })) });
  assert.equal(parseMvPlan(short, input, slots), null);
});

test('the rules plan an MV over the whole song and a film from its sentences', () => {
  const mv = planFromRules({ mode: 'mv', brief: LYRICS, characters: [MISA], look: '', mood: 'romantic', songSeconds: 120 });
  assert.ok(mv.length > 5);
  assert.ok(mv.filter((s) => s.line).every((s) => s.characterIds[0] === MISA.id), 'sung shots are led by the singer');
  const film = planFromRules(filmInput);
  assert.ok(film.length >= 1);
  assert.ok(film.some((s) => s.line === 'ฉันกลับมาแล้ว'));
});

test('prompts: LTX gets one paragraph with the Thai line and no subtitles; H3 its fields', () => {
  const shot = {
    characterIds: [11],
    speakerId: 11,
    shotSize: 'medium-close',
    camera: 'static',
    durationSec: 8,
    startSec: null,
    visual: 'Misa stands among candles and smiles at the camera.',
    line: 'สวัสดีค่ะ',
    sound: 'candles crackling',
  };
  const ctx = { mode: 'film' as const, look: 'film', mood: '', characters: [MISA, KAI], hasFirstFrame: true };
  const ltx = buildShotPrompt('ltx-2.5', shot, ctx);
  assert.match(ltx, /"สวัสดีค่ะ"/);
  assert.match(ltx, /No subtitles/);
  assert.match(ltx, /exactly as in the first frame/);
  const h3 = buildShotPrompt('minimax-h3', shot, ctx);
  assert.match(h3, /^integrated_multimodal_description: \[Shot 1\]/);
  assert.match(h3, /<d>\[Thai\] สวัสดีค่ะ<\/d>/);
  assert.match(h3, /overall_soundscape: candles crackling/);
  assert.match(h3, /non_diegetic_music: /);
  const mv = buildShotPrompt('ltx-2.5', { ...shot, speakerId: null }, { ...ctx, mode: 'mv', mood: 'dark' });
  assert.doesNotMatch(mv, /สวัสดีค่ะ/, 'an MV prompt never asks the model to say the lyric');
  assert.match(mv, /No speech/);
});
