/**
 * The KIE.ai models AIXMAN sells, and how an order becomes a KIE task.
 *
 * KIE is one key for nearly every vendor (Google, OpenAI, ByteDance, Kling,
 * MiniMax, Suno …) behind one async API: `createTask {model, input}`, then
 * `recordInfo`. The owner made it the primary provider on 2026-10-29.
 *
 * Chosen from KIE's catalogue and price list of 2026-10-28: the newest model
 * of each family, and only where it is not dearer than a sibling that does the
 * same job. Left out on purpose (older versions, deprecated, poor value, or no
 * studio tab yet) — see the research note kept with the integration, and
 * `RETIRED_KIE_KEYS` below for rows this file used to define.
 *
 * Every entry says what it costs us (`usd`), what it takes (references,
 * frames, a voice), and builds the task's `input` from field names in KIE's
 * own docs (docs.kie.ai/market/...). A field a model does not document is
 * never sent: KIE answers 422 to unknown values.
 *
 * Pure: the sync, the adapter, GenerationService and `/api/models` read it.
 */
import type { LengthFromAudio } from '@/lib/voice-length';
import type { ClipRule } from '@/lib/lipsync-rules';
import { DEFAULT_KIE_BASIS, kieCredits, type KieBasis, type KiePriceTable, type KiePriceTier } from './kie-pricing';
import {
  SUNO_STEM_TIERS,
  SUNO_SUBCATEGORY,
  SUNO_VERSIONS,
  buildSunoTask,
  type SunoOrder,
  type SunoParams,
  type SunoTool,
} from './kie-suno';

export type KieCategory = 'image' | 'edit' | 'video' | 'audio';

/** An order as the adapter hands it to an entry: every URL already one KIE can fetch. */
export interface KieOrder {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  tier: string;
  /** The priced length (video) or the voice's length (portraits); null when not length-priced. */
  seconds: number | null;
  /** Reference pictures an image model composes from. */
  images: string[];
  /** The picture an edit works on, a clip's first frame, or a portrait's face. */
  image?: string;
  /** A clip's last frame. */
  lastFrame?: string;
  /** A portrait's or re-dub's voice. */
  audio?: string;
  /** The clip a re-dub works on. */
  video?: string;
  seed?: number;
  /** Music: the words to sing (none = the model writes them, or an instrumental). */
  lyrics?: string;
  /** Music: the composed style line (genre, voice, mood …). */
  musicTags?: string;
  instrumental?: boolean;
  /** Music: `vocal_gender` from the singer chip (Suno). */
  vocalGender?: 'm' | 'f';
  /** Suno: the customer's fine-tuning, already sanitised (kie-suno.ts). */
  suno?: SunoParams;
  /** Speech: the voice id, already one of the entry's own. */
  voice?: string;
  /** Speech: how to say it ("slow and warm"), where the model takes a style. */
  speechStyle?: string;
}

/** One voice a speech model offers, labelled for the studio's picker. */
export interface KieVoice {
  /** The vendor's id, sent as it is. */
  id: string;
  /** Thai, on the picker: who it sounds like. */
  label: string;
  gender: 'female' | 'male';
}

export interface KieSpeech {
  /** The first is the default. */
  voices: KieVoice[];
  /** Most characters one order may read. */
  maxChars: number;
  /** Takes a speaking-style line beside the text. */
  style?: boolean;
  /** Reads audio tags in square brackets in the text ([laughs], [whispers]). */
  tags?: boolean;
}

export interface KieTask {
  model: string;
  input: Record<string, unknown>;
}

export interface KieEntry {
  /** `ai_models.model_id`. Never renamed: orders and history point at it. */
  key: string;
  name: string;
  /** Thai, on the studio's model picker. */
  description: string;
  category: KieCategory;
  subcategory: string;
  featured?: boolean;
  /** Which order param picks the tier (the studio's quality or resolution chips). */
  tierParam: 'quality' | 'resolution' | null;
  tiers: KiePriceTier[];
  /** What KIE charges for one order at this tier and length — per second when `perSecond`. */
  usd: (tier: string, seconds: number) => number;
  /** Lengths offered, in seconds; absent = one price whatever the length. */
  durations?: number[];
  /** Priced per second of the uploaded voice. */
  perSecond?: boolean;
  /** What KIE charges per attached picture past `freeImages`. */
  imageUsd?: number;
  freeImages?: number;
  /** Reference pictures an image model takes (what `build` forwards). */
  references?: number;
  firstFrame?: boolean;
  lastFrame?: boolean;
  /** A portrait's render is as long as its voice. */
  lengthFromAudio?: LengthFromAudio;
  /** A song model: lyrics and the music tab's style chips. */
  music?: boolean;
  /** One of Suno's tools (kie-suno.ts): its mode on the music tab, its inputs and checks. */
  suno?: SunoTool;
  /** Priced per this many characters of the text read aloud (`usd(tier, n)` = n characters). */
  perChars?: number;
  /** A text-to-speech model: its voices and how much one order may read. */
  speech?: KieSpeech;
  /**
   * A clip the order works on (an upscale, a motion reference): checked
   * against the stored file before charging (lipsync-rules.ts checkClip) and
   * priced per second of it — the output is as long as the clip.
   */
  sourceClip?: ClipRule;
  /** The order needs a picture of its own besides the clip (motion control's character). */
  needsImage?: boolean;
  maxDuration?: number;
  /** How long the vendor may take before the order is failed and refunded. */
  maxWaitSeconds: number;
  build: (order: KieOrder) => KieTask;
}

const MIN = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ratioOf(aspect: string): number {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  return m ? Number(m[1]) / Number(m[2]) : NaN;
}

/**
 * The model's own aspect closest to the one ordered. The studio offers seven
 * shapes and no model takes exactly those seven; sending one a model does not
 * list is a 422 after the customer was charged.
 */
export function nearestAspect(wanted: string | undefined, allowed: readonly string[], fallback?: string): string {
  if (wanted && allowed.includes(wanted)) return wanted;
  const target = wanted ? ratioOf(wanted) : NaN;
  const numeric = allowed.filter((a) => Number.isFinite(ratioOf(a)));
  if (!Number.isFinite(target) || numeric.length === 0) return fallback ?? allowed[0];
  return numeric.reduce((best, a) =>
    Math.abs(Math.log(ratioOf(a) / target)) < Math.abs(Math.log(ratioOf(best) / target)) ? a : best
  );
}

