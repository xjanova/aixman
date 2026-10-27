/**
 * Each machine's own record (host-record.ts), how the offer picker uses it,
 * and the backlog work plan (gpu-scaler.ts planBacklog).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/host-record.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRIOR_FAILURE_CHANCE,
  failureChance,
  isHostFailure,
  machineKeyOf,
  machineKeyOfRow,
  measuredDownloadMbps,
  summarizeHosts,
  type HostRentalRow,
} from '@/lib/gpu/host-record';
import { cardFamily } from '@/lib/gpu/gpu-specs';
import { UNRELIABLE_FAILURE_CHANCE, rankOffers, type OfferContext } from '@/lib/gpu/offer-picker';
import type { GpuOffer } from '@/lib/gpu/types';
import { planBacklog, playQueue } from '@/lib/services/gpu-scaler';

const MIN = 60_000;
const t0 = Date.UTC(2026, 9, 27, 14, 0);
const at = (minutes: number) => new Date(t0 + minutes * MIN);

/** A boot that downloaded `gb` GB in `minutes` minutes. */
const downloaded = (gb: number, minutes: number) => ({
  bootProgress: { mark: 'starting', at: t0 + minutes * MIN, firstBytes: 0, firstAt: t0, bytes: gb * 1e9, bytesAt: t0 + minutes * MIN },
});

function row(over: Partial<HostRentalRow>): HostRentalRow {
  return { machineKey: 'vast:m1', rentedAt: at(0), readyAt: at(3), terminatedAt: at(30), lastError: 'Idle for more than 2 min', metadata: {}, ...over };
}

test('a machine is its vendor id when there is one, else its listing', () => {
  assert.equal(machineKeyOf('vast', { id: '54635239', machineId: '1234' }), 'vast:m1234');
  assert.equal(machineKeyOf('simplepod', { id: '483' }), 'simplepod:483');
  assert.equal(machineKeyOf(undefined, { id: '483' }), 'simplepod:483');
  assert.equal(machineKeyOfRow('vast', { machineKey: 'vast:m9', offerId: '5' }), 'vast:m9');
  assert.equal(machineKeyOfRow('vast', { offerId: '5' }), 'vast:5', 'rows from before machine ids');
  assert.equal(machineKeyOfRow('vast', {}), null);
});

test("the host's failures count, the model's and ours do not", () => {
  const ended = (lastError: string) => ({ readyAt: null, terminatedAt: at(20), lastError });
  assert.equal(isHostFailure(ended('Inference server never became healthy within 60 min')), true);
  assert.equal(isHostFailure(ended('Never reported its HTTPS tunnel within 15 min')), true);
  assert.equal(isHostFailure(ended('Boot stalled: no progress for 9 min at 16 min')), true);
  assert.equal(isHostFailure(ended('Worker failed to provision: raise ProtocolError("Connection broken")')), true);
  assert.equal(isHostFailure(ended('Worker failed to provision: No module named sqlalchemy')), false, 'a broken model boot');
  assert.equal(isHostFailure(ended('Terminated manually by admin')), false);
  assert.equal(isHostFailure({ readyAt: at(3), terminatedAt: at(20), lastError: 'Instance stopped at provider' }), false, 'it served');
  assert.equal(isHostFailure({ readyAt: null, terminatedAt: null, lastError: null }), false, 'still booting');
});

test('the measured download needs a real sample', () => {
  assert.equal(Math.round(measuredDownloadMbps(downloaded(40, 10)) ?? 0), 533);
  assert.equal(measuredDownloadMbps(downloaded(0.5, 10)), null, 'under 1 GB');
  assert.equal(measuredDownloadMbps({ bootProgress: { ...downloaded(5, 0.5).bootProgress } }), null, 'under a minute');
  assert.equal(measuredDownloadMbps({}), null);
});

test('a record sums rentals per machine, newest failure first', () => {
  const records = summarizeHosts([
    row({ metadata: downloaded(40, 10) }),
    row({ rentedAt: at(60), readyAt: null, terminatedAt: at(80), lastError: 'Boot stalled: no progress', metadata: {} }),
    row({ rentedAt: at(100), metadata: downloaded(40, 20) }),
    row({ machineKey: 'vast:m2', readyAt: null, terminatedAt: at(5), lastError: 'Terminated manually by admin' }),
  ]);
  const m1 = records.get('vast:m1')!;
  assert.deepEqual([m1.judged, m1.failures], [3, 1]);
  assert.equal(Math.round(m1.downloadMbps!), 400, 'median of 533 and 267');
  assert.match(m1.lastFailure!, /Boot stalled/);
  assert.deepEqual(m1.lastRentedAt, at(100));
  assert.deepEqual([records.get('vast:m2')!.judged, records.get('vast:m2')!.failures], [0, 0]);
});

test('failure chance starts at the prior and follows the record', () => {
  assert.equal(failureChance(undefined), PRIOR_FAILURE_CHANCE);
  assert.ok(failureChance({ judged: 10, failures: 0 }) < 0.03);
  assert.ok(failureChance({ judged: 3, failures: 3 }) > 0.6);
});

// --- The picker ---

const offer = (id: string, over: Partial<GpuOffer> = {}): GpuOffer => ({
  id,
  provider: 'vast',
  marketRef: id,
  gpuModel: 'RTX PRO 5000',
  gpuCount: 1,
  gpuMemoryMb: 48 * 1024,
  cpuCores: 16,
  systemMemoryMb: 64 * 1024,
  diskGb: 200,
  pricePerHourUsd: 0.62,
  downloadMbps: 2000,
  ...over,
});

