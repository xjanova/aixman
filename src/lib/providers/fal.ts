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

  private async runModel(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
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
        const images = queueData.images || queueData.video ? [queueData.video] : [];
        return {
          success: true,
          resultUrl: images[0]?.url || queueData.video?.url,
          resultUrls: images.map((i: { url: string }) => i.url),
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
}