/** Drop undefined, null, empty strings and empty arrays: KIE validates what is present. */
function clean(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** A KIE order as Suno's builders read it. */
function sunoOrder(o: KieOrder): SunoOrder {
  return {
    style: o.musicTags ?? o.prompt,
    prompt: o.prompt,
    lyrics: o.lyrics,
    instrumental: o.instrumental === true,
    vocalGender: o.vocalGender,
    negativePrompt: o.negativePrompt,
    audio: o.audio,
    tier: o.tier,
    suno: o.suno ?? {},
  };
}

/** A tier list from ids; the first given as default unless one is named. */
function tiers(ids: [string, string][], defaultId?: string): KiePriceTier[] {
  return ids.map(([id, label], i) => ({ id, label, isDefault: defaultId ? id === defaultId : i === 0 }));
}

/** A price per tier (one number per tier, whatever the length). */
const flat = (prices: Record<string, number>) => (tier: string) => prices[tier] ?? Math.max(...Object.values(prices));
/** A price per second per tier, times the length. */
const perSecond = (prices: Record<string, number>) => (tier: string, seconds: number) =>
  (prices[tier] ?? Math.max(...Object.values(prices))) * Math.max(1, seconds);

const IMAGE_K: [string, string][] = [['1K', '1K'], ['2K', '2K'], ['4K', '4K']];
const MB = 1024 * 1024;
/** Thai script: ElevenLabs is told the language rather than left to guess it from a short line. */
const THAI = /[\u0E00-\u0E7F]/;
/** A price per character, quoted per thousand as vendors list it. */
const perThousandChars = (usd: number) => (_tier: string, chars: number) => (usd * chars) / 1000;

/**
 * ElevenLabs' preset voices, a curated set (docs.kie.ai lists 60+; previews at
 * static.aiquickdraw.com/elevenlabs/voice/<id>.mp3). V3 speaks Thai with all of them.
 */
const ELEVENLABS_VOICES: KieVoice[] = [
  { id: 'hpp4J3VqNfWAUOO0d1Us', label: 'Bella — หญิง สุภาพ อบอุ่น', gender: 'female' },
  { id: 'EkK5I93UQWFDigLMpZcX', label: 'James — ชาย ทุ้ม มีพลัง', gender: 'male' },
  { id: 'BZgkqPqms7Kj9ulSkVzn', label: 'Eve — หญิง สดใส ร่าเริง', gender: 'female' },
  { id: 'nPczCjzI2devNBz1zQrb', label: 'Brian — ชาย ทุ้มลึก นุ่มนวล', gender: 'male' },
  { id: '5l5f8iK3YPeGga21rQIX', label: 'Adeline — หญิง คุยเป็นกันเอง', gender: 'female' },
  { id: 'UgBBYS2sOqTuMpoF3BR0', label: 'Mark — ชาย พูดเป็นธรรมชาติ', gender: 'male' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', label: 'Laura — หญิง กระตือรือร้น', gender: 'female' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam — ชาย สไตล์ครีเอเตอร์', gender: 'male' },
  { id: 'kPzsL2i3teMYv0FxEYQ6', label: 'Brittney — หญิง วัยรุ่น สนุก', gender: 'female' },
  { id: 'DYkrAHD8iwork3YSUBbs', label: 'Tom — ชาย เล่าเรื่อง หนังสือเสียง', gender: 'male' },
  { id: '56AoDkrOh6qfVPDXZ7Pt', label: 'Cassidy — หญิง ชัดถ้อยชัดคำ', gender: 'female' },
  { id: 'x70vRnQBMBu4FAYhjJbO', label: 'Nathan — ชาย ดีเจวิทยุ', gender: 'male' },
  { id: 'Z3R5wn05IrDiVCyEkUrK', label: 'Arabella — หญิง ลึกลับ มีอารมณ์', gender: 'female' },
  { id: 'DGzg6RaUqxGRTHSBjfgF', label: 'Brock — ชาย ดุดัน หนักแน่น', gender: 'male' },
];

/** Gemini's prebuilt voices with the character Google gives each (ai.google.dev, speech generation). */
const GEMINI_VOICES: KieVoice[] = [
  { id: 'Kore', label: 'Kore — หญิง หนักแน่น มั่นใจ', gender: 'female' },
  { id: 'Charon', label: 'Charon — ชาย ให้ข้อมูล น่าเชื่อถือ', gender: 'male' },
  { id: 'Zephyr', label: 'Zephyr — หญิง สดใส', gender: 'female' },
  { id: 'Puck', label: 'Puck — ชาย ร่าเริง', gender: 'male' },
  { id: 'Sulafat', label: 'Sulafat — หญิง อบอุ่น', gender: 'female' },
  { id: 'Achird', label: 'Achird — ชาย เป็นมิตร', gender: 'male' },
  { id: 'Leda', label: 'Leda — หญิง วัยรุ่น', gender: 'female' },
  { id: 'Orus', label: 'Orus — ชาย หนักแน่น', gender: 'male' },
  { id: 'Aoede', label: 'Aoede — หญิง สบาย ๆ', gender: 'female' },
  { id: 'Fenrir', label: 'Fenrir — ชาย ตื่นเต้น', gender: 'male' },
  { id: 'Despina', label: 'Despina — หญิง นุ่มนวล', gender: 'female' },
  { id: 'Schedar', label: 'Schedar — ชาย สุขุม', gender: 'male' },
  { id: 'Achernar', label: 'Achernar — หญิง เสียงนุ่ม', gender: 'female' },
  { id: 'Algenib', label: 'Algenib — ชาย เสียงแหบ', gender: 'male' },
];
const STUDIO_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:2', '3:4', '2:3'] as const;

/** Someone speaking, when a portrait order came with no direction of its own. */
const PORTRAIT_PROMPT = 'a person speaking naturally to camera, subtle head movement';

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const KIE_CATALOG: KieEntry[] = [
  // ---------------------------------------------------------------- image
  {
    key: 'kie/nano-banana-2-1',
    name: 'Nano Banana 2.1',
    description: 'Google Gemini ภาพ — เข้าใจคำสั่งละเอียด ผสมภาพอ้างอิงได้ถึง 10 ภาพ คุ้มที่สุด',
    category: 'image',
    subcategory: 'general',
    featured: true,
    tierParam: 'quality',
    tiers: tiers(IMAGE_K),
    usd: flat({ '1K': 0.02, '2K': 0.03, '4K': 0.045 }),
    references: 10,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: 'nano-banana-2-1',
      input: clean({
        prompt: cut(o.prompt, 20000),
        image_input: o.images,
        aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], '1:1'),
        resolution: o.tier,
        output_format: 'png',
      }),
    }),
  },
  {
    key: 'kie/nano-banana-pro',
    name: 'Nano Banana Pro',
    description: 'Google Gemini 3 Pro Image — ตัวหนังสือในภาพคมชัด งานโฆษณา/อินโฟกราฟิก อ้างอิงได้ 8 ภาพ',
    category: 'image',
    subcategory: 'premium',
    featured: true,
    tierParam: 'quality',
    tiers: tiers(IMAGE_K),
    usd: flat({ '1K': 0.09, '2K': 0.09, '4K': 0.12 }),
    references: 8,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: 'nano-banana-pro',
      input: clean({
        prompt: cut(o.prompt, 20000),
        image_input: o.images,
        aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], '1:1'),
        resolution: o.tier,
        output_format: 'png',
      }),
    }),
  },
  {
    key: 'kie/gpt-image-2-5',
    name: 'GPT Image 2.5',
    description: 'OpenAI รุ่นล่าสุด — ทำตามคำสั่งแม่น แก้ภาพ/รวมภาพอ้างอิงได้ถึง 16 ภาพ',
    category: 'image',
    subcategory: 'premium',
    featured: true,
    tierParam: 'quality',
    tiers: tiers(IMAGE_K),
    usd: flat({ '1K': 0.03, '2K': 0.05, '4K': 0.08 }),
    references: 16,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: o.images.length > 0 ? 'gpt-image-2-5-flare-image-to-image' : 'gpt-image-2-5-flare-text-to-image',
      input: clean({
        prompt: cut(o.prompt, 20000),
        input_urls: o.images,
        aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'], '1:1'),
        resolution: o.tier,
      }),
    }),
  },
  {
    key: 'kie/seedream-5-pro',
    name: 'Seedream 5 Pro',
    description: 'ByteDance — ภาพสมจริงระดับสูง อ้างอิงได้ 10 ภาพ (ภาพอ้างอิงเกิน 1 ภาพคิดเพิ่มเล็กน้อย)',
    category: 'image',
    subcategory: 'premium',
    tierParam: 'quality',
    tiers: tiers([['basic', '1K'], ['high', '2K']]),
    usd: flat({ basic: 0.035, high: 0.07 }),
    imageUsd: 0.0025,
    freeImages: 1,
    references: 10,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: o.images.length > 0 ? 'seedream/5-pro-image-to-image' : 'seedream/5-pro-text-to-image',
      input: clean({
        prompt: cut(o.prompt, 5000),
        image_urls: o.images,
        aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], '1:1'),
        quality: o.tier,
        output_format: 'png',
      }),
    }),
  },
  {
    key: 'kie/seedream-5-flash',
    name: 'Seedream 5 Flash',
    description: 'ByteDance รุ่นเร็ว — 2K ราคาประหยัด อ้างอิงได้ 10 ภาพ',
    category: 'image',
    subcategory: 'fast',
    tierParam: null,
    tiers: tiers([['2K', '2K']]),
    usd: flat({ '2K': 0.0162 }),
    references: 10,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: o.images.length > 0 ? 'seedream/5-flash-image-to-image' : 'seedream/5-flash-text-to-image',
      input: clean({
        prompt: cut(o.prompt, 5000),
        image_urls: o.images,
        aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], '1:1'),
        size: '2K',
        output_format: 'png',
      }),
    }),
  },
  {
    key: 'kie/flux-3-klein',
    name: 'FLUX 3 Klein',
    description: 'Black Forest Labs — เร็วและถูกมาก ภาพคมถึง 4K อ้างอิงได้ 10 ภาพ',
    category: 'image',
    subcategory: 'fast',
    tierParam: 'quality',
    tiers: tiers(IMAGE_K),
    usd: flat({ '1K': 0.008, '2K': 0.0125, '4K': 0.0325 }),
    references: 10,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: o.images.length > 0 ? 'flux-3/klein-edit-image' : 'flux-3/klein-text-to-image',
      input: clean({
        prompt: cut(o.prompt, 5000),
        image_urls: o.images,
        aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21'], '1:1'),
        resolution: o.tier,
        output_format: 'png',
        num_images: 1,
        seed: o.seed,
      }),
    }),
  },
  {
    key: 'kie/flux-2-pro',
    name: 'FLUX 2 Pro',
    description: 'Black Forest Labs — ภาพถ่ายสมจริง สีและแสงแม่น อ้างอิงได้ 8 ภาพ',
    category: 'image',
    subcategory: 'general',
    tierParam: 'quality',
    tiers: tiers([['1K', '1K'], ['2K', '2K']]),
    usd: flat({ '1K': 0.025, '2K': 0.035 }),
    references: 8,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: o.images.length > 0 ? 'flux-2/pro-image-to-image' : 'flux-2/pro-text-to-image',
      input: clean({
        prompt: cut(o.prompt, 5000),
        input_urls: o.images,
        aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], '1:1'),
        resolution: o.tier,
      }),
    }),
  },
  {
    key: 'kie/ideogram-v3',
    name: 'Ideogram V3',
    description: 'เก่งเรื่องตัวอักษรในภาพ โลโก้ โปสเตอร์ — เลือกความเร็ว/คุณภาพได้',
    category: 'image',
    subcategory: 'design',
    tierParam: 'quality',
    tiers: tiers([['TURBO', 'เร็ว'], ['BALANCED', 'สมดุล'], ['QUALITY', 'คุณภาพสูง']], 'BALANCED'),
    usd: flat({ TURBO: 0.0175, BALANCED: 0.035, QUALITY: 0.05 }),
    references: 0,
    maxWaitSeconds: 10 * MIN,
    build: (o) => {
      const aspect = nearestAspect(o.aspectRatio, STUDIO_ASPECTS, '1:1');
      const size: Record<string, string> = {
        '1:1': 'square_hd', '16:9': 'landscape_16_9', '9:16': 'portrait_16_9',
        '4:3': 'landscape_4_3', '3:2': 'landscape_4_3', '3:4': 'portrait_4_3', '2:3': 'portrait_4_3',
      };
      return {
        model: 'ideogram/v3-text-to-image',
        input: clean({
          prompt: cut(o.prompt, 5000),
          rendering_speed: o.tier,
          style: 'AUTO',
          image_size: size[aspect] ?? 'square_hd',
          negative_prompt: o.negativePrompt ? cut(o.negativePrompt, 5000) : undefined,
          seed: o.seed,
        }),
      };
    },
  },
  {
    key: 'kie/qwen-image-3',
    name: 'Qwen Image 3.0',
    description: 'Alibaba — เข้าใจภาษาจีน/อังกฤษดี ตัวอักษรในภาพแม่น 2K อ้างอิงได้ 3 ภาพ',
    category: 'image',
    subcategory: 'general',
    tierParam: null,
    tiers: tiers([['2K', '2K']]),
    usd: flat({ '2K': 0.024 }),
    imageUsd: 0.0025,
    freeImages: 0,
    references: 3,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: o.images.length > 0 ? 'qwen3/image-to-image' : 'qwen3/text-to-image',
      input: clean({
        prompt: cut(o.prompt, 5000),
        image_urls: o.images,
        resolution: '2K',
        image_size: nearestAspect(o.aspectRatio, ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'], '1:1'),
        output_format: 'png',
        negative_prompt: o.negativePrompt ? cut(o.negativePrompt, 5000) : undefined,
        seed: o.seed,
      }),
    }),
  },
  {
    key: 'kie/grok-imagine-image-2',
    name: 'Grok Imagine Image 2.0',
    description: 'xAI — สไตล์จัดจ้าน สร้างเร็ว แก้ภาพจากภาพอ้างอิงได้ 5 ภาพ',
    category: 'image',
    subcategory: 'general',
    tierParam: null,
    tiers: tiers([['std', 'มาตรฐาน']]),
    usd: flat({ std: 0.02 }),
    references: 5,
    maxWaitSeconds: 10 * MIN,
    build: (o) => {
      const editing = o.images.length > 0;
      return {
        model: editing ? 'grok-imagine-image-2-0/image-edit' : 'grok-imagine-image-2-0/text-to-image',
        input: clean({
          prompt: cut(o.prompt, 8000),
          image_urls: o.images,
          aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '2:3', '3:2', '16:9', '9:16'], '1:1'),
        }),
      };
    },
  },
  {
    key: 'kie/z-image',
    name: 'Z-Image',
    description: 'Alibaba Tongyi — ถูกที่สุด เหมาะลองไอเดียเร็ว ๆ (ข้อความไม่เกิน 1,000 ตัวอักษร)',
    category: 'image',
    subcategory: 'fast',
    tierParam: null,
    tiers: tiers([['std', 'มาตรฐาน']]),
    usd: flat({ std: 0.004 }),
    references: 0,
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: 'z-image',
      input: clean({
        prompt: cut(o.prompt, 1000),
        aspect_ratio: nearestAspect(o.aspectRatio, ['1:1', '4:3', '3:4', '16:9', '9:16'], '1:1'),
      }),
    }),
  },

  // ----------------------------------------------------------------- edit
  {
    key: 'kie/nano-banana-2-1-edit',
    name: 'Nano Banana 2.1 แก้ภาพ',
    description: 'สั่งแก้ภาพด้วยคำพูด — เปลี่ยนชุด เปลี่ยนฉาก ลบ/เพิ่มของ',
    category: 'edit',
    subcategory: 'instruct',
    featured: true,
    tierParam: 'quality',
    tiers: tiers(IMAGE_K),
    usd: flat({ '1K': 0.02, '2K': 0.03, '4K': 0.045 }),
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: 'nano-banana-2-1',
      input: clean({
        prompt: cut(o.prompt, 20000),
        image_input: o.image ? [o.image] : [],
        aspect_ratio: 'auto',
        resolution: o.tier,
        output_format: 'png',
      }),
    }),
  },
  {
    key: 'kie/flux-3-klein-edit',
    name: 'FLUX 3 Klein แก้ภาพ',
    description: 'แก้ภาพด้วยคำสั่ง เร็วและถูก คงหน้าตาเดิมได้ดี',
    category: 'edit',
    subcategory: 'instruct',
    tierParam: 'quality',
    tiers: tiers(IMAGE_K),
    usd: flat({ '1K': 0.008, '2K': 0.0125, '4K': 0.0325 }),
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: 'flux-3/klein-edit-image',
      input: clean({
        prompt: cut(o.prompt, 5000),
        image_urls: o.image ? [o.image] : [],
        aspect_ratio: 'auto',
        resolution: o.tier,
        output_format: 'png',
        num_images: 1,
        seed: o.seed,
      }),
    }),
  },
  {
    key: 'kie/recraft-remove-background',
    name: 'ลบพื้นหลัง (Recraft)',
    description: 'ลบพื้นหลังเหลือแต่วัตถุ ได้ไฟล์ PNG โปร่งใส',
    category: 'edit',
    subcategory: 'background',
    featured: true,
    tierParam: null,
    tiers: tiers([['std', 'มาตรฐาน']]),
    usd: flat({ std: 0.005 }),
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({ model: 'recraft/remove-background', input: clean({ image: o.image }) }),
  },
  {
    key: 'kie/recraft-crisp-upscale',
    name: 'ขยายภาพคมชัด (Recraft Crisp)',
    description: 'ขยายภาพให้ใหญ่และคมขึ้นแบบรักษารายละเอียดเดิม ราคาถูกมาก',
    category: 'edit',
    subcategory: 'upscale',
    tierParam: null,
    tiers: tiers([['std', 'มาตรฐาน']]),
    usd: flat({ std: 0.0025 }),
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({ model: 'recraft/crisp-upscale', input: clean({ image: o.image }) }),
  },
  {
    key: 'kie/topaz-image-upscale',
    name: 'Topaz Upscale',
    description: 'ขยายภาพระดับมืออาชีพ 2 เท่าหรือ 4 เท่า',
    category: 'edit',
    subcategory: 'upscale',
    tierParam: 'quality',
    tiers: tiers([['2', '2 เท่า'], ['4', '4 เท่า']]),
    usd: flat({ '2': 0.05, '4': 0.1 }),
    maxWaitSeconds: 15 * MIN,
    build: (o) => ({ model: 'topaz/image-upscale', input: clean({ image_url: o.image, upscale_factor: o.tier }) }),
  },

  // ---------------------------------------------------------------- video
  {
    key: 'kie/kling-3',
    name: 'Kling 3.0',
    description: 'Kuaishou — การเคลื่อนไหวสมจริง มีเสียงในตัว ใส่ภาพแรก/ภาพสุดท้ายได้',
    category: 'video',
    subcategory: 'premium',
    featured: true,
    tierParam: 'resolution',
    tiers: tiers([['720p', '720p'], ['1080p', '1080p']]),
    // Always with its own sound: the native audio is what the model is for.
    usd: perSecond({ '720p': 0.1, '1080p': 0.135 }),
    durations: [5, 10, 15],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => ({
      model: 'kling-3.0/video',
      input: clean({
        prompt: cut(o.prompt, 2500),
        image_urls: [o.image, o.image ? o.lastFrame : undefined].filter((u): u is string => !!u),
        sound: true,
        duration: String(o.seconds ?? 5),
        // The output follows the first frame's shape when there is one.
        aspect_ratio: o.image ? undefined : nearestAspect(o.aspectRatio, ['16:9', '9:16', '1:1'], '16:9'),
        mode: o.tier === '1080p' ? 'pro' : 'std',
        multi_shots: false,
      }),
    }),
  },
  {
    key: 'kie/kling-4',
    name: 'Kling 4.0',
    description: 'Kuaishou รุ่นใหม่สุด — คุมภาพแรก/ภาพสุดท้ายแม่นยำ คลิปยาวถึง 15 วินาที',
    category: 'video',
    subcategory: 'premium',
    tierParam: 'resolution',
    tiers: tiers([['720p', '720p'], ['1080p', '1080p']]),
    usd: perSecond({ '720p': 0.1425, '1080p': 0.2125 }),
    durations: [5, 10, 15],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => ({
      model: 'kling-4.0/keyframe-to-video',
      input: clean({
        prompt: cut(o.prompt, 8000),
        duration: o.seconds ?? 5,
        resolution: o.tier,
        aspect_ratio: o.image ? undefined : nearestAspect(o.aspectRatio, ['16:9', '9:16', '1:1', '21:9'], '16:9'),
        first_frame_url: o.image,
        last_frame_url: o.image ? o.lastFrame : undefined,
      }),
    }),
  },
  {
    key: 'kie/veo-3-1-fast',
    name: 'Veo 3.1 Fast',
    description: 'Google — วิดีโอ 8 วินาทีพร้อมเสียงพูด/เสียงประกอบ เร็วและคุ้ม',
    category: 'video',
    subcategory: 'premium',
    featured: true,
    tierParam: 'resolution',
    tiers: tiers([['720p', '720p'], ['1080p', '1080p']]),
    usd: flat({ '720p': 0.3, '1080p': 0.325 }),
    durations: [8],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 8,
    maxWaitSeconds: 30 * MIN,
    build: (o) => veoTask(o, 'veo3_fast'),
  },
  {
    key: 'kie/veo-3-1-lite',
    name: 'Veo 3.1 Lite',
    description: 'Google รุ่นประหยัด — วิดีโอ 8 วินาทีพร้อมเสียง ราคาถูกที่สุดของ Veo',
    category: 'video',
    subcategory: 'general',
    tierParam: 'resolution',
    tiers: tiers([['720p', '720p'], ['1080p', '1080p']]),
    usd: flat({ '720p': 0.15, '1080p': 0.175 }),
    durations: [8],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 8,
    maxWaitSeconds: 30 * MIN,
    build: (o) => veoTask(o, 'veo3_lite'),
  },
  {
    key: 'kie/veo-3-1',
    name: 'Veo 3.1 Quality',
    description: 'Google รุ่นคุณภาพสูงสุด — งานโฆษณา/หนังสั้นระดับมืออาชีพ 8 วินาทีพร้อมเสียง',
    category: 'video',
    subcategory: 'premium',
    tierParam: 'resolution',
    tiers: tiers([['720p', '720p'], ['1080p', '1080p']]),
    usd: flat({ '720p': 1.25, '1080p': 1.275 }),
    durations: [8],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 8,
    maxWaitSeconds: 30 * MIN,
    build: (o) => veoTask(o, 'veo3'),
  },
  {
    key: 'kie/seedance-2-fast',
    name: 'Seedance 2 Fast',
    description: 'ByteDance — วิดีโอมีเสียงในตัว เร็วและราคาดี ใส่ภาพแรก/ภาพสุดท้ายได้',
    category: 'video',
    subcategory: 'general',
    tierParam: 'resolution',
    tiers: tiers([['480p', '480p'], ['720p', '720p']], '720p'),
    usd: perSecond({ '480p': 0.059, '720p': 0.124 }),
    durations: [5, 10, 15],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => seedanceTask('bytedance/seedance-2-fast', o, 20000),
  },
  {
    key: 'kie/seedance-2-mini',
    name: 'Seedance 2 Mini',
    description: 'ByteDance รุ่นประหยัด — วิดีโอมีเสียงในราคาถูกมาก',
    category: 'video',
    subcategory: 'fast',
    tierParam: 'resolution',
    tiers: tiers([['480p', '480p'], ['720p', '720p']], '720p'),
    usd: perSecond({ '480p': 0.019, '720p': 0.041 }),
    durations: [5, 10, 15],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => seedanceTask('bytedance/seedance-2-mini', o, 20000),
  },
  {
    key: 'kie/seedance-2-5',
    name: 'Seedance 2.5',
    description: 'ByteDance รุ่นท็อป — ภาพยนตร์คุณภาพสูง เสียงในตัว ถึง 1080p',
    category: 'video',
    subcategory: 'premium',
    tierParam: 'resolution',
    tiers: tiers([['480p', '480p'], ['720p', '720p'], ['1080p', '1080p']], '720p'),
    usd: perSecond({ '480p': 0.14, '720p': 0.315, '1080p': 0.79 }),
    durations: [5, 10, 15],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => seedanceTask('bytedance/seedance-2-5', o, 20480),
  },
  {
    key: 'kie/minimax-h3',
    // Customers see this name: never the vendor's, never how we serve it (public-provider.ts).
    name: 'MiniMax H3 Express',
    description: 'MiniMax H3 เริ่มสร้างทันทีไม่ต้องรอคิว ใส่ภาพแรก/ภาพสุดท้ายได้ ถึง 2K',
    category: 'video',
    subcategory: 'general',
    tierParam: 'resolution',
    tiers: tiers([['768P', '768p'], ['2K', '2K']]),
    usd: perSecond({ '768P': 0.04, '2K': 0.065 }),
    // Each frame picture is billed on top ("image input").
    imageUsd: 0.02,
    freeImages: 0,
    durations: [5, 10, 15],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => {
      const frames = !!o.image;
      return {
        model: frames ? 'minimax-h3/image-to-video' : 'minimax-h3/text-to-video',
        input: clean({
          prompt: cut(o.prompt, 7000),
          first_frame_url: o.image,
          last_frame_url: frames ? o.lastFrame : undefined,
          // Required for text-to-video; a frame sets the shape otherwise.
          aspect_ratio: frames ? undefined : nearestAspect(o.aspectRatio, ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], '16:9'),
          duration: o.seconds ?? 5,
          resolution: o.tier,
        }),
      };
    },
  },
  {
    key: 'kie/wan-3',
    name: 'Wan 3.0',
    description: 'Alibaba — วิดีโอพร้อมเสียง คุมภาพแรก/สุดท้ายได้ ราคาคุ้ม',
    category: 'video',
    subcategory: 'general',
    tierParam: 'resolution',
    tiers: tiers([['480P', '480p'], ['720P', '720p'], ['1080P', '1080p']], '720P'),
    usd: perSecond({ '480P': 0.04, '720P': 0.08, '1080P': 0.16 }),
    durations: [5, 10, 15],
    firstFrame: true,
    lastFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => ({
      model: 'wan/3-0-video',
      input: clean({
        prompt: cut(o.prompt, 20000),
        first_frame_url: o.image,
        last_frame_url: o.image ? o.lastFrame : undefined,
        resolution: o.tier,
        aspect_ratio: o.image ? 'adaptive' : nearestAspect(o.aspectRatio, ['16:9', '4:3', '1:1', '3:4', '9:16'], '16:9'),
        duration: o.seconds ?? 5,
        audio: true,
        seed: o.seed,
      }),
    }),
  },
  {
    key: 'kie/grok-imagine-video',
    name: 'Grok Imagine Video',
    description: 'xAI — วิดีโอสนุก สีจัด ราคาถูก ใส่ภาพแรกได้',
    category: 'video',
    subcategory: 'fast',
    tierParam: 'resolution',
    tiers: tiers([['480p', '480p'], ['720p', '720p'], ['1080p', '1080p']], '720p'),
    usd: perSecond({ '480p': 0.012, '720p': 0.0225, '1080p': 0.04 }),
    durations: [6, 10, 15],
    firstFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) =>
      o.image
        ? {
            model: 'grok-imagine/image-to-video',
            input: clean({
              prompt: o.prompt,
              image_urls: [o.image],
              mode: 'normal',
              // A string on image-to-video, a number on text-to-video (KIE's docs).
              duration: String(o.seconds ?? 6),
              resolution: o.tier,
            }),
          }
        : {
            model: 'grok-imagine/text-to-video',
            input: clean({
              prompt: o.prompt,
              aspect_ratio: nearestAspect(o.aspectRatio, ['2:3', '3:2', '1:1', '16:9', '9:16'], '16:9'),
              mode: 'normal',
              duration: o.seconds ?? 6,
              resolution: o.tier,
            }),
          },
  },
  {
    key: 'kie/pixverse-v6-max',
    name: 'PixVerse V6 Max',
    description: 'PixVerse — เอฟเฟกต์และสไตล์หลากหลาย มีเสียงในตัว',
    category: 'video',
    subcategory: 'general',
    tierParam: 'resolution',
    tiers: tiers([['540p', '540p'], ['720p', '720p'], ['1080p', '1080p']], '720p'),
    usd: perSecond({ '540p': 0.044, '720p': 0.06, '1080p': 0.112 }),
    durations: [5, 10, 15],
    firstFrame: true,
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => ({
      model: o.image ? 'pixverse-v6-max/image-to-video' : 'pixverse-v6-max/text-to-video',
      input: clean({
        prompt: cut(o.prompt, 5000),
        image_urls: o.image ? [o.image] : [],
        // Text-to-video only; KIE refuses it beside a picture.
        aspect_ratio: o.image ? undefined : nearestAspect(o.aspectRatio, ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'], '16:9'),
        quality: o.tier,
        duration: o.seconds ?? 5,
        generate_audio_switch: true,
        seed: o.seed,
      }),
    }),
  },

  // ------------------------------------------------------------- lip-sync
  {
    key: 'kie/kling-avatar',
    name: 'Kling AI Avatar',
    description: 'ภาพคน + เสียง → คลิปพูดได้ ปากตรงเสียง ยาวสุด 60 วินาที',
    category: 'video',
    subcategory: 'lipsync-portrait',
    featured: true,
    tierParam: null,
    tiers: tiers([['std', '720p']]),
    usd: perSecond({ std: 0.04 }),
    perSecond: true,
    lengthFromAudio: { minSeconds: 2, stepSeconds: 1 },
    maxDuration: 60,
    maxWaitSeconds: 40 * MIN,
    build: (o) => ({
      model: 'kling/ai-avatar-standard',
      input: clean({ image_url: o.image, audio_url: o.audio, prompt: cut(o.prompt.trim() || PORTRAIT_PROMPT, 5000) }),
    }),
  },
  {
    key: 'kie/infinitalk',
    name: 'InfiniTalk',
    description: 'ภาพคน + เสียง → คลิปพูด ราคาประหยัด ยาวสุด 15 วินาที',
    category: 'video',
    subcategory: 'lipsync-portrait',
    tierParam: null,
    tiers: tiers([['480p', '480p']]),
    usd: perSecond({ '480p': 0.015 }),
    perSecond: true,
    lengthFromAudio: { minSeconds: 2, stepSeconds: 1 },
    maxDuration: 15,
    maxWaitSeconds: 30 * MIN,
    build: (o) => ({
      model: 'infinitalk/from-audio',
      input: clean({ image_url: o.image, audio_url: o.audio, prompt: cut(o.prompt.trim() || PORTRAIT_PROMPT, 5000), resolution: '480p' }),
    }),
  },
  {
    key: 'kie/volcengine-lipsync',
    name: 'พากย์ทับคลิป (Volcengine)',
    description: 'คลิปเดิม + เสียงใหม่ → ปากขยับตามเสียง คิดตามความยาวคลิป สูงสุด 60 วินาที',
    category: 'video',
    subcategory: 'lipsync',
    tierParam: null,
    tiers: tiers([['basic', 'มาตรฐาน']]),
    usd: perSecond({ basic: 0.04 }),
    perSecond: true,
    maxDuration: 60,
    maxWaitSeconds: 40 * MIN,
    build: (o) => ({
      model: 'volcengine/video-to-video-lip-sync',
      input: clean({ mode: 'basic', video_url: o.video, audio_url: o.audio }),
    }),
  },

  // ---------------------------------------------------------------- music
  // Suno, seven tools (kie-suno.ts). One price for every version: the
  // version is the customer's free choice on the quality chips.
  {
    key: 'kie/suno-v6',
    name: 'Suno V6',
    description: 'แต่งเพลงพร้อมเสียงร้อง ได้ 2 เวอร์ชันต่อครั้ง — เลือกรุ่น V6 / Wild / Mini · ใส่เนื้อร้องเองหรือให้ AI แต่งให้',
    category: 'audio',
    subcategory: SUNO_SUBCATEGORY.song,
    featured: true,
    tierParam: 'quality',
    tiers: SUNO_VERSIONS,
    usd: flat({ V6: 0.06, V6_WILD: 0.06, V6_MINI: 0.06 }),
    music: true,
    suno: 'song',
    maxWaitSeconds: 15 * MIN,
    build: (o) => buildSunoTask('song', sunoOrder(o)),
  },
  {
    key: 'kie/suno-cover',
    name: 'Suno Cover',
    description: 'คัฟเวอร์เพลงของคุณเป็นแนวใหม่ คงทำนองเดิม ได้ 2 เวอร์ชัน · ใส่เนื้อร้องใหม่ได้ · เพลงต้นฉบับไม่เกิน 8 นาที',
    category: 'audio',
    subcategory: SUNO_SUBCATEGORY.cover,
    tierParam: 'quality',
    tiers: SUNO_VERSIONS,
    usd: flat({ V6: 0.06, V6_WILD: 0.06, V6_MINI: 0.06 }),
    music: true,
    suno: 'cover',
    maxWaitSeconds: 15 * MIN,
    build: (o) => buildSunoTask('cover', sunoOrder(o)),
  },
  {
    key: 'kie/suno-extend',
    name: 'Suno Extend',
    description: 'ต่อเพลงให้ยาวขึ้นจากวินาทีที่เลือก สไตล์เดิมต่อเนื่อง ใส่เนื้อท่อนใหม่ได้ · เพลงต้นฉบับไม่เกิน 8 นาที',
    category: 'audio',
    subcategory: SUNO_SUBCATEGORY.extend,
    tierParam: 'quality',
    tiers: SUNO_VERSIONS,
    usd: flat({ V6: 0.06, V6_WILD: 0.06, V6_MINI: 0.06 }),
    music: true,
    suno: 'extend',
    maxWaitSeconds: 15 * MIN,
    build: (o) => buildSunoTask('extend', sunoOrder(o)),
  },
  {
    key: 'kie/suno-add-vocals',
    name: 'Suno Add Vocals',
    description: 'ใส่เสียงร้องลงบนดนตรีบรรเลงของคุณ ร้องตามเนื้อที่เขียนเอง หรือให้ AI แต่งเนื้อให้',
    category: 'audio',
    subcategory: SUNO_SUBCATEGORY['add-vocals'],
    tierParam: 'quality',
    tiers: SUNO_VERSIONS,
    usd: flat({ V6: 0.06, V6_WILD: 0.06, V6_MINI: 0.06 }),
    music: true,
    suno: 'add-vocals',
    maxWaitSeconds: 15 * MIN,
    build: (o) => buildSunoTask('add-vocals', sunoOrder(o)),
  },
  {
    key: 'kie/suno-add-instrumental',
    name: 'Suno Add Instrumental',
    description: 'แต่งดนตรีประกอบให้เสียงร้องเปล่าของคุณ เลือกแนวดนตรีได้ — ใช้กับเสียงร้องที่แยกสเต็มไว้ได้เลย',
    category: 'audio',
    subcategory: SUNO_SUBCATEGORY['add-instrumental'],
    tierParam: 'quality',
    tiers: SUNO_VERSIONS,
    usd: flat({ V6: 0.06, V6_WILD: 0.06, V6_MINI: 0.06 }),
    music: true,
    suno: 'add-instrumental',
    maxWaitSeconds: 15 * MIN,
    build: (o) => buildSunoTask('add-instrumental', sunoOrder(o)),
  },
  {
    key: 'kie/suno-stems',
    name: 'Suno Stems',
    description: 'แยกเพลงเป็นสเต็ม: เสียงร้อง/ดนตรี, ครบทุกชิ้น หรือดึงเครื่องดนตรีชิ้นเดียว · เลือกโหลดเฉพาะไฟล์ที่ต้องการ',
    category: 'audio',
    subcategory: SUNO_SUBCATEGORY.stems,
    tierParam: 'quality',
    tiers: SUNO_STEM_TIERS,
    usd: flat({ vocals: 0.05, all: 0.25, one: 0.1 }),
    suno: 'stems',
    maxWaitSeconds: 10 * MIN,
    build: (o) => buildSunoTask('stems', sunoOrder(o)),
  },
  {
    key: 'kie/suno-sounds',
    name: 'Suno Sounds',
    description: 'เสียงประกอบและลูปดนตรีสั้น ๆ — บรรยากาศ เอฟเฟกต์ บีต · กำหนด BPM คีย์ และวนลูปไร้รอยต่อได้',
    category: 'audio',
    subcategory: SUNO_SUBCATEGORY.sounds,
    tierParam: 'quality',
    tiers: SUNO_VERSIONS,
    usd: flat({ V6: 0.0125, V6_WILD: 0.0125, V6_MINI: 0.0125 }),
    suno: 'sounds',
    maxWaitSeconds: 10 * MIN,
    build: (o) => buildSunoTask('sounds', sunoOrder(o)),
  },

  // --------------------------------------------------------------- speech
  {
    key: 'kie/elevenlabs-v3',
    name: 'ElevenLabs V3',
    description: 'อ่านข้อความเป็นเสียงพูดธรรมชาติ พูดไทยได้ ใส่อารมณ์ด้วยแท็กอย่าง [laughs] [whispers] · สูงสุด 5,000 ตัวอักษร',
    category: 'audio',
    subcategory: 'speech',
    featured: true,
    tierParam: null,
    tiers: tiers([['std', 'มาตรฐาน']]),
    usd: perThousandChars(0.07),
    perChars: 1000,
    speech: { voices: ELEVENLABS_VOICES, maxChars: 5000, tags: true },
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      // V3 is reached through the dialogue route; one turn is plain speech.
      // Multilingual v2 and Turbo 2.5 are cheaper but do not speak Thai.
      model: 'elevenlabs/text-to-dialogue-v3',
      input: clean({
        dialogue: [{ text: cut(o.prompt.trim(), 5000), voice: o.voice ?? ELEVENLABS_VOICES[0].id }],
        stability: 0.5,
        language_code: THAI.test(o.prompt) ? 'th' : undefined,
      }),
    }),
  },
  {
    key: 'kie/gemini-3-8-flash-tts',
    name: 'Gemini 3.8 Flash TTS',
    description: 'เสียงพูดราคาประหยัด พูดไทยได้ กำหนดสไตล์การพูดได้ เช่น “พูดช้า ๆ อบอุ่น” · สูงสุด 3,000 ตัวอักษร',
    category: 'audio',
    subcategory: 'speech',
    tierParam: null,
    tiers: tiers([['std', 'มาตรฐาน']]),
    // Billed by tokens ($0.35/M in, $6.30/M audio out ≈ 32 a second); a
    // thousand characters at a slow 8 a second is about $0.026.
    usd: perThousandChars(0.03),
    perChars: 1000,
    speech: { voices: GEMINI_VOICES, maxChars: 3000, style: true },
    maxWaitSeconds: 10 * MIN,
    build: (o) => ({
      model: 'google/gemini-3-8-flash-tts',
      input: clean({
        speakers: [{ speaker_id: 'Speaker 1', voice_name: o.voice ?? GEMINI_VOICES[0].id }],
        dialogue_turns: [
          clean({ speaker_id: 'Speaker 1', text: cut(o.prompt.trim(), 3000), style: o.speechStyle ? cut(o.speechStyle, 300) : undefined }),
        ],
      }),
    }),
  },

  // ---------------------------------------------------------- video tools
  {
    key: 'kie/topaz-video-upscale',
    name: 'Topaz Video Upscale',
    description: 'ขยายวิดีโอให้คมชัดขึ้น 2 หรือ 4 เท่า (หรือเพิ่มความคมที่ขนาดเดิม) · คิดตามความยาวคลิป สูงสุด 30 วินาที',
    category: 'video',
    subcategory: 'video-upscale',
    tierParam: 'resolution',
    tiers: tiers([['1', 'คมขึ้น ขนาดเดิม'], ['2', 'ขยาย ×2'], ['4', 'ขยาย ×4']], '2'),
    usd: perSecond({ '1': 0.04, '2': 0.04, '4': 0.07 }),
    perSecond: true,
    // Topaz takes MP4, MOV or MKV up to 50 MB and names no length; 30 s caps a ×4 at about $2.
    sourceClip: { minSeconds: 1, maxSeconds: 30, maxBytes: 50 * MB, containers: ['mp4'] },
    maxDuration: 30,
    maxWaitSeconds: 40 * MIN,
    build: (o) => ({ model: 'topaz/video-upscale', input: clean({ video_url: o.video, upscale_factor: o.tier }) }),
  },
  {
    key: 'kie/kling-3-motion-control',
    name: 'Kling 3.0 Motion Control',
    description: 'ภาพตัวละคร + คลิปท่าทาง → ตัวละครขยับตามคลิป (เต้น ท่าทาง สีหน้า) · คลิป 3–30 วินาที',
    category: 'video',
    subcategory: 'motion',
    tierParam: 'resolution',
    tiers: tiers([['720p', '720p'], ['1080p', '1080p']]),
    usd: perSecond({ '720p': 0.1, '1080p': 0.135 }),
    perSecond: true,
    needsImage: true,
    // The docs: video 3–30 s, ≤ 100 MB, sides over 340 px, MP4 or MOV.
    sourceClip: { minSeconds: 3, maxSeconds: 30, minSide: 340, maxBytes: 100 * MB, containers: ['mp4'] },
    maxDuration: 30,
    maxWaitSeconds: 40 * MIN,
    build: (o) => ({
      model: 'kling-3.0/motion-control',
      input: clean({
        prompt: o.prompt.trim() ? cut(o.prompt.trim(), 2500) : undefined,
        input_urls: o.image ? [o.image] : [],
        video_urls: o.video ? [o.video] : [],
        mode: o.tier,
        // The clip's facing, so a dancer turning round turns the character too.
        character_orientation: 'video',
      }),
    }),
  },
];

