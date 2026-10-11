/**
 * Where to send someone once they have signed in.
 *
 * `callbackUrl` arrives on the query string, so it is untrusted: only a path
 * on this site survives. It is checked by parsing, not by prefix — browsers
 * read `/\evil.com` and `/<tab>/evil.com` as `//evil.com`, which a
 * `startsWith('/') && !startsWith('//')` test lets straight through.
 *
 * No server imports: /login (a client page) and the XMAN ID routes share it.
 */

const PROBE_ORIGIN = 'https://aixman.invalid';

export function safeCallbackPath(raw: string | null | undefined, fallback = '/generate'): string {
  if (!raw || raw.length > 2048 || !raw.startsWith('/')) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  // Back to the sign-in page itself would only show the form again.
  if (url.pathname === '/login') return fallback;
  return url.pathname + url.search + url.hash;
}

/** /login, with a way back to `path`. */
export function loginHrefFor(path: string): string {
  return !path || path === '/' || path.startsWith('/login') ? '/login' : `/login?callbackUrl=${encodeURIComponent(path)}`;
}

/** /login, with a way back to the page the visitor is on now (browser only). */
export function loginHref(): string {
  if (typeof window === 'undefined') return '/login';
  return loginHrefFor(window.location.pathname + window.location.search);
}
