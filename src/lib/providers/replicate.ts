import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Replicate Provider (FLUX, WAN, and 1000+ other models)
 * Pattern: Submit prediction -> Poll for result
 */
export class ReplicateProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'replicate';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    return this.runPrediction(params);
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    return this.runPrediction(params);
  }

  private async runPrediction(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.replicate.com/v1';

    try {
      const input: Record<string, unknown> = {
        prompt: params.prompt,
      };

      if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
      if (params.width) input.width = params.width;
      if (params.height) input.height = params.height;
      if (params.steps) input.num_inference_steps = params.steps;
      if (params.cfgScale) input.guidance_scale = params.cfgScale;
      if (params.seed) input.seed = params.seed;
      if (params.numOutputs) input.num_outputs = params.numOutputs;
      if (params.inputImage) input.image = params.inputImage;
      if (params.duration) input.duration = params.duration;
      if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
      if (params.extraParams) Object.assign(input, params.extraParams);

      // Replicate uses model version IDs like "owner/model:version"
      const body: Record<string, unknown> = { input };

      // If modelId contains '/', use the models endpoint
      let url: string;
      if (params.modelId.includes('/')) {
        url = `${baseUrl}/models/${params.modelId}/predictions`;
      } else {
        body.version = params.modelId;
        url = `${baseUrl}/predictions`;
      }

      const response = await this.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        return { success: false, error: `Replicate error: ${error.detail || JSON.stringify(error)}` };
      }

      const prediction = await response.json();

      // Poll for completion
      return await this.pollForResult(async () => {
        const pollRes = await this.request(prediction.urls.get, {
          headers: { 'Authorization': `Bearer ${params.apiKey}` },
        });
        const data = await pollRes.json();

        if (data.status === 'succeeded') {
          const output = Array.isArray(data.output) ? data.output : [data.output];
          return {
            done: true,
            result: {
              success: true,
              resultUrl: output[0],
              resultUrls: output.filter(Boolean),
              jobId: prediction.id,
              processingMs: Date.now() - startTime,
            },
          };
        }

        if (data.status === 'failed' || data.status === 'canceled') {
          return {
            done: true,
            result: { success: false, error: data.error || 'Prediction failed', jobId: prediction.id },
          };
        }

        return { done: false };
      }, 120, 3000);
    } catch (error) {
      return { success: false, error: `Replicate request failed: ${(error as Error).message}` };
    }
  }
}
