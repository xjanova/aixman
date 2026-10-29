/**
 * Suno, as the music tab sells it: songs, covers, extensions, vocals or a band
 * added to a track, stems, and short sounds — seven tools, each its own row in
 * the KIE catalogue (kie-catalog.ts), all built here.
 *
 * Field names and limits are from docs.kie.ai/suno-api (2026-10-29):
 * - only V6, V6_MINI and V6_WILD are current (V4 … V5_5 are discontinued) and
 *   all three cost the same, so the version is a free choice of the customer;
 * - `vocal_gender`, the three weights, `variety` and `duration` are custom-mode
 *   fields — a song in simple mode (the model writes the words) must not carry
 *   them, and simple mode needs `style` or `lyrics`, not a bare `prompt`;
 * - a cover or an extension starts from a track of at most 8 minutes, a stem
 *   split from a file of at most 20 MB;
 * - with `instrumental` on, `lyrics`, `prompt` and `vocal_gender` must not be sent.
 *
 * Every input goes as a URL (`upload_url` / `audio_url`): our own R2 copy of
 * an upload or of a song made here. KIE's `task_id` + `audio_id` route would
 * tie an order to the vendor's 14-day files and their ids.
 *
 * Pure, so the studio can import the labels and limits it shows.
 */
import type { KiePriceTier } from './kie-pricing';

export type SunoTool = 'song' | 'cover' | 'extend' | 'add-vocals' | 'add-instrumental' | 'stems' | 'sounds';

/** The row each tool lives on: its subcategory gives the music tab's mode. */
export const SUNO_SUBCATEGORY: Record<SunoTool, string> = {
  song: 'music',
  cover: 'music-cover',
  extend: 'music-extend',
  'add-vocals': 'music-add',
  'add-instrumental': 'music-add',
  stems: 'music-stems',
  sounds: 'music-sounds',
};

/** The versions on sale, each a tier on the studio's chips. One price for all three. */
export const SUNO_VERSIONS: KiePriceTier[] = [
  { id: 'V6', label: 'V6', isDefault: true, description: 'เสียงร้องเป็นธรรมชาติ รายละเอียดดนตรีครบที่สุด' },
  { id: 'V6_WILD', label: 'V6 Wild', description: 'กล้าแหวก ฉีกแนว ได้สีสันที่ไม่ซ้ำใคร' },
  { id: 'V6_MINI', label: 'V6 Mini', description: 'เบาและเร็ว เหมาะลองไอเดียหลาย ๆ รอบ' },
];

/** Stem splits, each a tier: what comes back and what it costs differ. */
export const SUNO_STEM_TIERS: KiePriceTier[] = [
  { id: 'vocals', label: 'เสียงร้อง + ดนตรี', isDefault: true, description: 'แยกเป็น 2 ไฟล์: เสียงร้องล้วน และดนตรีไม่มีเสียงร้อง (คาราโอเกะ)' },
  { id: 'all', label: 'ครบทุกชิ้น', description: 'แยกได้สูงสุด 12 ไฟล์: ร้องนำ ประสาน กลอง เบส กีตาร์ คีย์บอร์ด เครื่องสาย ฯลฯ — ได้เฉพาะชิ้นที่มีในเพลง' },
  { id: 'one', label: 'ดึงชิ้นเดียว', description: 'เลือกเครื่องดนตรีหนึ่งชิ้น ได้ 2 ไฟล์: ชิ้นนั้นล้วน และเพลงที่ไม่มีชิ้นนั้น' },
];

const STEM_TYPE: Record<string, string> = { vocals: 'separate_vocal', all: 'split_stem', one: 'split_stem_advanced' };

/** What "ดึงชิ้นเดียว" may pull out: a curated part of KIE's `stem_name` list, in its own spelling. */
export const SUNO_STEMS: { id: string; label: string }[] = [
  { id: 'Lead Vocal', label: 'เสียงร้องนำ' },
  { id: 'Backing Vocals', label: 'เสียงประสาน' },
  { id: 'Choir', label: 'คอรัส' },
  { id: 'Drum Kit', label: 'กลองชุด' },
  { id: 'Kick', label: 'กระเดื่อง' },
  { id: 'Snare', label: 'สแนร์' },
  { id: 'Percussion', label: 'เครื่องเคาะ' },
  { id: 'Bass', label: 'เบส' },
  { id: 'Guitar', label: 'กีตาร์' },
  { id: 'Acoustic Guitar', label: 'กีตาร์โปร่ง' },
  { id: 'Electric Guitar', label: 'กีตาร์ไฟฟ้า' },
  { id: 'Piano', label: 'เปียโน' },
  { id: 'Keyboards', label: 'คีย์บอร์ด' },
  { id: 'Organ', label: 'ออร์แกน' },
  { id: 'Synth', label: 'ซินธ์' },
  { id: 'Synth Pad', label: 'ซินธ์แพด' },
  { id: 'String Section', label: 'เครื่องสาย' },
  { id: 'Violin', label: 'ไวโอลิน' },
  { id: 'Brass Section', label: 'เครื่องทองเหลือง' },
  { id: 'Tenor Saxophone', label: 'แซกโซโฟน' },
  { id: 'Flute', label: 'ฟลุต' },
  { id: 'Sound Effects', label: 'เอฟเฟกต์เสียง' },
];

