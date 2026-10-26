import type { ClipRule } from '@/lib/lipsync-rules';
import type { ParameterBinding, UiWorkflow } from './comfy-convert';
import type { DurationCurve } from '@/lib/pricing';
import {
  composeMusicTags,
  musicComplexity,
  musicVariance,
  type MusicStyleParams,
} from '@/lib/music-style';
import type { GpuArch } from './gpu-specs';
import type { LengthFromAudio } from '@/lib/voice-length';
import {
  SAMPLER_OPTIONS,
  SCHEDULER_OPTIONS,
  tunableReader,
  type QualityMode,
  type TunableValue,
  type WorkflowTunable,
} from './tunables';
import minimaxH3Template from './workflows/templates/minimax_h3_t2v.json';
import ltx25I2vTemplate from './workflows/templates/ltx25_i2v.json';
import aceStepTemplate from './workflows/templates/ace_step_1_5.json';
import qwenImageTemplate from './workflows/templates/qwen_image.json';
import yue2Text2MusicTemplate from './workflows/templates/yue2_text2music.json';
import yue2MusicCoverTemplate from './workflows/templates/yue2_music_cover.json';
import hunyuan3d21Template from './workflows/templates/hunyuan3d21_image_to_3d.json';
import latentsyncTemplate from './workflows/templates/latentsync16_video_dub.json';

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
  | 'clip_vision'
  | 'latent_upscale_models'
  // Not a ComfyUI folder: the LatentSync pack loads its own weights, and the
  // setup script links these where it (and whisper, and face-alignment) look.
  | 'latentsync'
  | 'latentsync/vae'
  | 'latentsync/whisper'
  | 'latentsync/face';

export interface ModelDownload {
  repo: string;
  /** Path within the repo — often nested under `split_files/`. */
  file: string;
  dest: ModelDest;
  /** Bytes, for the disk estimate and for showing progress honestly. */
  bytes: number;
  /**
   * Save under this name instead of the repo's basename. Required when a
   * template hardcodes a filename the upstream repo does not use — Hunyuan3D's
   * DiT ships as `model.fp16.ckpt` but the workflow asks for
   * `hunyuan3d-dit-v2-1-fp16.ckpt`, and a mismatch shows up only as an empty
   * dropdown at render time.
   */
  as?: string;
}

