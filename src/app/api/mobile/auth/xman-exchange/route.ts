import { NextRequest, NextResponse } from 'next/server';
import { issueTokenPair } from '@/lib/mobile-auth';
import { buildMobileSession } from '@/lib/services/mobile-session';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/mobile/auth/xman-exchange
 *
 * The back half of "Sign in with XMAN ID".
 *
 * The app sent the customer to xmanstudio's `/auth/xdreamer/authorize` in a
 * browser and got an authorization code back over its custom URL scheme. This
 * trades that code — plus the PKCE verifier that never left the device — for
 * the same bearer pair a password login would have produced.
 *
 * The shared secret lives here and is sent server to server. It is what proves
 * to xmanstudio that this redemption came from aixman and not from whoever
 * happened to intercept the redirect.
 */

const WINDOW_MS = 15 * 60 * 1000;
/**
 * Generous compared to password login: a code is single-use and expires in five
 * minutes, so replaying one is pointless. The cap is here to stop somebody
 * grinding guesses at the code space.
 */
const ATTEMPTS = 30;

const MAX_FIELD_LENGTH = 256;

export async function POST(request: NextRequest) {
  const limit = rateLimit(`xman-exchange:${clientIp(request.headers)}`, ATTEMPTS, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่', retryAfter: limit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  const secret = process.env.XMAN_SSO_SECRET;
  if (!secret) {
    console.error('XMAN_SSO_SECRET is not set — XMAN ID sign-in is unavailable');
    return NextResponse.json(
      { error: 'ระบบเข้าสู่ระบบด้วย XMAN ID ยังไม่พร้อมใช้งาน' },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const codeVerifier = typeof body?.codeVerifier === 'string' ? body.codeVerifier.trim() : '';

  if (!code || !codeVerifier || code.length > MAX_FIELD_LENGTH || codeVerifier.length > MAX_FIELD_LENGTH) {
    return NextResponse.json({ error: 'ข้อมูลการเข้าสู่ระบบไม่ครบถ้วน' }, { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_XMAN_URL || 'https://xman4289.com';

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/v1/auth/sso/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Sso-Secret': secret,
      },
      body: JSON.stringify({ code, code_verifier: codeVerifier }),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('XMAN SSO exchange: upstream unreachable', error);
    return NextResponse.json(
      { error: 'ติดต่อ xman4289.com ไม่สำเร็จ กรุณาลองใหม่' },
      { status: 503 }
    );
  }

  const payload = (await upstream.json().catch(() => null)) as
    | { success?: boolean; user?: { id?: number }; message?: string }
    | null;

  if (!upstream.ok || !payload?.success || typeof payload.user?.id !== 'number') {
    // A rejected code is a client problem, not a server one — the customer
    // should be sent back to start the flow again, not shown "try later".
    const clientFault = upstream.status >= 400 && upstream.status < 500;
    return NextResponse.json(
      { error: 'การเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่' },
      { status: clientFault ? 400 : 503 }
    );
  }

  // `users` is shared, so the id xmanstudio just vouched for is the same row
  // this app reads. buildMobileSession re-checks is_active and creates the
  // credit row on first sight, exactly as password login does.
  const session = await buildMobileSession(payload.user.id);
  if (!session) {
    return NextResponse.json(
      { error: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อฝ่ายบริการลูกค้า' },
      { status: 403 }
    );
  }

  const tokens = await issueTokenPair(payload.user.id);

  return NextResponse.json({ ...tokens, ...session });
}