const ctx = (over: Partial<OfferContext> = {}): OfferContext => ({
  weightsGb: 40,
  diskGb: 150,
  renderStatsByGpu: new Map(),
  referenceRenderSeconds: 170,
  jobsExpected: 10,
  bootingOnOffer: new Map(),
  idleTailSeconds: 120,
  waitValueUsdPerHour: 2,
  ...over,
});

test('a host that downloaded slowly before is priced at that speed, not its listing', () => {
  const hostRecords = summarizeHosts([row({ machineKey: 'vast:m7', metadata: downloaded(40, 27) })]);
  const [first, second] = rankOffers([offer('a', { machineId: '7' }), offer('b', { machineId: '8' })], ctx({ hostRecords }));
  assert.equal(first.machineKey, 'vast:m8');
  assert.equal(second.downloadBasis, 'measured');
  assert.equal(second.downloadMbps, 198);
  assert.equal(first.downloadBasis, 'listed');
  assert.ok(second.bootSeconds > first.bootSeconds * 5);
});

test('a host that keeps failing loses to an untried one at the same price', () => {
  const failed = (minutes: number) =>
    row({ machineKey: 'vast:m7', rentedAt: at(minutes), readyAt: null, terminatedAt: at(minutes + 60), lastError: 'Inference server never became healthy within 60 min' });
  const hostRecords = summarizeHosts([failed(0), failed(100)]);
  const ranked = rankOffers([offer('a', { machineId: '7' }), offer('b', { machineId: '8' })], ctx({ hostRecords }));
  assert.equal(ranked[0].machineKey, 'vast:m8');
  assert.ok(ranked[1].failureChance > 0.5);
  assert.equal(ranked[0].failureChance, PRIOR_FAILURE_CHANCE);
});

test('a machine that keeps failing is a last resort, however cheap', () => {
  const failed = row({ machineKey: 'vast:m7', readyAt: null, terminatedAt: at(15), lastError: 'Never reported its HTTPS tunnel within 15 min' });
  const hostRecords = summarizeHosts([failed]);
  const ranked = rankOffers(
    [offer('cheap', { machineId: '7', pricePerHourUsd: 0.1 }), offer('dear', { machineId: '8', pricePerHourUsd: 1.5 })],
    ctx({ hostRecords })
  );
  assert.deepEqual(ranked.map((r) => r.machineKey), ['vast:m8', 'vast:m7']);
  assert.ok(ranked[1].failureChance >= UNRELIABLE_FAILURE_CHANCE);
  // One good boot after it brings it back into the running.
  const redeemed = summarizeHosts([failed, row({ machineKey: 'vast:m7', rentedAt: at(60) })]);
  const again = rankOffers(
    [offer('cheap', { machineId: '7', pricePerHourUsd: 0.1 }), offer('dear', { machineId: '8', pricePerHourUsd: 1.5 })],
    ctx({ hostRecords: redeemed })
  );
  assert.equal(again[0].machineKey, 'vast:m7');
});

test("a machine's own render speed beats its card family's", () => {
  const renderStatsByGpu = new Map([[cardFamily('RTX PRO 5000'), { median: 170, n: 20 }]]);
  const renderStatsByMachine = new Map([['vast:m7', { median: 120, n: 4 }]]);
  const ranked = rankOffers([offer('a', { machineId: '7' }), offer('b', { machineId: '8' })], ctx({ renderStatsByGpu, renderStatsByMachine }));
  assert.equal(ranked[0].machineKey, 'vast:m7');
  assert.equal(ranked[0].renderBasis, 'machine');
  assert.ok(ranked[0].renderSeconds < 140);
  assert.equal(ranked[1].renderBasis, 'history');
});

test('history filed under the listing still counts for a machine now known by id', () => {
  const hostRecords = summarizeHosts([row({ machineKey: 'vast:a', metadata: downloaded(40, 27) })]);
  const [only] = rankOffers([offer('a', { machineId: '7' })], ctx({ hostRecords }));
  assert.equal(only.downloadBasis, 'measured');
});

// --- The work plan ---

test('the queue plays out on whichever machine is free first', () => {
  assert.deepEqual(playQueue([0, 0], 4, 100), { finish: 200, wait: 100 + 100 + 200 + 200 });
  assert.deepEqual(playQueue([0, 300], 2, 100), { finish: 200, wait: 300 }, 'a booting machine is not waited for');
  assert.deepEqual(playQueue([], 1, 100), { finish: Infinity, wait: Infinity });
  assert.deepEqual(playQueue([0], 0, 100), { finish: 0, wait: 0 });
});

const base = { renderSeconds: 170, bootSeconds: 600, hourlyUsd: 0.62, idleTailSeconds: 120, waitValueUsdPerHour: 2, maxAdd: 2 };

test('a 60-shot film is worth more machines; two clips are not', () => {
  const film = planBacklog({ ...base, queued: 57, machinesFreeIn: [60] });
  assert.equal(film.best.add, 2);
  assert.ok(film.best.finishSeconds < film.options[0].finishSeconds / 2);
  assert.match(film.summary, /\+2 machine\(s\) finish in ~\d+ min instead of ~\d+ min for \+\$0\.\d\d/);

  const two = planBacklog({ ...base, queued: 2, machinesFreeIn: [60] });
  assert.equal(two.best.add, 0);
  assert.match(two.summary, /would not pay for itself/);
});

test('a model with no machine always plans one', () => {
  const plan = planBacklog({ ...base, queued: 1, machinesFreeIn: [] });
  assert.equal(plan.best.add, 1);
  assert.equal(plan.options[0].finishSeconds, Infinity);
});

test('a machine almost booted is waited for rather than renting another', () => {
  assert.equal(planBacklog({ ...base, queued: 3, machinesFreeIn: [60] }).best.add, 0);
});