/** A community node pack, pinned. */
export interface CustomNodePack {
  repo: string;
  ref?: string;
  /**
   * `false` skips the pack's requirements.txt. For a pack whose list pins
   * something that cannot install on the worker — a failed install fails the
   * boot — and whose entry's setup script installs what it really needs.
   */
  requirements?: boolean;
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
  /** Filename of an uploaded clip to re-dub (video lip-sync). */
  videoFilename?: string;
  /** Song lyrics (music models). Empty means an instrumental. */
  lyrics?: string;
  /**
   * Suno-style song controls: who sings, in what genre, at what tempo, with
   * which instruments, how dense. Composed into the model's `[Tags]` text by
   * `composeMusicTags`, except the two that are real node inputs —
   * `complexity` picks `mode` and `variance` is `temperature`.
   */
  music?: MusicStyleParams;
  /** Output resolution preset id from `CatalogEntry.video.resolutions`. */
  resolution?: string;
  /**
   * Checkpoint files this particular worker has on disk, read from its own
   * `/object_info`.
   *
   * A rented machine gets exactly the weights the entry declares in
   * `downloads`, so its list is known before it is asked. A community machine
   * is somebody's gaming PC: it arrives with whatever its owner happened to
   * download, and naming a file it does not have fails the job at validation
   * with "the model download did not complete" — which on a home node is not
   * even true. An entry that can serve community capacity picks from this.
   */
  checkpoints?: string[];
  /**
   * The entry's tunables for this job: its declared defaults, overlaid with
   * whatever an admin set in /admin/workflows. Read through `tunableReader`,
   * which falls back to the default for anything missing or out of range.
   */
  tuning?: Record<string, TunableValue>;
  /** Quality mode id, for entries that declare `qualityModes`. */
  quality?: string;
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

/**
 * Which machines may run an entry. `rented`: machines we rent by the second and
 * provision with the entry's own downloads. `community`: GPUxMINE home PCs,
 * which bring whatever weights their owner has and are matched to a model by
 * community-eligibility.ts.
 */
export type CatalogPool = 'rented' | 'community';

export interface CatalogEntry {
  /** Matches `ai_models.modelId`, and doubles as the worker profile key. */
  key: string;
  name: string;
  /**
   * The pools this entry is dispatched to. A home node was once matched to any
   * entry its VRAM could hold, and a 12 GB card got ACE-Step, whose weights no
   * home PC has — customers' paid orders failed there and could take the model
   * off sale. Only entries built for home cards list `community`.
   */
  pools: readonly CatalogPool[];
  kind: 'video' | 'image' | 'audio' | 'lipsync' | 'model3d';
  /** What the job produces, so the queue knows how to store it. */
  outputKind: 'video' | 'image' | 'audio' | 'model3d';
  /** Thai copy shown to the customer. */
  description: string;
  template: UiWorkflow;
  /**
   * Where the vendored template came from — shown on /admin/workflows and used
   * for its export, so an admin can open the same file in ComfyUI.
   */
  source?: { file: string; title: string; url?: string };
  /**
   * Knobs an admin may turn from /admin/workflows without a deploy. The entry's
   * own bind/inject reads them (`tunableReader`), because what a knob means is
   * this entry's business: Qwen-Image's "quality steps" is a switch, a step
   * count and a cfg at once.
   */
  tunables?: WorkflowTunable[];
  /**
   * Quality modes the studio may offer. The chosen id reaches bind as
   * `p.quality`, and GenerationService multiplies the price by the mode's
   * `creditsMultiplier` (which an admin can change, along with who sees it).
   */
  qualityModes?: QualityMode[];
  downloads: ModelDownload[];
  hardware: {
    minVramMb: number;
    diskGb: number;
    /**
     * An allow-list of card names, matched as substrings. Empty means any card
     * gpu-specs.ts knows and places at `minArch` or newer — the offer picker
     * then weighs every one of them on cost and speed.
     */
    gpuModels: string[];
    /** Oldest architecture this model runs on; `MIN_ARCH` (Ampere) when unset. */
    minArch?: GpuArch;
    minCudaVersion?: string;
  };
  /**
   * Custom node packs to install into `ComfyUI/custom_nodes` before starting.
   * Core ComfyUI covers most of the catalogue, but some official templates use
   * community nodes (Chatterbox TTS is `FL_*`, from a third-party pack) and
   * without them ComfyUI reports the node as missing at submit time.
   */
  customNodes?: CustomNodePack[];
  /**
   * For a model whose node pack compiles CUDA code at install: the container
   * to boot instead of the default runtime image (which has no nvcc), and bash
   * run after the node packs are installed and before ComfyUI starts. The
   * script runs inside the generated start script, so its helpers
   * (`pip_install`, `fail_boot`) are in scope. An operator's
   * `gpu_worker_profiles` startScript replaces it.
   */
  runtime?: { image?: string; tag?: string; setupScript?: string };
  /** Node classes to strip — paid API nodes the template demoed with. */
  prune?: string[];
  /** Extra nodes to add, e.g. a LoadAudio for an uploaded track. */
  inject?: (p: CatalogJobParams) => Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  bind: (p: CatalogJobParams) => ParameterBinding[];
  /** Uploads the customer must supply before this model can run. */
  needs?: { image?: boolean; audio?: boolean; video?: boolean };
  /**
   * What a clip to re-dub may be (needs.video): length, picture, file size.
   * GenerationService checks it against the stored file before charging; the
   * limits are what one rented card and its tunnel can take.
   */
  sourceVideo?: ClipRule;
  /**
   * The render is as long as the uploaded audio — a voice track a portrait
   * speaks. GenerationService reads that length from the stored file itself
   * (audio-duration.ts), refuses it outside `minSeconds`…`limits.maxDuration`,
   * rounds it down to `stepSeconds` (the model's frame grid) and prices and
   * renders exactly that; the length a client sends is ignored.
   */
  lengthFromAudio?: LengthFromAudio;
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
  /**
   * Music controls for an audio model, sent to the studio by `/api/models`.
   *
   * `autoLength` is the important one. YuE2 stops at its own end token and the
   * latent is sized from the frames it actually produced, so a song already
   * ends where the song ends — *unless* the token budget runs out first, and
   * that budget is `max_duration`. Letting a customer pick 300 s therefore did
   * not buy a 300 s song, it only decided where the song got cut off. With
   * `autoLength` nobody picks: the model gets `limits.maxDuration` worth of
   * budget and finishes the song it was writing.
   */
  music?: {
    autoLength?: boolean;
    /** Longest song a cover may start from, in seconds; see the upload cap. */
    maxSourceSeconds?: number;
    /** The studio draws the chips and sliders only where they do something. */
    controls?: boolean;
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

/**
 * H3's knobs. The sampler, shifts and step counts default to what each turbo
 * LoRA was distilled for (the table above) — they are exposed so an admin can
 * experiment, and flagged `risky` because nothing downstream would notice a
 * wrong one except the picture.
 */
const H3_TUNABLES: WorkflowTunable[] = [
  {
    id: 'promptStructure',
    label: 'โครงพรอมต์ตามคู่มือทางการของ H3',
    group: 'prompt',
    type: 'choice',
    default: 'frames',
    options: [
      { value: 'frames', label: 'ใส่บรรทัดอ้างอิงภาพเมื่อมีเฟรมแรก/สุดท้าย (แนะนำ)' },
      { value: 'full', label: 'ห่อพรอมต์เป็น 3 ช่องแบบ Context-IR ทุกงาน' },
      { value: 'off', label: 'ส่งพรอมต์ตามที่ลูกค้าพิมพ์ ไม่เติมอะไร' },
    ],
    help:
      'H3-Base ถูกฝึกกับพรอมต์ที่ผ่าน H3-Context-IR ของ MiniMax (ไม่ได้เปิดซอร์ส) — คู่มือทางการกำหนดให้โหมดภาพแรก/ภาพแรก+สุดท้าย ' +
      'ขึ้นต้นด้วยบรรทัดบอกว่าภาพไหนอยู่วินาทีไหน "เสมอ" · โหมด 3 ช่องจะห่อพรอมต์ที่ยังไม่มีโครงเป็น integrated_multimodal_description / ' +
      'overall_soundscape / non_diegetic_music — ถ้าลูกค้ากด "ปรับพรอมต์ด้วย AI" ในสตูดิโอ พรอมต์จะมีโครงครบอยู่แล้วและระบบจะไม่ห่อซ้ำ',
  },
  {
    id: 'soundscapeDefault',
    label: 'overall_soundscape เริ่มต้น',
    group: 'prompt',
    type: 'text',
    maxLength: 600,
    default: 'Natural ambient sound and physical action sounds that match what happens on screen.',
    help: 'ใช้เฉพาะโหมด "ห่อ 3 ช่อง" กับพรอมต์ที่ยังไม่มีโครง · เขียนเป็นภาษาอังกฤษ 1–4 ประโยค ตามคู่มือ',
  },
  {
    id: 'musicDefault',
    label: 'non_diegetic_music เริ่มต้น',
    group: 'prompt',
    type: 'text',
    maxLength: 400,
    default: 'N/A',
    help: 'ดนตรีประกอบที่ตัวละครไม่ได้ยิน ใช้เฉพาะโหมด "ห่อ 3 ช่อง" · N/A = ไม่มีดนตรีประกอบ (เสียงบรรยากาศยังอยู่)',
  },
  {
    id: 'sampler',
    label: 'Sampler',
    group: 'sampler',
    type: 'choice',
    default: MINIMAX_H3_TURBO_SAMPLER,
    options: SAMPLER_OPTIONS,
    risky: true,
    help: 'workflow turbo ของ ModelTC ใช้ euler แทน res_multistep ของเทมเพลตฐาน — เปลี่ยนเพื่อทดลองเท่านั้น',
  },
  {
    id: 'loraStrength',
    label: 'ความแรง Turbo LoRA',
    group: 'sampler',
    type: 'float',
    default: 1,
    min: 0.5,
    max: 1.2,
    step: 0.05,
    risky: true,
    help: 'LoRA เร่งความเร็วถูกกลั่นมาที่ 1.0 — ต่ำกว่านี้ภาพจะดิบขึ้นเพราะสเต็ปไม่พอสำหรับโมเดลฐาน',
  },
  {
    id: 'steps768',
    label: 'สเต็ป · LoRA 768p (แนวนอน)',
    group: 'advanced',
    type: 'int',
    default: H3_TURBO_768P.steps,
    min: 2,
    max: 12,
    risky: true,
    help: 'ModelTC กลั่น LoRA 768p ไว้ที่ 4 สเต็ปพอดี — ค่าอื่นยังเรนเดอร์ได้แต่คุณภาพจะหลุดโดยไม่มีอะไรเตือน',
  },
  {
    id: 'stepsMixed',
    label: 'สเต็ป · LoRA แนวตั้ง/จัตุรัส',
    group: 'advanced',
    type: 'int',
    default: H3_TURBO_MIXED.steps,
    min: 4,
    max: 16,
    risky: true,
    help: 'LoRA mixed-aspect ถูกกลั่นไว้ที่ 8 สเต็ป',
  },
  {
    id: 'shiftVideo768',
    label: 'Sigma shift วิดีโอ · 768p',
    group: 'advanced',
    type: 'float',
    default: H3_TURBO_768P.shiftVideo,
    min: 1,
    max: 20,
    step: 0.5,
    risky: true,
    help: 'ตามตารางสเปกของ ModelTC: 768p ใช้ 6 (ตัวอย่าง workflow ของเขาเองใส่ 12 ซึ่งผิด)',
  },
  {
    id: 'shiftVideoMixed',
    label: 'Sigma shift วิดีโอ · แนวตั้ง/จัตุรัส',
    group: 'advanced',
    type: 'float',
    default: H3_TURBO_MIXED.shiftVideo,
    min: 1,
    max: 20,
    step: 0.5,
    risky: true,
    help: 'ตามตารางสเปกของ ModelTC: LoRA mixed-aspect ใช้ 12',
  },
  {
    id: 'shiftAudio',
    label: 'Sigma shift เสียง',
    group: 'advanced',
    type: 'float',
    default: H3_TURBO_768P.shiftAudio,
    min: 1,
    max: 12,
    step: 0.5,
    risky: true,
    help: 'LoRA ทั้งสองตัวใช้ 3',
  },
];

const H3 = tunableReader(H3_TUNABLES);

/**
 * The first line the official prompting guide puts in front of a keyframe task
 * (VIDEO_PROMPT_WRITING_GUIDE_base_en.md, §2.1 — "always uses"), or '' for
 * text-to-video. It tells H3-Base which picture sits at which second, and the
 * guide's FL2VA case aligns the last picture with the clip's effective length
 * written to exactly two decimals.
 */
function h3FrameInstruction(p: CatalogJobParams): string {
  if (p.imageFilename && p.lastImageFilename) {
    const seconds = (minimaxFrameLength(p.durationSeconds, MINIMAX_H3_FPS) / MINIMAX_H3_FPS).toFixed(2);
    return (
      'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark ' +
      `of the target video; Picture 2 (from Shot 1) aligns with the ${seconds}-second mark of the target video.`
    );
  }
  if (p.imageFilename) {
    return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
  }
  return '';
}

/** A prompt that already carries the official fields — written by our enhancer or by hand. */
const H3_STRUCTURED = /integrated_multimodal_description\s*:/i;
/** A prompt that already opens with a keyframe instruction. */
const H3_INSTRUCTED = /^\s*(For the target video, at|How the reference pictures align)/i;

/**
 * The text H3-Base receives.
 *
 * MiniMax's own pipeline never hands H3-Base the customer's words: its
 * Context-IR rewrites them first into the structure the model was trained on,
 * and the model card calls that step "critical to the quality of the final
 * output". This does the part of it that needs no language model — the
 * keyframe instruction, and (by choice) the three-field frame — and leaves a
 * prompt that is already structured alone.
 */
export function h3Prompt(p: CatalogJobParams): string {
  const raw = p.prompt.trim();
  const mode = H3.str(p.tuning, 'promptStructure');
  if (mode === 'off') return raw;

  let body = raw;
  if (mode === 'full' && !H3_STRUCTURED.test(raw)) {
    body =
      `integrated_multimodal_description: [Shot 1] ${raw}\n\n` +
      `overall_soundscape: ${H3.str(p.tuning, 'soundscapeDefault').trim() || 'N/A'}\n\n` +
      `non_diegetic_music: ${H3.str(p.tuning, 'musicDefault').trim() || 'N/A'}`;
  }
  // A prompt may arrive with an instruction line already (from the enhancer,
  // or typed by hand) written for a different set of frames than this job
  // has — an image-to-video prompt ordered as text-to-video points at a
  // picture that is not there. The line is always rebuilt from the job.
  if (H3_INSTRUCTED.test(body)) body = body.replace(/^\s*[^\n]*\n+/, '').trim();
  const lead = h3FrameInstruction(p);
  return lead ? `${lead}\n\n${body}` : body;
}

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
  pools: ['rented'],
  kind: 'video',
  outputKind: 'video',
  description: 'วิดีโอพร้อมเสียงในตัว คุณภาพสูงสุดในกลุ่ม • ใช้เวลาสร้างนานกว่าโมเดลอื่น',
  template: minimaxH3Template as UiWorkflow,
  source: {
    file: 'minimax_h3_t2v.json',
    title: 'video_minimax_h3_t2v (Comfy-Org) + Turbo LoRA ของ ModelTC',
    url: 'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_t2v.json',
  },
  tunables: H3_TUNABLES,
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
  // Any Ampere-or-newer card with the VRAM. The list used to be A100, RTX
  // 5090, RTX PRO 6000 and RTX 4090 — the A100 40 GB was the cheapest with
  // room for these weights on SimplePod ($0.48/hr against $0.72 for a 5090,
  // measured 2026-09-11) — which hid every other card that could do the work
  // (L40S, H100, RTX 6000 Ada, A6000) from the offer picker. int8 and the
  // nvfp4 text encoder do not need Blackwell.
  hardware: { minVramMb: 24576, diskGb: 120, gpuModels: [], minArch: 'ampere' },
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
    const landscape = turbo === H3_TURBO_768P;
    const nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
      '105_119': {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          model: ['105_6', 0],
          lora_name: turbo.lora,
          strength_model: H3.num(p.tuning, 'loraStrength'),
        },
      },
      '105_120': {
        class_type: 'MiniMaxH3SigmaShift',
        inputs: {
          model: ['105_119', 0],
          // The distilled values (turbo.shiftVideo / shiftAudio) are the
          // tunables' defaults; an admin override lands here.
          shift_video: H3.num(p.tuning, landscape ? 'shiftVideo768' : 'shiftVideoMixed'),
          shift_audio: H3.num(p.tuning, 'shiftAudio'),
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
    const landscape = plan.turbo === H3_TURBO_768P;
    return [
      ...frames,
      { nodeId: '105_104', input: 'prompt', value: h3Prompt(p) },
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
      // Fixed per LoRA, not taken from `p.steps` — only an admin's tunable
      // moves it, and its default is the LoRA's own count.
      { nodeId: '105_9', input: 'steps', value: H3.num(p.tuning, landscape ? 'steps768' : 'stepsMixed') },
      { nodeId: '105_17', input: 'sampler_name', value: H3.str(p.tuning, 'sampler') },

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
// LTX-2.5 — video with native audio, from text or a first frame
// ---------------------------------------------------------------------------
// Template: video_ltx2_5_i2v.json ("LTX-2.5: Image to Video"). Everything runs
// inside subgraph instance 398, so converted ids are `398_…`; the LoadImage
// (395), SaveVideo (75) and a ResolutionSelector (403) sit outside it.
//
// Two passes of the distilled 22B model: 8 steps at half size, a ×2 latent
// upscale, 3 more steps at full size. Picture and sound come out of one latent.
//
// The template's own text-to-video switch (`398_363`) only bypasses the image
// nodes, which still need a picture to load. Without a first frame the two
// LTXVImgToVideoInplace nodes are taken out of the latent path instead, and
// the image chain is pruned with them. Its prompt enhancer (a second Gemma)
// is cut off the same way: the prompt goes straight to the encoder, the
// studio has its own enhancer, and the extra model is never downloaded.

/** The subgraph instance the render lives in. */
const LTX25 = '398';

/**
 * Output frames, all multiples of 64 so the half-size first pass lands on
 * LTX's 32 px latent grid (the template's 720 does not: 360 / 32 = 11.25).
 * Close to the template's 1280×720 in pixels, so the time per second holds
 * whichever shape is ordered.
 */
const LTX_FRAMES: { aspect: number; width: number; height: number }[] = [
  { aspect: 9 / 16, width: 704, height: 1280 },
  { aspect: 3 / 4, width: 832, height: 1088 },
  { aspect: 1, width: 960, height: 960 },
  { aspect: 4 / 3, width: 1088, height: 832 },
  { aspect: 16 / 9, width: 1280, height: 704 },
];

/** The frame closest in shape to the order's width and height. */
export function ltxFrame(width: number, height: number): { width: number; height: number } {
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  let best = LTX_FRAMES[LTX_FRAMES.length - 1];
  for (const frame of LTX_FRAMES) {
    if (Math.abs(Math.log(frame.aspect / ratio)) < Math.abs(Math.log(best.aspect / ratio))) best = frame;
  }
  return { width: best.width, height: best.height };
}

const LTX25_TUNABLES: WorkflowTunable[] = [
  {
    id: 'negative',
    label: 'Negative prompt',
    help: 'ค่าของ template — มีคำว่า cartoon อยู่ ถ้าลูกค้าสั่งงานการ์ตูน/อนิเมะเยอะ ให้ลบคำนั้นออก',
    type: 'text',
    default: 'pc game, console game, video game, cartoon, childish, ugly',
    maxLength: 1000,
    group: 'prompt',
  },
  {
    id: 'firstFrameStrength',
    label: 'ความยึดภาพเฟรมแรก (รอบแรก)',
    help: 'template ใช้ 0.7 ในรอบครึ่งขนาด (รอบขยายใช้ 1.0 เสมอ) — สูงขึ้นภาพแรกตรงต้นฉบับขึ้นแต่การเคลื่อนไหวน้อยลง',
    type: 'float',
    default: 0.7,
    min: 0.3,
    max: 1,
    step: 0.05,
    group: 'quality',
    risky: true,
  },
];

const LTX25_T = tunableReader(LTX25_TUNABLES);

const LTX_25: CatalogEntry = {
  key: 'ltx-2.5',
  name: 'LTX-2.5 (วิดีโอ + เสียง)',
  pools: ['rented'],
  kind: 'video',
  outputKind: 'video',
  description: 'วิดีโอพร้อมเสียงในตัวจาก Lightricks • จากข้อความหรือภาพเฟรมแรก • เร็วและถูกกว่า H3',
  template: ltx25I2vTemplate as UiWorkflow,
  source: {
    file: 'ltx25_i2v.json',
    title: 'video_ltx2_5_i2v (Comfy-Org) — ไม่มีภาพเฟรมแรกก็เป็น text-to-video',
    url: 'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_ltx2_5_i2v.json',
  },
  tunables: LTX25_TUNABLES,
  // Sizes from Hugging Face (paths-info), the int8 files the template names.
  // Lightricks/LTX-2.5 is gated: the GPU_HF_TOKEN account must have accepted
  // its licence or every boot fails at the first download.
  downloads: [
    { repo: 'Lightricks/LTX-2.5', file: 'diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors', dest: 'diffusion_models', bytes: 21_504_034_224 },
    { repo: 'Lightricks/LTX-2.5', file: 'text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors', dest: 'text_encoders', bytes: 15_372_969_374 },
    { repo: 'Lightricks/LTX-2.5', file: 'vae/ltx-2.5-video-vae-bf16.safetensors', dest: 'vae', bytes: 1_472_223_346 },
    { repo: 'Lightricks/LTX-2.5', file: 'latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors', dest: 'latent_upscale_models', bytes: 995_778_752 },
    { repo: 'Lightricks/LTX-2.5', file: 'vae/ltx-2.5-audio-vae-bf16.safetensors', dest: 'vae', bytes: 364_866_540 },
  ],
  // 22B at int8 is ~21.5 GB before activations — the size that needed 32 GB
  // for LTX-2.3 at fp8 without ComfyUI streaming layers per step.
  hardware: { minVramMb: 32768, diskGb: 110, gpuModels: [], minArch: 'ampere' },
  // The enhancer's preview is an output node and would keep it alive.
  prune: ['PreviewAny'],
  bind: (p) => {
    const frame = ltxFrame(p.width, p.height);
    const firstFrame = p.imageFilename
      ? [
          { nodeId: '395', input: 'image', value: p.imageFilename },
          { nodeId: `${LTX25}_363`, input: 'value', value: false },
          { nodeId: `${LTX25}_357`, input: 'strength', value: LTX25_T.num(p.tuning, 'firstFrameStrength') },
        ]
      : [
          // Text to video: both passes take the latent straight through.
          { nodeId: `${LTX25}_377`, input: 'video_latent', value: [`${LTX25}_356`, 0] },
          { nodeId: `${LTX25}_340`, input: 'video_latent', value: [`${LTX25}_348`, 0] },
        ];
    return [
      ...firstFrame,
      // Straight to the encoder, past the template's prompt-enhancer switch.
      { nodeId: `${LTX25}_364`, input: 'text', value: p.prompt.trim() },
      { nodeId: `${LTX25}_373`, input: 'text', value: LTX25_T.str(p.tuning, 'negative') },
      // Full size; the template halves them for the first pass.
      { nodeId: `${LTX25}_372`, input: 'value', value: frame.width },
      { nodeId: `${LTX25}_360`, input: 'value', value: frame.height },
      // Whole seconds at 24 fps: seconds × 24 + 1 is always LTX's 8k+1.
      { nodeId: `${LTX25}_362`, input: 'value', value: Math.max(1, Math.round(p.durationSeconds)) },
      // Both passes, so a new seed is a new take.
      { nodeId: `${LTX25}_339`, input: 'noise_seed', value: p.seed },
      { nodeId: `${LTX25}_338`, input: 'noise_seed', value: p.seed + 1 },
      { nodeId: '75', input: 'filename_prefix', value: 'video/aixman', optional: true },
    ];
  },
  // A guess until the first rentals report: 8 + 3 distilled steps against
  // H3's 4, at a similar pixel count.
  baselineSecondsPerUnit: 15,
  // Cheaper than H3 (12) for the same 5 s, same growth with length — 10 s is
  // 23 credits, 15 s 42 — until real render times say otherwise.
  pricing: { creditsPerUnit: 8, costPerUnit: 0.03, durationCurve: { unitSeconds: 5, exponent: 1.5 } },
  limits: { maxWidth: 1280, maxHeight: 1280, maxDuration: 15 },
  video: { firstFrame: true },
};

// ---------------------------------------------------------------------------
// ACE-Step 1.5 — music and audio
// ---------------------------------------------------------------------------
// Template: audio_ace_step_1_5_split.json. Flat graph, so ids are as authored.
// The lightest model in the catalogue by a wide margin — it runs happily on the
// cheapest card available, which is what makes audio cheap to sell.
const ACE_TUNABLES: WorkflowTunable[] = [
  {
    id: 'steps',
    label: 'สเต็ป',
    group: 'quality',
    type: 'int',
    default: 8,
    min: 4,
    max: 50,
    risky: true,
    help: 'acestep v1.5 turbo ถูกกลั่นมาที่ 8 สเต็ป — เพิ่มแล้วช้าลงโดยไม่ได้ดีขึ้นเสมอไป',
  },
  {
    id: 'shift',
    label: 'Sigma shift (ModelSamplingAuraFlow)',
    group: 'sampler',
    type: 'float',
    default: 3,
    min: 1,
    max: 10,
    step: 0.5,
    help: 'ค่าตามเทมเพลตทางการคือ 3',
  },
  {
    id: 'sampler',
    label: 'Sampler',
    group: 'sampler',
    type: 'choice',
    default: 'euler',
    options: SAMPLER_OPTIONS,
    help: 'เทมเพลตทางการใช้ euler',
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    group: 'sampler',
    type: 'choice',
    default: 'simple',
    options: SCHEDULER_OPTIONS,
    help: 'เทมเพลตทางการใช้ simple',
  },
];

const ACE = tunableReader(ACE_TUNABLES);

const ACE_STEP: CatalogEntry = {
  key: 'ace-step-1.5',
  name: 'ACE-Step 1.5 (เพลง/เสียง)',
  pools: ['rented'],
  kind: 'audio',
  outputKind: 'audio',
  description: 'สร้างเพลงและเสียงจากคำอธิบาย • เบาที่สุด เร็วและถูกที่สุดในระบบ',
  template: aceStepTemplate as UiWorkflow,
  source: {
    file: 'ace_step_1_5.json',
    title: 'audio_ace_step_1_5_split (Comfy-Org)',
    url: 'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/audio_ace_step_1_5_split.json',
  },
  tunables: ACE_TUNABLES,
  downloads: [
    { repo: 'Comfy-Org/ace_step_1.5_ComfyUI_files', file: 'split_files/diffusion_models/acestep_v1.5_turbo.safetensors', dest: 'diffusion_models', bytes: 4_787_825_604 },
    { repo: 'Comfy-Org/ace_step_1.5_ComfyUI_files', file: 'split_files/text_encoders/qwen_0.6b_ace15.safetensors', dest: 'text_encoders', bytes: 1_191_588_248 },
    { repo: 'Comfy-Org/ace_step_1.5_ComfyUI_files', file: 'split_files/text_encoders/qwen_1.7b_ace15.safetensors', dest: 'text_encoders', bytes: 3_708_523_360 },
    { repo: 'Comfy-Org/ace_step_1.5_ComfyUI_files', file: 'split_files/vae/ace_1.5_vae.safetensors', dest: 'vae', bytes: 337_431_732 },
  ],
  // Any card that holds it — but not *any* name: the CUDA 13 image has no
  // kernels for Volta, and the market's cheapest 16 GB cards are V100s that
  // report a CUDA 13 driver. Unfiltered, this would rent one and fail at the
  // first tensor. Turing is enough for this one (gpu-specs.ts places cards).
  hardware: { minVramMb: 12288, diskGb: 60, gpuModels: [], minArch: 'turing' },
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
    // A distilled turbo: the step count is the admin's tunable, never a
    // client's number — the studio sends none for music, and a caller that
    // did would only slow the render down.
    { nodeId: '3', input: 'steps', value: ACE.num(p.tuning, 'steps'), optional: true },
    { nodeId: '3', input: 'sampler_name', value: ACE.str(p.tuning, 'sampler'), optional: true },
    { nodeId: '3', input: 'scheduler', value: ACE.str(p.tuning, 'scheduler'), optional: true },
    { nodeId: '78', input: 'shift', value: ACE.num(p.tuning, 'shift'), optional: true },
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
//
// The template carries both of Qwen-Image's paths behind one boolean (76_86):
// Lightning (LoRA 76_73, 8 steps from 76_79, cfg 1 from 76_81) and the full
// model (20 steps from 76_84, cfg 4 from 76_85). Its own VRAM table times them
// at 34 s and 71 s on a warm RTX 4090D — the "quality" mode below is that
// second path, priced at twice the first.

/**
 * Qwen-Image's native canvases, from the official model card and the table in
 * the template's own note (node 77). The model renders best at the sizes it
 * was trained on; the studio's generic 1344x768 was being fitted down to about
 * one megapixel. 1140 is the card's number for 4:3 — the latent needs
 * multiples of 16, so it is snapped when used.
 */
const QWEN_BUCKETS: { w: number; h: number }[] = [
  { w: 1328, h: 1328 },
  { w: 1664, h: 928 },
  { w: 928, h: 1664 },
  { w: 1472, h: 1140 },
  { w: 1140, h: 1472 },
  { w: 1584, h: 1056 },
  { w: 1056, h: 1584 },
];

/** The official "positive magic" appended to every English prompt in Qwen-Image's README. */
const QWEN_MAGIC_EN = ', Ultra HD, 4K, cinematic composition.';

/** The native canvas whose shape is closest to the requested one (on a log scale). */
export function nearestBucket(width: number, height: number, buckets: { w: number; h: number }[]): { w: number; h: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const want = Math.log(w / h);
  return buckets.reduce((best, b) => (Math.abs(Math.log(b.w / b.h) - want) < Math.abs(Math.log(best.w / best.h) - want) ? b : best));
}

const QWEN_QUALITY_MODES: QualityMode[] = [
  {
    id: 'fast',
    label: 'เร็ว',
    description: 'Lightning 8 สเต็ป — ภาพดีในไม่กี่วินาที เหมาะกับงานทั่วไป',
    creditsMultiplier: 1,
    isDefault: true,
  },
  {
    id: 'quality',
    label: 'คุณภาพสูง',
    description: 'โมเดลเต็มไม่ผ่าน LoRA เร่ง — รายละเอียด ผิว และตัวอักษรคมกว่า ใช้เวลาราว 2 เท่า',
    creditsMultiplier: 2,
    adminOnly: true,
  },
];

const QWEN_TUNABLES: WorkflowTunable[] = [
  {
    id: 'nativeResolution',
    label: 'ใช้ความละเอียดตามที่โมเดลฝึกมา',
    group: 'quality',
    type: 'bool',
    default: true,
    help: 'เลือกขนาดทางการที่ใกล้สัดส่วนที่ลูกค้าสั่งที่สุด (เช่น 16:9 → 1664×928, 1:1 → 1328×1328) แทนการย่อให้เหลือราว 1 ล้านพิกเซล',
  },
  {
    id: 'magicSuffix',
    label: 'ต่อท้าย "positive magic" ทางการ',
    group: 'prompt',
    type: 'bool',
    default: true,
    help: 'README ของ Qwen-Image ต่อท้ายทุกพรอมต์ด้วยข้อความนี้ — ช่วยเรื่องความคมและองค์ประกอบภาพ',
  },
  {
    id: 'magicText',
    label: 'ข้อความ positive magic',
    group: 'prompt',
    type: 'text',
    maxLength: 300,
    default: QWEN_MAGIC_EN,
    help: 'ค่าทางการ: ", Ultra HD, 4K, cinematic composition."',
  },
  {
    id: 'negativeDefault',
    label: 'Negative prompt เมื่อลูกค้าเว้นว่าง',
    group: 'prompt',
    type: 'text',
    maxLength: 600,
    default: '',
    help: 'README ทางการใช้ช่องว่าง (ไม่ตัดอะไรออก) — ใส่เพิ่มได้ เช่น "blurry, watermark" ใช้เฉพาะโหมดคุณภาพสูง เพราะ Lightning ใช้ cfg 1 ซึ่งไม่อ่าน negative',
  },
  {
    id: 'fastSteps',
    label: 'สเต็ป · โหมดเร็ว (Lightning)',
    group: 'quality',
    type: 'int',
    default: 8,
    min: 4,
    max: 16,
    risky: true,
    help: 'LoRA Lightning ถูกกลั่นมาที่ 8 สเต็ปพอดี',
  },
  {
    id: 'qualitySteps',
    label: 'สเต็ป · โหมดคุณภาพสูง',
    group: 'quality',
    type: 'int',
    default: 20,
    min: 10,
    max: 60,
    help: 'เทมเพลตทางการใช้ 20 · โน้ตในเทมเพลตแนะนำ 50 ถ้าอยากได้ค่าตามต้นฉบับ Qwen (ช้ากว่าราว 2.5 เท่า)',
  },
  {
    id: 'qualityCfg',
    label: 'CFG · โหมดคุณภาพสูง',
    group: 'quality',
    type: 'float',
    default: 4,
    min: 1,
    max: 8,
    step: 0.5,
    help: 'ค่าตามเทมเพลตและ README ทางการ (true_cfg_scale 4.0)',
  },
  {
    id: 'shift',
    label: 'Sigma shift (ModelSamplingAuraFlow)',
    group: 'sampler',
    type: 'float',
    default: 3.1,
    min: 1,
    max: 8,
    step: 0.1,
    help: 'ค่าตามเทมเพลตทางการคือ 3.1',
  },
  {
    id: 'sampler',
    label: 'Sampler',
    group: 'sampler',
    type: 'choice',
    default: 'euler',
    options: SAMPLER_OPTIONS,
    help: 'เทมเพลตทางการใช้ euler',
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    group: 'sampler',
    type: 'choice',
    default: 'simple',
    options: SCHEDULER_OPTIONS,
    help: 'เทมเพลตทางการใช้ simple',
  },
];

const QWEN = tunableReader(QWEN_TUNABLES);

/** The customer's words plus the official suffix, unless they already end with it. */
function qwenPrompt(p: CatalogJobParams): string {
  const text = p.prompt.trim();
  if (!QWEN.bool(p.tuning, 'magicSuffix')) return text;
  const magic = QWEN.str(p.tuning, 'magicText').trim();
  // Compared without the leading comma and trailing full stop, so a prompt
  // that already ends with the suffix (an enhanced one, a template) keeps one.
  const core = (s: string) => s.replace(/^[,\s]+/, '').replace(/[.\s]+$/, '').toLowerCase();
  if (!core(magic) || core(text).endsWith(core(magic))) return text;
  return `${text.replace(/[.\s]+$/, '')}${magic.startsWith(',') ? '' : ', '}${magic}`;
}

function qwenSize(p: CatalogJobParams): { width: number; height: number } {
  if (!QWEN.bool(p.tuning, 'nativeResolution')) {
    return { width: snap(p.width, 16, 1328), height: snap(p.height, 16, 1328) };
  }
  const b = nearestBucket(p.width, p.height, QWEN_BUCKETS);
  return { width: snap(b.w, 16, 1328), height: snap(b.h, 16, 1328) };
}

const QWEN_IMAGE: CatalogEntry = {
  key: 'qwen-image',
  name: 'Qwen-Image',
  pools: ['rented'],
  kind: 'image',
  outputKind: 'image',
  description: 'สร้างภาพนิ่งคุณภาพสูง เก่งเรื่องตัวอักษรทั้งไทยและอังกฤษ • ใช้ LoRA 8 สเต็ป เร็วกว่าปกติมาก',
  template: qwenImageTemplate as UiWorkflow,
  source: {
    file: 'qwen_image.json',
    title: 'image_qwen_image (Comfy-Org)',
    url: 'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image.json',
  },
  tunables: QWEN_TUNABLES,
  qualityModes: QWEN_QUALITY_MODES,
  downloads: [
    { repo: 'Comfy-Org/Qwen-Image_ComfyUI', file: 'split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors', dest: 'diffusion_models', bytes: 20_430_635_136 },
    { repo: 'Comfy-Org/Qwen-Image_ComfyUI', file: 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors', dest: 'text_encoders', bytes: 9_384_670_680 },
    { repo: 'Comfy-Org/Qwen-Image_ComfyUI', file: 'split_files/vae/qwen_image_vae.safetensors', dest: 'vae', bytes: 253_806_246 },
    // The template's LoraLoaderModelOnly expects this exact filename.
    { repo: 'lightx2v/Qwen-Image-Lightning', file: 'Qwen-Image-Lightning-8steps-V1.0.safetensors', dest: 'loras', bytes: 1_698_951_104 },
  ],
  hardware: { minVramMb: 24576, diskGb: 90, gpuModels: [], minArch: 'ampere' },
  bind: (p) => {
    const lightning = p.quality !== 'quality';
    const size = qwenSize(p);
    const negative = p.negativePrompt?.trim() ? p.negativePrompt : QWEN.str(p.tuning, 'negativeDefault');
    return [
      // 6 and 7 are positive and negative. Binding by id rather than by class is
      // deliberate — two CLIPTextEncode nodes are indistinguishable by type and
      // swapping them silently inverts the prompt.
      { nodeId: '76_6', input: 'text', value: qwenPrompt(p) },
      { nodeId: '76_7', input: 'text', value: negative },
      // Qwen-Image's latent patches need multiples of 16.
      { nodeId: '76_58', input: 'width', value: size.width },
      { nodeId: '76_58', input: 'height', value: size.height },
      { nodeId: '76_3', input: ['seed', 'noise_seed'], value: p.seed },
      // The template ships with its Lightning switch OFF: the model path skips
      // the LoRA and cfg comes out at 4. Left that way, forcing 8 steps renders
      // the base model undercooked at the wrong cfg — valid to ComfyUI, visibly
      // bad. This one boolean moves model and cfg onto the chosen branch
      // together; quality mode is the switch left off on purpose.
      { nodeId: '76_86', input: 'value', value: lightning },
      // Pinned per mode, so a caller-supplied step count cannot drag Lightning
      // off its distilled schedule.
      { nodeId: '76_3', input: 'steps', value: lightning ? QWEN.num(p.tuning, 'fastSteps') : QWEN.num(p.tuning, 'qualitySteps') },
      // Lightning keeps the switch's cfg (1). The full model takes the tunable,
      // written over the switch's wire.
      ...(lightning ? [] : [{ nodeId: '76_3', input: 'cfg', value: QWEN.num(p.tuning, 'qualityCfg') }]),
      { nodeId: '76_3', input: 'sampler_name', value: QWEN.str(p.tuning, 'sampler') },
      { nodeId: '76_3', input: 'scheduler', value: QWEN.str(p.tuning, 'scheduler') },
      { nodeId: '76_66', input: 'shift', value: QWEN.num(p.tuning, 'shift') },
      { nodeId: '60', input: 'filename_prefix', value: 'image/aixman', optional: true },
    ];
  },
  baselineSecondsPerUnit: 12,
  pricing: { creditsPerUnit: 3, costPerUnit: 0.02 },
  // The largest native canvas (QWEN_BUCKETS). The bind picks the canvas from
  // the requested *shape*, so rows created before this still render natively.
  limits: { maxWidth: 1664, maxHeight: 1664 },
};

// ---------------------------------------------------------------------------
// YuE2 — full songs, and covers of a song the customer uploads
// ---------------------------------------------------------------------------
// Templates: audio_yue2_text2music.json / audio_yue2_music_cover.json. Both
// wrap everything except SaveAudioAdvanced (10) and LoadAudio (45) in one
// subgraph instance (outer node 33), so inner ids convert to `33_*`.
//
// The pipeline is two passes over the same checkpoint: YuE2GenerateABC writes a
// melody-and-chord score, YuE2GenerateMusic sings it, and a KSampler + VAE turn
// the result into 48 kHz stereo. The cover template swaps the first pass for
// SheetSage2, which transcribes the uploaded song and hands the same score on —
// which is why the cover needs one extra weight file and nothing else.
//
// int8_convrot rather than the bf16 checkpoint: half the download, and
// comfy-kitchen's int8 kernels need CUDA 13, which the worker image already is.
// On a cu126 host those kernels are disabled and the run falls back to eager —
// slow enough to look broken — so the requirement is declared, not assumed.
const YUE2_CKPT: ModelDownload = {
  repo: 'Comfy-Org/YuE2',
  file: 'checkpoints/yue2_3b_int8_convrot.safetensors',
  dest: 'checkpoints',
  bytes: 3_960_938_800,
};

/**
 * The token budget a song gets, in seconds.
 *
 * Nobody chooses this any more. `max_duration` never was a target — the node's
 * own tooltip says "generation can stop earlier", the tokenizer converts it to
 * `max_duration * 25` tokens, and `EmptyYuE2LatentAudio.seconds` is wired from
 * the frames the model actually produced. So the song's real length is decided
 * by the model, and the only thing this number ever did was decide whether it
 * got to *finish*: too low and `_generate` hits its budget before the end
 * token, which is a track that stops mid-phrase. Job #100 asked for 300 s.
 *
 * `YUE2_MAX_SECONDS` is what everyone gets now, and it is deliberately far
 * past any ordinary song. It costs nothing when unused: the model stops when
 * it stops, and 480 s of budget on a 3.5-minute song renders in exactly the
 * time 3.5 minutes of song renders in.
 */
function yue2Duration(p: CatalogJobParams): number {
  return YUE2.num(p.tuning, 'budgetSeconds');
}

/**
 * The budget one song gets, in seconds — not a length anyone is sold.
 *
 * 240 was a guess, then 330; both were short enough to cut real songs off. The
 * node allows 900 and the 24,576-token context allows about 940, so 480 is not
 * near any limit — it is chosen so the worst case still lands inside
 * `jobTimeoutMinutes` (measured ~0.4x real time on a 3090: 300 s of song took
 * 113 GPU-seconds, so 480 s of song is about 3 minutes of render).
 */
const YUE2_MAX_SECONDS = 480;

/**
 * Longest song a cover may start from.
 *
 * Bounded by the 12 MB upload cap rather than by the model: an MP3 at 320 kbps
 * runs 12 MB at about five minutes, and the studio's hint says so.
 */
const YUE2_MAX_SOURCE_SECONDS = 330;

const YUE2_TUNABLES: WorkflowTunable[] = [
  {
    id: 'budgetSeconds',
    label: 'งบความยาวเพลง (วินาที)',
    group: 'quality',
    type: 'int',
    default: YUE2_MAX_SECONDS,
    min: 120,
    max: 900,
    risky: true,
    help:
      'ไม่ใช่ความยาวที่ขาย — โมเดลหยุดเองเมื่อเพลงจบ ค่านี้แค่กันไม่ให้เพลงถูกตัดกลางท่อน · ' +
      '480 ถูกเลือกให้กรณีแย่สุดยังจบภายในเวลาจำกัดของงาน ตั้งสูงกว่านี้ต้องเพิ่มเวลาจำกัดงานที่หน้า GPU ด้วย',
  },
  {
    id: 'decodeSteps',
    label: 'สเต็ปถอดเสียง (KSampler)',
    group: 'quality',
    type: 'int',
    default: 32,
    min: 8,
    max: 64,
    help: 'สเต็ปของ KSampler ที่แปลงผลลัพธ์เป็นเสียง 48 kHz — เทมเพลตทางการใช้ 32',
  },
];

const YUE2 = tunableReader(YUE2_TUNABLES);

/** Empty lyrics are what YuE2 reads as "instrumental" — no marker text. */
function yue2Lyrics(p: CatalogJobParams): string {
  if (p.music?.instrumental === true) return '';
  return (p.lyrics ?? '').trim();
}

/**
 * The `[Tags]` text: what the customer typed, plus what they picked.
 *
 * Kept here rather than in the studio so every client — web, mobile, a future
 * API caller — turns the same choices into the same prompt.
 */
function yue2Style(p: CatalogJobParams): string {
  return composeMusicTags(p.prompt, p.music);
}

const YUE2_MUSIC: CatalogEntry = {
  key: 'yue2-music',
  name: 'YuE2 (เพลงเต็มเพลง)',
  pools: ['rented'],
  kind: 'audio',
  outputKind: 'audio',
  description: 'แต่งเพลงเต็มเพลงพร้อมเสียงร้องจากเนื้อร้องที่เขียนเอง • วางโครงทำนองก่อนแล้วค่อยร้อง คุณภาพระดับ 48 kHz',
  template: yue2Text2MusicTemplate as UiWorkflow,
  source: {
    file: 'yue2_text2music.json',
    title: 'audio_yue2_text2music (Comfy-Org)',
    url: 'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/audio_yue2_text2music.json',
  },
  tunables: YUE2_TUNABLES,
  downloads: [YUE2_CKPT],
  // Weights are 3.7 GiB, but the run is dominated by the autoregressive pass
  // over a song-length sequence: a 90 s song needed ~7 GB of working memory on
  // top of the weights when measured outside ComfyUI. 16 GB is the smallest
  // card that leaves room for the VAE decode at the 240 s ceiling.
  hardware: { minVramMb: 16384, diskGb: 60, gpuModels: [], minArch: 'ampere', minCudaVersion: '13.0' },
  bind: (p) => [
    // style and lyrics go to both passes: the score writer plans to them, and
    // the singer is conditioned on them again. Binding only one leaves the
    // other singing the template's demo song.
    { nodeId: '33_24', input: 'style', value: yue2Style(p) },
    { nodeId: '33_24', input: 'lyrics', value: yue2Lyrics(p) },
    { nodeId: '33_25', input: 'style', value: yue2Style(p) },
    { nodeId: '33_25', input: 'lyrics', value: yue2Lyrics(p) },
    { nodeId: '33_25', input: 'max_duration', value: yue2Duration(p) },
    // How dense the arrangement is, as the model sees it: `full` writes a
    // chord-annotated score for the band to play, `melody` writes the tune
    // alone. Both passes must agree — they share one instruction string.
    { nodeId: '33_24', input: 'mode', value: musicComplexity(p.music?.complexity).mode },
    { nodeId: '33_25', input: 'mode', value: musicComplexity(p.music?.complexity).mode },
    // How far it may wander from the obvious take.
    { nodeId: '33_25', input: 'temperature', value: musicVariance(p.music?.variance) },
    // Three seeds, one song: score, singer, and the sampler that decodes it.
    // Leaving any of them on the template's constant makes a "new" seed return
    // a near-identical track.
    { nodeId: '33_24', input: 'seed', value: p.seed },
    { nodeId: '33_25', input: 'seed', value: p.seed },
    { nodeId: '33_34', input: 'seed', value: p.seed, optional: true },
    { nodeId: '33_8', input: 'steps', value: YUE2.num(p.tuning, 'decodeSteps'), optional: true },
    { nodeId: '10', input: 'filename_prefix', value: 'audio/aixman', optional: true },
  ],
  baselineSecondsPerUnit: 2,
  // Flat per song. Length is no longer a thing anyone picks, so there is
  // nothing to price it by: `lengthFactor` falls back to 1 and the ETA becomes
  // the median of past songs, which is the right estimate when every song gets
  // the same budget.
  pricing: { creditsPerUnit: 20, costPerUnit: 0.05 },
  limits: { maxDuration: YUE2_MAX_SECONDS },
  music: { autoLength: true, controls: true },
};

const YUE2_COVER: CatalogEntry = {
  key: 'yue2-cover',
  name: 'YuE2 คัฟเวอร์ (จากเพลงที่อัปโหลด)',
  pools: ['rented'],
  kind: 'audio',
  outputKind: 'audio',
  description: 'อัปโหลดเพลงแล้วให้ AI เรียบเรียงใหม่ตามแนวที่สั่ง • ถอดทำนองจากเพลงต้นฉบับแล้วร้องใหม่ทั้งเพลง',
  template: yue2MusicCoverTemplate as UiWorkflow,
  source: {
    file: 'yue2_music_cover.json',
    title: 'audio_yue2_music_cover (Comfy-Org)',
    url: 'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/audio_yue2_music_cover.json',
  },
  tunables: YUE2_TUNABLES,
  downloads: [
    YUE2_CKPT,
    // SheetSage2 is the transcriber; without it the cover graph has no score to
    // sing and the AudioEncoderLoader combo comes up empty.
    { repo: 'Comfy-Org/YuE2', file: 'audio_encoders/sheetsage2_bf16.safetensors', dest: 'audio_encoders', bytes: 1_386_868_122 },
  ],
  hardware: { minVramMb: 16384, diskGb: 70, gpuModels: [], minArch: 'ampere', minCudaVersion: '13.0' },
  needs: { audio: true },
  bind: (p) => [
    { nodeId: '33_25', input: 'style', value: yue2Style(p) },
    // A cover can keep the original words (the customer types them) or be sung
    // on vowels when left empty — the model never hears the source vocal, only
    // its melody, so nothing supplies lyrics by itself.
    { nodeId: '33_25', input: 'lyrics', value: yue2Lyrics(p) },
    { nodeId: '33_25', input: 'max_duration', value: yue2Duration(p) },
    // `mode` stays on the template's `melody`, whatever density was asked for:
    // SheetSage2 already supplies the score, and the official template and the
    // node's own tooltip both pin melody for covers. Here the density slider
    // reaches the arrangement through the tags only.
    { nodeId: '33_25', input: 'temperature', value: musicVariance(p.music?.variance) },
    { nodeId: '33_25', input: 'seed', value: p.seed },
    { nodeId: '33_34', input: 'seed', value: p.seed, optional: true },
    { nodeId: '33_8', input: 'steps', value: YUE2.num(p.tuning, 'decodeSteps'), optional: true },
    // LoadAudio sits outside the subgraph; the name is what `stageAudio` put in
    // the worker's input dir, never a URL.
    { nodeId: '45', input: 'audio', value: p.audioFilename ?? '' },
    { nodeId: '10', input: 'filename_prefix', value: 'audio/aixman', optional: true },
  ],
  baselineSecondsPerUnit: 3,
  pricing: { creditsPerUnit: 20, costPerUnit: 0.06 },
  limits: { maxDuration: YUE2_MAX_SECONDS },
  music: { autoLength: true, controls: true, maxSourceSeconds: YUE2_MAX_SOURCE_SECONDS },
};


// ---------------------------------------------------------------------------
// SDXL — the entry a shared home card can actually serve
// ---------------------------------------------------------------------------
// Every other model in this catalogue needs 12 GB or more, which is correct for
// rented datacentre cards and wrong for the network GPUxMINE is being built
// from. A measured 8 GB GTX 1070 Ti ran this graph end to end in 21.6 s at
// 512² and is on record at 279 s for 768² under --lowvram: slow for somebody
// watching a progress bar, entirely fine for a queue. Without an entry it could
// hold, every home node was told "no matching model" forever and the whole
// supply side earned nothing.
//
// The graph is supplied by `inject` rather than converted from a UI template.
// It is seven core nodes with no subgraph and no custom pack, and writing it in
// API form directly removes the one thing that breaks such templates: widget
// order drifting against `/object_info`.

/** The checkpoint a rented card downloads; a home card almost never has this exact file. */
const SDXL_BASE_FILE = 'sd_xl_base_1.0.safetensors';

/**
 * Which checkpoint to render with on this particular machine.
 *
 * A rented worker gets `SDXL_BASE_FILE` from `downloads` and reports it. A home
 * worker reports whatever its owner collected — the machine this was written
 * against has three SDXL derivatives and not the base model. Naming a file the
 * worker does not have fails validation before a single step is sampled, so the
 * entry asks the worker rather than assuming.
 */
function pickCheckpoint(available: string[] | undefined): string {
  const files = available ?? [];
  if (files.length === 0) return SDXL_BASE_FILE;
  if (files.includes(SDXL_BASE_FILE)) return SDXL_BASE_FILE;

  // Prefer something that names itself SDXL — an SD 1.5 checkpoint loads fine
  // and then renders badly at SDXL resolutions, which is worse than obvious.
  const sdxl = files.find((f) => /xl/i.test(f));
  return sdxl ?? files[0];
}

const SDXL_TUNABLES: WorkflowTunable[] = [
  {
    id: 'maxSteps',
    label: 'สเต็ปสูงสุด',
    group: 'quality',
    type: 'int',
    default: 20,
    min: 8,
    max: 40,
    help: 'การ์ดบ้านช้าที่สุดในเครือข่าย และสเต็ปคือตัวที่กินเวลาตรงตัว — 20 คือจุดที่ SDXL เลิกดีขึ้นให้เห็น ผู้สั่งขอน้อยกว่านี้ได้ แต่ไม่เกิน',
  },
  {
    id: 'cfg',
    label: 'CFG',
    group: 'sampler',
    type: 'float',
    default: 6.5,
    min: 1,
    max: 12,
    step: 0.5,
    help: 'SDXL ทั่วไปดีที่ 5–7',
  },
  { id: 'sampler', label: 'Sampler', group: 'sampler', type: 'choice', default: 'dpmpp_2m', options: SAMPLER_OPTIONS, help: 'dpmpp_2m + karras คือคู่มาตรฐานของ SDXL' },
  { id: 'scheduler', label: 'Scheduler', group: 'sampler', type: 'choice', default: 'karras', options: SCHEDULER_OPTIONS, help: 'karras ให้รายละเอียดดีในสเต็ปน้อย' },
  {
    id: 'negativeDefault',
    label: 'Negative prompt เมื่อลูกค้าเว้นว่าง',
    group: 'prompt',
    type: 'text',
    maxLength: 600,
    default: 'lowres, blurry, worst quality, low quality, jpeg artifacts, watermark, signature, text, deformed, bad anatomy, extra fingers, extra limbs',
    help: 'SDXL (CLIP) ได้ประโยชน์จาก negative มากกว่าโมเดลรุ่นใหม่ — ใช้เฉพาะงานที่ลูกค้าไม่ได้ใส่ negative เอง',
  },
];

const SDXL = tunableReader(SDXL_TUNABLES);

const SDXL_COMMUNITY: CatalogEntry = {
  key: 'sdxl-community',
  name: 'SDXL (เครื่องชุมชน)',
  // Community only (owner decision D5, 2026-09-25): a 1-credit image is not
  // worth booting a rented card for, and a home card is what it was built for.
  pools: ['community'],
  kind: 'image',
  outputKind: 'image',
  description: 'สร้างภาพนิ่งด้วย SDXL บนการ์ดจอที่คนแชร์มา — คิวธรรมดา ไม่ใช่งานด่วน',
  template: { nodes: [], links: [] } as UiWorkflow,
  source: { file: '(เขียนในโค้ด)', title: 'กราฟ API 7 โหนดที่เขียนตรงในแคตตาล็อก — ไม่มีเทมเพลต UI' },
  tunables: SDXL_TUNABLES,
  downloads: [
    { repo: 'stabilityai/stable-diffusion-xl-base-1.0', file: 'sd_xl_base_1.0.safetensors', dest: 'checkpoints', bytes: 6_938_040_682 },
  ],
  // 6 GB is what SDXL needs to run at all once ComfyUI is allowed to stream
  // weights; it is not what it needs to run fast. The node's own lane says
  // which of those this machine is doing, and the pool routes on that.
  hardware: { minVramMb: 6144, diskGb: 20, gpuModels: [], minArch: 'pascal' },
  inject: (p) => ({
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: pickCheckpoint(p.checkpoints) } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: p.prompt } },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: p.negativePrompt?.trim() ? p.negativePrompt : SDXL.str(p.tuning, 'negativeDefault') },
    },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: snap(p.width, 8, 1024), height: snap(p.height, 8, 1024), batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        seed: p.seed,
        // Home cards are the slowest thing on this network and steps are the
        // one dial that costs time linearly. The ceiling is an admin tunable
        // (20, where SDXL stops visibly improving); a caller may ask for
        // fewer, never for more.
        steps: Math.min(p.steps ?? SDXL.num(p.tuning, 'maxSteps'), SDXL.num(p.tuning, 'maxSteps')),
        cfg: SDXL.num(p.tuning, 'cfg'),
        sampler_name: SDXL.str(p.tuning, 'sampler'),
        scheduler: SDXL.str(p.tuning, 'scheduler'),
        denoise: 1.0,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'image/aixman' } },
  }),
  bind: () => [],
  // Measured on the 8 GB card this was built against, at the resolution the
  // limits below allow. A faster shared card simply finishes early.
  baselineSecondsPerUnit: 60,
  pricing: { creditsPerUnit: 1, costPerUnit: 0.004 },
  limits: { maxWidth: 1024, maxHeight: 1024 },
};

