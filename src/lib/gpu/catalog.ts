import type { ParameterBinding, UiWorkflow } from './comfy-convert';
import type { DurationCurve } from '@/lib/pricing';
import minimaxH3Template from './workflows/templates/minimax_h3_t2v.json';
import aceStepTemplate from './workflows/templates/ace_step_1_5.json';
import qwenImageTemplate from './workflows/templates/qwen_image.json';

/**
 * Catalogue of self-hostable models customers can choose from.
 *
 * Every entry pairs an **official Comfy-Org workflow template** (vendored under
 * `workflows/templates/` so node ids are pinned and reviewable) with the exact
 * weight files it needs and the hardware to run them. Adding a model is a data
 * change here, not new workflow code — `comfy-convert` turns the template into
 * the API format at run time.
 *
 * Sizes were read from the Hugging Face API, not from memory. They decide which
 * GPU gets rented, so a wrong number means either a rental that cannot load the
 * model or one that costs more than it needs to.
 */

/** Where a file has to land inside ComfyUI's `models/` directory. */
export type ModelDest =
  | 'diffusion_models'
  | 'text_encoders'
  | 'vae'
  | 'loras'
  | 'checkpoints'
  | 'audio_encoders'
  | 'clip_vision';

export interface ModelDownload {
  repo: string;
  /** Path within the repo — often nested under `split_files/`. */
  file: string;
  dest: ModelDest;
  /** Bytes, for the disk estimate and for showing progress honestly. */
  bytes: number;
  /**
   * Save under this name instead of the repo's basename. Required when a
   * template hardcodes a filename the upstream repo does not use — the TalkVid
   * LoRA ships as `lora_weights.safetensors` but the workflow asks for
   * `ltx-2.3-id-lora-talkvid-3k.safetensors`, and a mismatch shows up only as
   * an empty dropdown at render time.
   */
  as?: string;
}

export interface CatalogJobParams {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  seed: number;
  steps?: number;
  /** Filename of an image the customer uploaded into ComfyUI's input dir. */
  imageFilename?: string;
  /** Same, for the frame a video must end on (first-and-last-frame mode). */
  lastImageFilename?: string;
  /** Filename of an uploaded audio track (lip-sync, audio-driven video). */
  audioFilename?: string;
  /** Song lyrics (music models). Empty means an instrumental. */
  lyrics?: string;
  /** Output resolution preset id from `CatalogEntry.video.resolutions`. */
  resolution?: string;
}

/** A resolution the studio may offer for a video model, per aspect ratio. */
export interface VideoResolutionOption {
  id: string;
  /** Thai/number label shown in the studio. */
  label: string;
  /** Aspect ratios (studio values, e.g. "16:9") this preset applies to. */
  aspects: string[];
  /** The one a request without a `resolution` gets. */
  isDefault?: boolean;
  /**
   * Only admins see it and can order it: an experiment whose GPU time the
   * price does not cover yet. Anyone else asking for it gets the default.
   */
  adminOnly?: boolean;
}

