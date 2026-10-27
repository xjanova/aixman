/**
 * When a booting rented machine is ended early (boot-watch.ts): a quick boot
 * that went silent, a download too slow to finish — and never a slow boot
 * that keeps moving.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/boot-watch.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOT_QUIET_MS,
  BOOT_STALL_FLOOR_MS,
  bootStallDeadlineMs,
  isHostFault,
  judgeBoot,
  noteBootProgress,
  readBootProgress,
} from '@/lib/gpu/boot-watch';

const MIN = 60_000;
const HOUR = 60 * MIN;
const GB = 1e9;

test('the deadline follows the estimate, with a floor and the flat limit as a ceiling', () => {
  assert.equal(bootStallDeadlineMs(172, HOUR), BOOT_STALL_FLOOR_MS); // ACE-Step: 3 × 172 s is under the floor
  assert.equal(bootStallDeadlineMs(709, HOUR), 3 * 709 * 1000); // LTX on a fresh host: ~35 min
  assert.equal(bootStallDeadlineMs(3000, HOUR), HOUR);
  assert.equal(bootStallDeadlineMs(-5, HOUR), BOOT_STALL_FLOOR_MS);
});

test('the ACE-Step machine of 2026-10-27 is ended at ~16 min, not 60', () => {
  const rented = 0;
  // Tunnel up at 2 min, then the proxy kept saying "starting" with nothing new.
  const progress = noteBootProgress(null, { mark: 'downloading', bytes: 0 }, rented + 2 * MIN);
  const stuck = noteBootProgress(progress, { mark: 'downloading', bytes: 0 }, rented + 10 * MIN);
  assert.equal(stuck, progress, 'no growth, same stage: unchanged record');
  const at = (minutes: number) => judgeBoot({ ageMs: minutes * MIN, now: rented + minutes * MIN, expectedBootSeconds: 172, warmupTimeoutMs: HOUR, progress: stuck });
  assert.equal(at(14).stalled, false, 'before the deadline nothing is judged');
  const verdict = at(16);
  assert.equal(verdict.stalled, true);
  assert.match((verdict as { reason: string }).reason, /no progress for 14 min/);
});

test('a machine that never said anything is quiet since it was rented', () => {
  assert.equal(judgeBoot({ ageMs: 16 * MIN, now: 16 * MIN, expectedBootSeconds: 120, warmupTimeoutMs: HOUR, progress: null }).stalled, true);
});

test('a slow boot that keeps moving is left alone', () => {
  let p = noteBootProgress(null, { mark: 'downloading', bytes: 0 }, 0);
  // 40 GB at ~1.1 GB/min: done around minute 37, inside the hour.
  for (let m = 1; m <= 30; m++) p = noteBootProgress(p, { mark: 'downloading', bytes: m * 1.1 * GB }, m * MIN);
  assert.equal(judgeBoot({ ageMs: 30 * MIN, now: 30 * MIN, expectedBootSeconds: 300, warmupTimeoutMs: HOUR, progress: p, totalBytes: 40 * GB }).stalled, false);
});

test('a new stage counts as progress; the loading stage gets longer to be quiet', () => {
  const done = noteBootProgress(noteBootProgress(null, { mark: 'downloading', bytes: 5 * GB }, 0), { mark: 'starting' }, 10 * MIN);
  assert.equal(done.at, 10 * MIN);
  assert.equal(done.bytes, 5 * GB, 'bytes kept when the stage reports none');
  const judge = (now: number) => judgeBoot({ ageMs: now, now, expectedBootSeconds: 200, warmupTimeoutMs: HOUR, progress: done }).stalled;
  assert.equal(judge(10 * MIN + BOOT_QUIET_MS + MIN), false, 'vLLM may load for minutes in silence');
  assert.equal(judge(26 * MIN), true);
});

test('a download that cannot finish inside the limit is replaced now', () => {
  let p = noteBootProgress(null, { mark: 'downloading', bytes: 0 }, 2 * MIN);
  // 0.2 GB/min: 40 GB would take over three hours.
  for (let m = 3; m <= 7; m++) p = noteBootProgress(p, { mark: 'downloading', bytes: (m - 2) * 0.2 * GB }, m * MIN);
  const early = judgeBoot({ ageMs: 5 * MIN, now: 5 * MIN, expectedBootSeconds: 700, warmupTimeoutMs: HOUR, progress: p, totalBytes: 40 * GB });
  assert.equal(early.stalled, false, 'needs a few minutes of rate first');
  const verdict = judgeBoot({ ageMs: 7 * MIN, now: 7 * MIN, expectedBootSeconds: 700, warmupTimeoutMs: HOUR, progress: p, totalBytes: 40 * GB });
  assert.equal(verdict.stalled, true);
  assert.match((verdict as { reason: string }).reason, /Download too slow: 1\.0 of 40\.0 GB/);
  // Unknown size: no projection.
  assert.equal(judgeBoot({ ageMs: 7 * MIN, now: 7 * MIN, expectedBootSeconds: 700, warmupTimeoutMs: HOUR, progress: p }).stalled, false);
});

test('the record survives a round trip through metadata and rejects junk', () => {
  const p = noteBootProgress(null, { mark: 'downloading', bytes: 3 }, 1000);
  assert.deepEqual(readBootProgress(JSON.parse(JSON.stringify({ bootProgress: p }))), p);
  assert.equal(readBootProgress({ bootProgress: { mark: 1, at: 'x' } }), null);
  assert.equal(readBootProgress(null), null);
});

test('a host that dropped a download is the host\'s fault, a broken requirement is not', () => {
  assert.equal(isHostFault('Worker failed to provision: ComfyUI requirements failed to install: ... raise ProtocolError("Connection broken: IncompleteRead")'), true);
  assert.equal(isHostFault('CUDA is unavailable on this host'), true);
  assert.equal(isHostFault('ERROR: Could not find a version that satisfies the requirement foo==9'), false);
  assert.equal(isHostFault(null), false);
});
