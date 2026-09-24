/**
 * What a push from XMAN Studio may and may not do to a node's row (contract C1).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/community-push.test.mts)
 *
 * XMAN Studio pushes every node on every change and again every few minutes.
 * Each case is a way the old upsert, which wrote `warming` over whatever was
 * there, threw a working node out of the pool or undid an operator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { endpointProblem, metaFromPush, planNodePush, type NodePayload, type PushRow } from '@/lib/gpu/community-push';
import type { Eligibility } from '@/lib/gpu/community-eligibility';

const NOW = new Date('2026-09-25T12:00:00Z');
const PAIRED = new Date('2026-09-01T08:00:00Z');
const TOKEN_HASH = 'a'.repeat(64);

const node: NodePayload = {
  workerId: 'gxm-abc',
  endpoint: 'https://relay.xman4289.com:8443/w/gxm-abc',
  token: 'tunnel-token',
  online: true,
  assessed: true,
  vramTotalMb: 8192,
  canRun: ['image'],
  lanes: { image: 'slow' },
};

const eligible: Eligibility = { status: 'eligible', note: 'พร้อมรับงาน SDXL', modelKey: 'sdxl-community', lane: 'slow', provisional: false };
const offline: Eligibility = { ...eligible, status: 'offline', note: 'ออฟไลน์' };
const unassessed: Eligibility = { status: 'unassessed', note: 'ยังไม่ประเมิน', modelKey: null, lane: 'full', provisional: false };

const row = (over: Partial<PushRow> = {}): PushRow => ({
  status: 'warming',
  terminatedAt: null,
  modelKey: 'sdxl-community',
  metadata: { eligibility: 'eligible' },
  ...over,
});

test('the same state pushed again leaves a serving node serving', () => {
  // The old upsert wrote `warming` over `ready` on every sync, so a node was
  // pulled out of rotation once a minute for nothing.
  const ready = planNodePush(row({ status: 'ready' }), node, eligible, TOKEN_HASH, NOW);
  assert.equal(ready.change.status, undefined);
  assert.equal(ready.outcome, null);
});

test('a busy node keeps its status and its model while its job runs', () => {
  // Rewriting `busy` to `warming` mid-job had the job thrown away as
  // "terminated mid-render"; switching its model would strand the job.
  const moved: Eligibility = { ...eligible, modelKey: 'another-model' };
  for (const verdict of [eligible, moved, offline, unassessed]) {
    const plan = planNodePush(row({ status: 'busy' }), node, verdict, TOKEN_HASH, NOW);
    assert.equal(plan.change.status, undefined, verdict.status);
    assert.equal(plan.change.modelKey, undefined, verdict.status);
  }
});

test('a ready node that is no longer eligible, offline or on another model leaves rotation', () => {
  for (const verdict of [offline, unassessed, { ...eligible, modelKey: 'another-model' }]) {
    const plan = planNodePush(row({ status: 'ready' }), node, verdict, TOKEN_HASH, NOW);
    assert.equal(plan.change.status, 'warming', verdict.status);
  }
});

test('a retired row comes back warming, with its clock restarted', () => {
  const plan = planNodePush(
    row({ status: 'terminated', terminatedAt: new Date('2026-09-20T00:00:00Z') }),
    node,
    eligible,
    TOKEN_HASH,
    NOW
  );
  assert.equal(plan.change.status, 'warming');
  assert.equal(plan.change.terminatedAt, null);
  // rentedAt from the first pairing is what got every revival more than an
  // hour after pairing killed by the warmup check before it was probed.
  assert.deepEqual(plan.change.rentedAt, NOW);
  assert.notDeepEqual(plan.change.rentedAt, PAIRED);
});

test("a row an admin retired here is never brought back by a push", () => {
  const plan = planNodePush(
    row({ status: 'terminated', terminatedAt: NOW, metadata: { adminRetired: true, eligibility: 'eligible' } }),
    node,
    eligible,
    TOKEN_HASH,
    NOW
  );
  assert.equal(plan.outcome, 'retired');
  assert.equal(plan.change.status, undefined);
  assert.equal(plan.change.terminatedAt, undefined);
  // XMAN Studio's view is still recorded, and the retirement kept.
  assert.equal(plan.change.metadata.adminRetired, true);
  assert.equal(plan.change.metadata.syncedAt, NOW.toISOString());
});

test('a suspension takes the node out at once, even mid-job, and lifting it brings it back', () => {
  const suspended = planNodePush(row({ status: 'busy' }), { ...node, suspended: true }, eligible, TOKEN_HASH, NOW);
  assert.equal(suspended.outcome, 'suspended');
  assert.equal(suspended.change.status, 'terminated');
  assert.deepEqual(suspended.change.terminatedAt, NOW);
  assert.equal(suspended.change.metadata.adminRetired, undefined);

  const lifted = planNodePush(
    row({ status: 'terminated', terminatedAt: NOW, metadata: suspended.change.metadata }),
    { ...node, suspended: false },
    eligible,
    TOKEN_HASH,
    NOW
  );
  assert.equal(lifted.outcome, null);
  assert.equal(lifted.change.status, 'warming');
});

test('the token the relay refused does not revive the row; a new token does', () => {
  const refused = row({ status: 'terminated', terminatedAt: NOW, metadata: { rejectedTokenHash: TOKEN_HASH } });

  const same = planNodePush(refused, node, eligible, TOKEN_HASH, NOW);
  assert.equal(same.outcome, 'rejected');
  assert.equal(same.change.status, undefined);

  const rotated = planNodePush(refused, node, eligible, 'b'.repeat(64), NOW);
  assert.equal(rotated.outcome, null);
  assert.equal(rotated.change.status, 'warming');
  assert.equal(rotated.change.metadata.rejectedTokenHash, undefined);
});

test('the new C1 fields are kept, and absent ones read as their defaults', () => {
  const meta = metaFromPush(
    { ...node, freeSharePct: 140.4, pro: true, accepting: false, busy: null, referrerUserId: 42, firstPairedAt: '2026-09-01T08:00:00Z' },
    eligible,
    NOW
  );
  assert.equal(meta.freeSharePct, 100);
  assert.equal(meta.pro, true);
  assert.equal(meta.accepting, false);
  assert.equal(meta.busy, null);
  assert.equal(meta.referrerUserId, 42);
  assert.equal(meta.firstPairedAt, PAIRED.toISOString());
  assert.equal(meta.lane, 'slow');

  const older = metaFromPush(node, eligible, NOW);
  assert.equal(older.freeSharePct, 0);
  assert.equal(older.pro, false);
  assert.equal(older.accepting, null);
  assert.equal(older.referrerUserId, null);
  assert.equal(older.firstPairedAt, null);
  assert.equal(older.suspended, false);

  const junk = metaFromPush({ ...node, freeSharePct: Number.NaN, referrerUserId: -1, firstPairedAt: 'yesterday' }, eligible, NOW);
  assert.equal(junk.freeSharePct, 0);
  assert.equal(junk.referrerUserId, null);
  assert.equal(junk.firstPairedAt, null);
});

test("the admin's markers survive a push that knows nothing about them", () => {
  const plan = planNodePush(
    row({ metadata: { adminRetiredAt: '2026-09-24T00:00:00Z', eligibility: 'offline', note: 'old' } }),
    node,
    eligible,
    TOKEN_HASH,
    NOW
  );
  assert.equal(plan.change.metadata.adminRetiredAt, '2026-09-24T00:00:00Z');
  assert.equal(plan.change.metadata.eligibility, 'eligible');
  assert.equal(plan.change.metadata.note, 'พร้อมรับงาน SDXL');
});

test('a token only travels over https (or to this machine in development)', () => {
  assert.equal(endpointProblem('https://relay.xman4289.com:8443/w/gxm-abc'), null);
  assert.equal(endpointProblem('http://localhost:8080/w/gxm-abc'), null);
  assert.equal(endpointProblem('http://127.0.0.1:8080/w/gxm-abc'), null);
  assert.match(endpointProblem('http://relay.xman4289.com/w/gxm-abc') ?? '', /https/);
  assert.match(endpointProblem('http://localhost.evil.com/w/x') ?? '', /https/);
  assert.match(endpointProblem('ftp://relay/w/x') ?? '', /https/);
  assert.match(endpointProblem('not a url') ?? '', /valid URL/);
});