export interface CatalogEntry {
  /** Matches `ai_models.modelId`, and doubles as the worker profile key. */
  key: string;
  name: string;
  kind: 'video' | 'image' | 'audio' | 'lipsync';
  /** What the job produces, so the queue knows how to store it. */
  outputKind: 'video' | 'image' | 'audio';
  /** Thai copy shown to the customer. */
  description: string;
  template: UiWorkflow;
  downloads: ModelDownload[];
  hardware: {
    minVramMb: number;
    diskGb: number;
    gpuModels: string[];
    minCudaVersion?: string;
  };
  /**
   * Custom node packs to install into `ComfyUI/custom_nodes` before starting.
   * Core ComfyUI covers most of the catalogue, but some official templates use
   * community nodes (Chatterbox TTS is `FL_*`, from a third-party pack) and
   * without them ComfyUI reports the node as missing at submit time.
   */
  customNodes?: { repo: string; ref?: string }[];
  /** Node classes to strip — paid API nodes the template demoed with. */
  prune?: string[];
  /** Extra nodes to add, e.g. a LoadAudio for an uploaded track. */
  inject?: (p: CatalogJobParams) => Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  bind: (p: CatalogJobParams) => ParameterBinding[];
  /** Uploads the customer must supply before this model can run. */
  needs?: { image?: boolean; audio?: boolean };
  /**
   * Optional video controls the studio can offer for this model: a first
   * frame, a last frame, and resolution presets. Sent to the client by
   * `/api/models`; the job honours them through `inject`/`bind`.
   */
  video?: {
    firstFrame?: boolean;
    lastFrame?: boolean;
    resolutions?: VideoResolutionOption[];
  };
  /** Rough seconds of render per output second, for the first ETA before history exists. */
  baselineSecondsPerUnit: number;
  /**
   * What the customer pays and what it costs us. Kept here so the catalogue is
   * the single source of truth: the setup route creates the `ai_models` rows
   * from this, rather than a second hand-maintained list that can drift.
   */
  pricing: { creditsPerUnit: number; costPerUnit: number; durationCurve?: DurationCurve };
  limits?: { maxWidth?: number; maxHeight?: number; maxDuration?: number };
}

const GB = 1024 ** 3;

// ---------------------------------------------------------------------------
// MiniMax H3 — video with native synchronised audio
// ---------------------------------------------------------------------------
// Template: video_minimax_h3_t2v.json. Everything lives inside one subgraph
// (outer node 105), so converted ids are prefixed `105_`.
/**
 * Turbo LoRAs from lightx2v / ModelTC, repackaged by Comfy-Org (Apache-2.0 —
 * unlike the base weights, which carry the MiniMax community licence). Each is
 * distilled for one resolution family, step count and sigma shift, and mixing
 * those up costs quality in a way nothing in the pipeline would flag. From
 * ModelTC's spec table:
 *
 *   4-step v1.0 768p   1344x768 only        shift 6/3    4 steps
 *   8-step v1.0        544p, mixed aspect   shift 12/3   8 steps
 *
 * Landscape uses the 768p one: sharpest, and the first one proven here. Other
 * shapes must not. On the first real 9:16 render it drew a second dancer lying
 * sideways across the frame and turned the temple behind her through 90
 * degrees — it was trained on landscape only. The mixed-aspect LoRA was
 * trained for exactly those shapes.
 */
interface H3Turbo {
  lora: string;
  /** Distilled to this count; any other value degrades it. */
  steps: number;
  shiftVideo: number;
  shiftAudio: number;
}

const H3_TURBO_768P: H3Turbo = {
  lora: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
  steps: 4,
  shiftVideo: 6,
  shiftAudio: 3,
};

const H3_TURBO_MIXED: H3Turbo = {
  lora: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
  steps: 8,
  shiftVideo: 12,
  shiftAudio: 3,
};

/** 960x544: the pixel count the mixed-aspect LoRA was trained at. */
const H3_MIXED_PIXELS = 960 * 544;

/** The turbo workflow swaps the base template's res_multistep for euler. */
const MINIMAX_H3_TURBO_SAMPLER = 'euler';

/** H3 generates at 24 fps; its frame-count grid is defined in those frames. */
const MINIMAX_H3_FPS = 24;

/** Round to the model's size step, falling back when the input is unusable. */
function snap(value: number, step: number, fallback: number): number {
  const n = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.max(step, Math.round(n / step) * step);
}