function veoTask(o: KieOrder, tier: 'veo3_fast' | 'veo3_lite' | 'veo3'): KieTask {
  const frames = [o.image, o.image ? o.lastFrame : undefined].filter((u): u is string => !!u);
  return {
    model: 'veo-3-1',
    input: clean({
      prompt: o.prompt,
      model: tier,
      generation_type: frames.length > 0 ? 'FIRST_AND_LAST_FRAMES_2_VIDEO' : 'TEXT_2_VIDEO',
      image_urls: frames,
      aspect_ratio: frames.length > 0 ? 'Auto' : nearestAspect(o.aspectRatio, ['16:9', '9:16'], '16:9'),
      resolution: o.tier,
      duration: 8,
    }),
  };
}

function seedanceTask(model: string, o: KieOrder, maxPrompt: number): KieTask {
  return {
    model,
    input: clean({
      prompt: cut(o.prompt, maxPrompt),
      first_frame_url: o.image,
      last_frame_url: o.image ? o.lastFrame : undefined,
      generate_audio: true,
      resolution: o.tier,
      aspect_ratio: o.image ? 'adaptive' : nearestAspect(o.aspectRatio, ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'], '16:9'),
      duration: o.seconds ?? 5,
    }),
  };
}

/** Keys this file once defined and no longer sells: their rows are switched off by the sync. */
export const RETIRED_KIE_KEYS: string[] = [];

/**
 * Where an order on a KIE model goes when KIE cannot take it (no credit, key
 * refused or cooling down, rate limit, outage — kie-fallback.ts): rows of
 * other providers in the account pool, `<provider slug>:<model_id>`, tried in
 * this order. A row that is missing, off, not yet proven, or cannot do this
 * order (references, frames, length, clip) is skipped. The admin edits this
 * per model on /admin/kie (`ai_settings.kie_fallback_map`); a model not listed
 * has no fallback and its order is refunded, as before.
 */
export const KIE_FALLBACKS: Record<string, string[]> = {
  'kie/nano-banana-2-1': ['openai:gpt-image-1', 'byteplus:seedream-5.0'],
  'kie/nano-banana-pro': ['openai:gpt-image-1', 'byteplus:seedream-5.0'],
  'kie/gpt-image-2-5': ['openai:gpt-image-1'],
  'kie/seedream-5-pro': ['byteplus:seedream-5.0'],
  'kie/seedream-5-flash': ['byteplus:seedream-5.0-lite', 'byteplus:seedream-5.0'],
  'kie/flux-3-klein': ['fal:fal-ai/flux/schnell', 'replicate:black-forest-labs/flux-schnell'],
  'kie/flux-2-pro': ['fal:fal-ai/flux-pro/v1.1', 'replicate:black-forest-labs/flux-1.1-pro'],
  'kie/ideogram-v3': ['fal:fal-ai/recraft-v3'],
  'kie/qwen-image-3': ['fal:fal-ai/flux/dev', 'replicate:black-forest-labs/flux-dev'],
  'kie/grok-imagine-image-2': ['openai:gpt-image-1', 'fal:fal-ai/flux-pro/v1.1'],
  'kie/z-image': ['fal:fal-ai/flux/schnell', 'replicate:black-forest-labs/flux-schnell'],
  'kie/recraft-remove-background': ['stability:remove-background'],
  'kie/recraft-crisp-upscale': ['stability:stable-image-upscale', 'fal:fal-ai/creative-upscaler'],
  'kie/topaz-image-upscale': ['stability:stable-image-upscale', 'fal:fal-ai/creative-upscaler'],
  'kie/kling-3': ['kling:kling-v2.5-pro', 'kling:kling-v2.5'],
  'kie/kling-4': ['kling:kling-v2.5-pro'],
  'kie/veo-3-1-fast': ['openai:sora-2', 'runway:gen4_turbo'],
  'kie/veo-3-1-lite': ['openai:sora-2', 'runway:gen4_turbo'],
  'kie/veo-3-1': ['openai:sora-2', 'runway:gen4_turbo'],
  'kie/seedance-2-fast': ['byteplus:seedance-2.0'],
  'kie/seedance-2-mini': ['byteplus:seedance-1.0-lite', 'byteplus:seedance-2.0'],
  'kie/seedance-2-5': ['byteplus:seedance-2.0'],
  'kie/minimax-h3': ['minimax:MiniMax-H3'],
  'kie/wan-3': ['luma:ray-2', 'kling:kling-v2.5'],
  'kie/grok-imagine-video': ['luma:ray-2-flash', 'kling:kling-v1.6'],
  'kie/pixverse-v6-max': ['luma:ray-2', 'kling:kling-v2.5'],
  'kie/kling-avatar': ['fal:fal-ai/infinitalk'],
  'kie/infinitalk': ['fal:fal-ai/infinitalk'],
  'kie/volcengine-lipsync': ['fal:fal-ai/latentsync', 'fal:fal-ai/kling-video/lipsync/audio-to-video'],
};

const BY_KEY = new Map(KIE_CATALOG.map((e) => [e.key, e]));

export function getKieEntry(key: string): KieEntry | undefined {
  return BY_KEY.get(key);
}

/** The credits table a row carries (kie-pricing.ts), from the entry's USD prices. */
export function kiePriceTable(entry: KieEntry, basis: KieBasis = DEFAULT_KIE_BASIS): KiePriceTable {
  const credits: Record<string, Record<string, number>> = {};
  for (const tier of entry.tiers) {
    const row: Record<string, number> = {};
    if (entry.perChars) {
      row['1'] = kieCredits(entry.usd(tier.id, entry.perChars), basis);
    } else if (entry.perSecond) {
      row['1'] = kieCredits(entry.usd(tier.id, 1), basis);
    } else if (entry.durations) {
      for (const s of entry.durations) row[String(s)] = kieCredits(entry.usd(tier.id, s), basis);
    } else {
      row['*'] = kieCredits(entry.usd(tier.id, 0), basis);
    }
    credits[tier.id] = row;
  }
  return {
    tierParam: entry.tierParam,
    // As a row stores it: a tier's description is display only (/api/models reads it from the entry).
    tiers: entry.tiers.map((t) => ({ id: t.id, label: t.label, isDefault: t.isDefault === true })),
    durations: entry.perSecond || entry.perChars ? null : entry.durations ?? null,
    credits,
    perSecond: entry.perSecond === true,
    perChars: entry.perChars,
    imageCredits: entry.imageUsd ? kieCredits(entry.imageUsd, basis) : undefined,
    freeImages: entry.imageUsd ? entry.freeImages ?? 0 : undefined,
  };
}

/** Pictures an order carries that KIE may bill: references for a picture, frames for a clip. */
export function kieImageCount(
  entry: KieEntry,
  order: { references: number; inputImage?: string | null; inputImageEnd?: string | null }
): number {
  if (entry.category === 'image') return Math.min(order.references, entry.references ?? 0);
  if (entry.category === 'video' && entry.firstFrame && order.inputImage) {
    return 1 + (entry.lastFrame && order.inputImageEnd ? 1 : 0);
  }
  return 0;
}
