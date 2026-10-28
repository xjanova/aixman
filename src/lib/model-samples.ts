/**
 * The picture a model shows on the studio's model picker, so a customer can see
 * what it makes before choosing it.
 *
 * Pictures are the publishers' own examples found on the web (model cards,
 * official pages, Wikimedia Commons), copied into `public/model-samples/` —
 * not hotlinked, since a vendor page that moves would leave the picker broken.
 * Where each one came from is in `public/model-samples/CREDITS.md`.
 *
 * An admin's `ai_models.thumbnail` wins over these, so a row can be given its
 * own picture without a deploy.
 */

/**
 * Families that have a picture in `public/model-samples/<slug>.webp`. Mapped
 * families missing here (Stable Image, Kino XL, ACE-Step, YuE) had no usable
 * published example and show the category art.
 */
const SAMPLE_SLUGS = new Set<string>([
  'seedream', 'seedream-5', 'seedance', 'gpt-image', 'dall-e-3', 'sora-2', 'sd3.5', 'sdxl',
  'upscale', 'inpaint', 'outpaint', 'remove-background', 'creative-upscaler',
  'flux-pro', 'flux-dev', 'flux-schnell', 'minimax-video', 'minimax-h3', 'recraft-v3',
  'latentsync', 'kling-lipsync', 'infinitalk', 'runway-gen4', 'runway-gen3', 'kling-video',
  'kolors', 'luma-ray2', 'leonardo-phoenix', 'leonardo-diffusion-xl', 'qwen-image', 'ltx', 'hunyuan3d',
]);

/**
 * Families that also have a looping showcase clip, `public/model-samples/<slug>.mp4`
 * (480 px square, a few seconds, no sound) — the picker's balloons play it, with
 * the picture as its poster. The picture is the clip's first frame, so the
 * balloon does not jump when the clip starts.
 */
const VIDEO_SLUGS = new Set<string>([
  'seedance', 'sora-2', 'minimax-video', 'minimax-h3', 'ltx', 'kling-video', 'kling-lipsync',
  'luma-ray2', 'runway-gen4', 'runway-gen3', 'latentsync', 'hunyuan3d',
]);

/** Pictures whose licence requires a credit where they are shown (CC BY / BY-SA). */
const ATTRIBUTION: Record<string, string> = {
  'seedream-5': '© VulcanSphere · CC BY 4.0',
  'leonardo-diffusion-xl': '© LVictorious · CC BY-SA 4.0',
};

/**
 * Model id → picture. Exact ids first, then the first matching pattern, so a
 * new row of a known family (another FLUX route, a newer Kling) gets its
 * family's picture without an edit here.
 */
const EXACT: Record<string, string> = {
  'seedream-3.0': 'seedream',
  'seedream-5.0': 'seedream-5',
  'seedream-5.0-lite': 'seedream-5',
  'gpt-image-1': 'gpt-image',
  'gpt-image-1-mini': 'gpt-image',
  'stable-image-ultra': 'stable-image',
  'stable-image-core': 'stable-image',
  'stable-image-upscale': 'upscale',
  'stable-image-inpaint': 'inpaint',
  'stable-image-outpaint': 'outpaint',
  'remove-background': 'remove-background',
  'fal-ai/creative-upscaler': 'creative-upscaler',
  'fal-ai/recraft-v3': 'recraft-v3',
  'fal-ai/latentsync': 'latentsync',
  'latentsync-1.6': 'latentsync',
  'fal-ai/kling-video/lipsync/audio-to-video': 'kling-lipsync',
  'fal-ai/infinitalk': 'infinitalk',
  'minimax/video-01': 'minimax-video',
  'gen4_turbo': 'runway-gen4',
  'gen3a_turbo': 'runway-gen3',
  kolors: 'kolors',
  'phoenix-1.0': 'leonardo-phoenix',
  'kino-xl': 'leonardo-kino-xl',
  'leonardo-diffusion-xl': 'leonardo-diffusion-xl',
  // Pollinations' free route renders with FLUX schnell.
  flux: 'flux-schnell',
  'sdxl-community': 'sdxl',
  'yue2-music': 'yue',
  'yue2-cover': 'yue',
};

const PATTERNS: [RegExp, string][] = [
  [/flux.*(pro|ultra)/i, 'flux-pro'],
  [/flux.*schnell/i, 'flux-schnell'],
  [/flux/i, 'flux-dev'],
  [/seedream-[4-9]/i, 'seedream-5'],
  [/seedream/i, 'seedream'],
  [/seedance/i, 'seedance'],
  [/dall-e-3/i, 'dall-e-3'],
  [/sora/i, 'sora-2'],
  [/sd3/i, 'sd3.5'],
  [/sdxl/i, 'sdxl'],
  [/minimax-h|hailuo/i, 'minimax-h3'],
  [/kling.*lipsync/i, 'kling-lipsync'],
  [/kling/i, 'kling-video'],
  [/^ray-/i, 'luma-ray2'],
  [/qwen-image/i, 'qwen-image'],
  [/^ltx/i, 'ltx'],
  [/ace-step/i, 'ace-step'],
  [/yue/i, 'yue'],
  [/hunyuan3d/i, 'hunyuan3d'],
];

function slugFor(modelId: string): string | null {
  const exact = EXACT[modelId];
  if (exact) return exact;
  return PATTERNS.find(([re]) => re.test(modelId))?.[1] ?? null;
}

export interface ModelPreview {
  src: string;
  /** A short muted loop of the family's showcase clip, else null. */
  video: string | null;
  /** Credit the picture's licence requires on screen, else null. */
  credit: string | null;
}

/**
 * The picker picture for a model row: the admin's own when set, else the
 * family's bundled one, else null (the studio draws its category art).
 */
export function modelPreview(modelId: string, adminThumbnail: string | null): ModelPreview | null {
  const own = adminThumbnail?.trim();
  // An admin's picture replaces the family's clip too: it may not be the same model.
  if (own) return { src: own, video: null, credit: null };
  const slug = slugFor(modelId);
  if (!slug || !SAMPLE_SLUGS.has(slug)) return null;
  return {
    src: `/model-samples/${slug}.webp`,
    video: VIDEO_SLUGS.has(slug) ? `/model-samples/${slug}.mp4` : null,
    credit: ATTRIBUTION[slug] ?? null,
  };
}
