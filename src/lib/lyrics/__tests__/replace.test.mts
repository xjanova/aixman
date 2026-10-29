/**
 * Replace Section by the words (lyrics/replace.ts) and the two new Suno tools
 * (kie-suno.ts replace, mashup).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/lyrics/__tests__/replace.test.mts)
 *
 * What must hold: the part sung anew starts and ends in the breaths around
 * the lines picked, never inside another line; it is at least 10 s by taking
 * in whole lines; it is refused past half the song; the full lyrics change
 * exactly the lines picked; KIE gets our file, the window and both texts; a
 * window KIE would refuse after charging is refused before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { KaraokeTiming } from '@/lib/lyrics/karaoke';
import { replaceSpan, replacedLyrics, spanText, timingFits } from '@/lib/lyrics/replace';
import { buildSunoTask, checkSunoSource, sanitizeSunoParams, sunoReplaceWindow, thaiForSinging, type SunoOrder } from '@/lib/providers/kie-suno';

const LYRICS = '[Verse]\nหนึ่ง สอง\nสาม สี่\n\n[Chorus]\nห้า หก\nเจ็ด แปด\nเก้า สิบ';

/** Line i sung over [at, at + len]. */
function timing(spans: [number, number][], seconds = 120): KaraokeTiming {
  const texts = ['หนึ่ง สอง', 'สาม สี่', 'ห้า หก', 'เจ็ด แปด', 'เก้า สิบ'];
  return {
    version: 1,
    seconds,
    lines: spans.map(([a, b], i) => ({
      text: texts[i],
      section: i < 2 ? 'verse' : 'chorus',
      start: a,
      end: b,
      estimated: false,
      words: [
        { text: texts[i].split(' ')[0] + ' ', start: a, end: (a + b) / 2 },
        { text: texts[i].split(' ')[1], start: (a + b) / 2, end: b },
      ],
    })),
  };
}

const T = timing([
  [10, 14],
  [15, 19],
  [30, 34],
  [35, 39],
  [40, 44],
]);

test('timingFits: the timing must be of these lyrics', () => {
  assert.equal(timingFits(T, LYRICS), true);
  assert.equal(timingFits(T, LYRICS.replace('สาม', 'สามม')), false);
});

test('replaceSpan: edges in the breaths, never into a neighbour', () => {
  const span = replaceSpan(T, 2, 3, 120);
  assert.equal(span.ok, true);
  if (!span.ok) return;
  assert.equal(span.first, 2);
  assert.equal(span.last, 3);
  assert.ok(span.from > T.lines[1].end && span.from <= 30);
  assert.ok(span.to >= 39 && span.to < T.lines[4].start);
  assert.ok(span.to - span.from >= 10);
});

test('replaceSpan: too short takes in a whole neighbouring line', () => {
  const span = replaceSpan(T, 3, 3, 120);
  assert.equal(span.ok, true);
  if (!span.ok) return;
  assert.equal(span.grew, true);
  assert.ok(span.last - span.first >= 1);
  assert.ok(span.to - span.from >= 10);
  // Every line it covers is covered whole.
  for (let i = span.first; i <= span.last; i++) assert.ok(T.lines[i].start >= span.from && T.lines[i].end <= span.to);
  for (const [i, l] of T.lines.entries()) {
    if (i < span.first || i > span.last) assert.ok(l.end <= span.from || l.start >= span.to, `line ${i} cut in half`);
  }
});

test('replaceSpan: a gap long enough on its own is used before taking a line', () => {
  // The first line has 10 s of intro before it.
  const span = replaceSpan(T, 0, 0, 120);
  assert.equal(span.ok, true);
  if (span.ok) {
    assert.equal(span.first, 0);
    assert.equal(span.last, 0);
    assert.ok(span.to <= 15);
  }
});

test('replaceSpan: refused past half the song', () => {
  const span = replaceSpan(T, 0, 4, 60);
  assert.equal(span.ok, false);
});

test('spanText and replacedLyrics: exactly the lines picked change', () => {
  assert.equal(spanText(LYRICS, 2, 3), 'ห้า หก\nเจ็ด แปด');
  const full = replacedLyrics(LYRICS, 2, 3, 'ใหม่หนึ่ง\n\nใหม่สอง\n');
  assert.equal(full, '[Verse]\nหนึ่ง สอง\nสาม สี่\n\n[Chorus]\nใหม่หนึ่ง\nใหม่สอง\nเก้า สิบ');
  // Across a section tag: the lines and what lies between them go.
  assert.equal(replacedLyrics(LYRICS, 1, 2, 'ข้าม'), '[Verse]\nหนึ่ง สอง\nข้าม\nเจ็ด แปด\nเก้า สิบ');
});

test('thaiForSinging: the common Thai mistypings are mended', () => {
  assert.equal(thaiForSinging('นํ้า'), 'น้ำ');
  assert.equal(thaiForSinging('ทํา'), 'ทำ');
  assert.equal(thaiForSinging('เเม่'), 'แม่');
  assert.equal(thaiForSinging('ใจ​ดี'), 'ใจดี');
  assert.equal(thaiForSinging('น้ำใจ'), 'น้ำใจ');
});

