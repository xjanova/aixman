/**
 * Phase 2 of โหมดหนัง / MV: how the rendered shots become one film — pure, so
 * the page, the API, the assembler and the tests share it.
 *
 * Every part of the edit is the customer's switch, nothing is forced: the
 * clips' own sound (LTX and H3 speak Thai and make their ambience), music
 * (the MV's song, or a track ACE-Step makes for the film), Thai subtitles,
 * covering the subtitles LTX invents, fades between shots, and a title card.
 *
 * Settings live in ai_story_projects.script_json (`edit`, `music`) — no new
 * column, so the edit needs no migration.
 */
import { ASPECTS, LIMITS, LOOKS, MOODS, type StoryMode } from './cinematic';

export type MusicSource = 'off' | 'song' | 'generate';

export interface EditSettings {
  /** The clips' own sound: speech, ambience, effects. */
  clipAudio: boolean;
  clipVolume: number;
  music: MusicSource;
  musicVolume: number;
  /** Music drops under the clips' sound (speech stays clear). */
  duck: boolean;
  /** Thai subtitles from the shot's line (film) or lyric (MV). */
  subtitles: boolean;
  /** Blur the band where LTX burns invented subtitles. */
  coverFakeSubs: boolean;
  transition: 'cut' | 'fade';
  titleCard: boolean;
  /** MV: a shot with a finished lip-sync dub is cut from the dub (lipsync.ts). */
  lipsync: boolean;
}

export function defaultEdit(mode: StoryMode): EditSettings {
  return {
    clipAudio: mode === 'film',
    clipVolume: 1,
    music: mode === 'mv' ? 'song' : 'off',
    musicVolume: mode === 'mv' ? 1 : 0.35,
    duck: true,
    subtitles: true,
    coverFakeSubs: true,
    transition: mode === 'mv' ? 'cut' : 'fade',
    titleCard: mode === 'film',
    lipsync: mode === 'mv',
  };
}

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const volume = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? Math.round(Math.min(2, Math.max(0, n)) * 100) / 100 : fallback;
};

/** Stored or sent settings, every field checked; anything missing keeps its default. */
export function parseEdit(raw: unknown, mode: StoryMode): EditSettings {
  const d = defaultEdit(mode);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let music: MusicSource = r.music === 'off' || r.music === 'song' || r.music === 'generate' ? r.music : d.music;
  // A film has no song to play; an MV is cut to its song and never gets another.
  if (mode === 'film' && music === 'song') music = 'generate';
  if (mode === 'mv' && music === 'generate') music = 'song';
  return {
    clipAudio: bool(r.clipAudio, d.clipAudio),
    clipVolume: volume(r.clipVolume, d.clipVolume),
    music,
    musicVolume: volume(r.musicVolume, d.musicVolume),
    duck: bool(r.duck, d.duck),
    subtitles: bool(r.subtitles, d.subtitles),
    coverFakeSubs: bool(r.coverFakeSubs, d.coverFakeSubs),
    transition: r.transition === 'cut' || r.transition === 'fade' ? r.transition : d.transition,
    titleCard: bool(r.titleCard, d.titleCard),
    // A film has no song for a singer to mouth.
    lipsync: mode === 'mv' && bool(r.lipsync, d.lipsync),
  };
}

/** The film's background music order (ACE-Step), as stored in script_json.music. */
export interface MusicState {
  generationId: number;
  seconds: number;
}

export function parseMusicState(raw: unknown): MusicState | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = Number(r.generationId);
  return Number.isInteger(id) && id > 0 ? { generationId: id, seconds: Number(r.seconds) || 0 } : null;
}

/** What ACE-Step is asked for: an instrumental in the film's look (no lyrics → instrumental). */
export function musicPrompt(look: string, mood: string | null): string {
  const base = LOOKS[look]?.music ?? LOOKS.film.music;
  const feel = mood && MOODS[mood] ? `, ${MOODS[mood].label}` : '';
  return `Cinematic film score, instrumental, no vocals. ${base}${feel}`;
}

