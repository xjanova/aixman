import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * fal.ai Provider - Fast inference platform
 * Supports FLUX, Seedream, Kling, Veo, Wan and many more models
 */
export class FalProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'fal';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    return this.runModel(params);
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    return this.runModel(params);
  }

  // Image-to-image / edit / upscale — fal models read the source from `image_url`,
  // which runModel already forwards from params.inputImage.
  async editImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    if (!params.inputImage) {
      return { success: false, error: 'No input image provided for edit' };
    }
    return this.runModel(params);
  }

  /** Between status reads. A field so a test can poll without waiting. */
  protected pollIntervalMs = 3000;

  private async runModel(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const auth = { Authorization: `Key ${params.apiKey}` };

    try {
      const input = params.inputAudio ? this.lipsyncInput(params) : this.generativeInput(params);

      // Submit to queue
      const response = await this.request(`https://queue.fal.run/${params.modelId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth,
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `fal.ai error ${response.status}: ${error}` };
      }

      const queueData = await response.json();
      const requestId = queueData.request_id;

      if (!requestId) {
        // Direct response (sync mode)
        return delivered(queueData, undefined, startTime);
      }

      // The queue names its own status and result URLs; built by hand they
      // were wrong for nested model ids (`fal-ai/flux/dev`). Only ever ours to
      // follow on fal's own host — the API key travels with every request.
      const base = `https://queue.fal.run/${params.modelId}/requests/${requestId}`;
      const statusUrl = falUrl(queueData.status_url) ?? `${base}/status`;
      const responseUrl = falUrl(queueData.response_url) ?? base;

      return await this.pollForResult(async () => {
        const statusRes = await this.request(statusUrl, { headers: auth });
        if (!statusRes.ok) {
          // A blip on the status read is not the job failing — fal is still
          // rendering it, and billing us for it. Give up only when fal says
          // the request is gone or the key is refused.
          if (statusRes.status === 429 || statusRes.status >= 500) return { done: false };
          return { done: true, result: { success: false, error: `fal.ai status ${statusRes.status}: ${await errorText(statusRes)}` } };
        }
        const statusData = await statusRes.json();

        if (statusData.status === 'COMPLETED') {
          // fal has no FAILED status: a request that failed *completes*, with
          // `error` set. Reading it as success stored a finished generation
          // with no file and never refunded the customer.
          if (statusData.error) {
            const kind = typeof statusData.error_type === 'string' ? ` (${statusData.error_type})` : '';
            return { done: true, result: { success: false, error: `fal.ai error${kind}: ${describe(statusData.error)}` } };
          }
          const resultRes = await this.request(responseUrl, { headers: auth });
          if (!resultRes.ok) {
            return { done: true, result: { success: false, error: `fal.ai result ${resultRes.status}: ${await errorText(resultRes)}` } };
          }
          return { done: true, result: delivered(await resultRes.json(), requestId, startTime) };
        }

        // Not in fal's documented set; kept in case an endpoint reports it.
        if (statusData.status === 'FAILED') {
          return { done: true, result: { success: false, error: describe(statusData.error) || 'Generation failed' } };
        }

        return { done: false };
      }, 120, this.pollIntervalMs);
    } catch (error) {
      return { success: false, error: `fal.ai request failed: ${(error as Error).message}` };
    }
  }

  /** The generic text/image body every non-audio fal endpoint has taken so far. */
  private generativeInput(params: ProviderGenerateParams): Record<string, unknown> {
    const input: Record<string, unknown> = {
      prompt: params.prompt,
    };

    if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
    if (params.width) input.image_size = { width: params.width, height: params.height || params.width };
    if (params.steps) input.num_inference_steps = params.steps;
    if (params.cfgScale) input.guidance_scale = params.cfgScale;
    if (params.seed) input.seed = params.seed;
    if (params.numOutputs) input.num_images = params.numOutputs;
    if (params.inputImage) input.image_url = params.inputImage;
    if (params.duration) input.duration = params.duration;
    if (params.extraParams) Object.assign(input, params.extraParams);

    return input;
  }

  /**
   * Body for the audio-driven endpoints, which take a different shape.
   *
   * Two shapes exist and the driving input tells them apart, so no model-id
   * table has to be kept in sync with the catalogue:
   *
   *  - a source clip (`fal-ai/latentsync`) re-dubs existing footage and takes
   *    `video_url` + `audio_url` and nothing else meaningful;
   *  - a still (`fal-ai/infinitalk`) animates a portrait and additionally
   *    requires `prompt`.
   *
   * Unlike `generativeInput`, the caller's params are NOT spread in wholesale.
   * The generic path can afford that because those endpoints ignore fields
   * they do not know, but here the request carries a UI's worth of leftovers —
   * `width`, `fps`, `numOutputs`, `aspectRatio` — that mean nothing to a
   * lip-sync model, and `image_size` in particular is an object where a
   * scalar is expected. Only keys the published schemas name are forwarded.
   */
  private lipsyncInput(params: ProviderGenerateParams): Record<string, unknown> {
    const input: Record<string, unknown> = { audio_url: params.inputAudio };

    if (params.inputVideo) {
      input.video_url = params.inputVideo;
      // Audio longer than the clip has to resolve somehow, and silently
      // truncating the voice would cut a sentence mid-word. Looping the
      // picture keeps every word the customer paid to say.
      input.loop_mode = 'loop';
      if (params.cfgScale) input.guidance_scale = params.cfgScale;
    } else if (params.inputImage) {
      input.image_url = params.inputImage;
      // Required by the portrait endpoints, and empty is rejected.
      input.prompt = params.prompt?.trim() || 'a person speaking to camera';
      input.num_frames = portraitFrames(params);
    }

    if (params.seed) input.seed = params.seed;

    // Endpoint-specific extras still have a way in, but by explicit allowlist
    // rather than by dumping the whole params blob — and nothing on it changes
    // what fal bills us (see LIPSYNC_PASSTHROUGH).
    const extras = params.extraParams ?? {};
    for (const key of LIPSYNC_PASSTHROUGH) {
      if (extras[key] !== undefined) input[key] = extras[key];
    }

    return input;
  }
}

