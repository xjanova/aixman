/**
 * The cinematic writer behind โหมดหนัง and โหมด MV — pure, no database, so the
 * page, the API and the tests all read the same vocabulary.
 *
 * A video model sees one shot at a time and nothing of the film around it, so
 * every shot has to stand on its own: who is in it and what they look like,
 * where it happens, the framing, the camera, the look. The storyboard stores
 * those as separate fields the customer can edit; `buildShotPrompt` folds them
 * into what each model reads best (H3's structured fields, LTX's paragraph).
 *
 * Two lessons from the MVs made by hand (2026-10-24, 2026-10-27) are rules
 * here, not advice:
 *  - A character's face only survives when their picture is the first frame
 *    and it is already large: a wide picture the camera then pushes into gets
 *    a new face. So a shot led by a character never gets a push-in from a wide
 *    or full shot (`safeCamera`).
 *  - LTX-2.5 burns invented subtitles into any shot with speech or singing
 *    unless told not to — and sometimes even then. Every prompt says so; the
 *    edit (phase 2) still has to cover them.
 */

export type StoryMode = 'film' | 'mv';

export const MOVIE_MODEL_KEYS = ['ltx-2.5', 'minimax-h3'] as const;
export type MovieModelKey = (typeof MOVIE_MODEL_KEYS)[number];

export const LIMITS = {
  brief: 6000,
  lyrics: 6000,
  title: 120,
  characters: 4,
  characterName: 60,
  characterDescription: 400,
  shotsFilm: 24,
  shotsMv: 60,
  visual: 1500,
  line: 300,
  sound: 300,
  /** Seconds a shot may render: the models' sweet spot, and what the price curve covers sensibly. */
  minShotSeconds: 3,
  maxShotSeconds: 10,
  /** MV songs longer than this are refused — 60 shots of ~6 s. */
  maxSongSeconds: 360,
} as const;

export const ASPECTS: Record<string, { width: number; height: number; label: string }> = {
  '16:9': { width: 1344, height: 768, label: 'แนวนอน 16:9' },
  '9:16': { width: 768, height: 1344, label: 'แนวตั้ง 9:16' },
  '1:1': { width: 1024, height: 1024, label: 'จัตุรัส 1:1' },
};

interface Style {
  label: string;
  /** Visual direction appended to every shot. */
  style: string;
  /** Background score for H3's non_diegetic_music field (film), 'N/A' to leave it out. */
  music: string;
}

/** Film looks (โหมดหนัง). */
export const LOOKS: Record<string, Style> = {
  film: {
    label: 'ภาพยนตร์ทั่วไป',
    style: 'Live-action, cinematic, shot on 35mm film, anamorphic lens, natural film grain, motivated lighting, rich contrast',
    music: 'A restrained orchestral underscore with soft strings and piano, slow tempo.',
  },
  drama: {
    label: 'ดราม่า',
    style: 'Live-action, cinematic drama, soft window light, muted warm colour grade, shallow depth of field, intimate framing',
    music: 'A slow solo piano with sustained cello, quiet dynamics.',
  },
  action: {
    label: 'แอ็กชัน',
    style: 'Live-action, cinematic action, high contrast teal and orange grade, fast shutter, dynamic composition, sparks and debris',
    music: 'Driving percussion and low brass, fast tempo, rising intensity.',
  },
  thriller: {
    label: 'ระทึกขวัญ / สยองขวัญ',
    style: 'Live-action, cinematic thriller, low-key lighting, deep shadows, cold desaturated green-blue grade, slow creeping atmosphere',
    music: 'Low drones, sparse dissonant strings, slow pulse.',
  },
  romance: {
    label: 'โรแมนติก',
    style: 'Live-action, cinematic romance, golden hour backlight, soft bloom, pastel warm grade, gentle lens flare',
    music: 'A tender acoustic guitar and light strings, medium-slow tempo.',
  },
  anime: {
    label: 'อนิเมะ',
    style: '2D anime, cinematic, clean line art, painterly backgrounds, soft cel shading, vivid sky',
    music: 'A light orchestral theme with piano and strings, medium tempo.',
  },
};