/** ACE-Step renders 5–240 s; the film's music is as long as the film. */
export function musicSeconds(filmSeconds: number): number {
  return Math.min(240, Math.max(5, Math.ceil(filmSeconds)));
}

// ---------------------------------------------------------------------------
// Price of the cut
// ---------------------------------------------------------------------------

/**
 * Separate files are free; the joined film costs credits per started minute,
 * never less than a floor. Both numbers are ai_settings
 * (`story_assemble_credits_per_minute`, `story_assemble_min_credits`).
 */
export const ASSEMBLE_PRICE_DEFAULTS = { perMinute: 4, minimum: 3 } as const;

export function assemblePrice(filmSeconds: number, price: { perMinute: number; minimum: number } = ASSEMBLE_PRICE_DEFAULTS): number {
  if (filmSeconds <= 0) return 0;
  return Math.max(price.minimum, Math.ceil(filmSeconds / 60) * price.perMinute);
}

// ---------------------------------------------------------------------------
// The cut
// ---------------------------------------------------------------------------

export interface CutShot {
  number: number;
  /** Seconds the shot holds in the film (its storyboard length). */
  seconds: number;
  /** Subtitle text: the line (film) or the lyric (MV). */
  text: string;
  /** Rendered by LTX — the model that burns invented subtitles in. */
  burnsSubs: boolean;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const TITLE_SECONDS = 3;
export const FADE_SECONDS = 0.3;
export const MAX_FILM_SECONDS = LIMITS.maxFilmSeconds;

/** Where each shot sits in the film, from 0, in order. */
export function timeline(shots: CutShot[]): { start: number; end: number }[] {
  let t = 0;
  return shots.map((s) => {
    const start = t;
    t = Math.round((t + s.seconds) * 1000) / 1000;
    return { start, end: t };
  });
}

/** Subtitle cues: one per shot that has words, held for the shot (less its fades). */
export function subtitleCues(shots: CutShot[], fade: boolean): Cue[] {
  const spans = timeline(shots);
  const pad = fade ? FADE_SECONDS : 0.05;
  return shots.flatMap((s, k) => {
    const text = s.text.replace(/\s+/g, ' ').trim();
    if (!text) return [];
    return [{ start: spans[k].start + pad, end: Math.max(spans[k].start + pad + 0.5, spans[k].end - pad), text }];
  });
}

/** Thai wraps on spaces only; long lines are broken near the middle space. */
export function wrapLine(text: string, maxChars = 42): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxChars) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** ASS text is markup: braces and backslashes from a customer's words must stay text. */
export function assEscape(text: string): string {
  // Sarabun has no full-width backslash; a slash reads the same.
  // Control characters have no glyph and would print as boxes.
  return text.replace(/\\/g, '/').replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/[\x00-\x1f\x7f]+/g, ' ');
}

/**
 * The subtitle file: Thai lines in Sarabun Bold, white with a dark outline,
 * sat in the band LTX's fake subtitles occupy (so ours cover what is left of
 * them), and the title card when asked for.
 */