// ---------------------------------------------------------------------------
// Hunyuan3D-2.1 — one picture in, a textured (PBR) GLB out
// ---------------------------------------------------------------------------
// There is no official Comfy-Org template with texturing, so the template is
// visualbruno/ComfyUI-Hunyuan3d-2-1's own Full_Workflow with its preview,
// Set/Get and constant nodes taken out, the textured mesh (not the white one)
// wired into the export, and a background remover in front: the shape model
// expects a cut-out subject, and a picture with its backdrop comes back as a
// slab. The pack's seeds carry no `control_after_generate`, so the template's
// widgets_values have no "randomize" after them, or every later widget would
// shift by one.

/** Where the node pack lands; its texture stage imports two compiled extensions from here. */
const HY3D_NODE_DIR = '/workspace/aixman/ComfyUI/custom_nodes/ComfyUI-Hunyuan3d-2-1';

/**
 * A one-file ComfyUI node that cuts the subject out with rembg (MIT). Written
 * by the setup script rather than cloned, because it is twenty lines.
 */
const AIXMAN_REMBG_NODE = [
  'import numpy as np',
  'import torch',
  'from PIL import Image',
  '_sessions = {}',
  'class AixmanRemoveBackground:',
  '    @classmethod',
  '    def INPUT_TYPES(cls):',
  '        return {"required": {"image": ("IMAGE",), "model": (["birefnet-general", "isnet-general-use", "u2net"], {"default": "birefnet-general"})}}',
  '    RETURN_TYPES = ("IMAGE",)',
  '    FUNCTION = "run"',
  '    CATEGORY = "aixman"',
  '    def run(self, image, model):',
  '        from rembg import new_session, remove',
  '        if model not in _sessions:',
  '            _sessions[model] = new_session(model)',
  '        out = []',
  '        for frame in image:',
  '            rgb = (frame[..., :3].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)',
  '            rgba = remove(Image.fromarray(rgb), session=_sessions[model]).convert("RGBA")',
  '            out.append(torch.from_numpy(np.asarray(rgba).astype(np.float32) / 255.0))',
  '        return (torch.stack(out),)',
  'NODE_CLASS_MAPPINGS = {"AixmanRemoveBackground": AixmanRemoveBackground}',
  'NODE_DISPLAY_NAME_MAPPINGS = {"AixmanRemoveBackground": "Remove background (aixman)"}',
].join('\n');