/**
 * Landscape resolution presets for H3. Only 16:9 has a choice: portrait and
 * square exist only at the mixed-aspect LoRA's own size.
 *
 *   768p   render 1344x768 on the 768p LoRA, keep it
 *   720p   render 1344x768 on the 768p LoRA, resize the decoded frames to
 *          1280x720 (whole frame scaled, nothing cropped)
 *   544p   render 960x544 on the mixed-aspect LoRA — about the same cost
 *   1080p  admins only, an experiment: render 1920x1088 on the 768p LoRA,
 *          resize to 1920x1080
 *
 * 720 is not a size H3 can render natively (dimensions go in steps of 32), and
 * the 768p LoRA is distilled for 1344x768 only, so 720p is produced by scaling
 * a native render rather than by asking the model for a size it never saw.
 *
 * 1080p does ask for one. H3-Base is trained for a 768 px short side; the
 * official 2K comes from H3-Regenerate-2K, which is not open-source. So this is
 * the base model and the 768p LoRA pushed to twice the tokens per frame — to
 * measure what that costs and how it looks, not to sell. It is priced like 768p
 * while taking roughly three times the GPU, and a 15 s clip may not finish
 * inside the job timeout, so customers never see it.
 *
 * Measured on prod 2026-09-13, A100-SXM4-40GB, first-frame mode:
 *
 *   720p   5 s   122 s          15 s   587–669 s
 *   1080p  5 s   350 s (2.87x)  15 s   not run — about 34–37 min expected
 *
 * The 1080p output held up (no duplicated limbs or tiling) and is visibly
 * sharper. The 15 s figure comes from cost ∝ tokens + tokens², which predicted
 * both measured ratios (2.9x for 1080p at 5 s, 5.45x for 15 s over 5 s at 768p)
 * — past the 30 min job timeout, with twice the tokens of a 15 s 768p render
 * that 40 GB has not yet been shown to hold. Selling it would take a price
 * that grows with resolution as well as length.
 */
export const H3_RESOLUTIONS: VideoResolutionOption[] = [
  { id: '768p', label: '768p · 1344×768', aspects: ['16:9'], isDefault: true },
  { id: '720p', label: '720p · 1280×720', aspects: ['16:9'] },
  { id: '544p', label: '544p · 960×544', aspects: ['16:9'] },
  { id: '1080p', label: '1080p · 1920×1080 (ทดลอง · แอดมิน)', aspects: ['16:9'], adminOnly: true },
];

/** Whether `resolution` names one of this model's admin-only presets. */
export function isAdminOnlyPreset(modelKey: string, resolution: unknown): boolean {
  return getCatalogEntry(modelKey)?.video?.resolutions?.some((r) => r.adminOnly && r.id === resolution) === true;
}

/**
 * The video controls one caller may see: admin-only presets are left out for
 * everyone else. Null for a model without any.
 */
export function visibleVideoOptions(entry: CatalogEntry | undefined, admin: boolean): CatalogEntry['video'] | null {
  if (!entry?.video) return null;
  const { resolutions } = entry.video;
  return resolutions ? { ...entry.video, resolutions: resolutions.filter((r) => admin || !r.adminOnly) } : entry.video;
}

export interface H3RenderPlan {
  turbo: H3Turbo;
  width: number;
  height: number;
  /** Resize decoded frames to this before encoding, when the preset asks. */
  output?: { width: number; height: number };
}

/**
 * Which turbo LoRA a frame gets, the size to render it at, and any resize after
 * decode.
 *
 * 16:9 is 1.78, so the 1.6 cut keeps every landscape preset on the 768p LoRA
 * (always at exactly 1344x768 — "1344x768 only" in ModelTC's table) and sends
 * 3:2 and anything squarer to the mixed-aspect one, rescaled to the pixel count
 * it was trained at — 9:16 renders at 544x960, 1:1 at 736x736. Eight steps at
 * 544p costs about what four at 768p do, so one price holds.
 */
export function h3RenderPlan(width: number, height: number, resolution?: string): H3RenderPlan {
  const w = Number.isFinite(width) && width > 0 ? width : 1344;
  const h = Number.isFinite(height) && height > 0 ? height : 768;
  if (w / h >= 1.6) {
    if (resolution === '544p') return { turbo: H3_TURBO_MIXED, width: 960, height: 544 };
    // Admin-only experiment — see H3_RESOLUTIONS. 1088 is the nearest 32 px step.
    if (resolution === '1080p') {
      return { turbo: H3_TURBO_768P, width: 1920, height: 1088, output: { width: 1920, height: 1080 } };
    }
    return {
      turbo: H3_TURBO_768P,
      width: 1344,
      height: 768,
      output: resolution === '720p' ? { width: 1280, height: 720 } : undefined,
    };
  }
  const scale = Math.sqrt(H3_MIXED_PIXELS / (w * h));
  return { turbo: H3_TURBO_MIXED, width: snap(w * scale, 32, 544), height: snap(h * scale, 32, 960) };
}