test('sunoReplaceWindow and checkSunoSource: KIE’s rules before the charge', () => {
  assert.equal(sunoReplaceWindow(120, 10, 25).ok, true);
  assert.equal(sunoReplaceWindow(120, 10, 15).ok, false);
  assert.equal(sunoReplaceWindow(30, 0, 20).ok, false);
  assert.equal(sunoReplaceWindow(120, 110, 130).ok, false);
  const facts = { seconds: 120, bytes: 1000 };
  const params = sanitizeSunoParams({ replaceFrom: '29.654', replaceTo: 40.5, fullLyrics: 'ก\r\nข' });
  assert.deepEqual(params, { replaceFrom: 29.65, replaceTo: 40.5, fullLyrics: 'ก\nข' });
  assert.equal(checkSunoSource('replace', facts, params).ok, true);
  const noWords = checkSunoSource('replace', facts, { replaceFrom: 29.65, replaceTo: 40.5 });
  assert.equal(noWords.ok === false && noWords.code, 'missing-text');
  assert.equal(checkSunoSource('replace', facts, {}).ok, false);
});

test('a part picked by lines keeps its lines and the words they index, for reopening — never sent', () => {
  const picked = sanitizeSunoParams({ replaceFrom: 29.65, replaceTo: 40.5, fullLyrics: 'ก\nใหม่', originalLyrics: 'ก\r\nข', replaceLines: [1, 1] });
  assert.deepEqual(picked, { replaceFrom: 29.65, replaceTo: 40.5, fullLyrics: 'ก\nใหม่', originalLyrics: 'ก\nข', replaceLines: [1, 1] });
  // Lines without words, words without lines, lines backwards, or no part at all: neither is kept.
  for (const extra of [{ replaceLines: [1, 2] }, { originalLyrics: 'ก' }, { originalLyrics: 'ก', replaceLines: [2, 1] }, { originalLyrics: 'ก', replaceLines: [0.5, 1] }]) {
    const out = sanitizeSunoParams({ replaceFrom: 10, replaceTo: 22, ...extra });
    assert.equal(out.originalLyrics, undefined);
    assert.equal(out.replaceLines, undefined);
  }
  assert.deepEqual(sanitizeSunoParams({ originalLyrics: 'ก', replaceLines: [0, 0] }), {});
  const task = buildSunoTask('replace', { style: 'thai pop', prompt: '', instrumental: false, audio: 'https://r2.example/aixman/uploads/1/audio/a.mp3', tier: 'V6', suno: picked });
  assert.equal(JSON.stringify(task).includes('ก\\nข'), false);
  assert.equal('replaceLines' in task.input || 'originalLyrics' in task.input, false);
});

test('mashup: needs a second track, each within 8 minutes', () => {
  const facts = { seconds: 120, bytes: 1000 };
  assert.equal(checkSunoSource('mashup', facts, {}).ok, false);
  assert.equal(checkSunoSource('mashup', facts, {}, { seconds: 200, bytes: 1 }).ok, true);
  const long = checkSunoSource('mashup', facts, {}, { seconds: 9 * 60, bytes: 1 });
  assert.equal(long.ok === false && long.code, 'song-too-long');
  assert.deepEqual(sanitizeSunoParams({ mashWith: 'javascript:alert(1)' }), {});
  assert.deepEqual(sanitizeSunoParams({ mashWith: 'https://cdn.example/a.mp3' }), { mashWith: 'https://cdn.example/a.mp3' });
});

const ORDER: SunoOrder = {
  style: 'thai pop, female vocal',
  prompt: 'ร้องท่อนฮุกใหม่ให้เศร้าขึ้น',
  lyrics: 'เธอทําให้ฉันเเพ้',
  instrumental: false,
  audio: 'https://r2.example/aixman/uploads/1/audio/a.mp3',
  tier: 'V6',
  suno: { replaceFrom: 29.65, replaceTo: 40.5, fullLyrics: '[Chorus]\nเธอทําให้ฉันเเพ้' },
};

test('buildSunoTask replace: our file, the window, both texts mended', () => {
  const task = buildSunoTask('replace', ORDER);
  assert.equal(task.model, 'ai-music-api/replace-section');
  assert.equal(task.input.upload_url, ORDER.audio);
  assert.equal(task.input.model, 'V6');
  assert.equal(task.input.infill_start_s, 29.65);
  assert.equal(task.input.infill_end_s, 40.5);
  assert.equal(task.input.tags, 'thai pop, female vocal');
  assert.equal(task.input.lyrics, 'เธอทำให้ฉันแพ้');
  assert.equal(task.input.full_lyrics, '[Chorus]\nเธอทำให้ฉันแพ้');
  assert.equal(typeof task.input.title, 'string');
  assert.equal(typeof task.input.prompt, 'string');
  assert.equal('task_id' in task.input || 'audio_id' in task.input, false);
});

test('buildSunoTask mashup: both tracks, lyrics over the description', () => {
  const task = buildSunoTask('mashup', { ...ORDER, suno: { mashWith: 'https://r2.example/aixman/uploads/1/audio/b.mp3', length: 120 } });
  assert.equal(task.model, 'ai-music-api/mashup');
  assert.deepEqual(task.input.upload_url_list, [ORDER.audio, 'https://r2.example/aixman/uploads/1/audio/b.mp3']);
  assert.equal(task.input.lyrics, 'เธอทำให้ฉันแพ้');
  assert.equal(task.input.prompt, undefined);
  assert.equal(task.input.duration, 120);
  const described = buildSunoTask('mashup', { ...ORDER, lyrics: '', suno: { mashWith: 'https://r2.example/b.mp3' } });
  assert.equal(described.input.prompt, ORDER.prompt);
});
