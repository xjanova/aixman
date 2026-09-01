/**
 * "Sign in with XMAN ID" — the browser half.
 *
 * The mobile app already had this flow (`/api/mobile/auth/xman-exchange`); the
 * website did not, so a customer who was already signed in at xman4289.com
 * still had to retype the same password here. This module is the shared plumbing
 * for the web version: PKCE, the state nonce, and the hand-off ticket.
 *
 * Shape of the flow:
 *
 *   /api/auth/xman/start     → mint verifier+state into an httpOnly cookie,
 *                              redirect to xmanstudio's authorize screen
 *   xmanstudio               → authenticates (or reuses its own session) and
 *                              redirects back with ?code&state
 *   /api/auth/xman/callback  → checks state, trades code+verifier for a user id
 *                              server-to-server, mints a ticket
 *   /login?xman_ticket=…     → the browser hands the ticket to NextAuth, which
 *                              consumes it and issues the session
 *
 * PKCE matters even though both ends are our own servers: the code comes back
 * through the customer's browser, so anything sitting on that redirect sees it.
 * Without the verifier — which never leaves this server — an intercepted code
 * is worthless.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/** Cookie carrying the verifier + state between `start` and `callback`. */
export const SSO_COOKIE = 'xman_sso';

/** The round trip through xmanstudio's login screen has to fit in this. */
export const SSO_COOKIE_MAX_AGE = 10 * 60;

/**
 * How long a minted ticket stays redeemable. The browser redeems it on the very
 * next page load, so this only has to cover a slow render — not a coffee break.
 */
const TICKET_TTL_MS = 60_000;

/**
 * Ceiling on stored tickets. Each one costs a completed round trip through
 * xmanstudio, so this is already hard to grow; the cap is here so a bug upstream
 * cannot turn into unbounded memory.
 */
const MAX_TICKETS = 5_000;

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes → 43 base64url chars, the length xmanstudio validates. */
export function createVerifier(): string {
  return base64url(randomBytes(32));
}

export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function createState(): string {
  return base64url(randomBytes(16));
}

/**
 * Constant-time compare for the state nonce.
 *
 * Overkill by most readings — but `===` on a secret is the kind of thing that
 * gets copied into a place where it does matter, so it is not worth having in
 * the file at all.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

interface Ticket {
  userId: number;
  expiresAt: number;
}

/**
 * In-process, single-use ticket store.
 *
 * Same reasoning as `rate-limit.ts`: `ecosystem.config.cjs` runs `instances: 1`,
 * so one process sees both the callback that mints a ticket and the sign-in that
 * redeems it. Under PM2 cluster mode the redeem could land on a different worker
 * and SSO would fail intermittently — move this to Redis before scaling out.
 */
const tickets = new Map<string, Ticket>();

function evictExpired(now: number): void {
  for (const [key, ticket] of tickets) {
    if (ticket.expiresAt <= now) tickets.delete(key);
  }
}

export function issueTicket(userId: number): string {
  const now = Date.now();
  evictExpired(now);

  if (tickets.size >= MAX_TICKETS) {
    // Drop the oldest insertion rather than refusing to sign anyone in.
    const oldest = tickets.keys().next();
    if (!oldest.done) tickets.delete(oldest.value);
  }

  const ticket = base64url(randomBytes(32));
  tickets.set(ticket, { userId, expiresAt: now + TICKET_TTL_MS });
  return ticket;
}

/**
 * Redeem a ticket. Deletes on read whether or not it had expired, so a leaked
 * ticket cannot be retried.
 */
export function consumeTicket(ticket: string): number | null {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}

export function xmanBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_XMAN_URL || 'https://xman4289.com').replace(/\/+$/, '');
}

export function aixmanBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'https://ai.xman4289.com').replace(/\/+$/, '');
}

/** The exact string that must also be listed in xmanstudio's allowlist. */
export function ssoRedirectUri(): string {
  return `${aixmanBaseUrl()}/api/auth/xman/callback`;
}

/**
 * Only same-site, path-absolute destinations survive. `//evil.com` and
 * `https://evil.com` are both rejected — this value comes in on the query
 * string, so treating it as trusted would hand us an open redirect.
 */
export function safeCallbackPath(raw: string | null, fallback = '/generate'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}