/** The keys a sound may be in (`sound_key`); 'Any' lets the model choose. */
export const SUNO_KEYS = [
  'Any', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm',
] as const;

/** `variety`, 0–4, as the studio names each step. */
export const SUNO_VARIETY = ['ตรงสไตล์', 'ปกติ', 'หลากหลาย', 'กล้าลอง', 'สุดทาง'] as const;

/** Songs the model may be asked to make, in seconds (`duration`, V6 family, custom mode only). */
export const SUNO_LENGTH_MIN = 10;
export const SUNO_LENGTH_MAX = 360;

/** What a cover or an extension may start from: KIE's own limit. */
export const SUNO_SOURCE_MAX_SECONDS = 8 * 60;
/** What a stem split may start from (KIE: 20 MB). Our upload cap is lower; a song made here can be larger. */
export const SUNO_STEMS_MAX_BYTES = 20 * 1024 * 1024;

/** Which tools work on a track the customer brings. */
export function sunoTakesSource(tool: SunoTool): boolean {
  return tool !== 'song' && tool !== 'sounds';
}

/** Which tools sing or play from the style chips and the lyrics box. */
export function sunoSings(tool: SunoTool): boolean {
  return tool !== 'stems' && tool !== 'sounds';
}

/**
 * The customer's Suno choices, as stored on the order. Everything optional;
 * an absent field is the model's own default. Built only by `sanitizeSunoParams`.
 */
export interface SunoParams {
  title?: string;
  /** Styles to steer away from (`negative_tags`). */
  exclude?: string;
  /** 0–1, two decimals. */
  styleWeight?: number;
  weirdness?: number;
  audioWeight?: number;
  /** 0–4. */
  variety?: number;
  /** A song's target length, seconds. */
  length?: number;
  /** An extension's start, seconds into the source. */
  continueAt?: number;
  /** "ดึงชิ้นเดียว": one of `SUNO_STEMS`. */
  stem?: string;
  /** Sounds. */
  loop?: boolean;
  tempo?: number;
  key?: string;
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // Control characters out: these reach the vendor and are stored on the order.
  const t = v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]+/g, ' ').trim();
  return t ? t.slice(0, max) : undefined;
}