const HY3D_SETUP = [
  // The pack's requirements leave transformers unpinned, and 5.x renamed
  // DINOv2's attention layers (attention.attention.query → attention.q_proj),
  // so the image encoder inside the DiT checkpoint no longer loads: "Missing
  // key(s) in state_dict for SingleImageEncoder" (job #104). ComfyUI v0.36
  // asks for >=4.50.3. transformers 4.x holds huggingface_hub below 1.0, and
  // diffusers 0.40+ needs 1.x (0.41 imports resolve_revision, job #105).
  // From 0.35 diffusers also refuses the paint model's own unet code unless
  // the caller passes trust_remote_code, which the pack does not (job #106,
  // after the shape stage had passed). Tencent pins 0.30.0; 0.34 is the
  // newest without that refusal. One install, so pip resolves both together.
  'pip_install "transformers 4.x and diffusers" "transformers>=4.50.3,<5" "diffusers>=0.30,<0.35"',
  'echo "[aixman] building the Hunyuan3D-2.1 texture extensions"',
  'apt-get install -y -qq build-essential libgl1 libglib2.0-0 > /dev/null 2>&1 || true',
  // No TORCH_CUDA_ARCH_LIST: torch then builds for the card in this machine
  // only, which is the one that will run it, and the build is a fraction as long.
  'for ext in custom_rasterizer DifferentiableRenderer; do',
  `  if ! (cd ${HY3D_NODE_DIR}/hy3dpaint/$ext && python3 -m pip install --no-build-isolation --no-cache-dir .) >> /workspace/aixman/hy3d-build.log 2>&1; then`,
  `    fail_boot "Hunyuan3D $ext failed to build: $(grep -iE 'error' /workspace/aixman/hy3d-build.log | tail -n 3 | tr '\\n' ' ' | cut -c1-400)"`,
  '  fi',
  'done',
  'pip_install "rembg" rembg onnxruntime',
  "cat > /workspace/aixman/ComfyUI/custom_nodes/aixman_rembg.py <<'AIXMAN_PY'",
  AIXMAN_REMBG_NODE,
  'AIXMAN_PY',
  // The texture model, its image encoder and the matting model are fetched by
  // their own code on first use; start that now, beside ComfyUI, so the first
  // order does not sit through ~10 GB of downloads.
  "(hf download tencent/Hunyuan3D-2.1 --include 'hunyuan3d-paintpbr-v2-1/*'; hf download facebook/dinov2-giant; python3 -c \"from rembg import new_session; new_session('birefnet-general')\") > /workspace/aixman/hy3d-prefetch.log 2>&1 &",
].join('\n');

