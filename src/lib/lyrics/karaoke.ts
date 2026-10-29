/**
 * Karaoke timing — every sung word of a song with the moment it is sung, so a
 * player can light it as it plays and the MV cut can sweep it on screen.
 * Pure, so the studio, the MV cut and the tests share it.
 *
 * Built for Thai first:
 * - The words are the customer's own lyrics, never re-typed by a model. Each
 *   line is cut into words with the runtime's Thai dictionary
 *   (`Intl.Segmenter('th')`), so a word never splits a consonant from its
 *   vowel or tone mark — which is what turns into boxes and floating marks.
 * - Times come from aligning the letters of each line to the sung voice
 *   (align.ts: a Thai CTC speech model over the separated vocal, one time per
 *   letter). A word starts at its first letter; it stays lit until the next
 *   word, or while the voice still sounds (a held note), whichever is first.
 * - A line the voice was not found singing (a scream, a line sung twice but
 *   written once, words that differ from the lyrics) is not guessed from the
 *   aligner's squeeze: it is spread over the singing between the lines that
 *   were found, and marked `estimated` so the customer can move it.
 */

export const KARAOKE_VERSION = 1;

export interface KaraokeWord {
  /** As written, with the space or punctuation that follows it. */
  text: string;
  start: number;
  end: number;
}

export interface KaraokeLine {
  text: string;
  /** The section tag it sits under ('verse', 'chorus' …), '' when untagged. */
  section: string;
  start: number;
  end: number;
  words: KaraokeWord[];
  /** Placed by spreading, not found in the voice. */
  estimated: boolean;
}

export interface KaraokeTiming {
  version: typeof KARAOKE_VERSION;
  /** The song's length the timing was made on. */
  seconds: number;
  lines: KaraokeLine[];
}

/** A line of the lyrics as it will be sung and shown. */
export interface LyricLine {
  text: string;
  section: string;
}

export const KARAOKE_LIMITS = { lines: 200, line: 300 } as const;

// ---------------------------------------------------------------------------
// The lyrics → lines
// ---------------------------------------------------------------------------

const TAG = /^\s*[[(]\s*([^\])\n]{1,40}?)\s*[\])]\s*$/;
/** "x2", "×3", "(ซ้ำ)", "*", "**": repeat marks, not words. */
const REPEAT_MARK = /(?:\s*(?:[x×]\s*\d+|\(\s*ซ้ำ[^)]*\)|\*+))+\s*$/i;
const INSTRUMENTAL = /^(intro|outro|instrumental|inst|solo|guitar solo|break|interlude|drop|build ?up|end|ดนตรี|โซโล่)\b/i;

/**
 * The sung lines of `lyrics`: section tags become each line's `section`,
 * repeat marks and asides in brackets are dropped (backing echoes the lead
 * voice drowns), and an instrumental section has no lines.
 */
export function lyricLines(lyrics: string): LyricLine[] {
  return lyricRows(lyrics).map(({ text, section }) => ({ text, section }));
}

