import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { buildMobileSession } from '@/lib/services/mobile-session';
import {
  SSO_COOKIE,
  aixmanBaseUrl,
  issueTicket,
  safeCallbackPath,
  safeEqual,
  xmanBaseUrl,
} from '@/lib/xman-sso';

/**
 * GET /api/auth/xman/callback?code=…&state=…
 *
 * Back half of "Sign in with XMAN ID" on the web. Trades the authorization code
 * for a user id server-to-server, then hands the browser a single-use ticket
 * that NextAuth turns into a session on the next page load.
 *
 * The ticket exists because a credentials session can only be minted through
 * NextAuth's own sign-in path, which runs from the browser. It is single-use and
 * expires in a minute, so its brief appearance in a URL is not worth much.
 */

const WINDOW_MS = 15 * 60 * 1000;
const ATTEMPTS = 30;

/**
 * Everything that can go wrong ends on /login with a code the page explains.
 *
 * Built from `aixmanBaseUrl()` rather than `request.url`: behind nginx the
 * request URL can carry the internal origin, which would send the customer to
 * localhost. NEXTAUTH_URL is already the canonical public origin.
 */
function fail(reason: string) {
  const url = new URL('/login', aixmanBaseUrl());
  url.searchParams.set('xman_error', reason);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: SSO_COOKIE, path: '/api/auth/xman' });
  return response;
}

export async function GET(request: NextRequest) {
  const limit = rateLimit(`xman-sso-callback:${clientIp(request.headers)}`, ATTEMPTS, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่', retryAfter: limit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  const secret = process.env.XMAN_SSO_SECRET;
  if (!secret) {
    console.error('XMAN_SSO_SECRET is not set — XMAN ID sign-in is unavailable');
    return fail('unavailable');
  }

  const code = request.nextUrl.searchParams.get('code') ?? '';
  const state = request.nextUrl.searchParams.get('state') ?? '';
  if (!code || !state || code.length > 256 || state.length > 256) {
    return fail('invalid');
  }

  const raw = request.cookies.get(SSO_COOKIE)?.value;
  if (!raw) return fail('expired');

  let stored: { verifier?: unknown; state?: unknown; callbackPath?: unknown };
  try {
    stored = JSON.parse(raw);
  } catch {
    return fail('expired');
  }

  const verifier = typeof stored.verifier === 'string' ? stored.verifier : '';
  const expectedState = typeof stored.state === 'string' ? stored.state : '';
  const callbackPath = safeCallbackPath(
    typeof stored.callbackPath === 'string' ? stored.callbackPath : null
  );

  // The state check is what ties this response to a flow *this* browser started.
  // Without it, an attacker could feed a victim their own code and land the
  // victim in the attacker's account.
  if (!verifier || !expectedState || !safeEqual(expectedState, state)) {
    return fail('invalid');
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${xmanBaseUrl()}/api/v1/auth/sso/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Sso-Secret': secret,
      },
      body: JSON.stringify({ code, code_verifier: verifier }),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('XMAN SSO callback: upstream unreachable', error);
    return fail('upstream');
  }

  const payload = (await upstream.json().catch(() => null)) as
    | { success?: boolean; user?: { id?: number } }
    | null;

  if (!upstream.ok || !payload?.success || typeof payload.user?.id !== 'number') {
    return fail(upstream.status >= 500 ? 'upstream' : 'invalid');
  }

  // Re-checks is_active and creates the credit row on first sight, exactly as
  // password login does — so an XMAN ID user's first visit still gets the
  // welcome credits.
  const session = await buildMobileSession(payload.user.id);
  if (!session) return fail('inactive');

  const ticket = issueTicket(payload.user.id);

  const url = new URL('/login', aixmanBaseUrl());
  url.searchParams.set('xman_ticket', ticket);
  url.searchParams.set('callbackUrl', callbackPath);

  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: SSO_COOKIE, path: '/api/auth/xman' });
  return response;
}