/** MV moods (โหมด MV). The song is the score, so no music line. */
export const MOODS: Record<string, Style & { setting: string; energy: 'calm' | 'mid' | 'high' }> = {
  romantic: {
    label: 'โรแมนติก หวาน',
    style: 'romantic music video, golden hour backlight, soft bloom, warm pastel grade, floating petals',
    setting: 'a sunlit flower garden and a quiet seaside at dusk',
    energy: 'calm',
    music: 'N/A',
  },
  sad: {
    label: 'เศร้า อกหัก',
    style: 'melancholic music video, rain on glass, cold blue grade, soft haze, lonely negative space',
    setting: 'a rainy night street with neon reflections and an empty room by the window',
    energy: 'calm',
    music: 'N/A',
  },
  energetic: {
    label: 'สนุก มันส์',
    style: 'energetic music video, vivid saturated colours, stage lights and lens flares, confetti, high energy',
    setting: 'a concert stage with crowd lights and a colourful city rooftop',
    energy: 'high',
    music: 'N/A',
  },
  dark: {
    label: 'ดาร์ก ร็อก/เมทัล',
    style: 'dark rock music video, hard rim light, smoke, sparks and embers, deep crimson and black grade',
    setting: 'a gothic cathedral lit by candles and a burning ruined hall',
    energy: 'high',
    music: 'N/A',
  },
  dreamy: {
    label: 'ฝัน ละมุน',
    style: 'dreamy music video, soft focus, pastel haze, floating particles, slow motion feel',
    setting: 'a misty lake at dawn and a field of tall grass under soft clouds',
    energy: 'calm',
    music: 'N/A',
  },
  retro: {
    label: 'ย้อนยุค',
    style: 'retro music video, 1990s film look, warm faded grade, light leaks, VHS softness',
    setting: 'an old Bangkok street with vintage shops and a retro diner',
    energy: 'mid',
    music: 'N/A',
  },
  epic: {
    label: 'ยิ่งใหญ่ อลังการ',
    style: 'epic cinematic music video, sweeping vistas, volumetric god rays, dramatic clouds, grand scale',
    setting: 'a mountain cliff above the clouds and an ancient temple at sunset',
    energy: 'high',
    music: 'N/A',
  },
  cute: {
    label: 'น่ารัก ป๊อป',
    style: 'cute pop music video, bright candy colours, soft even light, sparkles, playful framing',
    setting: 'a pastel bedroom full of plush toys and a candy-coloured street',
    energy: 'mid',
    music: 'N/A',
  },
};

export const SHOT_SIZES: Record<string, { label: string; en: string; tight: boolean }> = {
  'extreme-wide': { label: 'ไกลมาก (เปิดฉาก)', en: 'an extreme wide establishing shot', tight: false },
  wide: { label: 'ไกล', en: 'a wide shot', tight: false },
  full: { label: 'เต็มตัว', en: 'a full shot', tight: false },
  medium: { label: 'ครึ่งตัว', en: 'a medium shot', tight: true },
  'medium-close': { label: 'อก-หัว', en: 'a medium close-up', tight: true },
  close: { label: 'ใกล้ (หน้า)', en: 'a close-up', tight: true },
  'extreme-close': { label: 'ใกล้มาก (รายละเอียด)', en: 'an extreme close-up', tight: true },
};

export const CAMERA_MOVES: Record<string, { label: string; en: string; push: boolean }> = {
  static: { label: 'กล้องนิ่ง', en: 'The camera holds a static shot.', push: false },
  'push-in': { label: 'ดันเข้าช้าๆ', en: 'The camera slowly pushes in.', push: true },
  'pull-out': { label: 'ถอยออกช้าๆ', en: 'The camera slowly pulls out.', push: false },
  'pan-left': { label: 'แพนซ้าย', en: 'The camera pans slowly to the left.', push: false },
  'pan-right': { label: 'แพนขวา', en: 'The camera pans slowly to the right.', push: false },
  tracking: { label: 'ตามตัวละคร', en: 'A smooth tracking shot follows the subject.', push: false },
  orbit: { label: 'หมุนรอบ', en: 'The camera arcs slowly around the subject.', push: false },
  'crane-up': { label: 'เครนขึ้น', en: 'The camera rises slowly on a crane, revealing the scene.', push: false },
  handheld: { label: 'กล้องมือถือ', en: 'Handheld camera, shaking slightly.', push: false },
};

