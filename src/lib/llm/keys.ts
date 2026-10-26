import { createHash, randomBytes } from 'crypto';

/**
 * Customer API keys for /api/v1.
 *
 * `axm-` + 40 base62 characters (~238 bits). Only the SHA-256 is stored: a
 * key this long cannot be guessed, so a slow hash adds nothing, and lookup
 * stays one indexed equality. The key is shown once, when it is made.
 */
export const API_KEY_PREFIX = 'axm-';
const KEY_BODY_LENGTH = 40;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  let body = '';
  // Rejection sampling: 248 is the largest multiple of 62 under 256, so every
  // character is equally likely.
  while (body.length < KEY_BODY_LENGTH) {
    for (const b of randomBytes(64)) {
      if (b < 248 && body.length < KEY_BODY_LENGTH) body += BASE62[b % 62];
    }
  }
  const key = API_KEY_PREFIX + body;
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), hash: hashApiKey(key) };
}

/** The key from `Authorization: Bearer …` (or `x-api-key`), if it looks like one of ours. */
export function readApiKey(headers: Headers): string | null {
  const auth = headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1];
  const key = bearer ?? headers.get('x-api-key')?.trim() ?? '';
  return key.startsWith(API_KEY_PREFIX) && key.length === API_KEY_PREFIX.length + KEY_BODY_LENGTH ? key : null;
}
