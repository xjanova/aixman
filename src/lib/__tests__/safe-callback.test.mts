/**
 * Where /login sends someone back to.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/safe-callback.test.mts)
 *
 * The value comes in on the query string, so anything that a browser would
 * resolve off this site is an open redirect — including the spellings a
 * prefix check misses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { safeCallbackPath } from '@/lib/safe-callback';

test('a path on this site comes back as given', () => {
  assert.equal(safeCallbackPath('/generate/3d'), '/generate/3d');
  assert.equal(safeCallbackPath('/gallery?type=model3d&page=2'), '/gallery?type=model3d&page=2');
  assert.equal(safeCallbackPath('/generate/3d?id=42#viewer'), '/generate/3d?id=42#viewer');
});

test('nothing, or nothing usable, falls back', () => {
  assert.equal(safeCallbackPath(null), '/generate');
  assert.equal(safeCallbackPath(undefined), '/generate');
  assert.equal(safeCallbackPath(''), '/generate');
  assert.equal(safeCallbackPath('generate'), '/generate');
  assert.equal(safeCallbackPath('/x'.repeat(1100)), '/generate');
  assert.equal(safeCallbackPath(null, '/profile'), '/profile');
});

test('another site never survives, however it is spelled', () => {
  for (const raw of [
    'https://evil.com',
    'http://evil.com/generate',
    '//evil.com',
    '//evil.com/generate',
    '/\\evil.com',
    '/\\/evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    'javascript:alert(1)',
    ' /generate',
  ]) {
    assert.equal(safeCallbackPath(raw), '/generate', JSON.stringify(raw));
  }
});

test('the sign-in page itself is not a destination', () => {
  assert.equal(safeCallbackPath('/login'), '/generate');
  assert.equal(safeCallbackPath('/login?callbackUrl=/login'), '/generate');
});

test('dot segments resolve on this site', () => {
  assert.equal(safeCallbackPath('/generate/../profile'), '/profile');
  assert.equal(safeCallbackPath('/../../etc'), '/etc');
});
