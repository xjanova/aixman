import { createHmac } from 'crypto';
import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Kling AI Provider (by Kuaishou)
 * Text-to-video, image-to-video, image generation.
 *
 * Auth: Kling requires a short-lived JWT (HS256) signed with the account's
 * Secret Key, with the Access Key as the `iss` claim. The account pool stores
 * the Access Key as `apiKey` and the Secret Key as `apiSecret`.
 */
export class KlingProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'kling';

  private base64url(input: Buffer | string): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  /**
   * Build the Authorization bearer token. When a Secret Key (apiSecret) is
   * available we sign a real JWT; otherwise we fall back to the raw key so a
   * pre-generated token can still be used.
   */
  private authToken(params: ProviderGenerateParams): string {
    if (!params.apiSecret) return params.apiKey;
    const header = this.base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const payload = this.base64url(
      JSON.stringify({ iss: params.apiKey, exp: now + 1800, nbf: now - 5 })
    );
    const data = `${header}.${payload}`;
    const sig = this.base64url(createHmac('sha256', params.apiSecret).update(data).digest());
    return `${data}.${sig}`;
  }

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.klingai.com';
    const token = this.authToken(params);

    try {
      const response = await this.request(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
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

      return await this.pollKlingTask(taskId, `/v1/images/generations/${taskId}`, token, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `Kling request failed: ${(error as Error).message}` };
    }
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = params.apiEndpoint || 'https://api.klingai.com';
    const token = this.authToken(params);

    try {
      const kind = params.inputImage ? 'image2video' : 'text2video';
      const endpoint = `/v1/videos/${kind}`;
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
          'Authorization': `Bearer ${token}`,
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

      // Poll the same task family the job was submitted to.
      return await this.pollKlingTask(taskId, `/v1/videos/${kind}/${taskId}`, token, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `Kling video failed: ${(error as Error).message}` };
    }
  }

  private async pollKlingTask(
    taskId: string,
    statusPath: string,
    token: string,
    baseUrl: string,
    startTime: number
  ): Promise<ProviderResponse> {
    return await this.pollForResult(async () => {
      const res = await this.request(`${baseUrl}${statusPath}`, {
        headers: { 'Authorization': `Bearer ${token}` },
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
