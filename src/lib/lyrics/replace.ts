/**
 * Replace Section, picked by the words: the customer chooses lines of their
 * song's karaoke timing (karaoke.ts) and the part sung anew is cut where those
 * lines are actually sung — not where a slider guessed. Pure: the studio and
 * the tests share it.
 *
 * - The edges sit in the breath between lines: a little before the first
 *   word, a little after the last, never into the line next to it.
 * - Shorter than the 10 s the model needs, the pick takes in the next line
 *   (or the one before) whole, until it is long enough; the customer sees the
 *   lines it took, so a half-replaced line never happens.
 * - The whole song's words after the change (`full_lyrics`) are the original
 *   lyrics with exactly those lines swapped for the new ones; every other
 *   line and tag is kept as the customer wrote it.
 */
import type { Msg } from '@/lib/i18n/locale';
import { SUNO_REPLACE_MAX_SHARE, SUNO_REPLACE_MIN_SECONDS } from '@/lib/providers/kie-suno';
import { lyricRows, type KaraokeTiming } from './karaoke';

/** Room left before the first word and after the last. */
const LEAD_IN = 0.35;
const TAIL_OUT = 0.5;

/** Whether `timing` was made from these `lyrics` (its lines are their sung lines, in order). */
export function timingFits(timing: KaraokeTiming, lyrics: string): boolean {
  const rows = lyricRows(lyrics);
  return rows.length === timing.lines.length && rows.every((r, i) => r.text === timing.lines[i].text);
}

export type ReplaceSpan =
  | { ok: true; first: number; last: number; from: number; to: number; grew: boolean }
  | { ok: false; message: Msg };

const two = (t: number) => Math.round(t * 100) / 100;

/**
 * The part to sing anew for lines `first`–`last` of `timing`, in a track of
 * `seconds`: its edges, and the lines it covers (more than asked when it had
 * to grow to 10 s).
 */
export function replaceSpan(timing: KaraokeTiming, first: number, last: number, seconds: number): ReplaceSpan {
  const lines = timing.lines;
  if (lines.length === 0 || !(seconds > 0)) return { ok: false, message: { th: 'ยังไม่มีจังหวะเนื้อร้อง', en: 'The lyrics are not timed yet.' } };
  let a = Math.max(0, Math.min(first, last));
  let b = Math.min(lines.length - 1, Math.max(first, last));
  const edges = (i: number, j: number) => {
    const before = i > 0 ? lines[i - 1].end : 0;
    const after = j + 1 < lines.length ? lines[j + 1].start : seconds;
    const from = Math.max(before + (i > 0 ? 0.05 : 0), lines[i].start - LEAD_IN, 0);
    const to = Math.min(after - (j + 1 < lines.length ? 0.05 : 0), lines[j].end + TAIL_OUT, seconds);
    // Into the breath on each side, as far as the minimum needs and the neighbours allow.
    const short = SUNO_REPLACE_MIN_SECONDS - (to - from);
    if (short <= 0) return { from, to };
    const roomBefore = Math.max(0, from - (i > 0 ? before + 0.05 : 0));
    const roomAfter = Math.max(0, (j + 1 < lines.length ? after - 0.05 : seconds) - to);
    const takeBefore = Math.min(roomBefore, Math.max(short / 2, short - roomAfter));
    const takeAfter = Math.min(roomAfter, short - takeBefore);
    return { from: from - takeBefore, to: to + takeAfter };
  };
  let span = edges(a, b);
  let grew = false;
  while (span.to - span.from < SUNO_REPLACE_MIN_SECONDS - 0.005) {
    // Take in the nearer whole line: after first, the one before at the song's end.
    if (b + 1 < lines.length && (a === 0 || lines[b + 1].start - lines[b].end <= lines[a].start - lines[a - 1].end)) b += 1;
    else if (a > 0) a -= 1;
    else break;
    grew = true;
    span = edges(a, b);
  }
  const from = two(span.from);
  const to = two(span.to);
  if (to - from < SUNO_REPLACE_MIN_SECONDS - 0.005) {
    return { ok: false, message: { th: `เพลงนี้สั้นเกินกว่าจะร้องใหม่ ${SUNO_REPLACE_MIN_SECONDS} วินาที`, en: `This song is too short to sing ${SUNO_REPLACE_MIN_SECONDS} seconds of it anew.` } };
  }
  if (to - from > seconds * SUNO_REPLACE_MAX_SHARE + 0.005) {
    return {
      ok: false,
      message: { th: 'ท่อนที่เลือกยาวเกินครึ่งเพลง — เลือกให้น้อยลง', en: 'The lines picked run longer than half the song — pick fewer.' },
    };
  }
  return { ok: true, first: a, last: b, from, to, grew };
}

/** The words of lines `first`–`last` as written (what the new-words box starts from). */
export function spanText(lyrics: string, first: number, last: number): string {
  const raw = lyrics.replace(/\r\n?/g, '\n').split('\n');
  const rows = lyricRows(lyrics);
  if (!rows[first] || !rows[last]) return '';
  return raw.slice(rows[first].row, rows[last].row + 1).filter((l) => l.trim() !== '').join('\n');
}

/**
 * The whole song's lyrics with lines `first`–`last` (sung lines, as counted
 * by `lyricRows`) replaced by `words`. Whatever sits between those lines in
 * the source (a blank line, a tag the pick crosses) goes with them; every
 * other line stays as the customer wrote it.
 */
export function replacedLyrics(lyrics: string, first: number, last: number, words: string): string {
  const raw = lyrics.replace(/\r\n?/g, '\n').split('\n');
  const rows = lyricRows(lyrics);
  if (!rows[first] || !rows[last]) return lyrics;
  const fresh = words.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  return [...raw.slice(0, rows[first].row), ...fresh, ...raw.slice(rows[last].row + 1)].join('\n');
}
