import type { Locale } from '@/lib/i18n/locale';

/**
 * Model names and descriptions in English.
 *
 * The Thai lives where each model is defined — `kie-catalog.ts`, `gpu/catalog.ts`
 * and the `ai_models` rows the model sync writes from them (an admin may edit
 * a row's Thai). The English lives here, keyed by `model_id`, and
 * `/api/models` picks per visitor. `model-text.test.mts` fails when a
 * catalogue gains a model without an entry here.
 *
 * Model names stay as they are; only a Thai part of a name is translated
 * ("ACE-Step 1.5 (เพลง/เสียง)" → "ACE-Step 1.5 (music/sound)"). No API vendor
 * is named in either language — the model makers (Google, ByteDance…) are.
 */

type ModelEn = { name?: string; description: string };

export const MODEL_TEXT_EN: Record<string, ModelEn> = {
  // ── KIE catalogue (kie-catalog.ts) ──
  'kie/nano-banana-2-1': { description: 'Google Gemini image — follows detailed instructions and blends up to 10 reference images. Best value.' },
  'kie/nano-banana-pro': { description: 'Google Gemini 3 Pro Image — crisp text in pictures, great for ads and infographics. Up to 8 references.' },
  'kie/gpt-image-2-5': { description: 'OpenAI’s latest — follows instructions precisely; edits and combines up to 16 reference images.' },
  'kie/seedream-5-pro': { description: 'ByteDance — highly realistic pictures, up to 10 references (a small extra charge past the first).' },
  'kie/seedream-5-flash': { description: 'ByteDance’s fast model — budget 2K, up to 10 references.' },
  'kie/flux-3-klein': { description: 'Black Forest Labs — very fast and very cheap, sharp up to 4K, up to 10 references.' },
  'kie/flux-2-pro': { description: 'Black Forest Labs — photorealistic, with accurate colour and light. Up to 8 references.' },
  'kie/ideogram-v3': { description: 'Great at text in pictures — logos and posters. Choose speed or quality.' },
  'kie/qwen-image-3': { description: 'Alibaba — strong with Chinese and English, accurate text in pictures, 2K, up to 3 references.' },
  'kie/grok-imagine-image-2': { description: 'xAI — bold styles, fast, edits from up to 5 reference images.' },
  'kie/z-image': { description: 'Alibaba Tongyi — the cheapest; good for trying ideas quickly (prompt up to 1,000 characters).' },
  'kie/nano-banana-2-1-edit': {
    name: 'Nano Banana 2.1 Edit',
    description: 'Edit a picture by describing the change — a new outfit, a new scene, remove or add things.',
  },
  'kie/flux-3-klein-edit': { name: 'FLUX 3 Klein Edit', description: 'Edit with a prompt — fast and cheap, and keeps faces as they were.' },
  'kie/recraft-remove-background': {
    name: 'Remove Background (Recraft)',
    description: 'Removes the background and keeps the subject, as a transparent PNG.',
  },
  'kie/recraft-crisp-upscale': {
    name: 'Crisp Upscale (Recraft Crisp)',
    description: 'Makes a picture bigger and sharper while keeping its detail. Very cheap.',
  },
  'kie/topaz-image-upscale': { description: 'Professional upscaling, 2× or 4×.' },
  'kie/kling-3': { description: 'Kuaishou — realistic motion with built-in sound; set a first and last frame.' },
  'kie/kling-4': { description: 'Kuaishou’s newest — precise first/last-frame control, clips up to 15 seconds.' },
  'kie/veo-3-1-fast': { description: 'Google — 8-second video with speech and sound effects. Fast and good value.' },
  'kie/veo-3-1-lite': { description: 'Google’s budget model — 8-second video with sound, the cheapest Veo.' },
  'kie/veo-3-1': { description: 'Google’s top quality — professional ads and short films, 8 seconds with sound.' },
  'kie/seedance-2-fast': { description: 'ByteDance — video with built-in sound, fast and well priced; set a first and last frame.' },
  'kie/seedance-2-mini': { description: 'ByteDance’s budget model — video with sound at a very low price.' },
  'kie/seedance-2-5': { description: 'ByteDance’s flagship — cinematic quality with built-in sound, up to 1080p.' },
  'kie/minimax-h3': { description: 'MiniMax H3 that starts right away with no queue; set a first and last frame, up to 2K.' },
  'kie/wan-3': { description: 'Alibaba — video with sound and first/last-frame control. Good value.' },
  'kie/grok-imagine-video': { description: 'xAI — fun, vivid video at a low price; set a first frame.' },
  'kie/pixverse-v6-max': { description: 'PixVerse — many effects and styles, with built-in sound.' },
  'kie/kling-avatar': { description: 'Portrait + voice → a talking clip with matching lips, up to 60 seconds.' },
  'kie/infinitalk': { description: 'Portrait + voice → a talking clip at a budget price, up to 15 seconds.' },
  'kie/volcengine-lipsync': {
    name: 'Re-dub a Clip (Volcengine)',
    description: 'Your clip + a new voice → the lips follow the voice. Priced by clip length, up to 60 seconds.',
  },
  'kie/suno-v6': { description: 'Writes songs with vocals, 2 versions per order — use your own lyrics or let the AI write them.' },
  'kie/suno-cover': { description: 'Covers your song in a new style, keeping the melody, 2 versions per order · new lyrics optional · original up to 8 min.' },
  'kie/suno-extend': { description: 'Extends a song from the second you pick in the same style, with new lyrics if you like · original up to 8 min.' },
  'kie/suno-add-vocals': { description: 'Sings over your instrumental — your own lyrics, or let the AI write them.' },
  'kie/suno-add-instrumental': { description: 'Writes the music for your bare vocal, in the genre you pick — works with vocals split into stems.' },
  'kie/suno-stems': { description: 'Splits a song into stems: vocals/music, every instrument, or one instrument · download only the files you want.' },
  'kie/suno-sounds': { description: 'Sound effects and short music loops — ambience, effects, beats · set BPM and key, loop seamlessly.' },
  'kie/elevenlabs-v3': {
    description: 'Natural-sounding speech from text, speaks Thai; add emotion with tags like [laughs] [whispers]. Up to 5,000 characters.',
  },
  'kie/gemini-3-8-flash-tts': {
    description: 'Budget speech that speaks Thai; set the speaking style, e.g. “slow and warm”. Up to 3,000 characters.',
  },
  'kie/topaz-video-upscale': {
    description: 'Makes a video sharper at 2× or 4× (or sharper at the same size). Priced by clip length, up to 30 seconds.',
  },
  'kie/kling-3-motion-control': {
    description: 'Character picture + a motion clip → the character moves like the clip (dance, gestures, expressions). Clips of 3–30 seconds.',
  },

  // ── Our own machines (gpu/catalog.ts) ──
  'minimax-h3': { description: 'Video with built-in sound, top quality in its class • takes longer than other models.' },
  'ltx-2.5': {
    name: 'LTX-2.5 (video + sound)',
    description: 'Video with built-in sound from Lightricks • from text or a first frame • faster and cheaper than H3.',
  },
  'ace-step-1.5': {
    name: 'ACE-Step 1.5 (music/sound)',
    description: 'Music and sound from a description • the lightest, fastest and cheapest model here.',
  },
  'qwen-image': {
    description: 'High-quality still images, great with both Thai and English text • an 8-step LoRA makes it much faster than usual.',
  },
  'yue2-music': {
    name: 'YuE2 (full song)',
    description: 'A full song with vocals from your own lyrics • lays out the melody first, then sings · 48 kHz quality.',
  },
  'yue2-cover': {
    name: 'YuE2 Cover (from your upload)',
    description: 'Upload a song and the AI rearranges it in the style you ask for • takes the original melody and sings the whole song anew.',
  },
  'sdxl-community': {
    name: 'SDXL (community machines)',
    description: 'Still images with SDXL on graphics cards members share — a regular queue, not for rush jobs.',
  },
  'hunyuan3d-2.1': {
    name: 'Image to 3D Model (Hunyuan3D-2.1)',
    description: 'Upload one picture of an object or character → a 3D model with PBR textures as a GLB file • the background is removed for you.',
  },
  'latentsync-1.6': {
    name: 'Re-dub a Clip (LatentSync 1.6)',
    description:
      'Upload a clip showing a face + a voice file (Thai works) → the lips follow the new voice, everything else stays • as long as the voice, up to 20 seconds.',
  },

  // ── Other rows whose Thai was written in the admin (ai_models) ──
  'MiniMax-H3': { description: 'Video with built-in speech • write Thai dialogue right in the prompt, no dubbing later • 6 seconds, 768p.' },
  'fal-ai/latentsync': {
    name: 'Re-dub a Clip (LatentSync)',
    description: 'Upload a clip + a Thai voice file → the lips match the new voice • keeps the whole original picture • up to 40 seconds.',
  },
  'fal-ai/infinitalk': {
    name: 'Talking Photo (InfiniTalk)',
    description: 'Upload a face photo + a Thai voice file → a clip of the person speaking • 5 seconds • priced per second, so it costs more.',
  },
};

