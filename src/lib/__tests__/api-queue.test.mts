/**
 * The queue and percentage an API order shows in the studio.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/api-queue.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apiQueueBlock, baselineSeconds, typicalSeconds } from '@/lib/api-queue';

const NOW = 1_800_000_000_000;

test('while the vendor has it queued: a queue with the wait left, no percentage', () => {
  const block = apiQueueBlock({ stage: 'queuing', generatingSince: null }, 30, 300, NOW);
  assert.deepEqual(block, { stage: 'queued', etaSeconds: 270, progress: null });
  assert.equal(apiQueueBlock({ stage: 'waiting', generatingSince: null }, 1, 300, NOW).stage, 'queued');
});

test('the percentage starts at 0 when the vendor starts, not when the order was placed', () => {
  // Two minutes in the queue, then the vendor starts: the bar is at 0, not 40%.
  const start = apiQueueBlock({ stage: 'generating', generatingSince: NOW }, 120, 300, NOW);
  assert.equal(start.stage, 'rendering');
  assert.equal(start.progress, 0);
  // A minute of rendering with a minute left: half way.
  const half = apiQueueBlock({ stage: 'generating', generatingSince: NOW - 60_000 }, 240, 300, NOW);
  assert.equal(half.etaSeconds, 60);
  assert.equal(half.progress, 0.5);
});

test('an order running late never claims it is done, and still promises some wait', () => {
  const late = apiQueueBlock({ stage: 'generating', generatingSince: NOW - 600_000 }, 700, 300, NOW);
  assert.equal(late.etaSeconds, 30); // 10% of the usual 300 s
  assert.ok(late.progress! <= 0.95);
  const quick = apiQueueBlock({ stage: 'generating', generatingSince: NOW - 60_000 }, 60, 20, NOW);
  assert.equal(quick.etaSeconds, 10);
});

test('nothing read in this process (a restart): shown rendering, timed from the start', () => {
  const block = apiQueueBlock(null, 100, 200, NOW);
  assert.equal(block.stage, 'rendering');
  assert.equal(block.etaSeconds, 100);
  assert.equal(block.progress, 0.5);
});

test('typical time: the median, from orders of the same length when there are enough', () => {
  const history = [
    { ms: 300_000, duration: 5 },
    { ms: 320_000, duration: 5 },
    { ms: 340_000, duration: 5 },
    { ms: 900_000, duration: 15 },
  ];
  assert.equal(typicalSeconds(history, 5), 320);
  // Too few at 15 s: all of them.
  assert.equal(typicalSeconds(history, 15), 330);
  assert.equal(typicalSeconds([], 5), null);
  assert.equal(typicalSeconds([{ ms: 0, duration: null }], null), null);
});

test('a model with no history yet gets a guess by what it makes', () => {
  assert.equal(baselineSeconds('video'), 240);
  assert.equal(baselineSeconds('audio'), 90);
  assert.equal(baselineSeconds('image'), 40);
});
