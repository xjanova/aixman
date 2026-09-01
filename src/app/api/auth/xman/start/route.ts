import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import {
  SSO_COOKIE,
  SSO_COOKIE_MAX_AGE,
  aixmanBaseUrl,
  createState,
  createVerifier,
  challengeFor,
  safeCallbackPath,
  ssoRedirectUri,
  xmanBaseUrl,
} from '@/lib/xman-sso';

/**
 * GET /api/auth/xman/start
 *
 * Front half of "Sign in with XMAN ID" on the web. Sends the customer to
 * xmanstudio's authorize screen and keeps the PKCE verifier here, in an
 * httpOnly cookie the browser cannot read.
 */

const WINDOW_MS = 15 * 60 * 1000;
const ATTEMPTS = 20;

export async function GET(request: NextRequest) {
  const limit = rateLimit(`xman-sso-start:${clientIp(request.headers)}`, ATTEMPTS, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่', retryAfter: limit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  // Fail closed and loudly: a half-configured deploy should not silently fall
  // back to something that looks like it worked.
  if (!process.env.XMAN_SSO_SECRET) {
    console.error('XMAN_SSO_SECRET is not set — XMAN ID sign-in is unavailable');
    // Canonical public origin, not `request.url`: behind nginx the latter can
    // carry the internal one and bounce the customer to localhost.
    return NextResponse.redirect(new URL('/login?xman_error=unavailable', aixmanBaseUrl()));
  }

  const verifier = createVerifier();
  const state = createState();
  const callbackPath = safeCallbackPath(request.nextUrl.searchParams.get('callbackUrl'));

  const target = new URL(`${xmanBaseUrl()}/auth/xdreamer/authorize`);
  target.searchParams.set('redirect_uri', ssoRedirectUri());
  target.searchParams.set('state', state);
  target.searchParams.set('code_challenge', challengeFor(verifier));

  const response = NextResponse.redirect(target);

  response.cookies.set(SSO_COOKIE, JSON.stringify({ verifier, state, callbackPath }), {
    httpOnly: true,
    // `lax`, not `strict`: the customer arrives back here via a top-level
    // redirect from xman4289.com, and `strict` would withhold the cookie on
    // exactly that navigation, breaking every sign-in.
    sameSite: 'lax',
    secure: true,
    path: '/api/auth/xman',
    maxAge: SSO_COOKIE_MAX_AGE,
  });

  return response;
}