/** Quality modes (gpu/catalog.ts `qualityModes`), keyed `<model>:<mode id>`. */
export const QUALITY_MODE_EN: Record<string, { label: string; description: string }> = {
  'qwen-image:fast': { label: 'Fast', description: 'Lightning, 8 steps — a good picture in seconds, fine for everyday work.' },
  'qwen-image:quality': {
    label: 'High quality',
    description: 'The full model without the speed LoRA — sharper detail, skin and text; takes about 2× as long.',
  },
  'hunyuan3d-2.1:standard': { label: 'Standard', description: 'Balanced detail and time — for showcases, illustration and 3D printing.' },
  'hunyuan3d-2.1:game': {
    label: 'Low-poly for games',
    description: 'Cut to about 15,000 faces — a light file that loads fast, ready for games and the web.',
  },
  'hunyuan3d-2.1:ultra': { label: 'Maximum detail', description: 'About 200,000 faces with 4K textures — takes about 2× as long.' },
};

/** KIE price tiers by their Thai label (resolutions like "1080p" need nothing). */
const TIER_LABEL_EN: Record<string, string> = {
  'เร็ว': 'Fast',
  'สมดุล': 'Balanced',
  'คุณภาพสูง': 'High quality',
  'มาตรฐาน': 'Standard',
  '2 เท่า': '2×',
  '4 เท่า': '4×',
  'คมขึ้น ขนาดเดิม': 'Sharper, same size',
  'ขยาย ×2': 'Upscale ×2',
  'ขยาย ×4': 'Upscale ×4',
  'เสียงร้อง + ดนตรี': 'Vocals + music',
  'ครบทุกชิ้น': 'Every instrument',
  'ดึงชิ้นเดียว': 'One instrument',
};

