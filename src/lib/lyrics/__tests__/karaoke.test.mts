/**
 * Karaoke timing (karaoke.ts) and the karaoke subtitle file (karaoke-ass.ts).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/lyrics/__tests__/karaoke.test.mts)
 *
 * What must hold: a Thai word is never cut between a consonant and its vowel
 * or tone mark; the words joined give back the line; lines never overlap and
 * stay in order; a line the voice was not found singing is spread, not
 * squeezed, and is flagged; a customer's words never become ASS markup; the
 * swept word times add up to the word's own time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  alignTarget,
  buildTiming,
  displayWidth,
  lineAt,
  lyricLines,
  moveLine,
  parseTiming,
  shiftTiming,
  wordProgress,
  wordsOf,
  type AlignResult,
  type AlignedChar,
  type KaraokeTiming,
} from '@/lib/lyrics/karaoke';
import { buildKaraokeAss, fitLines, karaokeTags } from '@/lib/lyrics/karaoke-ass';
import { DEFAULT_KARAOKE_LOOK, parseKaraokeLook } from '@/lib/lyrics/karaoke-look';
import { defaultEdit, parseEdit } from '@/lib/story/edit';

test('lyricLines: tags become sections, repeat marks and asides go, instrumentals have no lines', () => {
  const lines = lyricLines('[Verse 1]\nฉันรักเธอ x2\nคืนนี้ (ซ้ำ)\n(ฮู้ว)\n[Guitar Solo]\nไม่ควรมี\n[Chorus]\nเธอคือ (โอ้) ดวงใจ\n\n');
  assert.deepEqual(lines, [
    { text: 'ฉันรักเธอ', section: 'verse 1' },
    { text: 'คืนนี้', section: 'verse 1' },
    { text: 'เธอคือ ดวงใจ', section: 'chorus' },
  ]);
});

test('wordsOf: Thai words keep their marks, and the words give back the line', () => {
  for (const line of ['ที่รักจ๋า อย่าทิ้งฉันไป', 'น้ำตาไหล...ใจสลาย!', '  เริ่มด้วยช่องว่าง', 'ร้อง la la la ไป']) {
    const ws = wordsOf(line);
    assert.equal(ws.map((w) => w.text).join(''), line);
    for (const w of ws) {
      // A word never starts with a mark that belongs on the letter before it.
      assert.doesNotMatch(w.text.trimStart(), /^[ัิ-ฺ็-๎]/u, `"${w.text}" starts with a mark`);
    }
  }
});

test('displayWidth: tone marks and upper vowels take no width', () => {
  assert.equal(displayWidth('ก่'), displayWidth('ก'));
  assert.equal(displayWidth('ที่'), 1);
  assert.equal(displayWidth('ไม่ ใช่'), 4.5);
});

test('alignTarget: words spaced, mistypings mended for the model only, offsets point back', () => {
  const line = 'นํ้าเเข็ง ละลาย';
  const { align, map } = alignTarget(line);
  assert.equal(align.includes('ำ'), true);
  assert.equal(align.includes('เเ'), false);
  assert.equal(align.includes(' '), true);
  assert.equal([...align].length, map.length);
  for (const [k, offset] of map.entries()) {
    if (offset < 0) assert.equal([...align][k], ' ');
    else assert.ok(offset < line.length);
  }
});

/** An aligner answer where line `i`'s letters are sung evenly from `at[i]` for `len[i]` seconds (null = not found). */
function fakeAlign(texts: string[], spans: ([number, number] | null)[], seconds = 60, score = 0.6): AlignResult {
  return {
    seconds,
    voiced: spans.filter((s): s is [number, number] => s !== null).map(([a, b]) => [a, b + 0.3] as [number, number]),
    chars: texts.map((text, i) => {
      const cps = [...alignTarget(text).align];
      const span = spans[i];
      if (!span) return cps.map((): AlignedChar => null);
      const step = (span[1] - span[0]) / cps.length;
      return cps.map((ch, k): AlignedChar => (ch === ' ' ? null : [span[0] + k * step, span[0] + (k + 1) * step, score]));
    }),
  };
}

function checkTiming(t: KaraokeTiming, texts: string[]) {
  assert.equal(t.lines.length, texts.length);
  for (const [i, line] of t.lines.entries()) {
    assert.equal(line.words.map((w) => w.text).join(''), texts[i]);
    assert.equal(line.start, line.words[0].start);
    for (const [k, w] of line.words.entries()) {
      assert.ok(w.end > w.start, `word ${i}/${k} has no time`);
      if (k > 0) assert.ok(w.start >= line.words[k - 1].start, `word ${i}/${k} out of order`);
    }
    if (i > 0) assert.ok(line.start >= t.lines[i - 1].end - 1e-9, `line ${i} overlaps the one before`);
  }
}