/**
 * Optional inputs a caller may set on an audio-driven fal endpoint.
 *
 * Named after fal's own field names because that is what they are — a value
 * chosen for one endpoint and posted verbatim. Anything not listed is dropped
 * rather than forwarded, so a stray UI field cannot fail the request.
 *
 * `resolution` is deliberately absent: InfiniTalk bills 720p at twice the 480p
 * rate while the model row charges one flat price, so a caller asking for it
 * doubled what we paid; and the studio's own `resolution` is a video preset id
 * ("768p") that fal rejects. `acceleration` trades quality for speed on fal's
 * side and is not ours to hand out either.
 */
const LIPSYNC_PASSTHROUGH = [
  'loop_mode',
  'guidance_scale',
  'sync_mode',
] as const;

/**
 * The files a finished fal request produced, or a failure when it produced
 * none. A "success" with no URL used to be stored as a completed generation
 * with nothing in it — charged, and never refunded.
 */
function delivered(data: unknown, jobId: string | undefined, startTime: number): ProviderResponse {
  const urls = outputUrls(data);
  if (urls.length === 0) {
    const detail = describe((data as { detail?: unknown; error?: unknown } | null)?.detail ?? (data as { error?: unknown } | null)?.error);
    return { success: false, error: `fal.ai returned no output${detail ? `: ${detail}` : ''}` };
  }
  return { success: true, resultUrl: urls[0], resultUrls: urls, jobId, processingMs: Date.now() - startTime };
}

/** `video`, then `images[]`, then a single `image` (fal's upscalers answer with that one). */
function outputUrls(data: unknown): string[] {
  const d = (data ?? {}) as { video?: { url?: unknown }; images?: { url?: unknown }[]; image?: { url?: unknown } };
  const ok = (u: unknown): u is string => typeof u === 'string' && u.length > 0;
  if (ok(d.video?.url)) return [d.video.url];
  const images = Array.isArray(d.images) ? d.images.map((i) => i?.url).filter(ok) : [];
  if (images.length > 0) return images;
  if (ok(d.image?.url)) return [d.image.url];
  return [];
}

/** A queue URL from fal's own answer, only if it points at fal. */
function falUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'fal.run' || url.hostname.endsWith('.fal.run')) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** fal's error payloads are strings, `{ msg }` objects or lists of them. */
function describe(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error.slice(0, 500);
  if (Array.isArray(error)) return error.map(describe).filter(Boolean).join('; ').slice(0, 500);
  if (typeof error === 'object') {
    const e = error as { msg?: unknown; message?: unknown; detail?: unknown };
    return describe(e.msg ?? e.message ?? e.detail) || JSON.stringify(error).slice(0, 500);
  }
  return String(error).slice(0, 500);
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
    return describe(parsed.detail ?? parsed.error) || text.slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

/** Output frame rate of the portrait endpoints, used to turn seconds into frames. */
const PORTRAIT_FPS = 25;
/** Range the endpoint documents; outside it the request is rejected. */
const PORTRAIT_MIN_FRAMES = 41;
const PORTRAIT_MAX_FRAMES = 721;

/**
 * Frame count for a talking-portrait render.
 *
 * These endpoints bill **per second of output** while we charge a flat credit
 * price per generation, so the length is ours to decide, not the caller's and
 * not the vendor's. Left alone, fal defaults to 145 frames — about six seconds
 * — regardless of what the model row is priced for, which is spend we never
 * collect. This is the same hole `maxDuration` closed for MiniMax; the unit
 * here happens to be frames.
 *
 * `num_frames` is deliberately absent from LIPSYNC_PASSTHROUGH for the same
 * reason: a caller must not be able to set it directly and bypass the ceiling.
 */
function portraitFrames(params: ProviderGenerateParams): number {
  const ceiling = params.maxDuration && params.maxDuration > 0 ? params.maxDuration : undefined;
  const wanted = params.duration && params.duration > 0 ? params.duration : ceiling;
  const seconds = Math.min(wanted ?? 5, ceiling ?? wanted ?? 5);

  const frames = Math.round(seconds * PORTRAIT_FPS);
  return Math.min(PORTRAIT_MAX_FRAMES, Math.max(PORTRAIT_MIN_FRAMES, frames));
}