export function buildAss(opts: { aspect: string; cues: Cue[]; title?: string; font: string }): string {
  const frame = ASPECTS[opts.aspect] ?? ASPECTS['16:9'];
  const size = Math.round(Math.min(frame.width, frame.height) * 0.072);
  const marginV = Math.round(frame.height * 0.05);
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${opts.font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size / 14))},1,2,40,40,${marginV},222`,
    `Style: Title,${opts.font},${Math.round(size * 1.9)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(size / 8))},2,5,60,60,0,222`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (opts.title?.trim()) {
    const t = wrapLine(assEscape(opts.title.trim()), 28).join('\\N');
    lines.push(`Dialogue: 1,${assTime(0.2)},${assTime(TITLE_SECONDS)},Title,,0,0,0,,{\\fad(400,500)}${t}`);
  }
  for (const c of opts.cues) {
    const t = wrapLine(assEscape(c.text)).join('\\N');
    lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,{\\fad(120,120)}${t}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * The band LTX writes its invented subtitles into, as fractions of the clip
 * as rendered (measured on 1280×704: x 240–1040, y 572–700). A portrait
 * clip's lines run nearly edge to edge, so its band is wider. Blurred on the
 * source frame, before it is fitted to the film's frame, so the band follows
 * the text wherever the crop puts it.
 */
export const FAKE_SUB_BAND = { landscape: { x: 0.1875, w: 0.625 }, portrait: { x: 0.05, w: 0.9 }, y: 0.81, h: 0.18 } as const;

/** ffmpeg expressions for the band, evaluated on the clip's own size. */
export function bandExpr(): { w: string; h: string; x: string; y: string } {
  const { landscape: l, portrait: p, y, h } = FAKE_SUB_BAND;
  const pick = (a: number, b: number) => `if(gt(ih\\,iw)\\,${b}\\,${a})`;
  return {
    w: `trunc(iw*${pick(l.w, p.w)}/2)*2`,
    h: `trunc(ih*${h}/2)*2`,
    x: `trunc(iw*${pick(l.x, p.x)}/2)*2`,
    y: `trunc(ih*${y}/2)*2`,
  };
}

/** The ffmpeg video filter for one shot: the cover, frame, 24 fps, the fades. */
export function shotVideoFilter(opts: { aspect: string; seconds: number; cover: boolean; fade: boolean }): string {
  const f = ASPECTS[opts.aspect] ?? ASPECTS['16:9'];
  let chain = '';
  if (opts.cover) {
    const b = bandExpr();
    // overlay sees the base as main_w/main_h; the crop's own iw/ih are the clip's.
    const ox = b.x.replace(/iw/g, 'main_w').replace(/ih/g, 'main_h');
    const oy = b.y.replace(/ih/g, 'main_h');
    chain = `split[base][band];[band]crop=w=${b.w}:h=${b.h}:x=${b.x}:y=${b.y},boxblur=20:3[blur];[base][blur]overlay=x=${ox}:y=${oy},`;
  }
  chain += [
    `scale=${f.width}:${f.height}:force_original_aspect_ratio=increase`,
    `crop=${f.width}:${f.height}`,
    'fps=24',
    'setsar=1',
  ].join(',');
  if (opts.fade) {
    const out = Math.max(0, opts.seconds - FADE_SECONDS).toFixed(3);
    chain = `${chain},fade=t=in:st=0:d=${FADE_SECONDS},fade=t=out:st=${out}:d=${FADE_SECONDS}`;
  }
  return `${chain},format=yuv420p`;
}

/** The final sound: clips, music, or both with the music ducked under the clips. */
export function mixFilter(opts: { clips: boolean; music: boolean; clipVolume: number; musicVolume: number; duck: boolean; seconds: number }): string | null {
  const dur = opts.seconds.toFixed(3);
  const tail = Math.max(0, opts.seconds - 2).toFixed(3);
  const musicChain = `[1:a]atrim=0:${dur},asetpts=N/SR/TB,volume=${opts.musicVolume},afade=t=out:st=${tail}:d=2`;
  if (opts.clips && opts.music) {
    if (opts.duck) {
      return `[0:a]volume=${opts.clipVolume},asplit=2[voice][key];${musicChain}[bed];[bed][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked];[voice][ducked]amix=inputs=2:normalize=0:duration=first[aout]`;
    }
    return `[0:a]volume=${opts.clipVolume}[voice];${musicChain}[bed];[voice][bed]amix=inputs=2:normalize=0:duration=first[aout]`;
  }
  if (opts.music) return `${musicChain},apad=whole_dur=${dur}[aout]`;
  if (opts.clips) return `[0:a]volume=${opts.clipVolume}[aout]`;
  return null;
}
