import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Runway ML Provider (Gen-4.5, Gen-4, Veo 3)
 * Async task-based API
 */
export class RunwayProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'runway';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.dev.runwayml.com/v1';

    try {
      const response = await this.request(`${baseUrl}/text_to_image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify({
          model: params.modelId,
          promptText: params.prompt,
          width: params.width || 1024,
          height: params.height || 1024,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Runway error: ${error}` };
      }

      const data = await response.json();
      return await this.pollRunwayTask(data.id, params.apiKey, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `Runway request failed: ${(error as Error).message}` };
    }
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.dev.runwayml.com/v1';

    try {
      const body: Record<string, unknown> = {
        model: params.modelId || 'gen4_turbo',
        promptText: params.prompt,
        duration: params.duration || 5,
      };

      if (params.inputImage) body.promptImage = params.inputImage;
      if (params.width) body.width = params.width;
      if (params.height) body.height = params.height;

      const endpoint = params.inputImage ? '/image_to_video' : '/text_to_video';

      const response = await this.request(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Runway video error: ${error}` };
      }

      const data = await response.json();
      return await this.pollRunwayTask(data.id, params.apiKey, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `Runway video failed: ${(error as Error).message}` };
    }
  }

  private async pollRunwayTask(
    taskId: string,
    apiKey: string,
    baseUrl: string,
    startTime: number
  ): Promise<ProviderResponse> {
    return await this.pollForResult(async () => {
      const res = await this.request(`${baseUrl}/tasks/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-Runway-Version': '2024-11-06',
        },
      });
      const data = await res.json();

      if (data.status === 'SUCCEEDED') {
        const output = data.output || [];
        return {
          done: true,
          result: {
            success: true,
            resultUrl: output[0],
            resultUrls: output,
            jobId: taskId,
            processingMs: Date.now() - startTime,
          },
        };
      }
      if (data.status === 'FAILED') {
        return { done: true, result: { success: false, error: data.failure || 'Task failed', jobId: taskId } };
      }
      return { done: false };
    }, 120, 5000);
  }
}
