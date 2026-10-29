/**
 * The karaoke subtitle file for a video (the MV cut burns it in with libass):
 * pure, so the cut and the tests share it.
 *
 * - Two rows that take turns, so the next line is on screen before it is sung.
 * - Each word fills in its own time (`\kf`, a sweep across the word), and a
 *   soft glow lights behind the words already sung (`\ko` on a blurred layer).
 * - A countdown (● ● ●) before a line that follows a long instrumental.
 * - Thai renders whole: Sarabun Bold through libass's HarfBuzz shaping, and a
 *   line too wide for the frame is cut only where a word ends — never inside
 *   a word, so a vowel or tone mark never leaves its consonant.
 */
import { assEscape, assTime } from '@/lib/story/edit';
import { displayWidth, type KaraokeLine, type KaraokeTiming, type KaraokeWord } from './karaoke';
import { KARAOKE_THEMES, type KaraokeLook } from './karaoke-look';

/** '#RRGGBB' → ASS '&H00BBGGRR'. */
function assColour(hex: string, alpha = 0): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase();
}

/** Seconds a line shows before it is sung (when the row is free that early). */
const LEAD = 2.5;
const TAIL = 0.45;
/** A gap this long before a line earns a countdown. */
const COUNTDOWN_GAP = 5;

/**
 * Lines too wide for a row, cut where words end into pieces of about equal
 * width; each piece keeps its own words' times.
 */
export function fitLines(lines: KaraokeLine[], maxWidth: number): KaraokeLine[] {
  const out: KaraokeLine[] = [];
  for (const line of lines) {
    const width = displayWidth(line.text);
    if (width <= maxWidth || line.words.length < 2) {
      out.push(line);
      continue;
    }
    const pieces = Math.ceil(width / maxWidth);
    const target = width / pieces;
    let current: KaraokeWord[] = [];
    let w = 0;
    const flush = () => {
      if (!current.length) return;
      const text = current.map((x) => x.text).join('');
      out.push({ ...line, text: text.trimEnd(), start: current[0].start, end: current[current.length - 1].end, words: current });
      current = [];
      w = 0;
    };
    for (const word of line.words) {
      const ww = displayWidth(word.text);
      if (current.length && w + ww > target * 1.15 && w >= target * 0.5) flush();
      current.push(word);
      w += ww;
    }
    flush();
  }
  return out;
}

const cs = (seconds: number) => Math.max(0, Math.round(seconds * 100));

/** The `\k` run of one line, from the moment its event starts. */
export function karaokeTags(line: KaraokeLine, eventStart: number, tag: '\\kf' | '\\ko'): string {
  let at = cs(eventStart);
  let text = '';
  for (const [k, word] of line.words.entries()) {
    const start = cs(word.start);
    if (start > at) text += `{\\k${start - at}}`;
    const end = Math.max(cs(word.end), Math.max(start, at) + 1);
    const body = assEscape(k === line.words.length - 1 ? word.text.trimEnd() : word.text);
    text += `{${tag}${end - Math.max(start, at)}}${body}`;
    at = end;
  }
  return text;
}

