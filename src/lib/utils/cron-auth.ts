import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

/**
 * Shared bearer-secret check for cron-triggered endpoints.
 *
 * Comparison is constant-time so the secret can't be recovered by timing the
 * response, and an unset CRON_SECRET denies rather than allows — a missing
 * config must never open the endpoint up.
 */
export function hasValidCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;

  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.nextUrl.searchParams.get('secret') ||
    '';

  // Length is compared first because timingSafeEqual throws on a mismatch. The
  // length of a secret is not itself sensitive.
  if (provided.length !== secret.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}
