/**
 * The places in the queue that stand for a machine still starting: they must
 * fall steadily through the whole start-up, never sit on one number.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/queue-progress.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_STARTUP_PLACES, STARTUP_SECONDS_PER_PLACE, startupPlaces } from '@/lib/queue-progress';

test('no start-up left is no places', () => {
  assert.equal(startupPlaces(0, 1200), 0);
  assert.equal(startupPlaces(-5, 1200), 0);
  assert.equal(startupPlaces(Number.NaN, 1200), 0);
});

test('a short start-up counts one place per 30 s', () => {
  assert.equal(startupPlaces(120, 120), 4);
  assert.equal(startupPlaces(90, 120), 3);
  assert.equal(startupPlaces(31, 120), 2);
  assert.equal(startupPlaces(30, 120), 1);
});

test('a long start-up spreads its places instead of sitting at the cap', () => {
  // 20 minutes: 10 places, one every 2 minutes.
  assert.equal(startupPlaces(1200, 1200), MAX_STARTUP_PLACES);
  assert.equal(startupPlaces(1080, 1200), 9);
  assert.equal(startupPlaces(600, 1200), 5);
  assert.equal(startupPlaces(121, 1200), 2);
  assert.equal(startupPlaces(120, 1200), 1);
  // An overrun is reported as 30 s left: still one place, never zero.
  assert.equal(startupPlaces(30, 1200), 1);
});

test('the number falls the whole way, at least once per step, for any start-up length', () => {
  for (const total of [45, 120, 300, 600, 1200, 2400, 3600]) {
    const perPlace = Math.max(STARTUP_SECONDS_PER_PLACE, total / MAX_STARTUP_PLACES);
    let last = Infinity;
    let since = 0;
    for (let left = total; left >= 30; left -= 5) {
      const places = startupPlaces(left, total);
      assert.ok(places >= 1 && places <= MAX_STARTUP_PLACES, `${total}s, ${left}s left: ${places}`);
      assert.ok(places <= last, `${total}s: went up at ${left}s left`);
      since = places < last ? 0 : since + 5;
      assert.ok(since <= perPlace, `${total}s: stuck on ${places} for ${since}s`);
      last = places;
    }
  }
});

test('a stale or missing total never shows more than the cap', () => {
  assert.equal(startupPlaces(3000, 1200), MAX_STARTUP_PLACES);
  assert.equal(startupPlaces(600, Number.NaN), MAX_STARTUP_PLACES);
  assert.equal(startupPlaces(60, 0), 2);
});
