/**
 * Who gets work, and who is told why not.
 *
 * Run: node --experimental-strip-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/community-eligibility.test.mts
 *
 * The cases here are the ones a node owner will ask about. Every "no" has to be
 * a sentence they can act on, not a silence.
 *
 * The catalogue is passed in rather than imported: the real one pulls every
 * workflow template in as JSON, and a fixture also keeps these assertions
 * stable on the day a community tier is added to it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessCommunityNode, type DispatchableModel } from '@/lib/gpu/community-eligibility';

/** Mirrors the shape and the real numbers of today's catalogue. */
const CATALOGUE: DispatchableModel[] = [
  { key: 'ace-step-1.5', name: 'ACE-Step', kind: 'audio', hardware: { minVramMb: 16384 } },
  { key: 'qwen-image', name: 'Qwen Image', kind: 'image', hardware: { minVramMb: 24576 } },
  { key: 'minimax-h3', name: 'MiniMax H3', kind: 'video', hardware: { minVramMb: 24576 } },
];

/** The card this whole system was built and measured on: 8 GB, three job kinds. */
const homeCard = {
  assessed: true,
  online: true,
  vramTotalMb: 8191,
  canRun: ['upscale', 'video', 'embed'],
};

test('an unassessed machine is never dispatched to, whatever it claims', () => {
  const verdict = assessCommunityNode(
    { assessed: false, online: true, vramTotalMb: 81920, canRun: ['image', 'video'] },
    CATALOGUE
  );

  assert.equal(verdict.status, 'unassessed');
  assert.equal(verdict.modelKey, null);
});

test('a measured machine that can do nothing is told so, not left guessing', () => {
  const verdict = assessCommunityNode(
    { assessed: true, online: true, vramTotalMb: 4096, canRun: [] },
    CATALOGUE
  );

  assert.equal(verdict.status, 'no-matching-model');
  assert.ok(verdict.note.length > 0);
});

test('an 8 GB home card gets no model, and is told the actual numbers', () => {
  // Not a disappointment to hide. Every model in the catalogue today is
  // datacentre-class, and the owner deserves the real figure — it is also the
  // clearest possible argument for adding a community tier.
  const verdict = assessCommunityNode(homeCard, CATALOGUE);

  assert.equal(verdict.status, 'no-matching-model');
  assert.equal(verdict.modelKey, null);
  assert.match(verdict.note, /8\.0 GB/);
  assert.match(verdict.note, /16 GB/);
});

test('VRAM is a hard floor — one megabyte short is still short', () => {
  const justUnder = assessCommunityNode(
    { assessed: true, online: true, vramTotalMb: 16383, canRun: ['audio'] },
    CATALOGUE
  );
  const exactly = assessCommunityNode(
    { assessed: true, online: true, vramTotalMb: 16384, canRun: ['audio'] },
    CATALOGUE
  );

  // A card that cannot hold the weights fails every job of that kind. Letting
  // it through would only move the failure to after the customer has paid.
  assert.equal(justUnder.status, 'no-matching-model');
  assert.equal(exactly.status, 'eligible');
  assert.equal(exactly.modelKey, 'ace-step-1.5');
});

test('a capable card that is offline keeps its model and is not written off', () => {
  const verdict = assessCommunityNode(
    { assessed: true, online: false, vramTotalMb: 24576, canRun: ['video'] },
    CATALOGUE
  );

  // The distinction matters: "offline" is a machine to wait for, while
  // "no-matching-model" is one to stop expecting anything from.
  assert.equal(verdict.status, 'offline');
  assert.equal(verdict.modelKey, 'minimax-h3');
});

test('a card that could serve several models is given the heaviest it can hold', () => {
  const verdict = assessCommunityNode(
    { assessed: true, online: true, vramTotalMb: 49152, canRun: ['audio', 'image', 'video'] },
    CATALOGUE
  );

  // Pinning a capable card to a light model wastes the only capacity on the
  // network able to do the hard job.
  assert.equal(verdict.status, 'eligible');
  assert.equal(verdict.modelKey === 'qwen-image' || verdict.modelKey === 'minimax-h3', true);
});

test('work the node can do but the platform does not dispatch is not mistaken for eligibility', () => {
  // Upscale and text embedding are real, measured capabilities with no
  // catalogue entry. Calling them eligible would queue jobs that do not exist.
  const verdict = assessCommunityNode(
    { assessed: true, online: true, vramTotalMb: 81920, canRun: ['upscale', 'embed'] },
    CATALOGUE
  );

  assert.equal(verdict.status, 'no-matching-model');
});

test('an empty catalogue answers instead of throwing', () => {
  // Reachable during setup, before any model has been registered. `reduce` with
  // no seed would throw here, and every node's first sync would 500.
  const verdict = assessCommunityNode(homeCard, []);

  assert.equal(verdict.status, 'no-matching-model');
  assert.ok(verdict.note.length > 0);
});
