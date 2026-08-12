/**
 * In-process fixed-window rate limiter.
 *
 * Deliberately not Redis-backed: `ecosystem.config.cjs` runs `instances: 1`, so
 * a single process sees every request and a Map is both correct and free. If
 * this app is ever moved to PM2 cluster mode or a second server, this becomes
 * per-process and the limits multiply by the instance count — move it to Redis
 * at that point.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Ceiling on tracked keys so an attacker rotating source IPs cannot grow the
 * map without bound. ~10k entries is well under a megabyte.
 */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets. 0 when `ok`. */
  retryAfter: number;
  /** Attempts still allowed in this window. */
  remaining: number;
}

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Count one attempt against `key`.
 *
 * Fixed window rather than sliding: an attacker can burst 2× the limit across a
 * window boundary, which is an acceptable trade for a limiter that costs one
 * Map lookup and holds no state between deploys.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size >= MAX_TRACKED_KEYS) {
    evictExpired(now);
    // Still full — every bucket is live. Drop the oldest tenth (Map iterates in
    // insertion order) so new callers are never refused a bucket outright.
    if (buckets.size >= MAX_TRACKED_KEYS) {
      let toDrop = Math.ceil(MAX_TRACKED_KEYS / 10);
      for (const oldest of buckets.keys()) {
        buckets.delete(oldest);
        if (--toDrop <= 0) break;
      }
    }
  }

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0, remaining: limit - 1 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  return { ok: true, retryAfter: 0, remaining: limit - bucket.count };
}

/** Forget a key — called after a successful login so one typo costs nothing. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort client IP.
 *
 * Reads the LAST entry of `x-forwarded-for`, not the first. nginx in front of
 * this app uses `$proxy_add_x_forwarded_for`, which appends the socket peer it
 * actually observed — so the last hop is the one value a client cannot forge by
 * sending its own `X-Forwarded-For` header.
 */
export function clientIp(headerList: Headers): string {
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return headerList.get('x-real-ip')?.trim() || 'unknown';
}