const HY3D_TUNABLES: WorkflowTunable[] = [
  {
    id: 'shapeSteps',
    label: 'สเต็ปสร้างรูปทรง',
    help: 'มากขึ้นได้รายละเอียดรูปทรงดีขึ้นแต่ช้าลง — เทมเพลตของแพ็กใช้ 25 ค่าเริ่มต้นของโหนดคือ 50',
    type: 'int',
    default: 30,
    min: 10,
    max: 60,
    step: 5,
    group: 'sampler',
  },
  {
    id: 'shapeGuidance',
    label: 'Guidance รูปทรง',
    help: 'ความยึดภาพต้นฉบับของรูปทรง — เทมเพลตใช้ 7.5',
    type: 'float',
    default: 7.5,
    min: 3,
    max: 12,
    step: 0.5,
    group: 'sampler',
  },
  {
    id: 'octree',
    label: 'ความละเอียดตาข่าย (octree)',
    help: '384 คือค่าเริ่มต้นของโหนด ละเอียดกว่าเทมเพลต (256) แต่ใช้ VRAM และเวลามากขึ้น',
    type: 'int',
    default: 384,
    min: 256,
    max: 512,
    step: 64,
    group: 'quality',
    risky: true,
  },
  {
    id: 'faces',
    label: 'จำนวนหน้าสูงสุด',
    help: 'ลดหน้าก่อนลงสี — 60,000 พอสำหรับตัวละครในเกม อาวุธใช้น้อยกว่านี้ได้',
    type: 'int',
    default: 60000,
    min: 5000,
    max: 200000,
    step: 5000,
    group: 'quality',
  },
  {
    id: 'textureSize',
    label: 'ขนาด texture',
    help: '2048 คมพอเมื่อซูมเข้า 1024 เร็วกว่าและไฟล์เล็กกว่า',
    type: 'int',
    default: 2048,
    min: 1024,
    max: 4096,
    step: 512,
    group: 'quality',
  },
  {
    id: 'paintSteps',
    label: 'สเต็ปลงสี',
    help: 'สเต็ปของโมเดลวาดภาพหลายมุม — เทมเพลตใช้ 10',
    type: 'int',
    default: 10,
    min: 5,
    max: 30,
    step: 1,
    group: 'sampler',
  },
];

