import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * OpenAI Provider (GPT Image 1, DALL-E 3, Sora 2)
 */
export class OpenAIProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'openai';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.openai.com/v1';

    try {
      const body: Record<string, unknown> = {
        model: params.modelId || 'gpt-image-1',
        prompt: params.prompt,
        n: params.numOutputs || 1,
        size: this.mapSize(params.width, params.height),
      };

      if (params.extraParams?.quality) body.quality = params.extraParams.quality;

      const response = await this.request(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        return { success: false, error: `OpenAI error: ${error.error?.message || response.statusText}` };
      }

      const data = await response.json();
      const urls = data.data?.map((item: { url?: string; b64_json?: string }) => item.url || `data:image/png;base64,${item.b64_json}`) || [];

      return {
        success: true,
        resultUrl: urls[0],
        resultUrls: urls,
        processingMs: Date.now() - startTime,
      };
    } catch (error) {
      return { success: false, error: `OpenAI request failed: ${(error as Error).message}` };
    }
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.openai.com/v1';

    try {
      const body: Record<string, unknown> = {
        model: params.modelId || 'sora-2',
        prompt: params.prompt,
        duration: params.duration || 5,
      };

      if (params.width && params.height) body.size = `${params.width}x${params.height}`;
      if (params.inputImage) body.image = params.inputImage;

      const response = await this.request(`${baseUrl}/video/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        return { success: false, error: `OpenAI Sora error: ${error.error?.message || response.statusText}` };
      }

      const data = await response.json();

      // Check if async (returns task ID) or sync
      if (data.id && !data.data) {
        return await this.pollForResult(async () => {
          const statusRes = await this.request(`${baseUrl}/video/generations/${data.id}`, {
            headers: { 'Authorization': `Bearer ${params.apiKey}` },
          });
          const statusData = await statusRes.json();
          if (statusData.status === 'completed') {
            return {
              done: true,
              result: {
                success: true,
                resultUrl: statusData.data?.[0]?.url,
                jobId: data.id,
                processingMs: Date.now() - startTime,
              },
            };
          }
          if (statusData.status === 'failed') {
            return { done: true, result: { success: false, error: 'Video generation failed' } };
          }
          return { done: false };
        });
      }

      return {
        success: true,
        resultUrl: data.data?.[0]?.url,
        processingMs: Date.now() - startTime,
      };
    } catch (error) {
      return { success: false, error: `OpenAI video failed: ${(error as Error).message}` };
    }
  }

  private mapSize(width?: number, height?: number): string {
    if (!width || !height) return '1024x1024';
    // Map to supported sizes
    const ratio = width / height;
    if (ratio > 1.3) return '1792x1024';
    if (ratio < 0.7) return '1024x1792';
    return '1024x1024';
  }
}
