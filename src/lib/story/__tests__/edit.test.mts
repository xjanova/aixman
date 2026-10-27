/**
 * The film editor's pure parts: settings the customer switches, subtitle
 * timing, the ASS file, the filters handed to ffmpeg.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/story/__tests__/edit.test.mts)
 *
 * What must hold: every part of the edit can be turned off; a film never gets
 * the song of an MV and an MV never gets generated music; a customer's words
 * cannot become ASS markup; subtitles sit inside their shot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FAKE_SUB_BAND,
  assEscape,
  bandExpr,
  buildAss,
  defaultEdit,
  mixFilter,
  musicSeconds,
  parseEdit,
  shotVideoFilter,
  subtitleCues,
  timeline,
  wrapLine,
  type CutShot,
} from '@/lib/story/edit';

test('every part of the edit can be switched off, and stays off', () => {
  const off = parseEdit(
    { clipAudio: false, music: 'off', subtitles: false, coverFakeSubs: false, transition: 'cut', titleCard: false, duck: false },
    'film'
  );
  assert.deepEqual(
    { a: off.clipAudio, m: off.music, s: off.subtitles, c: off.coverFakeSubs, t: off.transition, ti: off.titleCard, d: off.duck },
    { a: false, m: 'off', s: false, c: false, t: 'cut', ti: false, d: false }
  );
});

test('defaults: a film speaks and fades; an MV plays its song and cuts', () => {
  assert.equal(defaultEdit('film').clipAudio, true);
  assert.equal(defaultEdit('film').music, 'off');
  assert.equal(defaultEdit('mv').music, 'song');
  assert.equal(defaultEdit('mv').clipAudio, false);
});

test('music source follows the mode; junk falls back to defaults', () => {
  assert.equal(parseEdit({ music: 'song' }, 'film').music, 'generate');
  assert.equal(parseEdit({ music: 'generate' }, 'mv').music, 'song');
  const junk = parseEdit({ clipAudio: 'yes', clipVolume: 99, musicVolume: -3, transition: 'wipe' }, 'film');
  assert.equal(junk.clipAudio, true);
  assert.equal(junk.clipVolume, 2);
  assert.equal(junk.musicVolume, 0);
  assert.equal(junk.transition, 'fade');
  assert.deepEqual(parseEdit(null, 'mv'), defaultEdit('mv'));
});

const SHOTS: CutShot[] = [
  { number: 1, seconds: 6, text: 'สวัสดีค่ะ', burnsSubs: true },
  { number: 2, seconds: 4.5, text: '', burnsSubs: true },
  { number: 3, seconds: 5, text: 'ลาก่อน', burnsSubs: false },
];

test('subtitles sit inside their shot and skip shots without words', () => {
  assert.deepEqual(timeline(SHOTS), [
    { start: 0, end: 6 },
    { start: 6, end: 10.5 },
    { start: 10.5, end: 15.5 },
  ]);
  const cues = subtitleCues(SHOTS, true);
  assert.equal(cues.length, 2);
  assert.ok(cues[0].start >= 0 && cues[0].end <= 6);
  assert.ok(cues[1].start >= 10.5 && cues[1].end <= 15.5);
});

test('a customer cannot write ASS markup into the film', () => {
  const escaped = assEscape('{\\pos(0,0)\\fs200}ใหญ่\nบรรทัด\b\u0007');
  assert.doesNotMatch(escaped, /[{}\\\x00-\x1f]/);
  const ass = buildAss({ aspect: '16:9', cues: [{ start: 0.3, end: 5, text: '{\\b1}ฮัลโหล' }], title: 'เรื่อง {x}', font: 'Sarabun' });
  const events = ass.split('[Events]')[1];
  // Only our own {\fad(...)} override blocks remain.
  for (const block of events.match(/\{[^}]*\}/g) ?? []) assert.match(block, /^\{\\fad\(\d+,\d+\)\}$/);
  assert.match(ass, /PlayResX: 1344/);
  assert.match(ass, /Dialogue: 1,0:00:00\.20,0:00:03\.00,Title/);
});

test('long Thai lines wrap on spaces into at most three lines', () => {
  const line = 'คำ '.repeat(40).trim();
  const lines = wrapLine(line, 20);
  assert.ok(lines.length <= 3);
  assert.ok(lines.every((l) => l.length <= 20));
  assert.deepEqual(wrapLine('สั้น'), ['สั้น']);
});

test('the cover band stays inside the clip, landscape or portrait', () => {
  const { landscape, portrait, y, h } = FAKE_SUB_BAND;
  for (const band of [landscape, portrait]) assert.ok(band.x + band.w <= 1);
  assert.ok(y + h <= 1);
  // The blur happens on the source frame, before it is fitted to the film's frame.
  const vf = shotVideoFilter({ aspect: '16:9', seconds: 5, cover: true, fade: true });
  assert.ok(vf.indexOf('boxblur') < vf.indexOf('scale='));
  assert.match(vf, /overlay=x=.*main_w.*fade=t=out:st=4\.700/);
  assert.match(bandExpr().w, /if\(gt\(ih\\,iw\)/);
  assert.doesNotMatch(shotVideoFilter({ aspect: '16:9', seconds: 5, cover: false, fade: false }), /boxblur|fade/);
});

test('the mix: ducked music under the clips, or either alone, or none', () => {
  assert.match(mixFilter({ clips: true, music: true, clipVolume: 1, musicVolume: 0.3, duck: true, seconds: 20 })!, /sidechaincompress/);
  assert.doesNotMatch(mixFilter({ clips: true, music: true, clipVolume: 1, musicVolume: 0.3, duck: false, seconds: 20 })!, /sidechaincompress/);
  assert.match(mixFilter({ clips: false, music: true, clipVolume: 1, musicVolume: 1, duck: true, seconds: 20 })!, /^\[1:a\]/);
  assert.equal(mixFilter({ clips: false, music: false, clipVolume: 1, musicVolume: 1, duck: true, seconds: 20 }), null);
  assert.equal(musicSeconds(2), 5);
  assert.equal(musicSeconds(500), 240);
});