const HY3D = tunableReader(HY3D_TUNABLES);

/**
 * What the 3D studio offers. 'standard' renders the tunables exactly as an
 * admin left them; the other two override only what makes them what they are,
 * so a change in /admin/workflows still reaches every mode.
 */
const HY3D_QUALITY_MODES: QualityMode[] = [
  {
    id: 'standard',
    label: 'มาตรฐาน',
    description: 'รายละเอียดสมดุลกับเวลา เหมาะกับงานโชว์ ภาพประกอบ และพิมพ์ 3D',
    creditsMultiplier: 1,
    isDefault: true,
  },
  {
    id: 'game',
    label: 'โลว์โพลีสำหรับเกม',
    description: 'ลดเหลือราว 15,000 หน้า ไฟล์เบา โหลดเร็ว พร้อมใช้ในเกมและเว็บ',
    creditsMultiplier: 1,
  },
  {
    id: 'ultra',
    label: 'ละเอียดสูงสุด',
    description: 'รูปทรงละเอียดราว 200,000 หน้า พื้นผิว 4K — ใช้เวลาราว 2 เท่า',
    creditsMultiplier: 2,
    // A 512 octree, 4K bake and 1024 views have not run on a rental yet.
    adminOnly: true,
  },
];

/** The most faces a game-ready model keeps, whatever the admin's default is. */
const HY3D_GAME_FACES = 15_000;
const HY3D_ULTRA = { octree: 512, faces: 200_000, textureSize: 4096, viewSize: 1024, minShapeSteps: 50 };
/** The paint model's view size in the vendored template. */
const HY3D_VIEW_SIZE = 768;

const HUNYUAN3D_21: CatalogEntry = {
  key: 'hunyuan3d-2.1',
  name: 'ภาพเป็นโมเดล 3D (Hunyuan3D-2.1)',
  pools: ['rented'],
  kind: 'model3d',
  outputKind: 'model3d',
  description: 'อัปโหลดภาพวัตถุหรือตัวละคร 1 ภาพ → ได้โมเดล 3D พร้อมพื้นผิว PBR เป็นไฟล์ GLB • ระบบตัดพื้นหลังให้เอง',
  template: hunyuan3d21Template as UiWorkflow,
  source: {
    file: 'hunyuan3d21_image_to_3d.json',
    title: 'Full_Workflow (visualbruno/ComfyUI-Hunyuan3d-2-1) — ตัดโหนดพรีวิว/Set-Get ออก ส่งโมเดลที่ลงสีแล้วออก และเพิ่มตัวตัดพื้นหลัง',
    url: 'https://github.com/visualbruno/ComfyUI-Hunyuan3d-2-1/blob/main/example_workflows/Full_Workflow.json',
  },
  tunables: HY3D_TUNABLES,
  // Sizes from Hugging Face. The texture model (hunyuan3d-paintpbr-v2-1,
  // ~6.9 GB) and facebook/dinov2-giant are loaded by the pack's own code from
  // the HF cache, which the setup script fills in the background.
  downloads: [
    { repo: 'tencent/Hunyuan3D-2.1', file: 'hunyuan3d-dit-v2-1/model.fp16.ckpt', dest: 'diffusion_models', bytes: 7_366_389_768, as: 'hunyuan3d-dit-v2-1-fp16.ckpt' },
    { repo: 'tencent/Hunyuan3D-2.1', file: 'hunyuan3d-vae-v2-1/model.fp16.ckpt', dest: 'vae', bytes: 655_648_152, as: 'Hunyuan3D-vae-v2-1-fp16.ckpt' },
  ],
  // Tencent's README: 10 GB for the shape, 21 GB for the texture, 29 GB for
  // both in one process. Disk: the devel image, these weights, the texture
  // model and DINOv2, and the pack's Python dependencies.
  hardware: { minVramMb: 40000, diskGb: 90, gpuModels: [], minArch: 'ampere' },
  customNodes: [{ repo: 'https://github.com/visualbruno/ComfyUI-Hunyuan3d-2-1', ref: 'a0b26fbb94c9a9d32720526c52e64f87e05d2b53' }],
  runtime: { image: 'pytorch/pytorch', tag: '2.13.0-cuda13.0-cudnn9-devel', setupScript: HY3D_SETUP },
  needs: { image: true },
  qualityModes: HY3D_QUALITY_MODES,
  bind: (p) => {
    const ultra = p.quality === 'ultra';
    const steps = Math.round(HY3D.num(p.tuning, 'shapeSteps'));
    const faces = Math.round(HY3D.num(p.tuning, 'faces'));
    return [
      { nodeId: '14', input: 'image', value: p.imageFilename ?? '' },
      { nodeId: '60', input: 'model', value: 'birefnet-general' },
      { nodeId: '37', input: 'seed', value: p.seed },
      { nodeId: '37', input: 'steps', value: ultra ? Math.max(steps, HY3D_ULTRA.minShapeSteps) : steps },
      { nodeId: '37', input: 'guidance_scale', value: HY3D.num(p.tuning, 'shapeGuidance') },
      { nodeId: '9', input: 'octree_resolution', value: ultra ? HY3D_ULTRA.octree : Math.round(HY3D.num(p.tuning, 'octree')) },
      {
        nodeId: '43',
        input: 'max_facenum',
        value: ultra ? HY3D_ULTRA.faces : p.quality === 'game' ? Math.min(faces, HY3D_GAME_FACES) : faces,
      },
      { nodeId: '20', input: 'seed', value: p.seed },
      { nodeId: '20', input: 'view_size', value: ultra ? HY3D_ULTRA.viewSize : HY3D_VIEW_SIZE },
      { nodeId: '20', input: 'texture_size', value: ultra ? HY3D_ULTRA.textureSize : Math.round(HY3D.num(p.tuning, 'textureSize')) },
      { nodeId: '20', input: 'steps', value: Math.round(HY3D.num(p.tuning, 'paintSteps')) },
      { nodeId: '44', input: 'filename_prefix', value: '3D/aixman' },
    ];
  },
  // One model is one unit: about three minutes on an A100 for shape and
  // texture together, until real rentals report.
  baselineSecondsPerUnit: 180,
  pricing: { creditsPerUnit: 15, costPerUnit: 0.04 },
  limits: { maxWidth: 2048, maxHeight: 2048 },
};

