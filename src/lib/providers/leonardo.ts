import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Leonardo.ai Provider
 * Image generation with multiple models
 */
export class LeonardoProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'leonardo';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://cloud.leonardo.ai/api/rest/v1';

    try {
      const body: Record<string, unknown> = {
        prompt: params.prompt,
        negative_prompt: params.negativePrompt,
        modelId: params.modelId,
        width: params.width || 1024,
        height: params.height || 1024,
        num_images: params.numOutputs || 1,
      };

      if (params.steps) body.num_inference_steps = params.steps;
      if (params.cfgScale) body.guidance_scale = params.cfgScale;
      if (params.seed) body.seed = params.seed;

      const response = await this.request(`${baseUrl}/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Leonardo error: ${error}` };
      }

      const data = await response.json();
      const generationId = data.sdGenerationJob?.generationId;
      if (!generationId) return { success: false, error: 'No generation ID returned' };

      // Poll for result
      return await this.pollForResult(async () => {
        const res = await this.request(`${baseUrl}/generations/${generationId}`, {
          headers: { 'Authorization': `Bearer ${params.apiKey}` },
        });
        const result = await res.json();
        const images = result.generations_by_pk?.generated_images || [];

        if (result.generations_by_pk?.status === 'COMPLETE' && images.length > 0) {
          const urls = images.map((img: { url: string }) => img.url);
          return {
            done: true,
            result: {
              success: true,
              resultUrl: urls[0],
              resultUrls: urls,
              jobId: generationId,
              processingMs: Date.now() - startTime,
            },
          };
        }
        if (result.generations_by_pk?.status === 'FAILED') {
          return { done: true, result: { success: false, error: 'Generation failed', jobId: generationId } };
        }
        return { done: false };
      }, 60, 3000);
    } catch (error) {
      return { success: false, error: `Leonardo request failed: ${(error as Error).message}` };
    }
  }

  async generateVideo(): Promise<ProviderResponse> {
    return { success: false, error: 'Leonardo.ai video generation is not yet supported via API' };
  }
}
