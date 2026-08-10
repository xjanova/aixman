import type { ParameterBinding, UiWorkflow } from './comfy-convert';
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
  /** Filename of an uploaded audio track (lip-sync, audio-driven video). */
  audioFilename?: string;
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
  /** Rough seconds of render per output second, for the first ETA before history exists. */
  baselineSecondsPerUnit: number;
}

const GB = 1024 ** 3;

// ---------------------------------------------------------------------------
// MiniMax H3 — video with native synchronised audio
// ---------------------------------------------------------------------------
// Template: video_minimax_h3_t2v.json. Everything lives inside one subgraph
// (outer node 105), so converted ids are prefixed `105_`.
const MINIMAX_H3: CatalogEntry = {
  key: 'minimax-h3',
  name: 'MiniMax H3 (Hailuo 3.0)',
  kind: 'video',
  outputKind: 'video',
  description: 'วิดีโอพร้อมเสียงในตัว คุณภาพสูงสุดในกลุ่ม • ใช้เวลานานและกินการ์ดใหญ่',
  template: minimaxH3Template as UiWorkflow,
  downloads: [
    // Pruned INT8 — the bf16 original is 66 GB and needs 4× H100.
    { repo: 'Comfy-Org/MiniMax-H3', file: 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors', dest: 'diffusion_models', bytes: 20_970_379_616 },
    { repo: 'Comfy-Org/MiniMax-H3', file: 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', dest: 'text_encoders', bytes: 15_687_142_551 },
    { repo: 'Comfy-Org/MiniMax-H3', file: 'vae/minimax_h3_video_vae_fp16.safetensors', dest: 'vae', bytes: 5_207_808_496 },
    { repo: 'Comfy-Org/MiniMax-H3', file: 'vae/minimax_h3_audio_vae_fp32.safetensors', dest: 'vae', bytes: 605_254_808 },
  ],
  hardware: { minVramMb: 24576, diskGb: 120, gpuModels: ['RTX 5090', 'RTX 4090', 'RTX PRO 6000'], minCudaVersion: '12.8' },
  bind: (p) => [
    { nodeId: '105_104', input: 'prompt', value: p.prompt },
    { nodeId: '105_104', input: 'width', value: p.width },
    { nodeId: '105_104', input: 'height', value: p.height },
    // MiniMax H3's latent temporal compression only accepts length % 17 === 5.
    { nodeId: '105_104', input: 'length', value: minimaxFrameLength(p.durationSeconds, p.fps) },
    { nodeId: '105_15', input: 'noise_seed', value: p.seed },
    // Cosmetic: the template's own defaults are fine if these ever move.
    { nodeId: '105_91', input: 'fps', value: p.fps, optional: true },
    { nodeId: '92', input: 'filename_prefix', value: 'video/aixman', optional: true },
  ],
  baselineSecondsPerUnit: 48,
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
  hardware: { minVramMb: 12288, diskGb: 60, gpuModels: [], minCudaVersion: '12.8' },
  bind: (p) => [
    // Input names differ across ACE-Step revisions; first match wins. These are
    // NOT verified against a live worker yet — if none matches, the job fails
    // loudly and the model stays in 'tuning' rather than rendering the
    // template's demo K-pop track and charging for it.
    { nodeId: '94', input: ['tags', 'text', 'prompt', 'caption'], value: p.prompt },
    // Lyrics are a bonus; a song still renders from the tags alone.
    { nodeId: '94', input: ['lyrics'], value: p.negativePrompt ?? '', optional: true },
    { nodeId: '98', input: ['seconds', 'duration', 'length'], value: Math.min(240, Math.max(5, p.durationSeconds)) },
    { nodeId: '3', input: ['seed', 'noise_seed'], value: p.seed },
    { nodeId: '3', input: 'steps', value: p.steps ?? 8, optional: true },
    { nodeId: '107', input: 'filename_prefix', value: 'audio/aixman', optional: true },
  ],
  baselineSecondsPerUnit: 3,
};

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
  hardware: { minVramMb: 24576, diskGb: 90, gpuModels: ['RTX 5090', 'RTX PRO 6000', 'RTX 4090'], minCudaVersion: '12.8' },
  bind: (p) => [
    // 6 and 7 are positive and negative. Binding by id rather than by class is
    // deliberate — two CLIPTextEncode nodes are indistinguishable by type and
    // swapping them silently inverts the prompt.
    { nodeId: '76_6', input: 'text', value: p.prompt },
    { nodeId: '76_7', input: 'text', value: p.negativePrompt ?? '' },
    { nodeId: '76_58', input: 'width', value: p.width },
    { nodeId: '76_58', input: 'height', value: p.height },
    { nodeId: '76_3', input: ['seed', 'noise_seed'], value: p.seed },
    { nodeId: '76_3', input: 'steps', value: p.steps ?? 8, optional: true },
    { nodeId: '60', input: 'filename_prefix', value: 'image/aixman', optional: true },
  ],
  baselineSecondsPerUnit: 12,
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