/** `lyricLines`, each with the index of the line of `lyrics` it came from (Replace Section rewrites those). */
export function lyricRows(lyrics: string): (LyricLine & { row: number })[] {
  const out: (LyricLine & { row: number })[] = [];
  let section = '';
  for (const [row, raw] of lyrics.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const tag = TAG.exec(raw);
    if (tag) {
      section = tag[1].trim().toLowerCase();
      continue;
    }
    if (INSTRUMENTAL.test(section)) continue;
    const text = raw
      .replace(REPEAT_MARK, '')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, KARAOKE_LIMITS.line);
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    out.push({ text, section, row });
    if (out.length >= KARAOKE_LIMITS.lines) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

let segmenter: Intl.Segmenter | null = null;
function words(): Intl.Segmenter {
  segmenter ??= new Intl.Segmenter('th', { granularity: 'word' });
  return segmenter;
}

let graphemes: Intl.Segmenter | null = null;
function clusters(): Intl.Segmenter {
  graphemes ??= new Intl.Segmenter('th', { granularity: 'grapheme' });
  return graphemes;
}

/** A word of a line: its letters span `from`–`to` (UTF-16 offsets); `text` also carries what follows it. */
export interface LineWord {
  text: string;
  from: number;
  to: number;
}

/**
 * The words of a line, in order. Spaces and punctuation ride on the word
 * before them (on the first word when the line opens with them), so the words
 * joined give back the line exactly.
 */
export function wordsOf(text: string): LineWord[] {
  const out: LineWord[] = [];
  let lead = '';
  for (const s of words().segment(text)) {
    if (s.isWordLike) {
      out.push({ text: lead + s.segment, from: s.index, to: s.index + s.segment.length });
      lead = '';
    } else if (out.length) {
      out[out.length - 1].text += s.segment;
    } else {
      lead += s.segment;
    }
  }
  if (lead && out.length) out[0].text = lead + out[0].text;
  return out;
}

/** Thai marks that sit on a letter and take no width of their own. */
const MARK = /[ัิ-ฺ็-๎]/u;

/** How wide a text reads: one per letter that takes space (a tone mark or upper vowel takes none). */
export function displayWidth(text: string): number {
  let n = 0;
  for (const g of clusters().segment(text)) {
    if (!/^\s+$/.test(g.segment)) n += 1;
    else n += 0.5;
  }
  return n;
}

/** Letters of a text that a reader counts (used to share time between words). */
function letters(text: string): number {
  let n = 0;
  for (const ch of text) if (/[\p{L}\p{N}]/u.test(ch) && !MARK.test(ch)) n += 1;
  return Math.max(1, n);
}

// ---------------------------------------------------------------------------
// What the aligner is asked
// ---------------------------------------------------------------------------

/**
 * A line as the aligner reads it: its words' letters with one space between
 * words (the model was trained on word-cut Thai), and for each code point the
 * UTF-16 offset in the line it came from (-1 for a space put in). Two common
 * typings are mended for the model only: "ํา" (nikhahit + sara aa, also with
 * the tone mark between them) is "ำ", "เเ" (sara e twice) is "แ".
 */
export function alignTarget(text: string): { align: string; map: number[] } {
  const cps: string[] = [];
  const map: number[] = [];
  for (const w of wordsOf(text)) {
    if (cps.length) {
      cps.push(' ');
      map.push(-1);
    }
    let offset = w.from;
    const chars = [...text.slice(w.from, w.to)];
    for (let k = 0; k < chars.length; k++) {
      const ch = chars[k];
      const next = chars[k + 1];
      // "ํ" + tone mark + "า" (น + ํ + ้ + า): the tone, then "ำ".
      if (ch === 'ํ' && /[่-๋]/.test(next ?? '') && chars[k + 2] === 'า') {
        cps.push(next, 'ำ');
        map.push(offset + ch.length, offset);
        offset += ch.length + next.length + 1;
        k += 2;
        continue;
      }
      if ((ch === 'ํ' && next === 'า') || (ch === 'เ' && next === 'เ')) {
        cps.push(ch === 'ํ' ? 'ำ' : 'แ');
        map.push(offset);
        offset += ch.length + next.length;
        k += 1;
        continue;
      }
      cps.push(ch);
      map.push(offset);
      offset += ch.length;
    }
  }
  return { align: cps.join(''), map };
}

// ---------------------------------------------------------------------------
// The aligner's answer → timing
// ---------------------------------------------------------------------------

/** One letter's time from the aligner: start, end (s), and how sure the model was (0–1). */
export type AlignedChar = [number, number, number] | null;

export interface AlignResult {
  /** Per line, per code point of its `alignTarget().align`. */
  chars: AlignedChar[][];
  /** Stretches where the separated voice sounds, in seconds. */
  voiced: [number, number][];
  seconds: number;
}

/** Below this the model did not hear the line sung. */
const MIN_SCORE = 0.15;
/** Above this many letters a second the aligner squeezed a line it could not find. */
const MAX_LETTERS_PER_SECOND = 16;
const MIN_WORD = 0.12;
/** Gaps up to this keep the word lit until the next one. */
const LEGATO = 0.35;
const HOLD_MAX = 3;

const r2 = (t: number) => Math.round(t * 100) / 100;

interface Found {
  start: number;
  last: number;
  score: number;
}

/** About how long a line takes to sing, from its letters. */
function naturalSeconds(text: string): number {
  return Math.min(8, Math.max(1.5, letters(text) * 0.3 + 0.8));
}

/** Where the voice still sounds after `t`, else a short tail. */
function holdUntil(t: number, voiced: [number, number][]): number {
  for (const [a, b] of voiced) {
    if (a <= t + 0.1 && b >= t) return Math.min(b, t + HOLD_MAX);
    if (a > t + 0.1) break;
  }
  return t + 0.2;
}

/** Spread `weights` over the voiced time inside [from, to] (all of it when too little sounds). */
function spreadOver(from: number, to: number, weights: number[], voiced: [number, number][]): [number, number][] {
  const span = Math.max(0, to - from);
  let parts = voiced
    .map(([a, b]): [number, number] => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b - a > 0.05);
  const sounding = parts.reduce((n, [a, b]) => n + b - a, 0);
  if (sounding < 0.4 * weights.length) parts = span > 0 ? [[from, to]] : [];
  const total = parts.reduce((n, [a, b]) => n + b - a, 0);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  // Position along the sounding time → a moment in the song.
  const at = (pos: number): number => {
    let left = pos;
    for (const [a, b] of parts) {
      if (left <= b - a) return a + left;
      left -= b - a;
    }
    return parts.length ? parts[parts.length - 1][1] : from;
  };
  const out: [number, number][] = [];
  let pos = 0;
  for (const w of weights) {
    const len = (w / sum) * total;
    out.push([at(pos), at(pos + len)]);
    pos += len;
  }
  return out;
}

/**
 * The timing of `lines` from the aligner's letters. Every line gets words and
 * times, in order, never overlapping; see the module note for the rules.
 */
export function buildTiming(lines: LyricLine[], result: AlignResult): KaraokeTiming {
  const seconds = Math.max(0, result.seconds);
  const voiced = [...result.voiced].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);

  // Per line: its words, each with the letters the voice was found singing.
  const rows = lines.map((line, i) => {
    const { map } = alignTarget(line.text);
    const chars = result.chars[i] ?? [];
    const byOffset = new Map<number, [number, number, number]>();
    map.forEach((offset, k) => {
      const c = chars[k];
      if (offset >= 0 && c && Number.isFinite(c[0]) && Number.isFinite(c[1])) byOffset.set(offset, c);
    });
    const ws = wordsOf(line.text);
    const found: (Found | null)[] = ws.map((w) => {
      let start = Infinity;
      let last = -Infinity;
      let score = 0;
      let n = 0;
      for (const [offset, c] of byOffset) {
        if (offset < w.from || offset >= w.to) continue;
        start = Math.min(start, c[0]);
        last = Math.max(last, c[1]);
        score += c[2];
        n += 1;
      }
      return n ? { start, last, score: score / n } : null;
    });
    const hits = found.filter((f): f is Found => f !== null);
    const alignable = map.filter((o) => o >= 0).length || 1;
    const meanScore = hits.length ? hits.reduce((a, f) => a + f.score, 0) / hits.length : 0;
    const span = hits.length ? hits[hits.length - 1].last - hits[0].start : 0;
    const rate = span > 0 ? letters(line.text) / span : Infinity;
    // Found, but the model was unsure (a scream, a slurred line): its times
    // are usually right, so they are kept and the line is flagged. Squeezed
    // or mostly missing: the times are the aligner's, not the singer's.
    const reliable = hits.length > 0 && byOffset.size / alignable >= 0.5 && rate <= MAX_LETTERS_PER_SECOND;
    const sure = reliable && meanScore >= MIN_SCORE;
    return { line, ws, found, reliable, sure };
  });

  // Words of reliable lines: found ones as found, the rest shared out between their neighbours.
  const starts: (number[] | null)[] = rows.map((row) => {
    if (!row.reliable) return null;
    const s = row.found.map((f) => (f ? f.start : NaN));
    for (let k = 0; k < s.length; k++) {
      if (!Number.isNaN(s[k])) continue;
      let j = k;
      while (j < s.length && Number.isNaN(s[j])) j++;
      const before = k > 0 ? (row.found[k - 1]?.last ?? s[k - 1]) : s[j] ?? 0;
      const after = j < s.length ? s[j] : (row.found[k - 1]?.last ?? before) + 0.3 * (j - k);
      const weights = row.ws.slice(k, j).map((w) => letters(w.text));
      const sum = weights.reduce((a, b) => a + b, 0);
      let acc = 0;
      for (let m = k; m < j; m++) {
        s[m] = before + ((after - before) * acc) / sum;
        acc += weights[m - k];
      }
      k = j - 1;
    }
    // Monotonic within the line.
    for (let k = 1; k < s.length; k++) s[k] = Math.max(s[k], s[k - 1]);
    return s;
  });

  // Lines the voice was not found singing: spread over the singing between their found neighbours.
  for (let i = 0; i < rows.length; i++) {
    if (starts[i]) continue;
    let j = i;
    while (j < rows.length && !starts[j]) j++;
    const prev = i > 0 ? rows[i - 1] : null;
    const prevStarts = i > 0 ? starts[i - 1] : null;
    const from = prev && prevStarts ? holdUntil(Math.max(...prev.found.map((f) => f?.last ?? 0), prevStarts[prevStarts.length - 1]), voiced) + 0.1 : 0;
    const to = j < rows.length ? (starts[j]![0] ?? seconds) - 0.1 : seconds;
    const slots = spreadOver(from, Math.max(from, to), rows.slice(i, j).map((r) => letters(r.line.text)), voiced);
    for (let m = i; m < j; m++) {
      const [a, slot] = slots[m - i] ?? [from, from];
      // No longer than the line takes to sing: a short line alone in a long gap is not swept for half a minute.
      const b = Math.min(slot, a + naturalSeconds(rows[m].line.text));
      const weights = rows[m].ws.map((w) => letters(w.text));
      const sum = weights.reduce((x, y) => x + y, 0) || 1;
      let acc = 0;
      starts[m] = weights.map((w) => {
        const t = a + ((b - a) * acc) / sum;
        acc += w;
        return t;
      });
      // A spread line's last word ends where its slot ends.
      rows[m].found = rows[m].ws.map(() => null);
      (rows[m] as { slotEnd?: number }).slotEnd = b;
    }
    i = j - 1;
  }

  // Ends, then the lines.
  const out: KaraokeLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const s = starts[i]!;
    const nextLineStart = i + 1 < rows.length ? starts[i + 1]![0] : seconds;
    const slotEnd = (row as { slotEnd?: number }).slotEnd;
    const ws: KaraokeWord[] = row.ws.map((w, k) => {
      const start = s[k];
      const next = k + 1 < s.length ? s[k + 1] : nextLineStart;
      let end: number;
      if (!row.reliable) {
        end = k + 1 < s.length ? next : Math.max(start + MIN_WORD, slotEnd ?? start + 0.5);
      } else {
        const last = Math.max(row.found[k]?.last ?? start, start);
        end = next - last <= LEGATO ? next : Math.min(next - 0.05, holdUntil(last, voiced));
      }
      end = Math.max(end, start + MIN_WORD);
      if (k + 1 < s.length) end = Math.min(end, Math.max(next, start + MIN_WORD));
      else end = Math.min(end, Math.max(nextLineStart - 0.05, start + MIN_WORD));
      return { text: w.text, start: r2(start), end: r2(end) };
    });
    if (ws.length === 0) continue;
    out.push({
      text: row.line.text,
      section: row.line.section,
      start: ws[0].start,
      end: ws[ws.length - 1].end,
      words: ws,
      estimated: !row.sure,
    });
  }
  return { version: KARAOKE_VERSION, seconds: r2(seconds), lines: out };
}

