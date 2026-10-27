/**
 * A model with no machine, at the worker cap, behind another model's long
 * backlog (gpu-scaler.ts pickHandover): one machine of a model that has
 * several gives its slot up after its current job.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/scaler-handover.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STARVE_HANDOVER_MS, pickHandover, readHandover } from '@/lib/services/gpu-scaler';

const HOUR = 3_600_000;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 27, 14, minute));
const film = [
  { id: 77, modelKey: 'ltx-2.5', busySince: at(40) },
  { id: 78, modelKey: 'ltx-2.5', busySince: at(38) },
  { id: 79, modelKey: 'ltx-2.5', busySince: at(41) },
];

test('a song starved behind a 60-shot film gets the film machine nearest the end of its shot', () => {
  assert.equal(pickHandover('ace-step-1.5', STARVE_HANDOVER_MS, film), 78);
});

test('nothing is handed over before the wait', () => {
  assert.equal(pickHandover('ace-step-1.5', STARVE_HANDOVER_MS - 1, film), null);
});

test('a machine between jobs goes before a busy one', () => {
  assert.equal(pickHandover('ace-step-1.5', STARVE_HANDOVER_MS, [...film, { id: 80, modelKey: 'ltx-2.5', busySince: null }]), 80);
});

test("a model's only machine is never taken, nor one of the wanted model", () => {
  const mixed = [
    { id: 1, modelKey: 'qwen-image', busySince: at(10) },
    { id: 2, modelKey: 'minimax-h3', busySince: at(11) },
    { id: 3, modelKey: 'ltx-2.5', busySince: at(12) },
  ];
  assert.equal(pickHandover('ace-step-1.5', HOUR, mixed), null);
  assert.equal(pickHandover('ltx-2.5', HOUR, film), null);
});

test('the promise is read from metadata, junk is none', () => {
  assert.equal(readHandover({ handOverTo: { modelKey: 'ace-step-1.5', at: 'x' } }), 'ace-step-1.5');
  assert.equal(readHandover({ handOverTo: { modelKey: '' } }), null);
  assert.equal(readHandover({ handOverTo: 'ace' }), null);
  assert.equal(readHandover(null), null);
});
