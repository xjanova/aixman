import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Kling AI Provider (by Kuaishou)
 * Text-to-video, image-to-video, image generation
 * Uses JWT-based authentication
 */
export class KlingProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'kling';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.klingai.com';

    try {
      const response = await this.request(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model_name: params.modelId || 'kling-v1',
          prompt: params.prompt,
          negative_prompt: params.negativePrompt,
          n: params.numOutputs || 1,
          width: params.width || 1024,
          height: params.height || 1024,
          ...(params.extraParams || {}),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Kling error: ${error}` };
      }

      const data = await response.json();
      const taskId = data.data?.task_id;
      if (!taskId) return { success: false, error: 'No task ID returned' };

      return await this.pollKlingTask(taskId, 'image', params.apiKey, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `Kling request failed: ${(error as Error).message}` };
    }
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.klingai.com';

    try {
      const endpoint = params.inputImage ? '/v1/videos/image2video' : '/v1/videos/text2video';
      const body: Record<string, unknown> = {
        model_name: params.modelId || 'kling-v1',
        prompt: params.prompt,
        negative_prompt: params.negativePrompt,
        duration: params.duration ? `${params.duration}` : '5',
        ...(params.extraParams || {}),
      };

      if (params.inputImage) body.image = params.inputImage;
      if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;

      const response = await this.request(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Kling video error: ${error}` };
      }

      const data = await response.json();
      const taskId = data.data?.task_id;
      if (!taskId) return { success: false, error: 'No task ID returned' };

      return await this.pollKlingTask(taskId, 'video', params.apiKey, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `Kling video failed: ${(error as Error).message}` };
    }
  }

  private async pollKlingTask(
    taskId: string,
    type: 'image' | 'video',
    apiKey: string,
    baseUrl: string,
    startTime: number
  ): Promise<ProviderResponse> {
    const endpoint = type === 'image'
      ? `/v1/images/generations/${taskId}`
      : `/v1/videos/text2video/${taskId}`;

    return await this.pollForResult(async () => {
      const res = await this.request(`${baseUrl}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      const data = await res.json();
      const status = data.data?.task_status;

      if (status === 'succeed') {
        const works = data.data?.task_result?.images || data.data?.task_result?.videos || [];
        const urls = works.map((w: { url: string }) => w.url);
        return {
          done: true,
          result: {
            success: true,
            resultUrl: urls[0],
            resultUrls: urls,
            jobId: taskId,
            processingMs: Date.now() - startTime,
          },
        };
      }
      if (status === 'failed') {
        return { done: true, result: { success: false, error: data.data?.task_status_msg || 'Failed', jobId: taskId } };
      }
      return { done: false };
    }, 120, 5000);
  }
}
