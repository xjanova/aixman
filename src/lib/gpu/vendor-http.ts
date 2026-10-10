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
 * How long a read waits before each retry. Vendors' gateways answer 502/503/504
 * for a few seconds at a time, and this server's outbound fetch drops the odd
 * connection ("fetch failed"): the orphan sweep and the balance check logged
 * dozens of those a day, and a balance nobody could read for one tick is a
 * balance check that failed.
 */
const READ_RETRY_DELAYS_MS = [1_500, 4_000];
/** Gateway answers that say "try again shortly", not "no". */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

type VendorInit = RequestInit & {
  timeoutMs?: number;
  text?: boolean;
  /**
   * Waits before each retry of a read. Only GET and HEAD are ever retried: a
   * POST that may have landed (a rental, a termination) must not be sent twice.
   */
  retryDelaysMs?: number[];
};

/**
 * `text: true` returns the body as it came, for endpoints that answer an id as
 * plain text on some calls and as a JSON string on others (Verda).
 *
 * A read that got no answer at all, or a gateway's 502/503/504, is tried again
 * twice. A timeout is not: the vendor is slow rather than gone, and waiting
 * three times as long would hold up the whole tick.
 */
export async function vendorFetch<T>(vendor: string, url: string, init: VendorInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const delays = method === 'GET' || method === 'HEAD' ? (init.retryDelaysMs ?? READ_RETRY_DELAYS_MS) : [];
  for (let attempt = 0; ; attempt++) {
    try {
      return await vendorFetchOnce<T>(vendor, url, init);
    } catch (error) {
      const retryable =
        error instanceof VendorHttpError &&
        (RETRYABLE_STATUSES.has(error.status) || (error.status === 0 && !error.message.endsWith('timed out')));
      if (!retryable || attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
    }
  }
}

async function vendorFetchOnce<T>(vendor: string, url: string, init: VendorInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const method = init.method || 'GET';
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  try {
    const { timeoutMs: _timeout, text: _text, retryDelaysMs: _delays, ...request } = init;
    void _timeout;
    void _text;
    void _delays;
    const res = await fetch(url, {
      ...request,
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