test('buildTiming: found lines keep their times; words start where their letters do', () => {
  const texts = ['ฉันรักเธอ หมดหัวใจ', 'คืนนี้ไม่มีวันจบ'];
  const t = buildTiming(
    texts.map((text) => ({ text, section: '' })),
    fakeAlign(texts, [
      [10, 13],
      [15, 18],
    ])
  );
  checkTiming(t, texts);
  assert.ok(Math.abs(t.lines[0].start - 10) < 0.05);
  assert.ok(Math.abs(t.lines[1].start - 15) < 0.05);
  assert.equal(t.lines[0].estimated, false);
});

test('buildTiming: a line not found is spread between its neighbours, flagged, and not stretched over a long gap', () => {
  const texts = ['ท่อนแรกร้องชัด', 'ท่อนนี้ตะโกนไม่ออก', 'ท่อนสุดท้าย'];
  const t = buildTiming(
    texts.map((text) => ({ text, section: '' })),
    fakeAlign(texts, [[5, 8], null, [40, 43]])
  );
  checkTiming(t, texts);
  const lost = t.lines[1];
  assert.equal(lost.estimated, true);
  assert.ok(lost.start > 8 && lost.end < 40);
  assert.ok(lost.end - lost.start <= 8, 'a short line is not swept for half a minute');
});

test('buildTiming: a line squeezed into an impossible time is treated as not found', () => {
  const texts = ['ฉันรักเธอ', 'บรรทัดยาวมากที่ร้องไม่ทันในเวลาเสี้ยววินาทีเดียว', 'ท้ายเพลง'];
  const t = buildTiming(
    texts.map((text) => ({ text, section: '' })),
    fakeAlign(texts, [[2, 4], [10, 10.3], [20, 22]])
  );
  checkTiming(t, texts);
  assert.equal(t.lines[1].estimated, true);
});

test('buildTiming: an unsure but found line keeps its times and is flagged', () => {
  const texts = ['ร้องเบาๆ'];
  const t = buildTiming([{ text: texts[0], section: '' }], fakeAlign(texts, [[3, 5]], 30, 0.05));
  checkTiming(t, texts);
  assert.ok(Math.abs(t.lines[0].start - 3) < 0.05);
  assert.equal(t.lines[0].estimated, true);
});

test('shiftTiming, moveLine: corrections keep the order', () => {
  const texts = ['หนึ่งสองสาม', 'สี่ห้าหก', 'เจ็ดแปดเก้า'];
  const t = buildTiming(
    texts.map((text) => ({ text, section: '' })),
    fakeAlign(texts, [
      [2, 4],
      [6, 8],
      [10, 12],
    ])
  );
  const late = shiftTiming(t, 0.5);
  assert.ok(Math.abs(late.lines[0].start - t.lines[0].start - 0.5) < 0.011);
  const early = shiftTiming(t, -5);
  assert.equal(early.lines[0].start, 0);
  // Moved past the line after: held before it.
  const moved = moveLine(t, 1, 30);
  checkTiming(moved, texts);
  assert.ok(moved.lines[1].start < moved.lines[2].start);
  // Moved onto the line before: that one stops in time.
  const back = moveLine(t, 1, 3);
  checkTiming(back, texts);
  assert.equal(back.lines[1].estimated, false);
  assert.equal(back.lines[0].end, back.lines[1].start);
});

test('parseTiming: refuses anything that is not a timing', () => {
  const t = buildTiming([{ text: 'ทดสอบ', section: '' }], fakeAlign(['ทดสอบ'], [[1, 2]]));
  assert.deepEqual(parseTiming(JSON.parse(JSON.stringify(t))), t);
  assert.equal(parseTiming(null), null);
  assert.equal(parseTiming({ ...t, version: 99 }), null);
  assert.equal(parseTiming({ ...t, lines: [{ text: 'x', words: [{ text: 'x', start: 2, end: 1 }] }] }), null);
  assert.equal(parseTiming({ ...t, lines: [{ text: 'x', words: [{ text: 'x', start: -1, end: 1 }] }] }), null);
});

test('lineAt, wordProgress', () => {
  const t = buildTiming(
    ['หนึ่ง', 'สอง'].map((text) => ({ text, section: '' })),
    fakeAlign(['หนึ่ง', 'สอง'], [
      [2, 3],
      [5, 6],
    ])
  );
  assert.equal(lineAt(t, 1), -1);
  assert.equal(lineAt(t, 2.5), 0);
  assert.equal(lineAt(t, 5.5), 1);
  const w = { text: 'x', start: 1, end: 2 };
  assert.equal(wordProgress(w, 0.5), 0);
  assert.equal(wordProgress(w, 1.5), 0.5);
  assert.equal(wordProgress(w, 3), 1);
});

// ---------------------------------------------------------------------------
// ASS
// ---------------------------------------------------------------------------