// ---------------------------------------------------------------------------
// LatentSync 1.6 — a clip re-dubbed with an uploaded voice
// ---------------------------------------------------------------------------
// Comfy-Org has no video lip-sync template, so the template is our own six
// nodes (latentsync16_video_dub.json) around vinavfx's maintained fork of the
// LatentSync wrapper; the original pack (ShmuelRonen) is unmaintained and
// breaks on torchvision 0.26.
//
// Two things of the pack's are not used as shipped:
//  - its face detector. It is InsightFace, whose buffalo_l weights are for
//    non-commercial research only. The setup script writes one built on
//    face-alignment (BSD-3) over it — LATENTSYNC_FACE_DETECTOR.
//  - its requirements.txt. It pins insightface (an sdist that needs a
//    compiler) and onnxruntime-gpu, and a failed install fails the boot. The
//    setup script installs what the inference path actually imports instead.
//
// The weights: LatentSync-1.6 is OpenRAIL++-M (commercial use allowed, with
// the licence's use restrictions), sd-vae-ft-mse is MIT.

/** Where the pack lands; its `checkpoints/` folder is pointed at the downloads. */
const LS_NODE_DIR = '/workspace/aixman/ComfyUI/custom_nodes/ComfyUI-LatentSyncWrapper';
const LS_MODELS = '/workspace/aixman/models/latentsync';

/**
 * Replaces the pack's `latentsync/utils/face_detector.py`. Same class, same
 * call: a box and the 106-point array ImageProcessor reads three points from
 * (eyebrow centres, nose centre) — filled from face-alignment's 68 points the
 * way LatentSync 1.5 computed the same three.
 */
const LATENTSYNC_FACE_DETECTOR = [
  '# Written by AIXMAN over the pack\'s own file. The pack finds faces with',
  '# InsightFace, whose buffalo_l weights are licensed for non-commercial research',
  '# only. This finds them with face-alignment (BSD-3): S3FD for the box, FAN for',
  '# 68 landmarks. ImageProcessor reads three points from the 106-point array it',
  '# expects (eyebrow centres and nose centre), so those slots are filled from the',
  '# 68 points the way LatentSync 1.5 computed the same three.',
  'import numpy as np',
  'import face_alignment',
  '',
  '_LEFT_BROW = [43, 48, 49, 51, 50]',
  '_RIGHT_BROW = [101, 102, 103, 104, 105]',
  '_NOSE = [74, 77, 83, 86]',
  '_MIN_SIDE = 40',
  '',
  '',
  'class FaceDetector:',
  '    def __init__(self, device="cuda"):',
  '        device = str(device)',
  '        self.fa = face_alignment.FaceAlignment(',
  '            face_alignment.LandmarksType.TWO_D,',
  '            device=device if device.startswith("cuda") or device == "cpu" else "cuda",',
  '            flip_input=False,',
  '            compile=False,',
  '        )',
  '',
  '    def __call__(self, frame, threshold=0.5):',
  '        image = np.ascontiguousarray(np.asarray(frame)[..., :3])',
  '        landmarks, _, boxes = self.fa.get_landmarks_from_image(image, return_bboxes=True)',
  '        if not landmarks or boxes is None:',
  '            return None, None',
  '        best = None',
  '        best_area = 0.0',
  '        for points, box in zip(landmarks, boxes):',
  '            x1, y1, x2, y2 = (float(v) for v in box[:4])',
  '            score = float(box[4]) if len(box) > 4 else 1.0',
  '            w, h = x2 - x1, y2 - y1',
  '            if score < threshold or w < _MIN_SIDE or h < _MIN_SIDE:',
  '                continue',
  '            if w * h > best_area:',
  '                best, best_area = (points, (x1, y1, x2, y2)), w * h',
  '        if best is None:',
  '            return None, None',
  '        points, (x1, y1, x2, y2) = best',
  '        points = np.asarray(points, dtype=np.float32)[:, :2]',
  '        lmk = np.zeros((106, 2), dtype=np.float32)',
  '        lmk[_LEFT_BROW] = points[17:22].mean(axis=0)',
  '        lmk[_RIGHT_BROW] = points[22:27].mean(axis=0)',
  '        lmk[_NOSE] = points[27:36].mean(axis=0)',
  '        height, width = image.shape[:2]',
  '        bbox = (max(0, int(x1)), max(0, int(y1)), min(width, int(x2)), min(height, int(y2)))',
  '        return bbox, lmk',
].join('\n');

/**
 * A one-file loader. Core LoadVideo hands over every frame at the clip's own
 * size and rate as float32 — a 20 s 1080p clip is 15 GB, and the pack copies
 * the batch onto the card. This decodes with ffmpeg at the 25 fps LatentSync
 * renders at, only as many seconds as the voice runs, long side capped.
 * Errors that are the clip's fault say `AIXMAN_INPUT:` (gpu-queue.ts).
 */
const AIXMAN_LOAD_VIDEO_NODE = [
  'import os',
  'import shutil',
  'import subprocess',
  '',
  'import numpy as np',
  '',
  'import folder_paths',
  '',
  '',
  'def _ffmpeg():',
  '    exe = shutil.which("ffmpeg")',
  '    if exe:',
  '        return exe',
  '    from imageio_ffmpeg import get_ffmpeg_exe',
  '',
  '    return get_ffmpeg_exe()',
  '',
  '',
  'def read_clip(path, max_seconds, max_side):',
  '    """The clip\'s frames at 25 fps as uint8 RGB, at most max_seconds long, long side at most max_side."""',
  '    side = int(max_side)',
  '    scale = (',
  '        f"scale=w=\'min(iw,{side})\':h=\'min(ih,{side})\'"',
  '        ":force_original_aspect_ratio=decrease:force_divisible_by=2"',
  '    )',
  '    cmd = [',
  '        _ffmpeg(), "-v", "error", "-nostdin", "-i", path,',
  '        "-t", f"{float(max_seconds):.3f}", "-an",',
  '        "-vf", f"fps=25,{scale},format=rgb24",',
  '        "-f", "image2pipe", "-c:v", "ppm", "-",',
  '    ]',
  '    run = subprocess.run(cmd, capture_output=True, timeout=900)',
  '    data = run.stdout',
  '    if run.returncode != 0 or not data.startswith(b"P6"):',
  '        reason = run.stderr.decode(errors="replace").strip()[-300:]',
  '        raise RuntimeError(f"AIXMAN_INPUT: the clip could not be decoded ({reason or \'no frames\'})")',
  '    # Each frame is one binary PPM: "P6", width and height, "255", then w*h*3 bytes.',
  '    magic, dims, depth, _ = data.split(b"\\n", 3)',
  '    width, height = (int(v) for v in dims.split())',
  '    header = len(magic) + len(dims) + len(depth) + 3',
  '    size = header + width * height * 3',
  '    count = len(data) // size',
  '    if count == 0 or int(depth) != 255:',
  '        raise RuntimeError("AIXMAN_INPUT: the clip has no readable frames")',
  '    frames = np.empty((count, height, width, 3), dtype=np.uint8)',
  '    for i in range(count):',
  '        start = i * size + header',
  '        frames[i] = np.frombuffer(data, dtype=np.uint8, count=width * height * 3, offset=start).reshape(height, width, 3)',
  '    return frames',
  '',
  '',
  'class AixmanLoadVideo25:',
  '    @classmethod',
  '    def INPUT_TYPES(cls):',
  '        return {',
  '            "required": {',
  '                "video": ("STRING", {"default": ""}),',
  '                "max_seconds": ("FLOAT", {"default": 10.0, "min": 0.5, "max": 120.0, "step": 0.01}),',
  '                "max_side": ("INT", {"default": 1280, "min": 256, "max": 1920, "step": 8}),',
  '            }',
  '        }',
  '',
  '    RETURN_TYPES = ("IMAGE",)',
  '    RETURN_NAMES = ("images",)',
  '    FUNCTION = "load"',
  '    CATEGORY = "aixman"',
  '',
  '    def load(self, video, max_seconds, max_side):',
  '        import torch',
  '',
  '        root = os.path.realpath(folder_paths.get_input_directory())',
  '        path = os.path.realpath(os.path.join(root, str(video)))',
  '        if not path.startswith(root + os.sep) or not os.path.isfile(path):',
  '            raise RuntimeError("AIXMAN_INPUT: the clip is not in the input folder")',
  '        frames = read_clip(path, max_seconds, max_side)',
  '        out = torch.empty(frames.shape, dtype=torch.float32)',
  '        for i in range(frames.shape[0]):',
  '            out[i] = torch.from_numpy(frames[i]).float().div_(255.0)',
  '        return (out,)',
  '',
  '',
  'NODE_CLASS_MAPPINGS = {"AixmanLoadVideo25": AixmanLoadVideo25}',
  'NODE_DISPLAY_NAME_MAPPINGS = {"AixmanLoadVideo25": "Load clip at 25 fps (aixman)"}',
].join('\n');

/**
 * face-alignment's landmark model. Not on Hugging Face, so it comes from its
 * author's own host, checked against its whole SHA-256 (torch.hub checks
 * before moving the file into place; its name carries only the first ten
 * digits). Its detector (S3FD) is in the downloads, from a Hugging Face mirror
 * whose file has the same hash as the author's.
 */
const FAN_URL = 'https://www.adrianbulat.com/downloads/python-fan/2DFAN4-11f355bf06.pth.tar';
const FETCH_FAN = [
  'import os',
  'import socket',
  'import sys',
  'import time',
  'from torch.hub import download_url_to_file',
  '',
  'socket.setdefaulttimeout(60)',
  'target = os.path.join(sys.argv[1], "2DFAN4-11f355bf06.pth.tar")',
  'for attempt in range(3):',
  '    if os.path.exists(target):',
  '        break',
  '    try:',
  '        download_url_to_file(sys.argv[2], target, hash_prefix="11f355bf0693120222f5955ce3f9dc8fb5763ebb30a47d7906e509490d32e4aa", progress=False)',
  '    except Exception as error:',
  '        print(f"[aixman] 2DFAN4 download attempt {attempt + 1} failed: {error}")',
  '        time.sleep(10)',
  'sys.exit(0 if os.path.exists(target) else 1)',
].join('\n');

/** Where a library will look, as Python works it out — HOME may be unset in a vendor's runner. */
const pyPath = (expr: string) => `"$(python3 -c '${expr}')"`;