export interface CharacterLite {
  id: number;
  name: string;
  description: string;
  hasReference: boolean;
}

/** One shot as the planner and the editor see it. */
export interface ShotDraft {
  characterIds: number[];
  speakerId: number | null;
  shotSize: string;
  camera: string;
  durationSec: number;
  /** MV only: position in the song. */
  startSec: number | null;
  /** English, what the shot shows. */
  visual: string;
  /** Film: the spoken line. MV: the lyric sung over the shot. */
  line: string;
  /** English ambient sound. */
  sound: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clip = (s: unknown, max: number): string => (typeof s === 'string' ? s.trim().slice(0, max) : '');

export function clampSeconds(value: unknown, fallback = 5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(LIMITS.maxShotSeconds, Math.max(LIMITS.minShotSeconds, Math.round(n)));
}

export function pickKey<T extends string>(value: unknown, table: Record<T, unknown>, fallback: T): T {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value) ? (value as T) : fallback;
}

/**
 * The camera a shot may really use. A push-in from a wide or full shot onto a
 * character whose picture opens the shot is where faces were lost (the model
 * invents a face for the close-up it zooms into) — it becomes a static hold.
 */
export function safeCamera(shotSize: string, camera: string, ledByCharacter: boolean): string {
  const move = CAMERA_MOVES[camera] ? camera : 'static';
  if (ledByCharacter && CAMERA_MOVES[move].push && !SHOT_SIZES[shotSize]?.tight) return 'static';
  return move;
}

/** Seconds a shot renders for: whole seconds the models take, never shorter than its slot. */
export function renderSeconds(durationSec: number): number {
  return Math.min(LIMITS.maxShotSeconds, Math.max(LIMITS.minShotSeconds, Math.ceil(durationSec - 0.05)));
}

// ---------------------------------------------------------------------------
// Lyrics → song timeline (MV)
// ---------------------------------------------------------------------------

export interface LyricSection {
  /** The bracket tag, lower-cased ("verse 1", "chorus"), or '' before any tag. */
  tag: string;
  lines: string[];
}

const INSTRUMENTAL = /^(intro|outro|instrumental|inst|solo|guitar solo|break|interlude|drop|build ?up|end)\b/i;

/** Suno/YuE-style lyrics: `[Verse 1]` tags, one sung line per row. */
export function parseLyrics(lyrics: string): LyricSection[] {
  const sections: LyricSection[] = [];
  let current: LyricSection = { tag: '', lines: [] };
  for (const raw of lyrics.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tag = /^\[([^\]]{1,40})\]$/.exec(line) ?? /^\(([^)]{1,40})\)$/.exec(line);
    if (tag) {
      if (current.tag || current.lines.length) sections.push(current);
      current = { tag: tag[1].trim().toLowerCase(), lines: [] };
      continue;
    }
    current.lines.push(line.slice(0, LIMITS.line));
  }
  if (current.tag || current.lines.length) sections.push(current);
  return sections;
}

export interface TimelineSlot {
  start: number;
  duration: number;
  /** Lyric lines sung in this slot ('' for an instrumental one). */
  line: string;
  section: string;
  instrumental: boolean;
}

/**
 * Where each shot sits in the song, from the lyrics alone.
 *
 * Without the vocal aligned (phase 2) the lines are spread by weight: a sung
 * line by its length, an instrumental section as a block, an untagged song
 * opening on an intro. Then slots are merged or split to shots of 4–8 s. It
 * is an estimate the customer can move — and an honest one: the shots cover
 * the whole song, in order, and never overlap.
 */
