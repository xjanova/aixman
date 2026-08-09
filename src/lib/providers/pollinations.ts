import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * Pollinations Provider — free text-to-image, no API key required.
 *
 * Used as the zero-config default so the platform can generate real images
 * before any paid provider is funded. The anonymous tier is rate limited and
 * picks the model itself (as of 2026-08 it serves `sana` regardless of the
 * `model` param — flux/kontext are reserved for token holders). The param is
 * still forwarded so adding a token at /admin/pools upgrades the output
 * without a code change.
 *
 * Docs: https://enter.pollinations.ai
 */
const IMAGE_BASE = 'https://image.pollinations.ai/prompt';

/** Free tier is slow above this; larger requests mostly time out. */
const MAX_DIMENSION = 1280;
const MIN_DIMENSION = 64;

/** Keep the request line well under the 8 KB most proxies accept. */
const MAX_ENCODED_PROMPT = 4000;

/** Per-image timeout. Free-tier queue waits of 30-60s are normal. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Reject anything larger — the result is base64'd into the DB / R2. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Rendered into <img src>; SVG is excluded deliberately. */
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const MAX_OUTPUTS = 4;

/**
 * The free backend intermittently answers 5xx (observed: upstream 530 from the
 * image host). One retry turns most of those into a normal result instead of a
 * failed generation + credit refund. Never retried on 4xx or 429.
 */
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2000;

type RenderResult =
  | { ok: true; dataUri: string }
  | { ok: false; error: string; rateLimited: boolean; retryable?: boolean };

export class PollinationsProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'pollinations';

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const count = Math.min(Math.max(params.numOutputs || 1, 1), MAX_OUTPUTS);

    // Pollinations caches by prompt when no seed is given — two users asking for
    // "a blue teapot" get byte-identical images. Always send an explicit seed.
    const baseSeed = params.seed ?? Math.floor(Math.random() * 1_000_000_000);

    const urls: string[] = [];
    let lastError = 'Generation failed';

    // Sequential on purpose: the free tier rate-limits concurrent requests.
    for (let i = 0; i < count; i++) {
      const result = await this.renderWithRetry(params, (baseSeed + i) % 1_000_000_000);
      if (result.ok) {
        urls.push(result.dataUri);
      } else {
        lastError = result.error;
        // A rate limit won't clear within this request — stop asking for more.
        if (result.rateLimited) break;
      }
    }

    if (urls.length === 0) {
      return { success: false, error: lastError, processingMs: Date.now() - startTime };
    }

    return {
      success: true,
      resultUrl: urls[0],
      resultUrls: urls,
      costUsd: 0,
      processingMs: Date.now() - startTime,
    };
  }

  async generateVideo(): Promise<ProviderResponse> {
    return { success: false, error: 'Pollinations does not support video generation' };
  }

  /** Render one image, retrying only the transient server-side failures. */
  private async renderWithRetry(
    params: ProviderGenerateParams,
    seed: number
  ): Promise<RenderResult> {
    let last: RenderResult = { ok: false, error: 'Generation failed', rateLimited: false };

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      last = await this.renderOne(params, seed);
      if (last.ok || !last.retryable || attempt === RETRY_ATTEMPTS) return last;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }

    return last;
  }

  /**
   * Render a single image. Returns a data URI rather than the Pollinations URL:
   * the upstream URL regenerates on every access, so it is not a stable asset.
   * GenerationService pushes the data URI to R2 when storage is configured.
   */
  private async renderOne(params: ProviderGenerateParams, seed: number): Promise<RenderResult> {
    const url = this.buildUrl(params, seed);

    try {
      const headers: Record<string, string> = { Accept: 'image/*' };
      // Optional — a token from /admin/pools unlocks the higher tiers.
      if (params.apiKey) {
        headers.Authorization = `Bearer ${params.apiKey}`;
      }

      const response = await this.request(url, { headers, timeout: REQUEST_TIMEOUT_MS });

      if (!response.ok) {
        return {
          ok: false,
          error: `Pollinations API error ${response.status}: ${await this.errorMessage(response)}`,
          rateLimited: response.status === 429,
          retryable: response.status >= 500,
        };
      }

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        // The free endpoint answers 200 with a JSON/HTML body when it degrades.
        return { ok: false, error: `Pollinations returned an unexpected content type: ${contentType || 'unknown'}`, rateLimited: false, retryable: true };
      }

      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_IMAGE_BYTES) {
        return { ok: false, error: 'Pollinations returned an image that is too large', rateLimited: false };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        return { ok: false, error: 'Pollinations returned an empty image', rateLimited: false, retryable: true };
      }
      if (buffer.length > MAX_IMAGE_BYTES) {
        return { ok: false, error: 'Pollinations returned an image that is too large', rateLimited: false };
      }

      return { ok: true, dataUri: `data:${contentType};base64,${buffer.toString('base64')}` };
    } catch (error) {
      return { ok: false, error: `Pollinations request failed: ${(error as Error).message}`, rateLimited: false, retryable: true };
    }
  }

  private buildUrl(params: ProviderGenerateParams, seed: number): string {
    const query = new URLSearchParams({
      width: String(this.clampDimension(params.width)),
      height: String(this.clampDimension(params.height)),
      seed: String(seed),
      model: params.modelId,
      nologo: 'true',
      // Anonymous generations are published to the public pollinations.ai feed
      // by default. Our users' prompts and images must not end up there.
      nofeed: 'true',
      referrer: 'aixman',
    });

    if (params.negativePrompt) {
      query.set('negative_prompt', params.negativePrompt);
    }

    return `${IMAGE_BASE}/${this.encodePrompt(params.prompt)}?${query.toString()}`;
  }

  /**
   * Percent-encode the prompt and truncate it to fit the URL budget. Thai text
   * expands ~9x when encoded, so the cap has to be measured after encoding.
   */
  private encodePrompt(prompt: string): string {
    let text = prompt.trim();
    let encoded = encodeURIComponent(text);

    while (encoded.length > MAX_ENCODED_PROMPT && text.length > 1) {
      text = text.slice(0, Math.ceil(text.length * 0.9));
      encoded = encodeURIComponent(text);
    }

    return encoded;
  }

  private clampDimension(value?: number): number {
    if (!value || !Number.isFinite(value)) return 1024;
    return Math.min(Math.max(Math.round(value), MIN_DIMENSION), MAX_DIMENSION);
  }

  /** Pollinations reports failures as `{ error, message }`; fall back to raw text. */
  private async errorMessage(response: Response): Promise<string> {
    try {
      const body = await response.text();
      try {
        const parsed = JSON.parse(body);
        return parsed.message || parsed.error || body.slice(0, 200);
      } catch {
        return body.slice(0, 200);
      }
    } catch {
      return response.statusText;
    }
  }
}
