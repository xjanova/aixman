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

  private async runModel(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      const input = params.inputAudio ? this.lipsyncInput(params) : this.generativeInput(params);

      // Submit to queue
      const response = await this.request(`https://queue.fal.run/${params.modelId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${params.apiKey}`,
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
        const images: { url: string }[] = Array.isArray(queueData.images) ? queueData.images : [];
        const videoUrl = queueData.video?.url;
        return {
          success: true,
          resultUrl: videoUrl || images[0]?.url,
          resultUrls: videoUrl ? [videoUrl] : images.map((i) => i.url).filter(Boolean),
          processingMs: Date.now() - startTime,
        };
      }

      // Poll for async result
      return await this.pollForResult(async () => {
        const statusRes = await this.request(
          `https://queue.fal.run/${params.modelId}/requests/${requestId}/status`,
          { headers: { 'Authorization': `Key ${params.apiKey}` } }
        );
        const statusData = await statusRes.json();

        if (statusData.status === 'COMPLETED') {
          // Fetch full result
          const resultRes = await this.request(
            `https://queue.fal.run/${params.modelId}/requests/${requestId}`,
            { headers: { 'Authorization': `Key ${params.apiKey}` } }
          );
          const resultData = await resultRes.json();
          const images = resultData.images || [];
          const videoUrl = resultData.video?.url;

          return {
            done: true,
            result: {
              success: true,
              resultUrl: videoUrl || images[0]?.url,
              resultUrls: videoUrl ? [videoUrl] : images.map((i: { url: string }) => i.url),
              jobId: requestId,
              processingMs: Date.now() - startTime,
            },
          };
        }

        if (statusData.status === 'FAILED') {
          return { done: true, result: { success: false, error: statusData.error || 'Generation failed' } };
        }

        return { done: false };
      }, 120, 3000);
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

    // Endpoint-specific extras still have a way in — `resolution`,
    // `num_frames`, `acceleration` — but by explicit allowlist rather than by
    // dumping the whole params blob.
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
 */
const LIPSYNC_PASSTHROUGH = [
  'resolution',
  'acceleration',
  'loop_mode',
  'guidance_scale',
  'sync_mode',
] as const;

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