function unit(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

function whole(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.round(Math.min(max, Math.max(min, n)));
}

/**
 * Keep only the fields above, with values KIE accepts. `params.suno` comes
 * from a browser or the API and is stored with the order, so nothing else of
 * it survives, and a number out of range is clamped rather than sent (a 422
 * after the charge).
 */
export function sanitizeSunoParams(raw: unknown): SunoParams {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: SunoParams = {};
  const title = text(r.title, 80);
  if (title) out.title = title;
  const exclude = text(r.exclude, 500);
  if (exclude) out.exclude = exclude;
  const styleWeight = unit(r.styleWeight);
  if (styleWeight !== undefined) out.styleWeight = styleWeight;
  const weirdness = unit(r.weirdness);
  if (weirdness !== undefined) out.weirdness = weirdness;
  const audioWeight = unit(r.audioWeight);
  if (audioWeight !== undefined) out.audioWeight = audioWeight;
  const variety = whole(r.variety, 0, 4);
  if (variety !== undefined) out.variety = variety;
  const length = whole(r.length, SUNO_LENGTH_MIN, SUNO_LENGTH_MAX);
  if (length !== undefined) out.length = length;
  const continueAt = typeof r.continueAt === 'number' || typeof r.continueAt === 'string' ? Number(r.continueAt) : NaN;
  if (Number.isFinite(continueAt) && continueAt > 0) out.continueAt = Math.round(Math.min(continueAt, SUNO_SOURCE_MAX_SECONDS) * 10) / 10;
  if (typeof r.stem === 'string' && SUNO_STEMS.some((s) => s.id === r.stem)) out.stem = r.stem;
  if (r.loop === true) out.loop = true;
  const tempo = whole(r.tempo, 1, 300);
  if (tempo !== undefined) out.tempo = tempo;
  if (typeof r.key === 'string' && (SUNO_KEYS as readonly string[]).includes(r.key) && r.key !== 'Any') out.key = r.key;
  return out;
}

/** `vocal_gender` from the music tab's singer chip; a duet, a group or a choir has none. */
export function sunoVocalGender(vocal: unknown): 'm' | 'f' | undefined {
  return vocal === 'male' ? 'm' : vocal === 'female' ? 'f' : undefined;
}

/** A track the order works on, as GenerationService measured it. */
export interface SunoSourceFacts {
  seconds: number;
  bytes: number;
}

export type SunoSourceCheck =
  | { ok: true; continueAt?: number }
  | { ok: false; code: string; message: string };

const minutes = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Whether the track fits the tool, read from the stored file before charging
 * — KIE refuses a long one after it has taken the order. An extension also
 * gets its start fixed here: inside the track, else a second before its end.
 */
export function checkSunoSource(tool: SunoTool, facts: SunoSourceFacts, params: SunoParams): SunoSourceCheck {
  if (!sunoTakesSource(tool)) return { ok: true };
  if (!(facts.seconds > 0)) {
    return { ok: false, code: 'voice-unreadable', message: 'อ่านความยาวของเพลงไม่ได้ กรุณาใช้ไฟล์ MP3, WAV หรือ M4A' };
  }
  if (tool === 'stems') {
    if (facts.bytes > SUNO_STEMS_MAX_BYTES) {
      return { ok: false, code: 'song-too-large', message: 'ไฟล์เพลงใหญ่เกิน 20 MB — แปลงเป็น MP3 หรือเลือกช่วงให้สั้นลงก่อน' };
    }
    if (facts.seconds > SUNO_SOURCE_MAX_SECONDS) {
      return { ok: false, code: 'song-too-long', message: `เพลงยาว ${minutes(facts.seconds)} นาที — แยกสเต็มได้ครั้งละไม่เกิน 8 นาที` };
    }
    return { ok: true };
  }
  if (facts.seconds > SUNO_SOURCE_MAX_SECONDS) {
    return { ok: false, code: 'song-too-long', message: `เพลงต้นฉบับยาว ${minutes(facts.seconds)} นาที — ใช้ได้ไม่เกิน 8 นาที เลือกช่วงให้สั้นลงก่อน` };
  }
  if (tool === 'extend') {
    if (facts.seconds < 2) return { ok: false, code: 'song-too-short', message: 'เพลงต้นฉบับสั้นเกินไปที่จะต่อ' };
    const end = Math.max(1, Math.floor(facts.seconds) - 1);
    const wanted = params.continueAt;
    const continueAt = wanted !== undefined && wanted > 0 && wanted < facts.seconds ? wanted : end;
    return { ok: true, continueAt };
  }
  return { ok: true };
}

/** What a Suno tool is built from: the adapter's order, narrowed to what Suno reads. */
export interface SunoOrder {
  /** The style line: the customer's description with the music chips composed in. */
  style: string;
  /** The description alone, for a title when none was given. */
  prompt: string;
  lyrics?: string;
  instrumental: boolean;
  vocalGender?: 'm' | 'f';
  /** The negative prompt box, if the studio sent one. */
  negativePrompt?: string;
  /** The track an order works on, already a URL KIE can fetch. */
  audio?: string;
  /** The tier priced: a version (`V6` …) for every tool but stems, where it is the split. */
  tier: string;
  suno: SunoParams;
}

export interface SunoTask {
  model: string;
  input: Record<string, unknown>;
}

/** Drop undefined, null and empty strings: KIE validates what is present. */
function clean(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

function titleOf(o: SunoOrder, max: number): string {
  const first = o.prompt.split(/[\n,.;]/)[0]?.trim() ?? '';
  return cut(o.suno.title ?? (first || 'X-DREAMER'), max);
}

function excludeOf(o: SunoOrder): string | undefined {
  const parts = [o.suno.exclude, o.negativePrompt?.trim()].filter((p): p is string => !!p);
  return parts.length ? cut(parts.join(', '), 500) : undefined;
}

/** The fine-tuning every custom-mode tool takes. `audio_weight` only where there is a voice. */
function tuning(o: SunoOrder): Record<string, unknown> {
  return {
    style_weight: o.suno.styleWeight,
    weirdness_constraint: o.suno.weirdness,
    audio_weight: o.instrumental ? undefined : o.suno.audioWeight,
    variety: o.suno.variety,
  };
}

/** The words to sing, or none: an instrumental sends neither lyrics nor a voice. */
function voiceOf(o: SunoOrder): { lyrics?: string; vocal_gender?: 'm' | 'f' } {
  if (o.instrumental) return {};
  const lyrics = (o.lyrics ?? '').trim();
  return { lyrics: lyrics ? cut(lyrics, 5000) : undefined, vocal_gender: o.vocalGender };
}

/** The style line, never empty where KIE requires one. */
function styleOf(o: SunoOrder, fallback: string): string {
  return cut(o.style.trim() || fallback, 1000);
}

/** The task one order becomes. */
export function buildSunoTask(tool: SunoTool, o: SunoOrder): SunoTask {
  switch (tool) {
    case 'song': {
      const voice = voiceOf(o);
      // Custom mode sings the given words (or plays, for an instrumental) and
      // takes every fine-tuning field; without words the simple mode writes
      // them, from the style and the description, and takes none of them.
      if (voice.lyrics || o.instrumental) {
        return {
          model: 'ai-music-api/generate',
          input: clean({
            custom_mode: true,
            instrumental: o.instrumental,
            model: o.tier,
            title: titleOf(o, 80),
            style: styleOf(o, 'pop'),
            ...voice,
            negative_tags: excludeOf(o),
            duration: o.suno.length,
            ...tuning(o),
          }),
        };
      }
      return {
        model: 'ai-music-api/generate',
        input: clean({
          custom_mode: false,
          instrumental: false,
          model: o.tier,
          // Simple mode refuses a bare prompt: the style line is what it needs.
          style: styleOf(o, 'pop'),
          prompt: o.prompt.trim() ? cut(o.prompt.trim(), 3000) : undefined,
          negative_tags: excludeOf(o),
        }),
      };
    }
    case 'cover':
      return {
        model: 'ai-music-api/upload-and-cover-audio',
        input: clean({
          upload_url: o.audio,
          instrumental: o.instrumental,
          model: o.tier,
          title: titleOf(o, 80),
          style: o.style.trim() ? cut(o.style.trim(), 1000) : undefined,
          ...voiceOf(o),
          negative_tags: excludeOf(o),
          ...tuning(o),
        }),
      };
    case 'extend':
      return {
        model: 'ai-music-api/upload-and-extend-audio',
        input: clean({
          upload_url: o.audio,
          model: o.tier,
          continue_at: o.suno.continueAt,
          instrumental: o.instrumental,
          title: titleOf(o, 100),
          style: o.style.trim() ? cut(o.style.trim(), 1000) : undefined,
          ...voiceOf(o),
          negative_tags: excludeOf(o),
          ...tuning(o),
        }),
      };
    case 'add-vocals':
      return {
        model: 'ai-music-api/add-vocals',
        input: clean({
          upload_url: o.audio,
          model: o.tier,
          title: titleOf(o, 80),
          // All three are required here: a style, and something to avoid.
          style: styleOf(o, 'pop vocal'),
          negative_tags: excludeOf(o) ?? 'off-key, distorted vocals',
          ...voiceOf({ ...o, instrumental: false }),
          ...tuning({ ...o, instrumental: false }),
        }),
      };
    case 'add-instrumental':
      return {
        model: 'ai-music-api/add-instrumental',
        input: clean({
          upload_url: o.audio,
          model: o.tier,
          title: titleOf(o, 80),
          tags: styleOf(o, 'pop band'),
          negative_tags: excludeOf(o) ?? 'noise, distortion',
          vocal_gender: o.vocalGender,
          ...tuning({ ...o, instrumental: false }),
        }),
      };
    case 'stems':
      return {
        model: 'ai-music-api/separate-vocals',
        input: clean({
          audio_url: o.audio,
          type: STEM_TYPE[o.tier] ?? 'separate_vocal',
          stem_name: o.tier === 'one' ? o.suno.stem ?? SUNO_STEMS[0].id : undefined,
        }),
      };
    case 'sounds':
      return {
        model: 'ai-music-api/sounds',
        input: clean({
          prompt: cut((o.prompt.trim() || o.style.trim() || 'ambient texture'), 500),
          model: o.tier,
          sound_loop: o.suno.loop === true ? true : undefined,
          sound_tempo: o.suno.tempo,
          sound_key: o.suno.key,
        }),
      };
  }
}

/** KIE's stem names (`stem_type_group_name`, file suffixes), in Thai. */
const STEM_LABELS: Record<string, string> = {
  vocals: 'เสียงร้อง',
  instrumental: 'ดนตรี (ไม่มีเสียงร้อง)',
  backing_vocals: 'เสียงประสาน',
  drums: 'กลอง',
  bass: 'เบส',
  guitar: 'กีตาร์',
  keyboard: 'คีย์บอร์ด',
  percussion: 'เครื่องเคาะ',
  strings: 'เครื่องสาย',
  synth: 'ซินธ์',
  fx: 'เอฟเฟกต์',
  brass: 'เครื่องทองเหลือง',
  woodwinds: 'เครื่องเป่าลมไม้',
  ...Object.fromEntries(SUNO_STEMS.map((s) => [s.id.toLowerCase().replace(/[\s-]+/g, '_'), s.label])),
};

function stemLabel(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STEM_LABELS[key] ?? name.trim().replace(/_/g, ' ');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A name for each file a stem split returned, in the order of `urls`. From
 * `resultObject.origin_data` when KIE sends it (an "ดึงชิ้นเดียว" split comes
 * back as an extract and a remove of the same stem, so the file name alone
 * cannot tell them apart), else from the file name's suffix (`…_Vocals.mp3`).
 * Read before the files are copied to R2 under random names.
 */
export function sunoStemLabels(resultJson: unknown, urls: string[]): string[] {
  const byUrl = new Map<string, string>();
  const root = isRecord(resultJson) ? resultJson : {};
  const object = isRecord(root.resultObject) ? root.resultObject : root;
  const origin = Array.isArray(object.origin_data) ? object.origin_data : [];
  for (const item of origin) {
    if (!isRecord(item)) continue;
    if (typeof item.audio_url === 'string') {
      const label = stemLabel(item.stem_type_group_name);
      if (label) byUrl.set(item.audio_url, label);
    }
    const extract = isRecord(item.extract) ? item.extract : null;
    const remove = isRecord(item.remove) ? item.remove : null;
    const label = stemLabel(extract?.stem_type_group_name ?? remove?.stem_type_group_name);
    if (label && typeof extract?.audio_url === 'string') byUrl.set(extract.audio_url, label);
    if (label && typeof remove?.audio_url === 'string') byUrl.set(remove.audio_url, `เพลงที่ไม่มี${label}`);
  }
  return urls.map((url, i) => {
    const known = byUrl.get(url);
    if (known) return known;
    let path = url;
    try {
      path = decodeURIComponent(new URL(url).pathname);
    } catch {
      /* keep the raw string */
    }
    const suffix = /_([A-Za-z][A-Za-z _-]*)\.(?:mp3|wav|flac|m4a)$/i.exec(path)?.[1];
    return stemLabel(suffix) ?? `สเต็ม ${i + 1}`;
  });
}

/** What the order button says when a tool that works on a track has none. */
export function sunoMissingSource(tool: SunoTool): string {
  switch (tool) {
    case 'cover':
      return 'ต้องอัปโหลดเพลงต้นฉบับที่จะคัฟเวอร์ก่อน';
    case 'extend':
      return 'ต้องอัปโหลดเพลงที่จะต่อก่อน';
    case 'add-vocals':
      return 'ต้องอัปโหลดดนตรีบรรเลงที่จะใส่เสียงร้องก่อน';
    case 'add-instrumental':
      return 'ต้องอัปโหลดเสียงร้องที่จะใส่ดนตรีก่อน';
    case 'stems':
      return 'ต้องอัปโหลดเพลงที่จะแยกสเต็มก่อน';
    default:
      return 'ต้องอัปโหลดเพลงก่อน';
  }
}

/** What the music tab needs to draw a Suno tool (`/api/models` → `music`). */
export function sunoStudioOptions(tool: SunoTool) {
  const source = sunoTakesSource(tool);
  return {
    // Words to sing: not for a voice that already sings, a split or a sound.
    lyrics: sunoSings(tool) && tool !== 'add-instrumental',
    sourceSong: source,
    maxDuration: null,
    autoLength: true,
    maxSourceSeconds: source ? SUNO_SOURCE_MAX_SECONDS : null,
    controls: sunoSings(tool),
    suno: {
      tool,
      /** Whether "เพลงบรรเลง" means anything: not when vocals or a band are what is added. */
      instrumental: tool === 'song' || tool === 'cover' || tool === 'extend',
      maxSourceBytes: tool === 'stems' ? SUNO_STEMS_MAX_BYTES : null,
      stems: tool === 'stems' ? SUNO_STEMS : null,
      keys: tool === 'sounds' ? [...SUNO_KEYS] : null,
    },
  };
}
