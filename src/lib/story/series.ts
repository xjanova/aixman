/**
 * Series and short dramas (ซีรีส์ / ละครสั้น) — pure, no database, so the
 * page, the API and the tests read the same vocabulary.
 *
 * A series is one story told over many episodes. Each episode is an ordinary
 * film project (acts → scenes → shots, rendered and cut as before) with
 * `seriesId` + `episodeNumber`; the series holds what the episodes share — the
 * premise, the cast, the look, the frame — and the "bible": a logline, the
 * characters AI added beyond the customer's cast, and every episode's title,
 * summary, the hook it opens on and the cliffhanger it stops on.
 *
 * The bible is written BIBLE_BATCH episodes per chat call, each call reading
 * the episodes before it, so no single answer is long (a thinking model spends
 * its budget reasoning first — see FILM_PART_SECONDS in cinematic.ts).
 *
 * An episode's film brief is composed from the bible (`episodeBrief`) in the
 * series' language, and its planner gets an `EpisodePlan` (cinematic.ts): the
 * film opens on the hook and stops on the cliffhanger instead of opening wide
 * and ending. Its reference library is copied from the nearest episode already
 * made, so faces, props and places drawn in one episode carry into the next.
 */

import type { Msg } from '@/lib/i18n/locale';
import { FILM_LENGTHS, LIMITS, extractJson, type EpisodePlan } from './cinematic';

export type SeriesFormat = 'short' | 'series';

interface FormatInfo {
  label: Msg;
  hint: Msg;
  /** What the form starts from when this format is picked. */
  aspect: string;
  episodeSeconds: number;
  episodeCount: number;
  /** Prompt text for the head writer — not a translation, never passed to t(). */
  direction: string;
}

export const SERIES_FORMATS: Record<SeriesFormat, FormatInfo> = {
  short: {
    label: { th: '📱 ละครสั้นแนวตั้ง', en: '📱 Vertical short drama' },
    hint: {
      th: 'ตอนละ 1–3 นาที ภาพแนวตั้งดูบนมือถือ เปิดทุกตอนด้วยฉากเด็ดใน 3 วินาทีแรก และจบด้วยปมค้างให้อยากดูตอนต่อไป',
      en: '1–3 minute vertical episodes for phones: each opens on a hook in its first 3 seconds and ends on a cliffhanger',
    },
    aspect: '9:16',
    episodeSeconds: 60,
    episodeCount: 10,
    direction:
      'a vertical short drama watched on phones, like the short-drama apps: every episode grabs the viewer in its first 3 seconds, moves fast, plays big emotions, reversals and twists, and ends on a cliffhanger that makes the next episode a must',
  },
  series: {
    label: { th: '📺 ซีรีส์', en: '📺 Series' },
    hint: {
      th: 'ตอนละ 3–10 นาที แต่ละตอนมีเรื่องของตัวเองในเรื่องใหญ่ ตัวละครเติบโตไปทีละตอน',
      en: '3–10 minute episodes, each a story of its own inside the big one, characters growing as they go',
    },
    aspect: '16:9',
    episodeSeconds: 300,
    episodeCount: 6,
    direction:
      'a serialised drama: each episode has a story of its own inside the big one, characters change over the season, and each episode ends on a question that leads into the next',
  },
};

export const isSeriesFormat = (v: unknown): v is SeriesFormat => v === 'short' || v === 'series';

interface GenreInfo {
  label: Msg;
  /** The film look (cinematic.ts LOOKS) the form suggests with it. */
  look: string;
  /** Prompt text for the head writer — not a translation. */
  direction: string;
}