/**
 * Node ids added to the converted H3 graph. Prefixed like the template's own
 * flattened subgraph nodes so they read as part of the same pipeline.
 */
const H3_FIRST_FRAME_NODE = '105_300';
const H3_LAST_FRAME_NODE = '105_301';
const H3_RESIZE_NODE = '105_310';

const MINIMAX_H3: CatalogEntry = {
  key: 'minimax-h3',
  name: 'MiniMax H3 (Hailuo 3.0)',
  kind: 'video',
  outputKind: 'video',
  description: 'วิดีโอพร้อมเสียงในตัว คุณภาพสูงสุดในกลุ่ม • ใช้เวลาสร้างนานกว่าโมเดลอื่น',
  template: minimaxH3Template as UiWorkflow,
  downloads: [
    // Pruned INT8 — the bf16 original is 66 GB and needs 4× H100.
    { repo: 'Comfy-Org/MiniMax-H3', file: 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors', dest: 'diffusion_models', bytes: 20_970_379_616 },
    { repo: 'Comfy-Org/MiniMax-H3', file: 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', dest: 'text_encoders', bytes: 15_687_142_551 },
    { repo: 'Comfy-Org/MiniMax-H3', file: 'vae/minimax_h3_video_vae_fp16.safetensors', dest: 'vae', bytes: 5_207_808_496 },
    { repo: 'Comfy-Org/MiniMax-H3', file: 'vae/minimax_h3_audio_vae_fp32.safetensors', dest: 'vae', bytes: 605_254_808 },
    // 1.9 GB against 42.5 GB of base weights — it barely moves warmup, and it
    // is what turns a 20-step render into a 4-step one.
    { repo: 'Comfy-Org/MiniMax-H3', file: 'loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors', dest: 'loras', bytes: 1_956_192_992 },
    // Portrait and square — the 768p LoRA only knows landscape (H3_TURBO_MIXED).
    { repo: 'Comfy-Org/MiniMax-H3', file: 'loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', dest: 'loras', bytes: 1_956_193_000 },
  ],
  // A100 40 GB is on the list because on SimplePod it was the cheapest card
  // with room for these weights ($0.48/hr against $0.72 for a 5090, measured
  // 2026-09-11). int8 and the nvfp4 text encoder do not need Blackwell.
  hardware: { minVramMb: 24576, diskGb: 120, gpuModels: ['A100', 'RTX 5090', 'RTX PRO 6000', 'RTX 4090'] },
  /**
   * Splice the turbo chain into the model path:
   *
   *   UNETLoader#6 -> LoraLoaderModelOnly#119 -> MiniMaxH3SigmaShift#120 -> guider + scheduler
   *
   * Node ids and ordering are copied from ModelTC's own
   * `example_workflows/video_minimax_h3_t2v_lightx2v_turbo.json`, so this graph
   * matches the one the LoRA was published with rather than an arrangement we
   * invented. Both new classes ship with core ComfyUI's MiniMax H3 support; a
   * worker too old to have `MiniMaxH3SigmaShift` fails validation loudly rather
   * than rendering at the wrong shift.
   */
  inject: (p) => {
    const plan = h3RenderPlan(p.width, p.height, p.resolution);
    const { turbo } = plan;
    const nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
      '105_119': {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          model: ['105_6', 0],
          lora_name: turbo.lora,
          strength_model: 1,
        },
      },
      '105_120': {
        class_type: 'MiniMaxH3SigmaShift',
        inputs: {
          model: ['105_119', 0],
          shift_video: turbo.shiftVideo,
          shift_audio: turbo.shiftAudio,
        },
      },
    };
    // First-and-last-frame mode: the template is text-to-video and leaves both
    // sockets unwired, so the uploaded stills need loaders of their own.
    if (p.imageFilename) {
      nodes[H3_FIRST_FRAME_NODE] = { class_type: 'LoadImage', inputs: { image: p.imageFilename } };
    }
    if (p.lastImageFilename) {
      nodes[H3_LAST_FRAME_NODE] = { class_type: 'LoadImage', inputs: { image: p.lastImageFilename } };
    }
    // 720p / 1080p: scale the decoded frames (whole frame, no crop) before CreateVideo.
    if (plan.output) {
      nodes[H3_RESIZE_NODE] = {
        class_type: 'ImageScale',
        inputs: {
          image: ['105_10', 0],
          upscale_method: 'lanczos',
          width: plan.output.width,
          height: plan.output.height,
          crop: 'disabled',
        },
      };
    }
    return nodes;
  },
  bind: (p) => {
    const plan = h3RenderPlan(p.width, p.height, p.resolution);
    const frames: ParameterBinding[] = [
      ...(p.imageFilename
        ? [{ nodeId: '105_104', input: 'first_frame', value: [H3_FIRST_FRAME_NODE, 0], connect: true }]
        : []),
      ...(p.lastImageFilename
        ? [{ nodeId: '105_104', input: 'last_frame', value: [H3_LAST_FRAME_NODE, 0], connect: true }]
        : []),
      // Re-point CreateVideo's frames at the resize; the VAEDecode stays its input.
      ...(plan.output ? [{ nodeId: '105_91', input: 'images', value: [H3_RESIZE_NODE, 0] }] : []),
    ];
    return [
      ...frames,
      { nodeId: '105_104', input: 'prompt', value: p.prompt },
      // Sized for the chosen LoRA, in the node's 32 px steps (ComfyUI does not
      // enforce step, the model does).
      { nodeId: '105_104', input: 'width', value: plan.width },
      { nodeId: '105_104', input: 'height', value: plan.height },
      // MiniMax H3's latent temporal compression only accepts length % 17 === 5,
      // counted at its native 24 fps — a caller's fps must not change the maths.
      { nodeId: '105_104', input: 'length', value: minimaxFrameLength(p.durationSeconds, MINIMAX_H3_FPS) },
      { nodeId: '105_15', input: 'noise_seed', value: p.seed },

      // Move BOTH model consumers onto the turbo chain. Leaving BasicScheduler on
      // the raw UNET would build a 20-step sigma curve and hand it to a model
      // distilled for 4 — which still renders, so nothing would catch it except
      // the output looking wrong.
      { nodeId: '105_16', input: 'model', value: ['105_120', 0] },
      { nodeId: '105_9', input: 'model', value: ['105_120', 0] },
      // Fixed per LoRA, not taken from `p.steps`.
      { nodeId: '105_9', input: 'steps', value: plan.turbo.steps },
      { nodeId: '105_17', input: 'sampler_name', value: MINIMAX_H3_TURBO_SAMPLER },

      // Cosmetic: the template's own defaults are fine if these ever move.
      { nodeId: '105_91', input: 'fps', value: MINIMAX_H3_FPS, optional: true },
      { nodeId: '92', input: 'filename_prefix', value: 'video/aixman', optional: true },
    ];
  },
  // Estimate, and only used until this deployment has real history. Derived
  // from the one public 1344x768 measurement on a 5090-class card (5s at ~10
  // steps = 335s) scaled to 4 steps, with headroom left because VAE decode and
  // model load do not shrink with step count. The previous value of 48 was a
  // guess that never matched the 20-step config it described (~126 measured).
  baselineSecondsPerUnit: 36,
  // The base price covers 5 s; longer clips follow the render's measured cost
  // growth (lib/pricing.ts) — at 12 credits, 10 s is 34 and 15 s is 63.
  pricing: { creditsPerUnit: 12, costPerUnit: 0.05, durationCurve: { unitSeconds: 5, exponent: 1.5 } },
  limits: { maxWidth: 1344, maxHeight: 768, maxDuration: 15 },
  // H3-Base-FL2VA takes zero, one or two stills: text-to-video, first-frame,
  // or first-and-last-frame (model card, "Model Variants").
  video: { firstFrame: true, lastFrame: true, resolutions: H3_RESOLUTIONS },
};