export function buildKaraokeAss(opts: {
  width: number;
  height: number;
  timing: KaraokeTiming;
  look: KaraokeLook;
  font: string;
  title?: string;
  titleSeconds?: number;
}): string {
  const { width: W, height: H, look } = opts;
  const theme = KARAOKE_THEMES[look.theme];
  const size = Math.round(Math.min(W, H) * 0.075);
  const bord = Math.max(2, Math.round(size / 12));
  const rowGap = Math.round(size * 1.5);
  const edge = Math.round(H * 0.07);
  // Rows: [upper y, lower y], each the bottom of its text (\an2).
  const lower = look.position === 'top' ? edge + size + rowGap : look.position === 'middle' ? Math.round(H / 2 + rowGap / 2) : H - edge;
  const rows = look.nextLine ? [lower - rowGap, lower] : [lower];
  const x = Math.round(W / 2);
  // Sarabun's letters average a little over half the font size across.
  const maxWidth = Math.max(8, Math.floor((W * 0.88) / (size * 0.56)));

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // A soft dark halo behind the words, so they read over a bright frame.
    `Style: Shade,${opts.font},${size},&HA0000000,&HA0000000,&HA0000000,&HFF000000,-1,0,0,0,100,100,0,0,1,${bord * 4},0,2,20,20,0,222`,
    // Sung = Primary, waiting = Secondary (how \k works).
    `Style: Kara,${opts.font},${size},${assColour(theme.sung)},${assColour(theme.unsung)},${assColour(theme.outline)},&H96000000,-1,0,0,0,100,100,0,0,1,${bord},2,2,20,20,0,222`,
    `Style: Glow,${opts.font},${size},&HFF000000,&HFF000000,${assColour(theme.glow, 0x40)},&HFF000000,-1,0,0,0,100,100,0,0,1,${bord * 3},0,2,20,20,0,222`,
    `Style: Count,${opts.font},${Math.round(size * 0.7)},${assColour(theme.sung)},${assColour(theme.sung)},${assColour(theme.outline)},&H96000000,-1,0,0,0,100,100,0,0,1,${bord},1,2,20,20,0,222`,
    `Style: Title,${opts.font},${Math.round(size * 1.8)},&H00FFFFFF,&H00FFFFFF,${assColour(theme.outline)},&H80000000,-1,0,0,0,100,100,0,0,1,${bord * 2},2,5,60,60,0,222`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events: string[] = [];
  if (opts.title?.trim()) {
    const t = assEscape(opts.title.trim());
    events.push(`Dialogue: 4,${assTime(0.2)},${assTime(opts.titleSeconds ?? 3)},Title,,0,0,0,,{\\fad(400,500)}${t}`);
  }

  const lines = fitLines(opts.timing.lines, maxWidth);
  // When each row is free again.
  const rowFree = rows.map(() => 0);
  const shown: { start: number; end: number; row: number }[] = [];
  for (const [i, line] of lines.entries()) {
    const row = i % rows.length;
    const prev = lines[i - 1];
    // Not before the row's last line has gone, nor (with two rows) before the line before this one starts.
    let start = Math.max(line.start - LEAD, rowFree[row] + 0.05, rows.length > 1 && prev ? prev.start : 0);
    if (rows.length === 1 && prev) start = Math.max(start, prev.end + 0.05);
    start = Math.max(0, Math.min(start, line.start - 0.25));
    shown.push({ start, end: line.end + TAIL, row });
    rowFree[row] = line.end + TAIL;
  }
  // A line leaves its row before the row's next line arrives.
  for (let i = 0; i < shown.length; i++) {
    const next = shown.slice(i + 1).find((s) => s.row === shown[i].row);
    if (next) shown[i].end = Math.min(shown[i].end, next.start - 0.02);
  }

  for (const [i, line] of lines.entries()) {
    const { start, end, row } = shown[i];
    if (end <= start) continue;
    const pos = `\\an2\\pos(${x},${rows[row]})`;
    const fade = `\\fad(180,220)`;
    // Waiting its turn, a line sits a little smaller and dimmer; it grows to full as its first word comes.
    const sing = Math.max(0, Math.round((line.start - start) * 1000));
    const from = Math.max(0, sing - 220);
    const grow = `\\fscx90\\fscy90\\t(${from},${sing},\\fscx100\\fscy100)`;
    const plain = assEscape(line.words.map((w) => w.text).join('').trimEnd());
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Shade,,0,0,0,,{${pos}${fade}${grow}\\blur${Math.max(8, Math.round(size / 4))}}${plain}`);
    events.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Glow,,0,0,0,,{${pos}${fade}${grow}\\blur${Math.max(4, Math.round(size / 8))}}${karaokeTags(line, start, '\\ko')}`);
    events.push(
      `Dialogue: 2,${assTime(start)},${assTime(end)},Kara,,0,0,0,,{${pos}${fade}${grow}\\alpha&H50&\\t(${from},${sing},\\alpha&H00&)}${karaokeTags(line, start, '\\kf')}`
    );

    const gapBefore = i === 0 ? line.start : line.start - lines[i - 1].end;
    if (look.countdown && gapBefore >= COUNTDOWN_GAP && line.start >= 3) {
      // Above the line's own row, counting down to its first word.
      const y = rows[row] - Math.round(size * 1.2);
      for (let k = 3; k >= 1; k--) {
        const a = line.start - k;
        const b = line.start - k + 0.92;
        events.push(`Dialogue: 3,${assTime(a)},${assTime(b)},Count,,0,0,0,,{\\an2\\pos(${x},${y})}${Array(k).fill('●').join('  ')}`);
      }
    }
  }
  return [...header, ...events].join('\n') + '\n';
}