export const SERIES_GENRES: Record<string, GenreInfo> = {
  romance: {
    label: { th: 'รักโรแมนติก', en: 'Romance' },
    look: 'romance',
    direction: 'romance: longing, misunderstandings, a rival, a slow burn to the confession',
  },
  ceo: {
    label: { th: 'รักท่านประธาน', en: 'Billionaire romance' },
    look: 'drama',
    direction: 'a rich-and-powerful romance: a cold heir or CEO and an underdog lead, a contract relationship, family pressure, jealousy, grand gestures',
  },
  revenge: {
    label: { th: 'แก้แค้น / ตบหน้า', en: 'Revenge' },
    look: 'drama',
    direction: 'revenge: the lead is humiliated or betrayed, hides who they really are, and turns the tables in satisfying reversals that shame the people who wronged them',
  },
  family: {
    label: { th: 'ดราม่าครอบครัว', en: 'Family drama' },
    look: 'drama',
    direction: 'family drama: secrets, an inheritance, rivalry between relatives, sacrifice and reconciliation',
  },
  mystery: {
    label: { th: 'ลึกลับ / สืบสวน', en: 'Mystery' },
    look: 'thriller',
    direction: 'mystery: a crime or a secret, clues planted in every episode, suspects, a reveal that recasts what came before',
  },
  horror: {
    label: { th: 'สยองขวัญ', en: 'Horror' },
    look: 'thriller',
    direction: 'horror: dread that builds, a haunting with rules, sudden scares, a curse to break',
  },
  fantasy: {
    label: { th: 'แฟนตาซี', en: 'Fantasy' },
    look: 'film',
    direction: 'fantasy: a lead thrown into another world, a rule of magic or fate, a choice between two lives',
  },
  timetravel: {
    label: { th: 'ย้อนเวลา / ทะลุมิติ', en: 'Time travel' },
    look: 'film',
    direction:
      "time travel: a lead from today wakes in another era, often in someone else's body, or returns to their own past with every memory; they use what they know to survive and change fate, hide who they really are, and must choose between the life they left and the one they found",
  },
  wuxia: {
    label: { th: 'กำลังภายใน', en: 'Wuxia' },
    look: 'wuxia',
    direction:
      'wuxia, a Chinese martial-arts period drama: the jianghu of rival sects and wandering swordsmen in ancient China, a master and a disciple, a massacre or a stolen manual to avenge, codes of honour and sworn brotherhood, duels that reveal a hidden technique, a traitor inside the sect',
  },
  xianxia: {
    label: { th: 'เทพเซียน', en: 'Xianxia' },
    look: 'xianxia',
    direction:
      'xianxia, a Chinese immortal fantasy: sects on cloud-wrapped peaks, the mortal, immortal and demon realms, a love heaven forbids, trials and tribulations, a sealed power or memory, a sacrifice',
  },
  period: {
    label: { th: 'ย้อนยุค / วังหลัง', en: 'Period / palace' },
    look: 'palace',
    direction:
      'a period court drama: a royal court of consorts, maids, servants and ministers, schemes, poisonings and false accusations, a clever underdog who rises rank by rank, a fight over the succession, love against duty; customs, clothes and speech stay true to the era and country the premise names',
  },
  comedy: {
    label: { th: 'ตลก / ฟีลกู้ด', en: 'Comedy' },
    look: 'film',
    direction: 'comedy: misunderstandings, running gags, warm characters, a light touch even when it turns serious',
  },
  action: {
    label: { th: 'แอ็กชัน', en: 'Action' },
    look: 'action',
    direction: 'action: chases, fights, a ticking clock, a lead who keeps getting back up',
  },
};

export const SERIES_LIMITS = {
  title: 120,
  premise: 6000,
  minEpisodes: 2,
  maxEpisodes: 30,
  logline: 400,
  episodeTitle: 120,
  episodeSummary: 1200,
  hook: 300,
  cliffhanger: 300,
  /** Series one customer may keep. */
  series: 20,
} as const;

/** Episodes the head writer outlines per chat call. */
export const BIBLE_BATCH = 8;

/** The title a series gets when the customer leaves it blank — the bible may replace it. */
export const NEW_SERIES_TITLE: Msg = { th: 'ซีรีส์ใหม่', en: 'New series' };

/** Episode lengths a series may ask for: the film lengths, without "auto". */
export const EPISODE_LENGTHS: number[] = Object.values(FILM_LENGTHS)
  .map((l) => l.seconds)
  .filter((s): s is number => s !== null);

