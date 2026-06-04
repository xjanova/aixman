import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Stability AI Provider (Stable Diffusion 3.5, Image Ultra, Image Core)
 * Image generation only (video was deprecated)
 */
export class StabilityProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'stability';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.stability.ai';

    try {
      const formData = new FormData();
      formData.append('prompt', params.prompt);
      if (params.negativePrompt) formData.append('negative_prompt', params.negativePrompt);
      if (params.seed) formData.append('seed', params.seed.toString());
      if (params.aspectRatio) formData.append('aspect_ratio', params.aspectRatio);
      formData.append('output_format', 'png');

      // Map model ID to endpoint
      const endpoint = this.getEndpoint(params.modelId);

      const response = await this.request(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${params.apiKey}`,
          'Accept': 'image/*',
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Stability error ${response.status}: ${error}` };
      }

      // Response is the image binary
      const blob = await response.blob();
      const buffer = Buffer.from(await blob.arrayBuffer());
      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

      return {
        success: true,
        resultUrl: base64,
        processingMs: Date.now() - startTime,
      };
    } catch (error) {
      return { success: false, error: `Stability request failed: ${(error as Error).message}` };
    }
  }

  async generateVideo(): Promise<ProviderResponse> {
    return { success: false, error: 'Stability AI video generation has been deprecated' };
  }

  /**
   * Image edit / upscale.
   * - Upscale models (modelId/extraParams contain "upscale") use the fast upscale
   *   endpoint, which returns the enlarged image synchronously.
   * - Otherwise runs image-to-image on SD3.5 using the source image + prompt.
   */
  async editImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.stability.ai';

    try {
      if (!params.inputImage) {
        return { success: false, error: 'No input image provided for edit' };
      }

      const isUpscale = /upscale/i.test(params.modelId) || params.extraParams?.mode === 'upscale';
      const imageBlob = await this.toBlob(params.inputImage);

      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');
      formData.append('output_format', 'png');

      let endpoint: string;
      if (isUpscale) {
        // Fast 4x upscaler — synchronous, returns the image binary
        endpoint = '/v2beta/stable-image/upscale/fast';
      } else {
        // Image-to-image edit on SD3.5
        endpoint = '/v2beta/stable-image/generate/sd3';
        formData.append('prompt', params.prompt || '');
        formData.append('mode', 'image-to-image');
        formData.append('strength', String(params.extraParams?.strength ?? 0.5));
        if (params.negativePrompt) formData.append('negative_prompt', params.negativePrompt);
      }

      const response = await this.request(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${params.apiKey}`,
          'Accept': 'image/*',
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Stability edit error ${response.status}: ${error}` };
      }

      const blob = await response.blob();
      const buffer = Buffer.from(await blob.arrayBuffer());
      return {
        success: true,
        resultUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        processingMs: Date.now() - startTime,
      };
    } catch (error) {
      return { success: false, error: `Stability edit failed: ${(error as Error).message}` };
    }
  }

  private getEndpoint(modelId: string): string {
    const endpoints: Record<string, string> = {
      'stable-image-ultra': '/v2beta/stable-image/generate/ultra',
      'sd3.5-large': '/v2beta/stable-image/generate/sd3',
      'sd3.5-large-turbo': '/v2beta/stable-image/generate/sd3',
      'sd3.5-medium': '/v2beta/stable-image/generate/sd3',
      'stable-image-core': '/v2beta/stable-image/generate/core',
    };
    return endpoints[modelId] || '/v2beta/stable-image/generate/core';
  }
}
