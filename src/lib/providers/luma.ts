import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Luma AI Provider (Dream Machine for video, image generation)
 */
export class LumaProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'luma';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.lumalabs.ai/dream-machine/v1';

    try {
      const response = await this.request(`${baseUrl}/generations/image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: params.modelId || 'photon-1',
          prompt: params.prompt,
          aspect_ratio: params.aspectRatio || '1:1',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Luma error: ${error}` };
      }

      const data = await response.json();
      return await this.pollLumaTask(data.id, params.apiKey, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `Luma request failed: ${(error as Error).message}` };
    }
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.lumalabs.ai/dream-machine/v1';

    try {
      const body: Record<string, unknown> = {
        model: params.modelId || 'ray-2',
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio || '16:9',
        duration: params.duration ? `${params.duration}s` : '5s',
      };

      if (params.inputImage) {
        body.keyframes = {
          frame0: { type: 'image', url: params.inputImage },
        };
      }

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
        return { success: false, error: `Luma video error: ${error}` };
      }

      const data = await response.json();
      return await this.pollLumaTask(data.id, params.apiKey, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `Luma video failed: ${(error as Error).message}` };
    }
  }

  private async pollLumaTask(
    taskId: string,
    apiKey: string,
    baseUrl: string,
    startTime: number
  ): Promise<ProviderResponse> {
    return await this.pollForResult(async () => {
      const res = await this.request(`${baseUrl}/generations/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      const data = await res.json();

      if (data.state === 'completed') {
        const url = data.assets?.video || data.assets?.image;
        return {
          done: true,
          result: {
            success: true,
            resultUrl: url,
            resultUrls: url ? [url] : [],
            jobId: taskId,
            processingMs: Date.now() - startTime,
          },
        };
      }
      if (data.state === 'failed') {
        return { done: true, result: { success: false, error: data.failure_reason || 'Failed', jobId: taskId } };
      }
      return { done: false };
    }, 120, 5000);
  }
}