export function episodeSecondsOf(value: unknown, fallback: number): number {
  const n = Number(value);
  return EPISODE_LENGTHS.includes(n) ? n : fallback;
}

export function episodeCountOf(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  if (value === null || value === '' || !Number.isFinite(n)) return fallback;
  return Math.min(SERIES_LIMITS.maxEpisodes, Math.max(SERIES_LIMITS.minEpisodes, n));
}

/** The language the series is written in: Thai when the premise is. */
export function seriesLanguage(premise: string): 'th' | 'en' {
  return /[฀-๿]/.test(premise) ? 'th' : 'en';
}

export interface EpisodeOutline {
  title: string;
  summary: string;
  hook: string;
  cliffhanger: string;
}

export interface SeriesCharacter {
  name: string;
  description: string;
}

export interface SeriesBible {
  logline: string;
  /** Characters AI added beyond the customer's cast (no pictures yet). */
  characters: SeriesCharacter[];
  /** Episode k + 1 is `episodes[k]`; an unwritten one has no title and no summary. */
  episodes: EpisodeOutline[];
}

export interface CastMember {
  name: string;
  description: string;
  referenceUrl: string | null;
}

const clip = (s: unknown, max: number): string => (typeof s === 'string' ? s.trim().slice(0, max) : '');

const EMPTY_OUTLINE: EpisodeOutline = { title: '', summary: '', hook: '', cliffhanger: '' };

export const isWritten = (o: EpisodeOutline | null | undefined): o is EpisodeOutline => Boolean(o && (o.title || o.summary));

/** Episodes written, counted from the first: the next AI call continues after them. */
export function writtenCount(bible: SeriesBible | null): number {
  if (!bible) return 0;
  let n = 0;
  while (n < bible.episodes.length && isWritten(bible.episodes[n])) n++;
  return n;
}

/**
 * An outline is its title or summary; a hook or cliffhanger with neither is
 * not one (nothing to make the episode from), so it is cleared rather than
 * kept as an episode AI would see as empty and write over.
 */
function settled(o: EpisodeOutline): EpisodeOutline {
  return isWritten(o) ? o : { ...EMPTY_OUTLINE };
}

function outlineOf(raw: unknown): EpisodeOutline {
  if (typeof raw === 'string') return settled({ ...EMPTY_OUTLINE, summary: clip(raw, SERIES_LIMITS.episodeSummary) });
  const o = (raw ?? {}) as Record<string, unknown>;
  return settled({
    title: clip(o.title, SERIES_LIMITS.episodeTitle),
    summary: clip(o.summary, SERIES_LIMITS.episodeSummary),
    hook: clip(o.hook, SERIES_LIMITS.hook),
    cliffhanger: clip(o.cliffhanger, SERIES_LIMITS.cliffhanger),
  });
}

function charactersOf(raw: unknown, max: number): SeriesCharacter[] {
  const seen = new Set<string>();
  const out: SeriesCharacter[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const name = clip((c as SeriesCharacter)?.name, LIMITS.characterName);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, description: clip((c as SeriesCharacter)?.description, LIMITS.characterDescription) });
    if (out.length >= max) break;
  }
  return out;
}

/** Trailing unwritten episodes say nothing; dropped so the list ends on a written one. */
function trimTail(episodes: EpisodeOutline[]): EpisodeOutline[] {
  let end = episodes.length;
  while (end > 0 && !isWritten(episodes[end - 1])) end--;
  return episodes.slice(0, end);
}

/** The cast stored on the series (cast_json), every field checked. */
export function castOf(value: unknown): CastMember[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      return {
        name: clip(c.name, LIMITS.characterName),
        description: clip(c.description, LIMITS.characterDescription),
        referenceUrl: typeof c.referenceUrl === 'string' && c.referenceUrl ? c.referenceUrl : null,
      };
    })
    .filter((c) => c.name)
    .slice(0, LIMITS.characters);
}

