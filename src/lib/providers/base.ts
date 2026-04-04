import type { AIProviderAdapter, ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Base class for all AI provider adapters.
 * Each provider implements generateImage/generateVideo with their specific API.
 */
export abstract class BaseProvider implements AIProviderAdapter {
  abstract readonly slug: ProviderSlug;

  abstract generateImage(params: ProviderGenerateParams): Promise<ProviderResponse>;
  abstract generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse>;

  editImage?(params: ProviderGenerateParams): Promise<ProviderResponse>;
  checkJobStatus?(jobId: string, apiKey: string, apiEndpoint?: string): Promise<ProviderResponse>;

  /**
   * Helper: Make HTTP request with error handling
   */
  protected async request(
    url: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = options.timeout || 120000; // 2 min default
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Helper: Poll for async job completion
   */
  protected async pollForResult(
    checkFn: () => Promise<{ done: boolean; result?: ProviderResponse }>,
    maxAttempts: number = 60,
    intervalMs: number = 3000
  ): Promise<ProviderResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      const { done, result } = await checkFn();
      if (done && result) return result;
      if (done) return { success: false, error: 'Job completed but no result' };
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { success: false, error: 'Polling timeout - job took too long' };
  }
}