export function songTimeline(lyrics: string, songSeconds: number, targetShot = 6): TimelineSlot[] {
  const total = Math.max(0, Math.min(LIMITS.maxSongSeconds, songSeconds));
  if (total < LIMITS.minShotSeconds) return [];
  const sections = parseLyrics(lyrics);

  type Item = { weight: number; line: string; section: string; instrumental: boolean };
  const items: Item[] = [];
  if (!sections.some((s) => INSTRUMENTAL.test(s.tag) && /^intro/.test(s.tag))) {
    items.push({ weight: 2, line: '', section: 'intro', instrumental: true });
  }
  for (const s of sections) {
    if (s.lines.length === 0 || INSTRUMENTAL.test(s.tag)) {
      items.push({ weight: s.lines.length ? 2 + s.lines.length * 0.5 : 2.5, line: '', section: s.tag || 'instrumental', instrumental: true });
      continue;
    }
    for (const line of s.lines) {
      items.push({ weight: 1 + Math.min(2, line.length / 30), line, section: s.tag || 'verse', instrumental: false });
    }
  }
  if (!sections.some((s) => /^outro|^end/.test(s.tag))) {
    items.push({ weight: 1.5, line: '', section: 'outro', instrumental: true });
  }

  const sum = items.reduce((a, i) => a + i.weight, 0);
  const timed = items.map((i) => ({ ...i, duration: (i.weight / sum) * total }));

  // Merge short neighbours of the same kind and section; split long ones.
  const slots: TimelineSlot[] = [];
  let at = 0;
  let pending: TimelineSlot | null = null;
  const flush = () => {
    if (!pending) return;
    const parts = Math.max(1, Math.round(pending.duration / targetShot));
    const each = pending.duration / parts;
    for (let k = 0; k < parts; k++) {
      slots.push({ ...pending, start: pending.start + each * k, duration: each, line: k === 0 ? pending.line : '' });
    }
    pending = null;
  };
  for (const item of timed) {
    if (
      pending &&
      pending.instrumental === item.instrumental &&
      pending.section === item.section &&
      pending.duration < targetShot - 1 &&
      pending.duration + item.duration <= LIMITS.maxShotSeconds
    ) {
      pending.duration += item.duration;
      if (item.line) pending.line = pending.line ? `${pending.line} / ${item.line}` : item.line;
    } else {
      flush();
      pending = { start: at, duration: item.duration, line: item.line, section: item.section, instrumental: item.instrumental };
    }
    at += item.duration;
  }
  flush();

  // A slot under the minimum joins its neighbour, so nothing renders a blink.
  for (let k = slots.length - 1; k > 0; k--) {
    if (slots[k].duration < LIMITS.minShotSeconds) {
      slots[k - 1].duration += slots[k].duration;
      if (slots[k].line) slots[k - 1].line = slots[k - 1].line ? `${slots[k - 1].line} / ${slots[k].line}` : slots[k].line;
      slots.splice(k, 1);
    }
  }
  if (slots.length > 1 && slots[0].duration < LIMITS.minShotSeconds) {
    slots[1].start = 0;
    slots[1].duration += slots[0].duration;
    slots.shift();
  }
  return slots.slice(0, LIMITS.shotsMv).map((s) => ({ ...s, start: round2(s.start), duration: round2(s.duration) }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Rules planner — no model needed, so planning never fails
// ---------------------------------------------------------------------------

const FILM_RHYTHM: [string, string][] = [
  ['extreme-wide', 'crane-up'],
  ['medium', 'push-in'],
  ['close', 'static'],
  ['full', 'tracking'],
  ['medium-close', 'orbit'],
  ['wide', 'pull-out'],
];

/** Quoted words in a sentence — what a character says. */
function quoted(sentence: string): string {
  const m = /[“"«']([^”"»']{2,200})[”"»']/.exec(sentence);
  return m ? m[1].trim() : '';
}

function characterLine(chars: CharacterLite[]): string {
  return chars.map((c) => `${c.name} (${c.description})`).join(' and ');
}

export interface PlanInput {
  mode: StoryMode;
  brief: string;
  characters: CharacterLite[];
  look: string;
  mood: string;
  songSeconds: number;
}

export function planFromRules(input: PlanInput): ShotDraft[] {
  const lead = input.characters.find((c) => c.hasReference) ?? input.characters[0];
  if (input.mode === 'mv') {
    const mood = MOODS[input.mood] ?? MOODS.romantic;
    const sizes = mood.energy === 'high' ? ['medium', 'wide', 'close', 'full'] : ['medium-close', 'medium', 'wide', 'close'];
    const moves = mood.energy === 'calm' ? ['static', 'pan-right', 'orbit', 'static'] : ['orbit', 'handheld', 'tracking', 'static'];
    return songTimeline(input.brief, input.songSeconds).map((slot, k) => {
      const withLead = Boolean(lead) && !slot.instrumental;
      const size = slot.instrumental && k === 0 ? 'extreme-wide' : sizes[k % sizes.length];
      const visual = withLead
        ? `${characterLine([lead!])} sings this line with feeling, in ${mood.setting}.`
        : `${slot.section === 'intro' ? 'The opening of the video: ' : ''}${mood.setting}, the scene breathes with the music.`;
      return {
        characterIds: withLead ? [lead!.id] : [],
        speakerId: null,
        shotSize: size,
        camera: safeCamera(size, moves[k % moves.length], withLead),
        durationSec: slot.duration,
        startSec: slot.start,
        visual,
        line: slot.line,
        sound: '',
      };
    });
  }

  const sentences = input.brief
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const per = Math.max(1, Math.ceil(sentences.length / 8));
  const shots: ShotDraft[] = [];
  for (let k = 0; k < sentences.length && shots.length < LIMITS.shotsFilm; k += per) {
    const text = sentences.slice(k, k + per).join(' ');
    const [size, move] = FILM_RHYTHM[shots.length % FILM_RHYTHM.length];
    const inShot = input.characters.filter((c) => text.includes(c.name));
    const cast = inShot.length ? inShot : lead && shots.length > 0 ? [lead] : [];
    const line = quoted(text);
    shots.push({
      characterIds: cast.map((c) => c.id),
      speakerId: line && cast[0] ? cast[0].id : null,
      shotSize: size,
      camera: safeCamera(size, move, cast.length > 0),
      durationSec: line ? 8 : 5,
      startSec: null,
      visual: `${cast.length ? `${characterLine(cast)}. ` : ''}${text}`.slice(0, LIMITS.visual),
      line,
      sound: 'Natural ambient sound that matches the scene.',
    });
  }
  return shots;
}

// ---------------------------------------------------------------------------
// LLM planner — the brief and the reply parser
// ---------------------------------------------------------------------------

const SIZE_KEYS = Object.keys(SHOT_SIZES).join(', ');
const MOVE_KEYS = Object.keys(CAMERA_MOVES).join(', ');

function castList(chars: CharacterLite[]): string {
  if (chars.length === 0) return 'No named characters.';
  return chars.map((c, k) => `${k + 1}. ${c.name} — ${c.description}${c.hasReference ? ' (has a reference photo)' : ''}`).join('\n');
}

/** System + user message for a film storyboard. */
export function filmPlannerMessages(input: PlanInput): { system: string; user: string } {
  const look = LOOKS[input.look] ?? LOOKS.film;
  const system = `You are a film director and storyboard artist. Turn the user's story into a shot list for an AI video model that renders ONE shot at a time and knows nothing of the other shots.
Return ONLY JSON, no markdown: {"title": string, "shots": [{"characters": [numbers], "speaker": number|null, "duration": 5|8|10, "size": string, "camera": string, "visual": string, "line": string, "sound": string}]}
Rules:
- 4 to 12 shots that tell the whole story with a beginning, middle and end. Open on an establishing shot; vary sizes (wide → medium → close-up) and give every camera move a reason.
- "characters": numbers from the cast list of who is visible, the main face FIRST — that character's photo becomes the shot's first frame, so the shot must open on them, facing the camera or in three-quarter view.
- "size" one of: ${SIZE_KEYS}. "camera" one of: ${MOVE_KEYS}. Never "push-in" on a wide or full shot that opens on a character.
- "visual": English, 40–80 words, self-contained: the setting, each visible character by name with their look, the action in order, lighting and mood. Look of the film: ${look.style}.
- "line": words spoken on screen in the story's language (Thai stays Thai, verbatim), at most about 2.5 words per second of "duration"; "" when nobody speaks. "speaker" is that character's number, null otherwise.
- "sound": English, ambient and physical sounds only, no music, no dialogue.`;
  return { system, user: `Cast:\n${castList(input.characters)}\n\nStory:\n${input.brief}` };
}

/** System + user message for an MV: the timing is fixed, the model writes the pictures. */
export function mvPlannerMessages(input: PlanInput, slots: TimelineSlot[]): { system: string; user: string } {
  const mood = MOODS[input.mood] ?? MOODS.romantic;
  const system = `You are a music video director. The song is already cut into ${slots.length} timed slots; write ONE shot for each, in order, for an AI video model that renders one shot at a time and knows nothing of the others.
Return ONLY JSON, no markdown: {"title": string, "shots": [{"characters": [numbers], "size": string, "camera": string, "visual": string}]} with exactly ${slots.length} shots.
Rules:
- Mood: ${mood.label} — ${mood.style}. Settings that fit: ${mood.setting}. Build a small visual story that follows the lyrics; repeat a chorus's look when the chorus returns.
- "characters": numbers from the cast of who is visible, the singer FIRST — their photo becomes the shot's first frame, so the shot opens on them facing the camera. Instrumental slots may show no one (scenery, details, the band).
- Sung slots: the singer performs the line (singing with emotion, mouth moving), in a tight size (medium, medium-close, close) with a calm camera.
- "size" one of: ${SIZE_KEYS}. "camera" one of: ${MOVE_KEYS}. Never "push-in" on a wide or full shot that opens on a character.
- "visual": English, 30–70 words, self-contained: setting, each visible character by name with their look, action, lighting. No text on screen.`;
  const list = slots
    .map((s, k) => `${k + 1}. ${s.start.toFixed(1)}s +${s.duration.toFixed(1)}s [${s.section}] ${s.instrumental ? '(instrumental)' : s.line}`)
    .join('\n');
  return { system, user: `Cast:\n${castList(input.characters)}\n\nSlots:\n${list}` };
}

/** The first JSON object in a chat answer, or null. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

type RawShot = Record<string, unknown>;

function castIds(raw: unknown, chars: CharacterLite[]): number[] {
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  for (const n of raw) {
    const c = chars[Number(n) - 1];
    if (c && !ids.includes(c.id)) ids.push(c.id);
  }
  return ids;
}

/** A film storyboard from the model's answer, every field checked; null when unusable. */
export function parseFilmPlan(text: string, input: PlanInput): { title: string; shots: ShotDraft[] } | null {
  const data = extractJson(text) as { title?: unknown; shots?: unknown } | null;
  if (!data || !Array.isArray(data.shots) || data.shots.length === 0) return null;
  const shots: ShotDraft[] = (data.shots as RawShot[]).slice(0, LIMITS.shotsFilm).flatMap((s) => {
    const visual = clip(s.visual, LIMITS.visual);
    if (!visual) return [];
    const characterIds = castIds(s.characters, input.characters);
    const shotSize = pickKey(s.size, SHOT_SIZES, 'medium');
    const line = clip(s.line, LIMITS.line);
    const speaker = input.characters[Number(s.speaker) - 1];
    return [{
      characterIds,
      speakerId: line && speaker ? speaker.id : null,
      shotSize,
      camera: safeCamera(shotSize, pickKey(s.camera, CAMERA_MOVES, 'static'), characterIds.length > 0),
      durationSec: clampSeconds(s.duration, line ? 8 : 5),
      startSec: null,
      visual,
      line,
      sound: clip(s.sound, LIMITS.sound),
    }];
  });
  return shots.length ? { title: clip(data.title, LIMITS.title), shots } : null;
}

/** An MV storyboard: the model's pictures on our timing. Null when it did not answer for every slot. */
export function parseMvPlan(text: string, input: PlanInput, slots: TimelineSlot[]): { title: string; shots: ShotDraft[] } | null {
  const data = extractJson(text) as { title?: unknown; shots?: unknown } | null;
  if (!data || !Array.isArray(data.shots) || data.shots.length < slots.length) return null;
  const raw = data.shots as RawShot[];
  const shots: ShotDraft[] = [];
  for (let k = 0; k < slots.length; k++) {
    const s = raw[k] ?? {};
    const visual = clip(s.visual, LIMITS.visual);
    if (!visual) return null;
    const characterIds = castIds(s.characters, input.characters);
    const shotSize = pickKey(s.size, SHOT_SIZES, 'medium');
    shots.push({
      characterIds,
      speakerId: null,
      shotSize,
      camera: safeCamera(shotSize, pickKey(s.camera, CAMERA_MOVES, 'static'), characterIds.length > 0),
      durationSec: slots[k].duration,
      startSec: slots[k].start,
      visual,
      line: slots[k].line,
      sound: '',
    });
  }
  return { title: clip(data.title, LIMITS.title), shots };
}

// ---------------------------------------------------------------------------
// One shot → the prompt its model reads
// ---------------------------------------------------------------------------

export interface PromptContext {
  mode: StoryMode;
  look: string;
  mood: string;
  characters: CharacterLite[];
  /** The shot opens on its first character's picture. */
  hasFirstFrame: boolean;
}

const NO_TEXT = 'No subtitles, no captions, no on-screen text, no watermark.';

export function buildShotPrompt(modelKey: string, shot: ShotDraft, ctx: PromptContext): string {
  const style = ctx.mode === 'mv' ? MOODS[ctx.mood] ?? MOODS.romantic : LOOKS[ctx.look] ?? LOOKS.film;
  const cast = shot.characterIds.map((id) => ctx.characters.find((c) => c.id === id)).filter((c): c is CharacterLite => Boolean(c));
  const size = SHOT_SIZES[shot.shotSize] ?? SHOT_SIZES.medium;
  const move = CAMERA_MOVES[safeCamera(shot.shotSize, shot.camera, ctx.hasFirstFrame)] ?? CAMERA_MOVES.static;
  const speaker = shot.speakerId !== null ? ctx.characters.find((c) => c.id === shot.speakerId) : undefined;
  const who = cast.length ? `${characterLine(cast)}. ` : '';
  const opening = ctx.hasFirstFrame && cast[0] ? `The shot opens on ${cast[0].name} exactly as in the first frame, keeping the same face, hair and clothes. ` : '';
  const line = shot.line.trim();

  if (modelKey === 'minimax-h3') {
    let body = `[Shot 1] ${style.style}, ${size.en} frames the scene. ${opening}${who}${shot.visual} ${move.en}`;
    if (ctx.mode === 'film' && line) {
      const voice = speaker ? `${speaker.name} (S1), ${speaker.description},` : 'A narrator (S1)';
      body += ` ${voice} says: <d>[Thai] ${line}</d>`;
    } else if (ctx.mode === 'mv' && line) {
      body += ' The singer mouths the lyrics with emotion; no spoken dialogue.';
    }
    const soundscape = ctx.mode === 'mv' ? 'N/A' : shot.sound.trim() || 'Natural ambient sound that matches the scene.';
    return `integrated_multimodal_description: ${body}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${style.music}`;
  }

  // LTX-2.5 and anything else: one paragraph, speech in quotes.
  let text = `${style.style}. ${capital(size.en)}. ${opening}${who}${shot.visual} ${move.en}`;
  if (ctx.mode === 'film' && line) {
    const voice = speaker ? `${speaker.name}` : 'A narrator off screen';
    text += ` ${voice} speaks Thai in a natural voice, lips synced to every word, saying: "${line}"`;
    text += shot.sound.trim() ? ` Sound: ${shot.sound.trim()}` : '';
  } else if (ctx.mode === 'mv') {
    text += line ? ' The singer sings along with emotion. No speech.' : ' No speech.';
  } else if (shot.sound.trim()) {
    text += ` Sound: ${shot.sound.trim()}`;
  }
  return `${text.trim()} ${NO_TEXT}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