// ---------------------------------------------------------------------------
// The customer's corrections
// ---------------------------------------------------------------------------

/** Everything moved by `offset` seconds (the whole song early or late). */
export function shiftTiming(timing: KaraokeTiming, offset: number): KaraokeTiming {
  if (!offset) return timing;
  const at = (t: number) => r2(Math.max(0, t + offset));
  return {
    ...timing,
    lines: timing.lines.map((l) => ({ ...l, start: at(l.start), end: at(l.end), words: l.words.map((w) => ({ ...w, start: at(w.start), end: at(w.end) })) })),
  };
}

/**
 * One line moved to start at `start`, its words kept in step. It may not pass
 * its neighbours: it is held between the end of the line before and the start
 * of the line after.
 */
export function moveLine(timing: KaraokeTiming, index: number, start: number): KaraokeTiming {
  const line = timing.lines[index];
  if (!line) return timing;
  const before = index > 0 ? timing.lines[index - 1].start + 0.1 : 0;
  const length = line.end - line.start;
  const after = index + 1 < timing.lines.length ? timing.lines[index + 1].start : Math.max(timing.seconds, line.end);
  const target = Math.min(Math.max(start, before), Math.max(before, after - Math.min(length, after - before)));
  const delta = target - line.start;
  const lines = [...timing.lines];
  lines[index] = {
    ...line,
    start: r2(line.start + delta),
    end: r2(Math.min(line.end + delta, after)),
    words: line.words.map((w) => ({ ...w, start: r2(w.start + delta), end: r2(Math.min(w.end + delta, after)) })),
    estimated: false,
  };
  // The line before is sung faster, to end where this one starts.
  if (index > 0 && lines[index - 1].end > lines[index].start) {
    const prev = lines[index - 1];
    const cap = lines[index].start;
    const f = (cap - prev.start) / Math.max(0.01, prev.end - prev.start);
    const at = (t: number) => r2(prev.start + (t - prev.start) * f);
    lines[index - 1] = { ...prev, end: r2(cap), words: prev.words.map((w) => ({ ...w, start: at(w.start), end: at(w.end) })) };
  }
  return { ...timing, lines };
}

