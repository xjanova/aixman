import { NextRequest, NextResponse } from 'next/server';
import { getLatestAppRelease } from '@/lib/services/app-release';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * GET /api/mobile/app-version
 *
 * What the newest Android build is. Deliberately **unauthenticated**: a phone
 * running a version old enough to be blocked must still be able to fetch the
 * update that unblocks it, and by definition it may not be able to sign in.
 *
 * Answers `{ update: null }` when GitHub cannot be reached, so a release-server
 * outage reads as "you are up to date" rather than as a broken app.
 */
export async function GET(request: NextRequest) {
  const limit = rateLimit(`app-version:${clientIp(request.headers)}`, 30, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { update: null },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  const release = await getLatestAppRelease();

  return NextResponse.json(
    { update: release },
    // The service layer caches for 10 minutes; let a CDN hold it for one.
    { headers: { 'Cache-Control': 'public, max-age=60' } }
  );
}