/** length % 17 === 5, with Python modulo semantics — JS `%` would go negative. */
function minimaxFrameLength(durationSeconds: number, fps: number): number {
  const raw = Math.max(5, Math.round(durationSeconds * (fps || 24)));
  return raw + ((((5 - (raw % 17)) % 17) + 17) % 17);
}

// ---------------------------------------------------------------------------
// ACE-Step 1.5 — music and audio
// ---------------------------------------------------------------------------
// Template: audio_ace_step_1_5_split.json. Flat graph, so ids are as authored.
// The lightest model in the catalogue by a wide margin — it runs happily on the
// cheapest card available, which is what makes audio cheap to sell.
const ACE_STEP: CatalogEntry = {
  key: 'ace-step-1.5',
  name: 'ACE-Step 1.5 (เพลง/เสียง)',
  kind: 'audio',
  outputKind: 'audio',
  description: 'สร้างเพลงและเสียงจากคำอธิบาย • เบาที่สุด เร็วและถูกที่สุดในระบบ',
  template: aceStepTemplate as UiWorkflow,
  downloads: [
    { repo: 'Comfy-Org/ace_step_1.5_ComfyUI_files', file: 'split_files/diffusion_models/acestep_v1.5_turbo.safetensors', dest: 'diffusion_models', bytes: 4_787_825_604 },
    { repo: 'Comfy-Org/ace_step_1.5_ComfyUI_files', file: 'split_files/text_encoders/qwen_0.6b_ace15.safetensors', dest: 'text_encoders', bytes: 1_191_588_248 },
    { repo: 'Comfy-Org/ace_step_1.5_ComfyUI_files', file: 'split_files/text_encoders/qwen_1.7b_ace15.safetensors', dest: 'text_encoders', bytes: 3_708_523_360 },
    { repo: 'Comfy-Org/ace_step_1.5_ComfyUI_files', file: 'split_files/vae/ace_1.5_vae.safetensors', dest: 'vae', bytes: 337_431_732 },
  ],
  // Any card that holds it — but not *any* name: the CUDA 13 image has no
  // kernels for Volta, and the market's cheapest 16 GB cards are V100s that
  // report a CUDA 13 driver. Unfiltered, this would rent one and fail at the
  // first tensor. Every entry here is Turing or newer.
  hardware: { minVramMb: 12288, diskGb: 60, gpuModels: ['RTX', 'A100', 'A40', 'A10', 'L4', 'H100', 'H200'] },
  bind: (p) => [
    // Input names differ across ACE-Step revisions; first match wins. Verified
    // against ComfyUI v0.35.1's /prompt validation (see provision.ts); if a
    // later version renames them the job fails loudly and the model stays in
    // 'tuning' rather than rendering the template's demo K-pop track.
    { nodeId: '94', input: ['tags', 'text', 'prompt', 'caption'], value: p.prompt },
    // Lyrics come from the studio's own field; older callers put them in
    // negativePrompt. None at all asks for an instrumental outright — an empty
    // string leaves the model to hum made-up syllables over the track.
    { nodeId: '94', input: ['lyrics'], value: (p.lyrics ?? p.negativePrompt ?? '').trim() || '[instrumental]', optional: true },
    // The template feeds one duration and one seed to *two* nodes through
    // editor-only primitives. The text encoder plans the song for its own
    // duration, so binding only the latent would write a 30 s clip of a song
    // composed for the template's 120 s.
    { nodeId: '98', input: ['seconds', 'duration', 'length'], value: aceDuration(p.durationSeconds) },
    { nodeId: '94', input: ['duration'], value: aceDuration(p.durationSeconds) },
    { nodeId: '3', input: ['seed', 'noise_seed'], value: p.seed },
    { nodeId: '94', input: ['seed'], value: p.seed },
    { nodeId: '3', input: 'steps', value: p.steps ?? 8, optional: true },
    { nodeId: '107', input: 'filename_prefix', value: 'audio/aixman', optional: true },
  ],
  baselineSecondsPerUnit: 3,
  pricing: { creditsPerUnit: 4, costPerUnit: 0.01 },
  limits: { maxDuration: 240 },
};