/** The stored bible (bible_json), every field checked; null when there is none. */
export function bibleOf(value: unknown): SeriesBible | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  return {
    logline: clip(b.logline, SERIES_LIMITS.logline),
    characters: charactersOf(b.characters, LIMITS.characters),
    episodes: trimTail((Array.isArray(b.episodes) ? b.episodes : []).slice(0, SERIES_LIMITS.maxEpisodes).map(outlineOf)),
  };
}

/** The episodes the next AI call writes, or null when every one has an outline. */
export function nextBatch(from: number, count: number): { from: number; to: number } | null {
  if (from < 1 || from > count) return null;
  return { from, to: Math.min(count, from + BIBLE_BATCH - 1) };
}

/** The first episode at or after `from` with no outline; count + 1 when there is none. */
export function firstUnwritten(bible: SeriesBible | null, from: number, count: number): number {
  let n = Math.max(1, from);
  while (n <= count && isWritten(bible?.episodes[n - 1])) n++;
  return n;
}

/**
 * The batch AI writes from episode `from`. Keeping what is written, it stops
 * before the next episode that already has an outline (one the customer wrote
 * by hand is never overwritten); rewriting, it runs on regardless.
 */
export function batchFrom(bible: SeriesBible | null, from: number, count: number, keepWritten: boolean): { from: number; to: number } | null {
  const batch = nextBatch(from, count);
  if (!batch || !keepWritten) return batch;
  let to = batch.from;
  while (to < batch.to && !isWritten(bible?.episodes[to])) to++;
  return { from: batch.from, to };
}

export interface BibleInput {
  title: string;
  premise: string;
  format: SeriesFormat;
  genre: string;
  language: string;
  episodeSeconds: number;
  /** Episodes in the series. */
  count: number;
  cast: CastMember[];
  /** Characters AI already added (later batches keep to them). */
  characters: SeriesCharacter[];
  /** Outlines of episodes 1 … from − 1, which this batch continues. */
  done: EpisodeOutline[];
  from: number;
  to: number;
}

/** About how many scenes an episode of this length holds. */
function sceneRange(seconds: number): string {
  if (seconds <= 60) return '2 to 4';
  if (seconds <= 180) return '4 to 8';
  if (seconds <= 300) return '6 to 12';
  return '10 to 20';
}

/** The earlier episodes as the next batch reads them, the newest in full, all within `budget` characters. */
function storySoFar(done: EpisodeOutline[], budget = 9000): string {
  const lines = done.map(
    (o, k) => `${k + 1}. ${o.title}${o.summary ? ` — ${o.summary}` : ''}${o.cliffhanger ? ` (Ends on: ${o.cliffhanger})` : ''}`
  );
  // Squeeze the oldest first: their title and how they ended are what later episodes lean on.
  for (let k = 0; k < lines.length && lines.join('\n').length > budget; k++) {
    const o = done[k];
    lines[k] = `${k + 1}. ${o.title}${o.cliffhanger ? ` (Ends on: ${o.cliffhanger.slice(0, 120)})` : ''}`;
  }
  const text = lines.join('\n');
  return text.length > budget ? text.slice(text.length - budget) : text;
}

