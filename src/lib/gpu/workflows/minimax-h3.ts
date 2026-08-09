/**
 * Built-in ComfyUI workflow for MiniMax H3 (Hailuo 3.0).
 *
 * Transcribed from the official Comfy-Org template
 * `templates/video_minimax_h3_t2v.json`, which ships as a UI-format graph with
 * the pipeline wrapped in a subgraph. ComfyUI's `/prompt` endpoint only accepts
 * API format, so the subgraph is flattened here into the equivalent node set:
 *
 *   UNETLoader ─┬─> BasicScheduler ──> SamplerCustomAdvanced ─> VAEDecode ──────┐
 *               └─> BasicGuider ─┐            ^  ^  ^                           ├─> CreateVideo -> SaveVideo
 *   CLIPLoader ─> MiniMaxH3ImageToVideo ──────┘  │  │         VAEDecodeAudio ───┘
 *   VAELoader(video) ─┘   │                      │  │              ^
 *   VAELoader(audio) ─────┼──────────────────────┼──┼──────────────┘
 *   RandomNoise ──────────┘      KSamplerSelect ─┘  │
 *                                                   └── (latent from MiniMaxH3ImageToVideo)
 *
 * Two helper nodes from the template are deliberately NOT reproduced:
 *  - `ComfyMathExpression` computes the frame count; it comes from a custom node
 *    pack that may not be installed, so `frameLengthFor()` does the same maths.
 *  - `ResolutionSelector` derives width/height; the caller already has them.
 *
 * Model filenames are the ones the official template uses — the quantised set
 * that fits a single 24 GB card.
 */

export const MINIMAX_H3_MODELS = {
  /** Pruned INT8, ~20.97 GB. The bf16 original is 66 GB and needs 4× H100. */
  unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  /** Qwen3-VL 32B text encoder, NVFP4 AWQ, ~15.69 GB. */
  clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
} as const;

export interface MiniMaxH3WorkflowParams {
  prompt: string;
  width: number;
  height: number;
  /** Seconds of video. Converted to a legal frame count internally. */
  duration: number;
  fps: number;
  seed: number;
  steps?: number;
  /** Filename of an already-uploaded image, for image-to-video. */
  firstFrameImage?: string;
}

/**
 * MiniMax H3's latent temporal compression only accepts frame counts where
 * `length % 17 === 5`. The official template enforces this with the expression
 *   max(5, round(a*24)) + (5 - (max(5, round(a*24)) % 17)) % 17
 * reproduced here with Python's modulo semantics (JS `%` keeps the sign, which
 * would yield a negative pad and an invalid length).
 */
export function frameLengthFor(durationSeconds: number, fps: number): number {
  const raw = Math.max(5, Math.round(durationSeconds * fps));
  const pad = (((5 - (raw % 17)) % 17) + 17) % 17;
  return raw + pad;
}

/** Round to the multiple of 32 the model expects, staying within bounds. */
function snapDimension(value: number, fallback: number): number {
  const n = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.min(1920, Math.max(256, Math.round(n / 32) * 32));
}

/**
 * Build the API-format graph. Node ids mirror the official template so a graph
 * dumped from here can be compared against it directly.
 */
export function buildMiniMaxH3Workflow(
  params: MiniMaxH3WorkflowParams
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const width = snapDimension(params.width, 1344);
  const height = snapDimension(params.height, 768);
  const fps = params.fps > 0 ? params.fps : 24;
  const length = frameLengthFor(params.duration, fps);
  const steps = params.steps && params.steps > 0 ? Math.min(60, params.steps) : 20;

  const h3Inputs: Record<string, unknown> = {
    clip: ['13', 0],
    vae: ['11', 0],
    prompt: params.prompt,
    width,
    height,
    length,
  };

  // first_frame / last_frame are optional and left unconnected for pure
  // text-to-video, exactly as the official T2V template does.
  if (params.firstFrameImage) {
    h3Inputs.first_frame = ['200', 0];
  }

  const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    '6': {
      class_type: 'UNETLoader',
      inputs: { unet_name: MINIMAX_H3_MODELS.unet, weight_dtype: 'default' },
    },
    '13': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: MINIMAX_H3_MODELS.clip, type: 'minimax', device: 'default' },
    },
    '11': {
      class_type: 'VAELoader',
      inputs: { vae_name: MINIMAX_H3_MODELS.videoVae },
    },
    '24': {
      class_type: 'VAELoader',
      inputs: { vae_name: MINIMAX_H3_MODELS.audioVae },
    },
    '104': {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: h3Inputs,
    },
    '15': {
      class_type: 'RandomNoise',
      // Kept inside INT32 range: ComfyUI rejects seeds beyond its widget bounds.
      inputs: { noise_seed: Math.abs(Math.floor(params.seed)) % 2_147_483_647 },
    },
    '17': {
      class_type: 'KSamplerSelect',
      inputs: { sampler_name: 'res_multistep' },
    },
    '9': {
      class_type: 'BasicScheduler',
      inputs: { model: ['6', 0], scheduler: 'simple', steps, denoise: 1 },
    },
    '16': {
      class_type: 'BasicGuider',
      // conditioning comes from MiniMaxH3ImageToVideo's `positive` output (slot 0)
      inputs: { model: ['6', 0], conditioning: ['104', 0] },
    },
    '14': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['15', 0],
        guider: ['16', 0],
        sampler: ['17', 0],
        sigmas: ['9', 0],
        // latent comes from MiniMaxH3ImageToVideo's LATENT output (slot 1)
        latent_image: ['104', 1],
      },
    },
    '10': {
      class_type: 'VAEDecode',
      inputs: { samples: ['14', 0], vae: ['11', 0] },
    },
    '23': {
      class_type: 'VAEDecodeAudio',
      inputs: { samples: ['14', 0], vae: ['24', 0] },
    },
    '91': {
      class_type: 'CreateVideo',
      inputs: { images: ['10', 0], audio: ['23', 0], fps },
    },
    '92': {
      class_type: 'SaveVideo',
      inputs: { video: ['91', 0], filename_prefix: 'video/aixman', format: 'auto', codec: 'auto' },
    },
  };

  if (params.firstFrameImage) {
    graph['200'] = {
      class_type: 'LoadImage',
      inputs: { image: params.firstFrameImage },
    };
  }

  return graph;
}

/** Node id whose outputs carry the finished video. */
export const MINIMAX_H3_OUTPUT_NODE = '92';
