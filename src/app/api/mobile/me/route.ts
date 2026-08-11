import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { buildMobileSession } from '@/lib/services/mobile-session';

/**
 * GET /api/mobile/me
 *
 * Profile + credit balance in one call, so the app can restore a session on
 * cold start without hitting `/api/credits` and a user endpoint separately.
 * Works with either credential — bearer token or session cookie.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await buildMobileSession(userId);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(session);
}
