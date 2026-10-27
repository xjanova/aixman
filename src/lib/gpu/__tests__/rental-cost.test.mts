/**
 * What a rental really costs (download fees included) and how long a booted
 * machine is kept warm (rental-cost.ts).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/rental-cost.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_KEEP_WARM_MINUTES,
  ingressTerms,
  ingressUsd,
  keepWarmMinutes,
  readIngress,
  rentalCostUsd,
} from '@/lib/gpu/rental-cost';

const MIN = 60_000;
const t0 = new Date(2026, 9, 27, 14, 0);
const at = (minutes: number) => new Date(t0.getTime() + minutes * MIN);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

const ltx = { ingress: { usdPerGb: 0.004, gb: 40 } };

test('download terms are kept only when the host charges for them', () => {
  assert.deepEqual(ingressTerms(0.004, 40), { usdPerGb: 0.004, gb: 40 });
  assert.equal(ingressTerms(0, 40), null);
  assert.equal(ingressTerms(undefined, 40), null);
  assert.equal(ingressTerms(0.004, 0), null);
  assert.deepEqual(readIngress(ltx), { usdPerGb: 0.004, gb: 40 });
  assert.equal(readIngress({ ingress: { usdPerGb: 'x', gb: 40 } }), null);
  assert.equal(readIngress(null), null);
});

test('a booted machine paid for every GB; a failed boot for what reached its disk', () => {
  near(ingressUsd({ readyAt: at(8), metadata: ltx }), 0.16);
  const halfway = { ...ltx, bootProgress: { mark: 'downloading', at: 0, bytes: 10e9 } };
  near(ingressUsd({ readyAt: null, metadata: halfway }), 0.04);
  near(ingressUsd({ readyAt: null, metadata: ltx }), 0);
  near(ingressUsd({ readyAt: at(8), metadata: {} }), 0);
});

test('a rental costs its uptime plus its downloads', () => {
  const row = { rentedAt: t0, terminatedAt: at(60), readyAt: at(8), pricePerHourUsd: 0.7, metadata: ltx };
  near(rentalCostUsd(row, at(90)), 0.7 + 0.16);
  near(rentalCostUsd(row, at(30)), 0.35 + 0.16);
  near(rentalCostUsd({ ...row, metadata: {} }, at(90)), 0.7);
});

test('a machine dear to boot waits until another boot would cost more', () => {
  // LTX: 10-min boot at $0.70/h + 40 GB at $0.002 = $0.197 → ~17 min of idle.
  const ltxWarm = keepWarmMinutes({
    idleTimeoutMinutes: 2,
    pricePerHourUsd: 0.7,
    bootSeconds: 600,
    ingress: { usdPerGb: 0.002, gb: 40 },
  });
  assert.ok(ltxWarm > 16 && ltxWarm < 17.5, String(ltxWarm));
  // Dearer downloads hit the cap, not an hour.
  assert.equal(
    keepWarmMinutes({ idleTimeoutMinutes: 2, pricePerHourUsd: 0.7, bootSeconds: 600, ingress: { usdPerGb: 0.02, gb: 40 } }),
    MAX_KEEP_WARM_MINUTES
  );
  // ACE-Step: a 2.5-min boot, nothing billed per GB → about its boot.
  near(keepWarmMinutes({ idleTimeoutMinutes: 2, pricePerHourUsd: 0.27, bootSeconds: 150, ingress: null }), 2.5);
  // Never below the admin's idle timeout; no price → the plain timeout.
  assert.equal(keepWarmMinutes({ idleTimeoutMinutes: 5, pricePerHourUsd: 0.27, bootSeconds: 60, ingress: null }), 5);
  assert.equal(keepWarmMinutes({ idleTimeoutMinutes: 2, pricePerHourUsd: 0, bootSeconds: 600, ingress: null }), 2);
});