/** Speech voices by id: the voice's name stays, its character is translated. */
const VOICE_EN: Record<string, string> = {
  hpp4J3VqNfWAUOO0d1Us: 'Bella — female, gentle, warm',
  EkK5I93UQWFDigLMpZcX: 'James — male, deep, energetic',
  BZgkqPqms7Kj9ulSkVzn: 'Eve — female, bright, cheerful',
  nPczCjzI2devNBz1zQrb: 'Brian — male, deep, smooth',
  '5l5f8iK3YPeGga21rQIX': 'Adeline — female, conversational',
  UgBBYS2sOqTuMpoF3BR0: 'Mark — male, natural',
  FGY2WhTYpPnrIDTdsKH5: 'Laura — female, enthusiastic',
  TX3LPaxmHKxFdv7VOQHJ: 'Liam — male, creator style',
  kPzsL2i3teMYv0FxEYQ6: 'Brittney — female, young, fun',
  DYkrAHD8iwork3YSUBbs: 'Tom — male, storyteller, audiobook',
  '56AoDkrOh6qfVPDXZ7Pt': 'Cassidy — female, crisp and clear',
  x70vRnQBMBu4FAYhjJbO: 'Nathan — male, radio DJ',
  Z3R5wn05IrDiVCyEkUrK: 'Arabella — female, mysterious, emotive',
  DGzg6RaUqxGRTHSBjfgF: 'Brock — male, intense, firm',
  Kore: 'Kore — female, firm, confident',
  Charon: 'Charon — male, informative, trustworthy',
  Zephyr: 'Zephyr — female, bright',
  Puck: 'Puck — male, upbeat',
  Sulafat: 'Sulafat — female, warm',
  Achird: 'Achird — male, friendly',
  Leda: 'Leda — female, youthful',
  Orus: 'Orus — male, firm',
  Aoede: 'Aoede — female, easy-going',
  Fenrir: 'Fenrir — male, excitable',
  Despina: 'Despina — female, smooth',
  Schedar: 'Schedar — male, even',
  Achernar: 'Achernar — female, soft',
  Algenib: 'Algenib — male, gravelly',
};

const THAI = /[฀-๿]/;

/** A name with its Thai left out: "Foo (ภาษาไทย)" → "Foo". The last resort for a row nobody translated. */
function withoutThai(name: string): string {
  const cleaned = name
    .replace(/\s*\([^)]*[฀-๿][^)]*\)/g, '')
    .replace(/[฀-๿][฀-๿\s/+&·•,-]*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || name;
}

/** A model's name for `locale`. */
export function modelName(modelId: string, name: string, locale: Locale): string {
  if (locale === 'th' || !THAI.test(name)) return name;
  return MODEL_TEXT_EN[modelId]?.name ?? withoutThai(name);
}

/**
 * A model's description for `locale`. An English visitor gets the English
 * from this file, the row's own text when it has no Thai, else nothing —
 * never a Thai paragraph in an English page.
 */
export function modelDescription(modelId: string, description: string | null, locale: Locale): string | null {
  if (locale === 'th') return description;
  const en = MODEL_TEXT_EN[modelId]?.description;
  if (en) return en;
  return description && !THAI.test(description) ? description : null;
}

export function qualityModeText(
  modelId: string,
  mode: { id: string; label: string; description: string },
  locale: Locale
): { label: string; description: string } {
  if (locale === 'th') return { label: mode.label, description: mode.description };
  const en = QUALITY_MODE_EN[`${modelId}:${mode.id}`];
  if (en) return en;
  const label = TIER_LABEL_EN[mode.label] ?? (THAI.test(mode.label) ? mode.id : mode.label);
  return { label, description: THAI.test(mode.description) ? '' : mode.description };
}

/** A price tier's label (KIE `tiers`) for `locale`. */
export function tierLabel(label: string, locale: Locale): string {
  if (locale === 'th' || !THAI.test(label)) return label;
  return TIER_LABEL_EN[label] ?? label;
}

/** A speech voice's label for `locale`. */
export function voiceLabel(voiceId: string, label: string, locale: Locale): string {
  if (locale === 'th' || !THAI.test(label)) return label;
  return VOICE_EN[voiceId] ?? label.split(' — ')[0];
}
