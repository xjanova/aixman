/**
 * The one HTTP helper the GPU vendor adapters share: a timeout on every call,
 * and failures that keep the status code, so each adapter can say which ones
 * mean "refused — nothing was rented" and which mean "unknown".
 *
 * Error messages carry the vendor's own `detail`/`msg` text but never the
 * request or response body: Vast's user endpoint returns the API key, and
 * RunPod's pod records return every environment variable — the worker's
 * bearer token among them.
 */

export class VendorHttpError extends Error {
  constructor(
    readonly vendor: string,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'VendorHttpError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Pull a human sentence out of whatever error body the vendor returned. */
function detailOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    for (const key of ['detail', 'msg', 'message', 'error', 'title', 'code']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300);
    }
    return '';
  } catch {
    return body.replace(/\s+/g, ' ').trim().slice(0, 300);
  }
}

/**
 * `text: true` returns the body as it came, for endpoints that answer an id as
 * plain text on some calls and as a JSON string on others (Verda).
 */
export async function vendorFetch<T>(
  vendor: string,
  url: string,
  init: RequestInit & { timeoutMs?: number; text?: boolean } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const method = init.method || 'GET';
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      const detail = detailOf(text);
      throw new VendorHttpError(vendor, res.status, `${vendor} ${method} ${path} → ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    if (init.text) return text as T;
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new VendorHttpError(vendor, res.status, `${vendor} ${method} ${path} returned something that is not JSON`);
    }
  } catch (error) {
    if (error instanceof VendorHttpError) throw error;
    const aborted = (error as Error).name === 'AbortError';
    // status 0: no answer at all — the order may or may not have landed.
    throw new VendorHttpError(vendor, 0, `${vendor} ${method} ${path} ${aborted ? 'timed out' : `failed: ${(error as Error).message}`}`);
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