/** System + user message for one batch of the bible. */
export function bibleMessages(input: BibleInput): { system: string; user: string } {
  const format = SERIES_FORMATS[input.format] ?? SERIES_FORMATS.short;
  const genre = SERIES_GENRES[input.genre] ?? SERIES_GENRES.romance;
  const first = input.from === 1;
  const n = input.to - input.from + 1;
  const range = n === 1 ? `episode ${input.from}` : `episodes ${input.from} to ${input.to}`;
  const room = Math.max(0, LIMITS.characters - input.cast.length);
  const language = input.language === 'th' ? 'Thai' : "the premise's language";
  const finale = input.to >= input.count;
  const system = `You are the head writer of ${format.direction}. Genre: ${genre.direction}.
Write ${first ? 'the series bible and ' : ''}the outline of ${range} of ${input.count}; each episode runs about ${input.episodeSeconds} seconds on screen.
Return ONLY JSON, no markdown: {${first ? '"title": string, "logline": string, "characters": [{"name": string, "description": string}], ' : ''}"episodes": [{"title": string, "summary": string, "hook": string, "cliffhanger": string}]} with exactly ${n} episode${n === 1 ? '' : 's'}, in order.
Rules:
- Write titles, the logline, summaries, hooks and cliffhangers in ${language}.
- "summary": 2 to 4 sentences — what happens in the episode, who does and says what. An episode of ${input.episodeSeconds} s holds ${sceneRange(input.episodeSeconds)} short scenes; do not cram in more.
- "hook": one sentence — the striking moment the episode opens on, within its first 3 seconds (a slap, a secret overheard, a stranger at the door). From episode 2 on it picks up the cliffhanger before it.
- "cliffhanger": one sentence — the unresolved moment the episode stops on, cut at its peak.${finale ? ` Episode ${input.count} is the finale: it resolves the main conflict, and its "cliffhanger" is the closing image (or a hint of a next season).` : ''}
- Stakes rise episode by episode, with a twist every few episodes. Never contradict the premise or the earlier episodes.
- Use the cast by name. ${
    first
      ? room > 0
        ? `"characters": only NEW people the story needs beyond the cast, at most ${room}; "name" in ${language}; "description" in English, 15–40 words, purely visual (age, face, hair, build, clothes) so they are drawn the same way in every episode.`
        : '"characters": [] — the cast is full; use only the cast.'
      : 'Add no new main characters.'
  }${first ? `\n- "logline": one or two sentences that sell the whole series.${input.title ? '' : ' "title": a short, catchy series title.'}` : ''}`;
  const cast = input.cast.length
    ? input.cast.map((c, k) => `${k + 1}. ${c.name}${c.description ? ` — ${c.description}` : ''}`).join('\n')
    : 'No named characters yet.';
  const added = input.characters.length ? `\n\nCharacters added before:\n${input.characters.map((c) => `- ${c.name} — ${c.description}`).join('\n')}` : '';
  const before = input.done.length ? `\n\nEpisodes so far:\n${storySoFar(input.done)}` : '';
  const user = `${input.title ? `Series title: ${input.title}\n\n` : ''}Cast:\n${cast}${added}\n\nPremise:\n${input.premise}${before}`;
  return { system, user };
}

export interface BibleBatch {
  title: string;
  logline: string;
  characters: SeriesCharacter[];
  episodes: EpisodeOutline[];
}

/**
 * One batch from the head writer's answer, every field checked. Null when it
 * holds no usable episode; fewer episodes than asked are kept (the next call
 * writes on from them).
 */
export function parseBible(text: string, input: Pick<BibleInput, 'from' | 'to' | 'cast'>): BibleBatch | null {
  const data = extractJson(text) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.episodes)) return null;
  const wanted = input.to - input.from + 1;
  const episodes = data.episodes.slice(0, wanted).map(outlineOf);
  // Keep only the run of written episodes from the start: a gap would be an episode nobody wrote.
  let usable = 0;
  while (usable < episodes.length && isWritten(episodes[usable])) usable++;
  if (usable === 0) return null;
  const castNames = new Set(input.cast.map((c) => c.name.toLowerCase()));
  const room = Math.max(0, LIMITS.characters - input.cast.length);
  return {
    title: clip(data.title, SERIES_LIMITS.title),
    logline: clip(data.logline, SERIES_LIMITS.logline),
    characters: charactersOf(data.characters, LIMITS.characters).filter((c) => !castNames.has(c.name.toLowerCase())).slice(0, room),
    episodes: episodes.slice(0, usable),
  };
}

/**
 * The bible with a batch laid in at episode `from`. A rewrite drops the
 * outlines after the batch — they followed the episodes it replaced; filling
 * gaps (`keepAfter`) keeps them. The first batch brings the logline and
 * characters; later ones keep what is there.
 */