// ---------------------------------------------------------------------------
// Reading a stored timing back
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 36000 ? v : null);

/** A stored or sent timing, every field checked; null when it is not one. */
export function parseTiming(raw: unknown): KaraokeTiming | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== KARAOKE_VERSION || !Array.isArray(r.lines)) return null;
  const seconds = num(r.seconds);
  if (seconds === null) return null;
  const lines: KaraokeLine[] = [];
  for (const l of r.lines.slice(0, KARAOKE_LIMITS.lines)) {
    if (!l || typeof l !== 'object') return null;
    const o = l as Record<string, unknown>;
    if (typeof o.text !== 'string' || !Array.isArray(o.words)) return null;
    const ws: KaraokeWord[] = [];
    for (const w of o.words.slice(0, 200)) {
      const x = (w ?? {}) as Record<string, unknown>;
      const start = num(x.start);
      const end = num(x.end);
      if (typeof x.text !== 'string' || start === null || end === null || end < start) return null;
      ws.push({ text: x.text.slice(0, KARAOKE_LIMITS.line), start, end });
    }
    if (ws.length === 0) continue;
    lines.push({
      text: o.text.slice(0, KARAOKE_LIMITS.line),
      section: typeof o.section === 'string' ? o.section.slice(0, 40) : '',
      start: ws[0].start,
      end: ws[ws.length - 1].end,
      words: ws,
      estimated: o.estimated === true,
    });
  }
  return { version: KARAOKE_VERSION, seconds, lines };
}

/** The line being sung at `t`, else the last one that started (−1 before the first). */
export function lineAt(timing: KaraokeTiming, t: number): number {
  let found = -1;
  for (let i = 0; i < timing.lines.length; i++) {
    if (timing.lines[i].start <= t) found = i;
    else break;
  }
  return found;
}

/** How much of `word` has been sung at `t`, 0–1. */
export function wordProgress(word: KaraokeWord, t: number): number {
  if (t <= word.start) return 0;
  if (t >= word.end) return 1;
  return (t - word.start) / Math.max(0.01, word.end - word.start);
}
