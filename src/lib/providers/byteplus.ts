import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * BytePlus Provider (Seedream for images, Seedance for video)
 * Uses OpenAI-compatible API protocol via ModelArk platform
 * Base URL: https://ark.ap-southeast.bytepluses.com/api/v3
 */
export class BytePlusProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'byteplus';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://ark.ap-southeast.bytepluses.com/api/v3';

    try {
      const response = await this.request(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: params.modelId,
          prompt: params.prompt,
          size: `${params.width || 1024}x${params.height || 1024}`,
          n: params.numOutputs || 1,
          ...(params.extraParams || {}),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `BytePlus API error ${response.status}: ${error}` };
      }

      const data = await response.json();
      const urls = data.data?.map((item: { url: string }) => item.url) || [];

      return {
        success: true,
        resultUrl: urls[0],
        resultUrls: urls,
        processingMs: Date.now() - startTime,
      };
    } catch (error) {
      return { success: false, error: `BytePlus request failed: ${(error as Error).message}` };
    }
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://ark.ap-southeast.bytepluses.com/api/v3';

    try {
      // Submit video generation task
      const submitBody: Record<string, unknown> = {
        model: params.modelId,
        content: [{ type: 'text', text: params.prompt }],
      };

      if (params.inputImage) {
        submitBody.content = [
          { type: 'image_url', image_url: { url: params.inputImage } },
          { type: 'text', text: params.prompt },
        ];
      }

      if (params.duration) submitBody.duration = params.duration;
      if (params.width && params.height) submitBody.size = `${params.width}x${params.height}`;

      const response = await this.request(`${baseUrl}/content/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(submitBody),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `BytePlus video submit error ${response.status}: ${error}` };
      }

      const data = await response.json();
      const taskId = data.id;

      if (!taskId) {
        // Synchronous response
        const videoUrl = data.data?.[0]?.url || data.output?.video_url;
        return {
          success: !!videoUrl,
          resultUrl: videoUrl,
          jobId: data.id,
          processingMs: Date.now() - startTime,
        };
      }

      // Poll for async result
      return await this.pollForResult(async () => {
        const statusRes = await this.request(`${baseUrl}/content/generations/${taskId}`, {
          headers: { 'Authorization': `Bearer ${params.apiKey}` },
        });
        const statusData = await statusRes.json();

        if (statusData.status === 'succeeded' || statusData.status === 'completed') {
          const videoUrl = statusData.data?.[0]?.url || statusData.output?.video_url;
          return {
            done: true,
            result: {
              success: true,
              resultUrl: videoUrl,
              jobId: taskId,
              processingMs: Date.now() - startTime,
            },
          };
        }

        if (statusData.status === 'failed') {
          return {
            done: true,
            result: { success: false, error: statusData.error?.message || 'Video generation failed', jobId: taskId },
          };
        }

        return { done: false };
      }, 120, 5000); // Poll every 5s, max 10 minutes
    } catch (error) {
      return { success: false, error: `BytePlus video failed: ${(error as Error).message}` };
    }
  }
}