export function mergeBible(prev: SeriesBible | null, batch: BibleBatch, from: number, count: number, keepAfter = false): SeriesBible {
  const base = prev ?? { logline: '', characters: [], episodes: [] };
  const head = base.episodes.slice(0, from - 1);
  while (head.length < from - 1) head.push({ ...EMPTY_OUTLINE });
  const after = keepAfter ? base.episodes.slice(from - 1 + batch.episodes.length) : [];
  return {
    logline: from === 1 && batch.logline ? batch.logline : base.logline,
    characters: from === 1 ? batch.characters : base.characters,
    episodes: trimTail([...head, ...batch.episodes, ...after].slice(0, count)),
  };
}

/**
 * Episode outlines typed by the customer: `[{number, title?, summary?, hook?,
 * cliffhanger?}]`, only the fields sent change. An episode may be written by
 * hand before AI ever ran; one left with no title and no summary is cleared
 * (the page only saves that to delete an outline).
 */
export function editEpisodes(prev: SeriesBible | null, raw: unknown, count: number): SeriesBible {
  const base = prev ?? { logline: '', characters: [], episodes: [] };
  const episodes = base.episodes.map((o) => ({ ...o }));
  // A page sends one episode at a time; never walk an oversized list.
  for (const item of (Array.isArray(raw) ? raw : []).slice(0, SERIES_LIMITS.maxEpisodes)) {
    const e = (item ?? {}) as Record<string, unknown>;
    const number = Number(e.number);
    if (!Number.isInteger(number) || number < 1 || number > count) continue;
    while (episodes.length < number) episodes.push({ ...EMPTY_OUTLINE });
    const o = episodes[number - 1];
    if (e.title !== undefined) o.title = clip(e.title, SERIES_LIMITS.episodeTitle);
    if (e.summary !== undefined) o.summary = clip(e.summary, SERIES_LIMITS.episodeSummary);
    if (e.hook !== undefined) o.hook = clip(e.hook, SERIES_LIMITS.hook);
    if (e.cliffhanger !== undefined) o.cliffhanger = clip(e.cliffhanger, SERIES_LIMITS.cliffhanger);
    episodes[number - 1] = settled(o);
  }
  return { ...base, episodes: trimTail(episodes.slice(0, count)) };
}

/** What the series holds that an episode's brief and plan read. */
export interface SeriesInfo {
  title: string;
  premise: string;
  format: string;
  genre: string;
  language: string;
  aspectRatio: string;
  episodeCount: number;
}

/** An episode's project title: "<series> · EP.3 <episode title>". */
export function episodeTitle(seriesTitle: string, n: number, outline: EpisodeOutline | null | undefined): string {
  return `${seriesTitle} · EP.${n}${outline?.title ? ` ${outline.title}` : ''}`.slice(0, LIMITS.title);
}

/**
 * The film brief of episode `n`: what the planner reads as "the story", in the
 * series' language, within LIMITS.brief. The episode before is told in full
 * (this one picks up its cliffhanger); older ones shrink first.
 */
