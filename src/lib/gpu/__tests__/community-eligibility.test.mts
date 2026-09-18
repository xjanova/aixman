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

/** The card this whole system was built and measured on: 8 GB. */
const homeCard = {
  assessed: true,
  online: true,
  vramTotalMb: 8191,
  canRun: ['upscale', 'audio', 'video', 'embed'],
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

test('a node that can do music is matched to a music model when it fits', () => {
  // Three of the five models this platform dispatches are audio, and audio was
  // missing from the node assessment entirely — so no machine could ever be
  // matched to the largest category we sell.
  const bigEnough = assessCommunityNode(
    { assessed: true, online: true, vramTotalMb: 16384, canRun: ['audio'] },
    CATALOGUE
  );

  assert.equal(bigEnough.status, 'eligible');
  assert.equal(bigEnough.modelKey, 'ace-step-1.5');
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

test('a node reporting no lanes at all is treated as fast, the way it was before lanes existed', () => {
  // Every node already in the field is on an older client. Reading silence as
  // "slow" would quietly demote the entire fleet on the day this shipped.
  const verdict = assessCommunityNode(
    { assessed: true, online: true, vramTotalMb: 16384, canRun: ['audio'] },
    CATALOGUE
  );

  assert.equal(verdict.status, 'eligible');
  assert.equal(verdict.lane, 'full');
});

test('work the node is slow at is still dispatched, and says so', () => {
  // Slow is not a refusal. The machine does produce the track; it just must not
  // be put in front of somebody watching a progress bar.
  const verdict = assessCommunityNode(
    {
      assessed: true,
      online: true,
      vramTotalMb: 16384,
      canRun: ['audio'],
      lanes: { audio: 'slow' },
    },
    CATALOGUE
  );

  assert.equal(verdict.status, 'eligible');
  assert.equal(verdict.lane, 'slow');
  assert.equal(verdict.modelKey, 'ace-step-1.5');
});

test('a fast kind beats a heavier slow one', () => {
  // The old rule took the heaviest model the card could hold, full stop. Here
  // that would pin a machine to a 24 GB image model it renders slowly while it
  // does music quickly — a worse outcome for the customer and for the owner.
  const verdict = assessCommunityNode(
    {
      assessed: true,
      online: true,
      vramTotalMb: 49152,
      canRun: ['audio', 'image'],
      lanes: { audio: 'full', image: 'slow' },
    },
    CATALOGUE
  );

  assert.equal(verdict.lane, 'full');
  assert.equal(verdict.modelKey, 'ace-step-1.5');
});

test('among equally fast kinds the heaviest still wins', () => {
  const verdict = assessCommunityNode(
    {
      assessed: true,
      online: true,
      vramTotalMb: 49152,
      canRun: ['audio', 'image'],
      lanes: { audio: 'full', image: 'full' },
    },
    CATALOGUE
  );

  assert.equal(verdict.lane, 'full');
  assert.equal(verdict.modelKey, 'qwen-image');
});

test('a lane given on trust is flagged, so nobody reads it as measured', () => {
  const verdict = assessCommunityNode(
    {
      assessed: true,
      online: true,
      vramTotalMb: 16384,
      canRun: ['audio'],
      lanes: { audio: 'full' },
      provisional: ['audio'],
    },
    CATALOGUE
  );

  assert.equal(verdict.status, 'eligible');
  assert.equal(verdict.provisional, true);
  assert.match(verdict.note, /รอบแรก/);
});

test('an offline machine keeps the lane it earned, not a default', () => {
  const verdict = assessCommunityNode(
    {
      assessed: true,
      online: false,
      vramTotalMb: 24576,
      canRun: ['video'],
      lanes: { video: 'slow' },
    },
    CATALOGUE
  );

  assert.equal(verdict.status, 'offline');
  assert.equal(verdict.modelKey, 'minimax-h3');
  assert.equal(verdict.lane, 'slow');
});
