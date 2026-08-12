import { NextRequest, NextResponse } from 'next/server';
import { issueTokenPair, verifyMobileToken } from '@/lib/mobile-auth';
import { buildMobileSession } from '@/lib/services/mobile-session';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/mobile/auth/refresh
 *
 * Trades a valid refresh token for a fresh pair. The refresh token is rotated
 * on every call, so a token captured off the wire stops being useful as soon as
 * the real client refreshes once.
 *
 * A 401 here means "the app must show the login screen again" — the client
 * treats it as a hard sign-out and clears its stored tokens.
 */

const WINDOW_MS = 15 * 60 * 1000;
/**
 * Generous: a correctly behaving app refreshes about once an hour, but a user
 * switching networks or resuming from background can bunch several together.
 * The cap exists to stop a stolen token being used to mint pairs in a loop.
 */
const REFRESH_ATTEMPTS = 60;

const MAX_TOKEN_LENGTH = 4096;

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  const limit = rateLimit(`mobile-refresh:ip:${ip}`, REFRESH_ATTEMPTS, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'คำขอบ่อยเกินไป กรุณารอสักครู่', retryAfter: limit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  const body = await request.json().catch(() => null);
  const refreshToken =
    body && typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';

  if (!refreshToken || refreshToken.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 });
  }

  const userId = await verifyMobileToken(refreshToken, 'refresh');
  if (userId === null) {
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 });
  }

  // Re-read the account. A token minted 29 days ago must not outlive the
  // account being disabled in xmanstudio.
  let session;
  try {
    session = await buildMobileSession(userId);
  } catch (error) {
    // Must be a 503, never a 401: the client treats 401 here as a hard sign-out
    // and wipes its tokens. A database blip is not a reason to make somebody
    // type their password again.
    console.error('Mobile refresh: session build failed', error);
    return NextResponse.json(
      { error: 'ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง' },
      { status: 503 }
    );
  }
  if (!session) {
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 });
  }

  const tokens = await issueTokenPair(userId);

  return NextResponse.json({ ...tokens, ...session });
}