export function episodeBrief(series: SeriesInfo, bible: SeriesBible, n: number): string {
  const th = series.language === 'th';
  const L = th
    ? { ep: 'ตอนที่', of: 'จาก', genre: 'แนว', story: 'เรื่องย่อทั้งเรื่อง', before: 'ตอนก่อนหน้า', now: 'เรื่องในตอนนี้', open: 'เปิดตอนด้วย', end: 'จบตอนที่ (ค้างไว้ ยังไม่คลี่คลาย)', finale: 'ตอนจบของเรื่อง ปิดท้ายด้วย', ends: 'จบที่' }
    : { ep: 'Episode', of: 'of', genre: 'Genre', story: 'The whole story', before: 'Previously', now: 'This episode', open: 'Open on', end: 'End on (unresolved)', finale: 'The finale — close on', ends: 'ends on' };
  const outline = bible.episodes[n - 1] ?? EMPTY_OUTLINE;
  const genre = SERIES_GENRES[series.genre]?.label ?? SERIES_GENRES.romance.label;
  const format = SERIES_FORMATS[isSeriesFormat(series.format) ? series.format : 'short'].label;
  const head = `${series.title} — ${L.ep} ${n} ${L.of} ${series.episodeCount}${outline.title ? `: ${outline.title}` : ''}\n${L.genre}: ${genre[th ? 'th' : 'en']} · ${format[th ? 'th' : 'en'].replace(/^\S+\s/, '')}`;
  const story = `${L.story}: ${bible.logline || series.premise}`.slice(0, 1500);
  const finale = n >= series.episodeCount;
  const tail = [
    `${L.now}: ${outline.summary || outline.title}`,
    outline.hook ? `${L.open}: ${outline.hook}` : '',
    outline.cliffhanger ? `${finale ? L.finale : L.end}: ${outline.cliffhanger}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  // The episodes before, newest first in priority: the last one in full, the rest by title.
  const earlier = bible.episodes.slice(0, n - 1);
  const room = LIMITS.brief - head.length - story.length - tail.length - 40;
  const lines = earlier.map((o, k) =>
    k === earlier.length - 1
      ? `${k + 1}. ${o.title} — ${o.summary}${o.cliffhanger ? ` (${L.ends}: ${o.cliffhanger})` : ''}`
      : `${k + 1}. ${o.title}${o.cliffhanger ? ` (${L.ends}: ${o.cliffhanger})` : ''}`
  );
  while (lines.length > 1 && lines.join('\n').length > room) lines.shift();
  const before = lines.length ? `${L.before}:\n${lines.join('\n')}`.slice(0, Math.max(0, room)) : '';
  return [head, story, before, tail].filter(Boolean).join('\n\n').slice(0, LIMITS.brief);
}

/** What episode `n`'s planner needs to know (cinematic.ts EpisodePlan). */
export function episodePlanOf(series: Pick<SeriesInfo, 'format' | 'episodeCount' | 'aspectRatio'>, bible: SeriesBible | null, n: number): EpisodePlan {
  const outline = bible?.episodes[n - 1];
  const before = n > 1 ? bible?.episodes[n - 2] : undefined;
  return {
    number: n,
    count: Math.max(n, series.episodeCount),
    format: isSeriesFormat(series.format) ? series.format : 'short',
    hook: outline?.hook ?? '',
    cliffhanger: outline?.cliffhanger ?? '',
    previously: before?.cliffhanger ?? '',
    vertical: series.aspectRatio === '9:16',
  };
}

/** A library row as an episode is made from (ai_story_characters' fields). */
export interface LibrarySeed {
  kind: string;
  name: string;
  description: string;
  origin: string;
  referenceUrl: string | null;
  images: unknown;
  voiceId: string | null;
}

/**
 * A new episode's reference library: the made episode's library as it is
 * (characters, props, places, every picture), then any cast member or
 * AI-added character it lacks by name — characters capped at LIMITS.characters.
 * With no episode made yet, it is the cast and the AI's characters.
 */
export function episodeLibrary(source: LibrarySeed[], cast: CastMember[], characters: SeriesCharacter[]): LibrarySeed[] {
  const out = source.map((s) => ({ ...s }));
  const names = new Set(out.filter((s) => s.kind === 'character').map((s) => s.name.trim().toLowerCase()));
  let people = names.size;
  const add = (seed: LibrarySeed) => {
    const key = seed.name.trim().toLowerCase();
    if (!key || names.has(key) || people >= LIMITS.characters) return;
    names.add(key);
    people++;
    out.push(seed);
  };
  for (const c of cast) {
    add({ kind: 'character', name: c.name, description: c.description, origin: 'uploaded', referenceUrl: c.referenceUrl, images: null, voiceId: null });
  }
  for (const c of characters) {
    add({ kind: 'character', name: c.name, description: c.description, origin: 'planned', referenceUrl: null, images: null, voiceId: null });
  }
  return out;
}