const LATENTSYNC_SETUP = [
  `LS_DIR=${LS_NODE_DIR}`,
  `LS_MODELS=${LS_MODELS}`,
  '[ -d "$LS_DIR/latentsync" ] || fail_boot "the LatentSync node pack is missing"',
  // ffmpeg on PATH: the pack re-encodes through it, whisper reads the voice
  // through it, and the loader decodes the clip with it. imageio-ffmpeg's
  // static binary is the loader's fallback.
  'apt-get install -y -qq ffmpeg libgl1 libglib2.0-0 > /dev/null 2>&1 || echo "[aixman] no ffmpeg from apt; the imageio-ffmpeg binary will be used"',
  // diffusers and DeepCache at the versions LatentSync 1.6 ships with: its
  // UNet imports diffusers internals by module path. transformers 4.x, as for
  // Hunyuan3D, keeps huggingface_hub below 1.0, which diffusers 0.32 needs.
  'pip_install "LatentSync dependencies" "diffusers==0.32.2" "DeepCache==0.1.1" "transformers>=4.50.3,<5" accelerate omegaconf einops "decord==0.6.0" ffmpeg-python soundfile librosa imageio imageio-ffmpeg kornia matplotlib scipy scikit-image numba opencv-python-headless tqdm requests',
  // Without its declared dependencies: they name opencv-python, whose GUI
  // build fights the headless one over the cv2 module. The rest are above.
  'pip_install "face-alignment" --no-deps "face-alignment==1.5.0"',
  `PY_HOME=${pyPath('import os; print(os.path.expanduser("~"))')}`,
  // The pack installs whatever it thinks is missing on first use unless this
  // flag exists, and its list names pytorch_lightning, which nothing imports.
  'touch "$PY_HOME/.latentsync16_dependencies_installed"',
  // Weights land in models/latentsync like every other download. The pack
  // reads them from its own checkpoints/ folder, whisper from its cache dir,
  // face-alignment from torch.hub's.
  'rm -rf "$LS_DIR/checkpoints" && ln -sfn "$LS_MODELS" "$LS_DIR/checkpoints"',
  `WHISPER_DIR=${pyPath('import os; print(os.getenv("XDG_CACHE_HOME", os.path.join(os.path.expanduser("~"), ".cache", "whisper")))')}`,
  'mkdir -p "$WHISPER_DIR" "$PY_HOME/.latentsync16_models"',
  'ln -sfn "$LS_MODELS/whisper/tiny.pt" "$WHISPER_DIR/tiny.pt"',
  // The pack pre-downloads S3FD under this name on its first job (sic, e19a).
  'ln -sfn "$LS_MODELS/face/s3fd-619a316812.pth" "$PY_HOME/.latentsync16_models/s3fd-e19a316812.pth"',
  `HUB_DIR=${pyPath('import torch; print(torch.hub.get_dir())')}/checkpoints`,
  'mkdir -p "$HUB_DIR"',
  'ln -sfn "$LS_MODELS/face/s3fd-619a316812.pth" "$HUB_DIR/s3fd-619a316812.pth"',
  // A machine that cannot find a face cannot render; better it never says ready.
  `python3 - "$HUB_DIR" '${FAN_URL}' <<'AIXMAN_PY' || fail_boot "face-alignment's landmark model (2DFAN4) could not be downloaded"`,
  FETCH_FAN,
  'AIXMAN_PY',
  `cat > "$LS_DIR/latentsync/utils/face_detector.py" <<'AIXMAN_PY'`,
  LATENTSYNC_FACE_DETECTOR,
  'AIXMAN_PY',
  "cat > /workspace/aixman/ComfyUI/custom_nodes/aixman_load_video.py <<'AIXMAN_PY'",
  AIXMAN_LOAD_VIDEO_NODE,
  'AIXMAN_PY',
].join('\n');

const LS_TUNABLES: WorkflowTunable[] = [
  {
    id: 'lipsExpression',
    label: 'ความชัดของปาก',
    help: 'น้ำหนักของเสียงต่อรูปปาก (guidance) — ค่าของโหนดคือ 1.5 สูงขึ้นปากขยับชัดขึ้นแต่อาจดูเกร็ง',
    type: 'float',
    default: 1.5,
    min: 1,
    max: 3,
    step: 0.1,
    group: 'quality',
  },
  {
    id: 'steps',
    label: 'สเต็ป',
    help: 'สเต็ปของ diffusion — ค่าของโหนดคือ 20 มากขึ้นละเอียดขึ้น แต่ช้าลงตามสัดส่วน',
    type: 'int',
    default: 20,
    min: 10,
    max: 50,
    step: 1,
    group: 'sampler',
  },
  {
    id: 'maxSide',
    label: 'ความละเอียดสูงสุด (ด้านยาว)',
    help: 'คลิปที่ใหญ่กว่านี้ถูกย่อก่อนเข้าโมเดล หน้าถูกวาดที่ 512 px อยู่แล้ว แต่ทุกเฟรมทั้งภาพอยู่ในหน่วยความจำ — เกิน 1280 กับคลิปยาวอาจทำให้หน่วยความจำไม่พอ',
    type: 'int',
    default: 1280,
    min: 720,
    max: 1920,
    step: 8,
    group: 'quality',
    risky: true,
  },
];

const LS = tunableReader(LS_TUNABLES);

/** LatentSync renders at 25 fps, whatever the clip's own rate was. */
const LS_FPS = 25;
const LS_MAX_SECONDS = 20;

const LATENTSYNC_16: CatalogEntry = {
  key: 'latentsync-1.6',
  name: 'พากย์ทับคลิป (LatentSync 1.6)',
  pools: ['rented'],
  kind: 'lipsync',
  outputKind: 'video',
  description: `อัปโหลดคลิปที่เห็นหน้าคน + ไฟล์เสียงพูด (ภาษาไทยได้) → ปากในคลิปขยับตามเสียงใหม่ ภาพส่วนอื่นคงเดิม • ยาวตามไฟล์เสียง สูงสุด ${LS_MAX_SECONDS} วินาที`,
  template: latentsyncTemplate as UiWorkflow,
  source: {
    file: 'latentsync16_video_dub.json',
    title: 'เขียนเอง — LatentSync 1.6 (vinavfx/ComfyUI-LatentSyncWrapper) พากย์ทับคลิปด้วยเสียงที่อัปโหลด',
    url: 'https://github.com/vinavfx/ComfyUI-LatentSyncWrapper',
  },
  tunables: LS_TUNABLES,
  // Sizes from Hugging Face. The landmark model (2DFAN4, ~96 MB) is fetched by
  // the setup script — see FAN_URL.
  downloads: [
    { repo: 'ByteDance/LatentSync-1.6', file: 'latentsync_unet.pt', dest: 'latentsync', bytes: 5_072_222_488 },
    { repo: 'stabilityai/sd-vae-ft-mse', file: 'diffusion_pytorch_model.safetensors', dest: 'latentsync/vae', bytes: 334_643_276 },
    { repo: 'vinthony/SadTalker', file: 'hub/checkpoints/s3fd-619a316812.pth', dest: 'latentsync/face', bytes: 89_843_225 },
    { repo: 'ByteDance/LatentSync-1.6', file: 'whisper/tiny.pt', dest: 'latentsync/whisper', bytes: 75_572_083 },
    { repo: 'stabilityai/sd-vae-ft-mse', file: 'config.json', dest: 'latentsync/vae', bytes: 547 },
  ],
  // ByteDance: 18 GB of VRAM for 1.6 at 512 px, and the pack caps itself at
  // 80% of the card — 24 GB is the smallest that holds it. fp16 needs Ampere
  // (the pack falls back to fp32 below compute 8, which does not fit).
  hardware: { minVramMb: 24576, diskGb: 60, gpuModels: [], minArch: 'ampere' },
  customNodes: [
    { repo: 'https://github.com/vinavfx/ComfyUI-LatentSyncWrapper', ref: '4902c3957c027acd1e333659e1c48bcdb7cf9d55', requirements: false },
  ],
  runtime: { setupScript: LATENTSYNC_SETUP },
  needs: { audio: true, video: true },
  // A clip is uploaded to the machine whole, so it is kept to what crosses a
  // tunnel in seconds. Only as much of it as the voice runs is decoded.
  sourceVideo: { minSeconds: 1, maxSeconds: 60, minSide: 256, maxBytes: 50 * 1024 * 1024 },
  lengthFromAudio: { minSeconds: 1, stepSeconds: 1 / LS_FPS },
  bind: (p) => [
    { nodeId: '1', input: 'audio', value: p.audioFilename ?? '' },
    // One number decides the voice, the clip read and the frame count.
    { nodeId: '2', input: 'start_index', value: 0 },
    { nodeId: '2', input: 'duration', value: p.durationSeconds },
    { nodeId: '3', input: 'video', value: p.videoFilename ?? '' },
    // A clip shorter than the voice is played back and forth by the pack.
    { nodeId: '3', input: 'max_seconds', value: p.durationSeconds },
    { nodeId: '3', input: 'max_side', value: Math.round(LS.num(p.tuning, 'maxSide')) },
    // numpy's seed must fit in 32 bits; a client may send any number.
    { nodeId: '4', input: 'seed', value: Math.abs(Math.trunc(p.seed)) % 2_147_483_647 },
    { nodeId: '4', input: 'lips_expression', value: LS.num(p.tuning, 'lipsExpression') },
    { nodeId: '4', input: 'inference_steps', value: Math.round(LS.num(p.tuning, 'steps')) },
    // The file carries the customer's recording as trimmed, not the pack's
    // 16 kHz copy.
    { nodeId: '5', input: 'fps', value: LS_FPS },
    { nodeId: '6', input: 'filename_prefix', value: 'video/aixman' },
  ],
  // A guess until rentals report: ByteDance's numbers put 1.6 at a few frames
  // a second on a 4090, plus face detection and paste-back for every frame.
  baselineSecondsPerUnit: 30,
  // Priced by the voice: ≤5 s 10 credits, 10 s 23, 20 s 53. A smaller card
  // and model than the portrait (LTX), so a gentler curve.
  pricing: { creditsPerUnit: 10, costPerUnit: 0.03, durationCurve: { unitSeconds: 5, exponent: 1.2 } },
  limits: { maxDuration: LS_MAX_SECONDS },
};

export const MODEL_CATALOG: CatalogEntry[] = [
  MINIMAX_H3,
  LTX_25,
  ACE_STEP,
  QWEN_IMAGE,
  YUE2_MUSIC,
  YUE2_COVER,
  SDXL_COMMUNITY,
  HUNYUAN3D_21,
  LATENTSYNC_16,
];

/**
 * Keys that once had an entry. Their `ai_models` rows outlive the entry, and a
 * key with no entry falls back to the H3 worker profile, so an order for one
 * would rent a machine that cannot run it. Orders are refused and the model
 * sync turns the rows off.
 *
 * `ltx-2.3-talking`: the LTX-2.3 talking portrait, removed for LTX-2.5.
 */
export const RETIRED_CATALOG_KEYS: readonly string[] = ['ltx-2.3-talking'];

export function isRetiredCatalogKey(key: string): boolean {
  return RETIRED_CATALOG_KEYS.includes(key);
}

export function getCatalogEntry(key: string): CatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.key === key);
}

export function inPool(entry: Pick<CatalogEntry, 'pools'> | undefined, pool: CatalogPool): boolean {
  return entry?.pools.includes(pool) ?? false;
}

/** Whether GPUxMINE home machines may be given this model's jobs. */
export function isCommunityModel(modelKey: string): boolean {
  return inPool(getCatalogEntry(modelKey), 'community');
}

/** Whether this model may only ever run on community machines (no rental fallback). */
export function isCommunityOnlyModel(modelKey: string): boolean {
  const entry = getCatalogEntry(modelKey);
  return inPool(entry, 'community') && !inPool(entry, 'rented');
}

/**
 * Whether an order for this model needs a key from its provider's account
 * pool. A community-only model does not: it rents nothing and calls no
 * vendor's API — its jobs go to GPUxMINE home PCs, paid per job — so the
 * SimplePod row it is filed under must not decide whether it can be ordered.
 * `gpuModel`: the model's provider is a GPU-rental row (getGpuProvider).
 */
export function orderNeedsProviderAccount(modelKey: string, gpuModel: boolean): boolean {
  return !(gpuModel && isCommunityOnlyModel(modelKey));
}

/** The entries a community node may be matched to — the only ones eligibility looks at. */
export function communityCatalogue(): CatalogEntry[] {
  return MODEL_CATALOG.filter((entry) => inPool(entry, 'community'));
}

/** Total download size, used for the disk estimate and warmup expectations. */
export function downloadBytes(entry: CatalogEntry): number {
  return entry.downloads.reduce((sum, d) => sum + d.bytes, 0);
}

export function downloadGb(entry: CatalogEntry): number {
  return Number((downloadBytes(entry) / GB).toFixed(1));
}