function aceDuration(seconds: number): number {
  return Math.min(240, Math.max(5, seconds));
}

// ---------------------------------------------------------------------------
// Qwen-Image — stills
// ---------------------------------------------------------------------------
// Template: image_qwen_image.json. Only SaveImage (60) sits outside the
// subgraph (76); everything else converts to `76_*` ids.
const QWEN_IMAGE: CatalogEntry = {
  key: 'qwen-image',
  name: 'Qwen-Image',
  kind: 'image',
  outputKind: 'image',
  description: 'สร้างภาพนิ่งคุณภาพสูง เก่งเรื่องตัวอักษรทั้งไทยและอังกฤษ • ใช้ LoRA 8 สเต็ป เร็วกว่าปกติมาก',
  template: qwenImageTemplate as UiWorkflow,
  downloads: [
    { repo: 'Comfy-Org/Qwen-Image_ComfyUI', file: 'split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors', dest: 'diffusion_models', bytes: 20_430_635_136 },
    { repo: 'Comfy-Org/Qwen-Image_ComfyUI', file: 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors', dest: 'text_encoders', bytes: 9_384_670_680 },
    { repo: 'Comfy-Org/Qwen-Image_ComfyUI', file: 'split_files/vae/qwen_image_vae.safetensors', dest: 'vae', bytes: 253_806_246 },
    // The template's LoraLoaderModelOnly expects this exact filename.
    { repo: 'lightx2v/Qwen-Image-Lightning', file: 'Qwen-Image-Lightning-8steps-V1.0.safetensors', dest: 'loras', bytes: 1_698_951_104 },
  ],
  hardware: { minVramMb: 24576, diskGb: 90, gpuModels: ['A100', 'RTX 5090', 'RTX PRO 6000', 'RTX 4090'] },
  bind: (p) => [
    // 6 and 7 are positive and negative. Binding by id rather than by class is
    // deliberate — two CLIPTextEncode nodes are indistinguishable by type and
    // swapping them silently inverts the prompt.
    { nodeId: '76_6', input: 'text', value: p.prompt },
    { nodeId: '76_7', input: 'text', value: p.negativePrompt ?? '' },
    // Qwen-Image's latent patches need multiples of 16.
    { nodeId: '76_58', input: 'width', value: snap(p.width, 16, 1328) },
    { nodeId: '76_58', input: 'height', value: snap(p.height, 16, 1328) },
    { nodeId: '76_3', input: ['seed', 'noise_seed'], value: p.seed },
    // The template ships with its Lightning switch OFF: the model path skips the
    // LoRA and cfg comes out at 4. Left that way, forcing 8 steps renders the
    // base model undercooked at the wrong cfg — valid to ComfyUI, visibly bad.
    // This one boolean moves model and cfg onto the Lightning branch together.
    { nodeId: '76_86', input: 'value', value: true },
    // Distilled to 8; the switch would pick 8 too, but pinning it means a
    // caller-supplied step count cannot drag it off the distilled schedule.
    { nodeId: '76_3', input: 'steps', value: 8 },
    { nodeId: '60', input: 'filename_prefix', value: 'image/aixman', optional: true },
  ],
  baselineSecondsPerUnit: 12,
  pricing: { creditsPerUnit: 3, costPerUnit: 0.02 },
  limits: { maxWidth: 1328, maxHeight: 1328 },
};

export const MODEL_CATALOG: CatalogEntry[] = [MINIMAX_H3, ACE_STEP, QWEN_IMAGE];

export function getCatalogEntry(key: string): CatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.key === key);
}

/** Total download size, used for the disk estimate and warmup expectations. */
export function downloadBytes(entry: CatalogEntry): number {
  return entry.downloads.reduce((sum, d) => sum + d.bytes, 0);
}

export function downloadGb(entry: CatalogEntry): number {
  return Number((downloadBytes(entry) / GB).toFixed(1));
}