test('karaokeTags: each word sweeps for its own time, gaps wait, from the event start', () => {
  const line = {
    text: 'ฉัน รัก',
    section: '',
    start: 1,
    end: 2.5,
    estimated: false,
    words: [
      { text: 'ฉัน ', start: 1, end: 1.4 },
      { text: 'รัก', start: 1.6, end: 2.5 },
    ],
  };
  assert.equal(karaokeTags(line, 0.5, '\\kf'), '{\\k50}{\\kf40}ฉัน {\\k20}{\\kf90}รัก');
  // The tags' durations add up to the line's end, counted from the event start.
  const total = [...karaokeTags(line, 0.5, '\\kf').matchAll(/\\kf?(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(total, 200);
});

test('karaokeTags: a customer’s braces and backslashes stay text', () => {
  const line = { text: '{\\pos(0,0)}', section: '', start: 0, end: 1, estimated: false, words: [{ text: '{\\pos(0,0)}', start: 0, end: 1 }] };
  const tags = karaokeTags(line, 0, '\\kf');
  assert.equal(tags.startsWith('{\\kf100}'), true);
  assert.equal(tags.slice('{\\kf100}'.length).includes('{'), false);
  assert.equal(tags.slice('{\\kf100}'.length).includes('\\'), false);
});

test('fitLines: a long line is cut where words end, keeping each piece’s times', () => {
  const text = 'คืนนี้ฉันจะร้องเพลงนี้ให้เธอฟังจนกว่าฟ้าจะสว่าง';
  const ws = wordsOf(text);
  const line = {
    text,
    section: '',
    start: 0,
    end: ws.length,
    estimated: false,
    words: ws.map((w, k) => ({ text: w.text, start: k, end: k + 1 })),
  };
  const pieces = fitLines([line], 14);
  assert.ok(pieces.length >= 2);
  assert.equal(pieces.map((p) => p.words.map((w) => w.text).join('')).join(''), text);
  for (const p of pieces) {
    assert.equal(p.start, p.words[0].start);
    assert.equal(p.end, p.words[p.words.length - 1].end);
  }
});

test('buildKaraokeAss: two rows that take turns, never two lines on one row at once', () => {
  const texts = ['หนึ่ง สอง สาม', 'สี่ ห้า หก', 'เจ็ด แปด', 'เก้า สิบ'];
  const timing = buildTiming(
    texts.map((text) => ({ text, section: '' })),
    fakeAlign(texts, [
      [10, 12],
      [12.5, 14],
      [14.5, 16],
      [30, 32],
    ])
  );
  const ass = buildKaraokeAss({ width: 1344, height: 768, timing, look: DEFAULT_KARAOKE_LOOK, font: 'Sarabun', title: 'เพลง {ทดสอบ}' });
  assert.match(ass, /PlayResX: 1344/);
  assert.match(ass, /Style: Kara,Sarabun,/);
  assert.equal(ass.includes('{ทดสอบ}'), false);
  const time = (s: string) => {
    const [h, m, rest] = s.split(':');
    return Number(h) * 3600 + Number(m) * 60 + Number(rest);
  };
  const rows = new Map<string, [number, number][]>();
  for (const m of ass.matchAll(/^Dialogue: 2,([^,]+),([^,]+),Kara,.*?\\pos\((\d+),(\d+)\)/gm)) {
    const list = rows.get(m[4]) ?? [];
    list.push([time(m[1]), time(m[2])]);
    rows.set(m[4], list);
  }
  assert.equal(rows.size, 2);
  for (const spans of rows.values()) {
    for (let k = 1; k < spans.length; k++) assert.ok(spans[k][0] >= spans[k - 1][1], 'two lines on one row at once');
  }
  // The long gap before the last line gets a countdown.
  assert.match(ass, /Count,.*●  ●  ●/);
  // Every line is on screen before it is sung.
  const shown = [...ass.matchAll(/^Dialogue: 2,([^,]+),[^,]+,Kara,/gm)].map((m) => time(m[1]));
  timing.lines.forEach((l, i) => assert.ok(shown[i] <= l.start - 0.2));
});

test('karaoke look and the MV edit: parsed field by field, karaoke off by default and only for an MV', () => {
  assert.deepEqual(parseKaraokeLook({ theme: 'toString', position: 'top', nextLine: false }), { ...DEFAULT_KARAOKE_LOOK, position: 'top', nextLine: false });
  assert.equal(defaultEdit('mv').karaoke, false);
  assert.equal(parseEdit({ karaoke: true }, 'mv').karaoke, true);
  assert.equal(parseEdit({ karaoke: true }, 'film').karaoke, false);
  assert.equal(parseEdit({ karaokeAudio: 'drums' }, 'mv').karaokeAudio, 'song');
  assert.equal(parseEdit({ karaokeAudio: 'instrumental' }, 'mv').karaokeAudio, 'instrumental');
});
