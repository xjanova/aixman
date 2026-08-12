import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import { headers } from 'next/headers';

/**
 * Bearer-token auth for native mobile clients (X-DREAMER Android app).
 *
 * The web app authenticates with a NextAuth session cookie. A native app has no
 * cookie jar we control and no way to complete NextAuth's CSRF dance, so it
 * presents `Authorization: Bearer <jwt>` instead. Both paths converge on the
 * same numeric user id inside `getCurrentUserId()` — every existing endpoint
 * therefore works for mobile without being duplicated.
 *
 * Tokens are stateless. That is deliberate: the only revocation the platform
 * actually needs today is "this account was disabled", and `getCurrentUserId()`
 * already re-reads `users.is_active` from the DB on every single request, so a
 * deactivated account loses access immediately regardless of token lifetime.
 * Per-device revocation ("sign out my other phone") would need a token table —
 * see the note at the bottom of this file.
 */

/** Short, so a leaked access token stops working within the hour. */
const ACCESS_TTL_SECONDS = 60 * 60;
/** Long, so the app does not ask for a password every day. Rotated on refresh. */
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

const ISSUER = 'aixman';
const AUDIENCE = 'aixman-mobile';

export type MobileTokenKind = 'access' | 'refresh';

export interface MobileTokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until `accessToken` expires — the client refreshes before this. */
  expiresIn: number;
  refreshExpiresIn: number;
  tokenType: 'Bearer';
}

let cachedKey: Uint8Array | null = null;

/**
 * Signing key for mobile tokens.
 *
 * Namespaced with a suffix so mobile tokens and NextAuth session tokens are
 * signed with different key material even though both descend from the same
 * env secret — one can never be replayed as the other.
 */
function signingKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const raw = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!raw) {
    throw new Error('AUTH_SECRET (or NEXTAUTH_SECRET) must be set to issue mobile tokens');
  }

  cachedKey = new TextEncoder().encode(`${raw}:mobile-v1`);
  return cachedKey;
}

async function sign(userId: number, kind: MobileTokenKind, ttlSeconds: number): Promise<string> {
  return new SignJWT({ knd: kind })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(signingKey());
}

/** Mint a fresh access + refresh pair. Used by login and by refresh (rotation). */
export async function issueTokenPair(userId: number): Promise<MobileTokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    sign(userId, 'access', ACCESS_TTL_SECONDS),
    sign(userId, 'refresh', REFRESH_TTL_SECONDS),
  ]);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    refreshExpiresIn: REFRESH_TTL_SECONDS,
    tokenType: 'Bearer',
  };
}

/**
 * Verify a mobile token and return the user id it claims.
 *
 * `kind` is checked against the token's own `knd` claim: a 30-day refresh token
 * must never be accepted as an access token, which is the whole point of having
 * two lifetimes. `algorithms` is pinned so a token cannot arrive claiming
 * `alg: none`.
 *
 * Returns null for anything wrong — expired, tampered, wrong kind, wrong
 * issuer/audience. The caller decides the status code; this never throws.
 */
export async function verifyMobileToken(
  token: string,
  kind: MobileTokenKind
): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    if (payload.knd !== kind) return null;

    const userId = parseInt(String(payload.sub ?? ''), 10);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

/**
 * Read `Authorization: Bearer <access token>` off the current request.
 *
 * Returns null when the header is absent or malformed, so a cookie-authenticated
 * web request falls straight through to the NextAuth path.
 */
export async function getBearerUserId(): Promise<number | null> {
  const headerList = await headers();
  const raw = headerList.get('authorization');
  if (!raw) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  if (!match) return null;

  return verifyMobileToken(match[1], 'access');
}

/*
 * Not implemented on purpose — revisit when the product needs it:
 *
 * - Per-device revocation / "sign out everywhere". Needs an `ai_mobile_tokens`
 *   table keyed by the refresh token's `jti`, checked on refresh and cleared on
 *   logout. Stateless tokens cannot do this.
 * - Refresh-token reuse detection. With a token table, a second use of an
 *   already-rotated `jti` is a strong signal of theft and should invalidate the
 *   whole family.
 */
