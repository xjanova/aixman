/**
 * Keeping community machines in the pool, and handing them work fairly.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/community-dispatch.test.mts)
 *
 * Every case here is a way the rental reaper used to lose a home PC for good,
 * or a way the queue used to waste a customer's attempt on one. They are the
 * rules GpuWorkerManager.reconcileCommunity and GpuQueue.assignIdleWorkers
 * carry out, asserted without a database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AVOID_LIST_LIMIT,
  NodeRefusedError,
  PROBE_BUDGET_MS,
  ProbeBudget,
  READY_REPROBE_MS,
  RELAY_BUSY_STAGE,
  RELAY_DOWN_AFTER,
  RELAY_PUSHBACK_PARK_AFTER,
  classifyCommunityProbe,
  communityHoldReason,
  isCommunitySlug,
  isNodeRefusal,
  isRelayPushback,
  laneOf,
  lastErrorSaysAway,
  parseNodeRefusal,
  planCommunityReconcile,
  planSubmitFailure,
  rankCommunityCandidates,
  readAvoidList,
  slowLaneOpen,
  stageLabel,
  transitionAfterProbe,
  withAvoided,
  type CommunityMeta,
  type CommunityRowState,
} from '@/lib/gpu/community-dispatch';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const HOUR = 3_600_000;

function row(over: Partial<CommunityRowState> = {}): CommunityRowState {
  return {
    status: 'warming',
    hasEndpoint: true,
    activeJobs: 0,
    meta: { eligibility: 'eligible' },
    lastProbedAt: null,
    now: NOW,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// reconcileCommunity: what happens to a row each tick
// ---------------------------------------------------------------------------

test('a warming node is asked every tick, however long it has been warming', () => {
  // The rental rule killed a warming row 60 minutes after rentedAt — and for a
  // community row rentedAt was the pairing date, so every revival after the
  // first hour died before it was ever probed.
  assert.deepEqual(planCommunityReconcile(row()), { kind: 'probe' });
  assert.deepEqual(planCommunityReconcile(row({ lastProbedAt: NOW - 10_000 })), { kind: 'probe' });
});

test('a ready node is re-asked every few minutes, not every tick and not never', () => {
  // Never re-probing a ready row was how a paused or gaming owner still got
  // customer jobs; probing every tick would be a relay call per node per minute.
  assert.deepEqual(planCommunityReconcile(row({ status: 'ready', lastProbedAt: NOW - 30_000 })), { kind: 'leave' });
  assert.deepEqual(planCommunityReconcile(row({ status: 'ready', lastProbedAt: NOW - READY_REPROBE_MS })), { kind: 'probe' });
  // A process that just started knows nothing about any row.
  assert.deepEqual(planCommunityReconcile(row({ status: 'ready', lastProbedAt: null })), { kind: 'probe' });
});

test('a node with a job on it is left to the queue, whatever its status says', () => {
  // A node that drops off the relay mid-render is waited for up to the job
  // timeout; it is not "terminated mid-render" on the first blip.
  for (const status of ['busy', 'warming', 'draining', 'ready']) {
    assert.deepEqual(planCommunityReconcile(row({ status, activeJobs: 1 })), { kind: 'leave' }, status);
  }
});

test('draining means "check it", never "kill it", for a machine we do not own', () => {
  assert.deepEqual(planCommunityReconcile(row({ status: 'draining' })), { kind: 'probe' });
});

test('a busy row with no job is a reservation that outlived its submit, and is re-asked', () => {
  assert.deepEqual(planCommunityReconcile(row({ status: 'busy', activeJobs: 0 })), { kind: 'probe' });
});

test('no rental reaper applies: age, idleness and budget never end a community row', () => {
  // Whatever the state and however old, the reconciler's only moves are
  // leave / hold / probe. Ending a row is a probe verdict (a refused token)
  // or an explicit retirement — never a timer.
  const statuses = ['provisioning', 'warming', 'ready', 'busy', 'draining'];
  const probedAt = [null, NOW - 1_000, NOW - 5 * HOUR, NOW - 400 * HOUR];
  for (const status of statuses) {
    for (const lastProbedAt of probedAt) {
      for (const activeJobs of [0, 1]) {
        const step = planCommunityReconcile(row({ status, lastProbedAt, activeJobs }));
        assert.ok(['leave', 'hold', 'probe'].includes(step.kind), `${status}/${lastProbedAt}/${activeJobs} → ${step.kind}`);
      }
    }
  }
});

test('a node that may not take work is held out of rotation with the reason, not probed', () => {
  const unassessed = planCommunityReconcile(
    row({ status: 'ready', meta: { eligibility: 'unassessed', note: 'เครื่องยังไม่ผ่านการประเมิน' } })
  );
  assert.deepEqual(unassessed, { kind: 'hold', lastError: 'เครื่องยังไม่ผ่านการประเมิน' });

  const noModel = planCommunityReconcile(row({ meta: { eligibility: 'no-matching-model' } }));
  assert.equal(noModel.kind, 'hold');

  const suspended = planCommunityReconcile(row({ meta: { eligibility: 'eligible', suspended: true } }));
  assert.equal(suspended.kind, 'hold');

  const retired = planCommunityReconcile(row({ meta: { eligibility: 'eligible', adminRetired: true } }));
  assert.equal(retired.kind, 'hold');

  assert.equal(planCommunityReconcile(row({ hasEndpoint: false })).kind, 'hold');

  // Matched to a rented model before catalogue pools existed: out of rotation
  // until XMAN Studio's next push re-matches it — but a job already on it finishes.
  assert.equal(planCommunityReconcile(row({ status: 'ready', modelAllowed: false })).kind, 'hold');
  assert.equal(planCommunityReconcile(row({ status: 'busy', modelAllowed: false, activeJobs: 1 })).kind, 'leave');
});

test("XMAN Studio's 'offline' does not hold a node: the probe is the fresher answer", () => {
  // Its sample of relay presence can be minutes old; the probe goes through
  // the same relay now.
  assert.equal(communityHoldReason({ eligibility: 'offline' }), null);
  assert.deepEqual(planCommunityReconcile(row({ meta: { eligibility: 'offline' } })), { kind: 'probe' });
  // A row an admin enlisted by hand carries no eligibility at all.
  assert.equal(communityHoldReason({} as CommunityMeta), null);
});

// ---------------------------------------------------------------------------
// The probe's answer
// ---------------------------------------------------------------------------

test('200 puts a node in rotation, and only a fresh entry stamps readyAt', () => {
  const verdict = classifyCommunityProbe({ status: 200, body: { ready: true } });
  assert.deepEqual(verdict, { next: 'ready' });

  const fromWarming = transitionAfterProbe('warming', verdict);
  assert.equal(fromWarming.status, 'ready');
  assert.equal(fromWarming.stampReadyAt, true);

  const stillReady = transitionAfterProbe('ready', verdict);
  assert.equal(stillReady.status, 'ready');
  assert.equal(stillReady.stampReadyAt, false);
});

test('relay offline, paused, busy: out of rotation, never terminated', () => {
  for (const stage of ['offline', 'paused', 'unassessed', 'busy', 'draining']) {
    const verdict = classifyCommunityProbe({ status: 503, body: { ready: false, stage, reason: 'owner is gaming' } });
    assert.equal(verdict.next, 'warming', stage);
    assert.ok(verdict.next === 'warming' && verdict.stage === stage);
    assert.match((verdict as { detail: string }).detail, new RegExp(`\\(${stage}\\)`));
  }
  const paused = classifyCommunityProbe({ status: 503, body: { stage: 'paused', reason: 'owner is gaming' } });
  assert.match((paused as { detail: string }).detail, /owner is gaming/);
});

test('a failure that would end a rented machine only takes a home node out of rotation', () => {
  // For a rental, 500 {failed} is a dead boot and the machine is released.
  // A home PC restarting ComfyUI answers the same, and will be back.
  assert.equal(classifyCommunityProbe({ status: 500, body: { failed: 'boom' } }).next, 'warming');
  assert.equal(classifyCommunityProbe({ status: 502, body: null }).next, 'warming');
  assert.equal(classifyCommunityProbe({ error: 'fetch failed' }).next, 'warming');
});

test('only a relay that refuses the token ends the row', () => {
  const dead = classifyCommunityProbe({ status: 401, body: { error: 'bad worker token' } });
  assert.equal(dead.next, 'terminated');
  assert.equal(dead.next === 'terminated' && dead.rejectToken, true, 'a 401 is a dead token: remembered as refused');

  // A 403 this build does not know: out, but the token is not written off.
  const unknown = classifyCommunityProbe({ status: 403, body: { error: 'disabled' } });
  assert.equal(unknown.next, 'terminated');
  assert.equal(unknown.next === 'terminated' && unknown.rejectToken, false);

  // Deny-by-default on the tunnel is our configuration, not the node's fault.
  assert.equal(classifyCommunityProbe({ status: 403, body: { error: 'path-not-allowed' } }).next, 'warming');
});

test('a node the relay has disabled for now waits in the pool for its enable, token intact', () => {
  // Contract C4 disable/enable: an XMAN Studio suspension whose push to us
  // failed, or an operator's switch. Terminating it (and writing off the
  // token) left the node dead after the enable.
  const verdict = classifyCommunityProbe({ status: 403, body: { error: 'worker-disabled' } });
  assert.equal(verdict.next, 'warming');
  assert.ok(verdict.next === 'warming' && verdict.stage === 'disabled');
  assert.match((verdict as { detail: string }).detail, /worker-disabled/);
  assert.equal(transitionAfterProbe('ready', verdict).status, 'warming');

  // The same answer to a submit or a download is a "not now": the job goes
  // back to the queue without spending an attempt.
  assert.deepEqual(parseNodeRefusal(403, '{"error":"worker-disabled"}'), { stage: 'disabled', status: 403 });
  assert.equal(parseNodeRefusal(403, '{"error":"path-not-allowed"}'), null);
  assert.equal(parseNodeRefusal(403, 'Forbidden'), null);
  assert.equal(planSubmitFailure(new NodeRefusedError({ stage: 'disabled', status: 403 }, 'the prompt'), true).requeueWithoutAttempt, true);
});

test('a node leaving rotation drops its cached schema — its owner may have changed the checkpoints', () => {
  const paused = classifyCommunityProbe({ status: 503, body: { stage: 'paused' } });
  assert.equal(transitionAfterProbe('ready', paused).forgetSchema, true);
  assert.equal(transitionAfterProbe('warming', paused).forgetSchema, false);
  assert.equal(transitionAfterProbe('warming', classifyCommunityProbe({ status: 401, body: null })).forgetSchema, true);
});

// ---------------------------------------------------------------------------
// Choosing a machine
// ---------------------------------------------------------------------------

const at = (minutesAgo: number | null) => (minutesAgo === null ? null : new Date(NOW - minutesAgo * 60_000));

test('the machine given work least recently goes first, and a new one before all', () => {
  // Warmest-first gave one owner every job and new nodes nothing.
  const ranked = rankCommunityCandidates([
    { id: 1, lane: 'full', lastJobAt: at(1) },
    { id: 2, lane: 'full', lastJobAt: at(30) },
    { id: 3, lane: 'full', lastJobAt: null },
    { id: 4, lane: 'full', lastJobAt: at(5) },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), [3, 2, 4, 1]);
});

test('full lane before slow, whatever their history', () => {
  const ranked = rankCommunityCandidates([
    { id: 1, lane: 'slow', lastJobAt: null },
    { id: 2, lane: 'full', lastJobAt: at(1) },
    { id: 3, lane: null, lastJobAt: at(2) },
    { id: 4, lane: 'slow', lastJobAt: at(90) },
  ]);
  // A row written before lanes existed has none, and counts as full.
  assert.deepEqual(ranked.map((r) => r.id), [3, 2, 1, 4]);
  assert.equal(laneOf({ lane: undefined }), 'full');
});

test('ties break on id, so the order is stable between passes', () => {
  const ranked = rankCommunityCandidates([
    { id: 9, lane: 'full', lastJobAt: at(10) },
    { id: 4, lane: 'full', lastJobAt: at(10) },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), [4, 9]);
});

test('priority (the cooperation hook) orders within a lane, never across lanes', () => {
  const ranked = rankCommunityCandidates([
    { id: 1, lane: 'full', lastJobAt: null, priority: 0 },
    { id: 2, lane: 'full', lastJobAt: at(1), priority: 5 },
    { id: 3, lane: 'slow', lastJobAt: null, priority: 99 },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), [2, 1, 3]);
});

test('ranking does not reorder the caller\'s array', () => {
  const input = [
    { id: 2, lane: 'full', lastJobAt: at(1) },
    { id: 1, lane: 'full', lastJobAt: null },
  ];
  rankCommunityCandidates(input);
  assert.deepEqual(input.map((r) => r.id), [2, 1]);
});

test('slow machines wait while a fast one is idle, unless the fast ones cannot take what is left', () => {
  assert.equal(slowLaneOpen(1, false), false);
  assert.equal(slowLaneOpen(0, false), true);
  // Every idle fast machine already failed the remaining jobs: without this,
  // those jobs would wait for a machine that will never be offered them.
  assert.equal(slowLaneOpen(2, true), true);
});

// ---------------------------------------------------------------------------
// A failed submit (contract C5)
// ---------------------------------------------------------------------------

test('a node saying "not now" is a refusal; anything without a stage is a failure', () => {
  assert.deepEqual(parseNodeRefusal(503, JSON.stringify({ ready: false, stage: 'paused', reason: 'schedule' })), {
    stage: 'paused',
    reason: 'schedule',
    status: 503,
  });
  assert.equal(parseNodeRefusal(409, JSON.stringify({ stage: 'busy' }))?.stage, 'busy');
  // The relay's own offline answer carries `detail`, not `reason`.
  assert.equal(parseNodeRefusal(503, JSON.stringify({ stage: 'offline', detail: 'node disconnected' }))?.reason, 'node disconnected');

  assert.equal(parseNodeRefusal(503, 'Service Unavailable'), null);
  assert.equal(parseNodeRefusal(503, JSON.stringify({ error: 'x' })), null);
  assert.equal(parseNodeRefusal(500, JSON.stringify({ stage: 'paused' })), null);
  assert.equal(parseNodeRefusal(400, JSON.stringify({ stage: 'paused' })), null);
});

test('a stage-503 requeues the job without spending an attempt and parks the node', () => {
  const refused = new NodeRefusedError({ stage: 'paused', status: 503 }, 'the prompt');
  assert.equal(isNodeRefusal(refused), true);
  assert.deepEqual(planSubmitFailure(refused, true), {
    requeueWithoutAttempt: true,
    workerStatus: 'warming',
    avoidWorker: false,
  });
});

test('any other submit failure on a home node costs the attempt and sends the retry elsewhere', () => {
  // The same node failing the same job twice was how one flaky PC refunded
  // customers while other nodes sat idle.
  assert.deepEqual(planSubmitFailure(new Error('ComfyUI rejected the workflow (HTTP 400)'), true), {
    requeueWithoutAttempt: false,
    workerStatus: 'warming',
    avoidWorker: true,
  });
});

test('rented machines keep the rule they always had', () => {
  const refused = new NodeRefusedError({ stage: 'paused', status: 503 }, 'the prompt');
  const unchanged = { requeueWithoutAttempt: false, workerStatus: null, avoidWorker: false };
  assert.deepEqual(planSubmitFailure(refused, false), unchanged);
  assert.deepEqual(planSubmitFailure(new Error('boom'), false), unchanged);
  const pushback = new NodeRefusedError({ stage: RELAY_BUSY_STAGE, status: 429 }, 'the prompt');
  assert.deepEqual(planSubmitFailure(pushback, false), unchanged);
});

// ---------------------------------------------------------------------------
// The relay pushing back for itself (contract C4)
// ---------------------------------------------------------------------------

test("the relay's relay-busy and rate limit are read as its own pushback, not the node's refusal", () => {
  // RelayHost.BusyAsync: 503 {error:'relay-busy'} with Retry-After, and no stage
  // on purpose — "this says nothing about the node".
  assert.deepEqual(parseNodeRefusal(503, JSON.stringify({ error: 'relay-busy' })), {
    stage: RELAY_BUSY_STAGE,
    reason: 'relay-busy',
    status: 503,
  });
  // The rate limiter's 429 {error:'rate-limited'} — and any 429, since a node
  // never answers one of its own (a proxy in front of the relay may).
  assert.equal(parseNodeRefusal(429, JSON.stringify({ error: 'rate-limited' }))?.stage, RELAY_BUSY_STAGE);
  assert.equal(parseNodeRefusal(429, 'Too Many Requests')?.stage, RELAY_BUSY_STAGE);
  assert.equal(parseNodeRefusal(429, '')?.status, 429);

  // Only 503 carries relay-busy; other statuses and other errors keep their meaning.
  assert.equal(parseNodeRefusal(500, JSON.stringify({ error: 'relay-busy' })), null);
  assert.equal(parseNodeRefusal(409, JSON.stringify({ error: 'relay-busy' })), null);
  assert.equal(parseNodeRefusal(503, JSON.stringify({ error: 'body-too-large' })), null);
  assert.equal(parseNodeRefusal(403, JSON.stringify({ error: 'relay-busy' })), null);
  // A node's own stage still wins over an error field beside it.
  assert.equal(parseNodeRefusal(503, JSON.stringify({ stage: 'paused', error: 'relay-busy' }))?.stage, 'paused');

  const pushback = new NodeRefusedError({ stage: RELAY_BUSY_STAGE, status: 503 }, 'the prompt');
  assert.equal(isNodeRefusal(pushback), true);
  assert.equal(isRelayPushback(pushback), true);
  assert.equal(isRelayPushback(new NodeRefusedError({ stage: 'paused', status: 503 }, 'the prompt')), false);
  assert.equal(isRelayPushback(new Error('relay-busy')), false);
});

test('relay pushback requeues the job without an attempt and keeps the node in rotation, off no avoid list', () => {
  // It used to count as the node failing: an attempt spent, the node parked
  // in warming and the job told never to go back to a machine that was fine.
  const pushback = new NodeRefusedError({ stage: RELAY_BUSY_STAGE, status: 503 }, 'the prompt');
  assert.deepEqual(planSubmitFailure(pushback, true), {
    requeueWithoutAttempt: true,
    workerStatus: null,
    avoidWorker: false,
  });
  const limited = new NodeRefusedError({ stage: RELAY_BUSY_STAGE, status: 429 }, 'the prompt');
  assert.deepEqual(planSubmitFailure(limited, true, 1), {
    requeueWithoutAttempt: true,
    workerStatus: null,
    avoidWorker: false,
  });
});

test('relay pushback on the same node again and again parks it, still without costing the job an attempt', () => {
  // A stuck share of the relay (the node's agent stopped reading), or a
  // modified node answering in the relay's words to stay in rotation while
  // refusing every job.
  const pushback = new NodeRefusedError({ stage: RELAY_BUSY_STAGE, status: 503 }, 'the prompt');
  assert.equal(planSubmitFailure(pushback, true, RELAY_PUSHBACK_PARK_AFTER - 2).workerStatus, null);
  assert.deepEqual(planSubmitFailure(pushback, true, RELAY_PUSHBACK_PARK_AFTER - 1), {
    requeueWithoutAttempt: true,
    workerStatus: 'warming',
    avoidWorker: false,
  });
  assert.equal(planSubmitFailure(pushback, true, RELAY_PUSHBACK_PARK_AFTER + 5).workerStatus, 'warming');
  // The count is only about pushback: a node's own "not now" parks it at once, as before.
  const paused = new NodeRefusedError({ stage: 'paused', status: 503 }, 'the prompt');
  assert.equal(planSubmitFailure(paused, true, 0).workerStatus, 'warming');
});

test('a probe the relay pushed back does not blame the node, keeps its schema, and is asked again next tick', () => {
  for (const result of [
    { status: 503, body: { error: 'relay-busy' } },
    { status: 429, body: { error: 'rate-limited' } },
    { status: 429, body: null },
  ]) {
    const verdict = classifyCommunityProbe(result);
    assert.equal(verdict.next, 'warming');
    assert.ok(verdict.next === 'warming' && verdict.stage === RELAY_BUSY_STAGE);
    assert.match((verdict as { detail: string }).detail, /relay-busy/);
    assert.doesNotMatch((verdict as { detail: string }).detail, /เครื่องตอบ/);
    // Nothing on the node changed: its multi-megabyte /object_info stays cached.
    assert.equal(transitionAfterProbe('ready', verdict).forgetSchema, false);
    assert.equal(transitionAfterProbe('busy', verdict).forgetSchema, false);
  }
  // Out of rotation only until the next tick's probe.
  assert.deepEqual(planCommunityReconcile(row({ status: 'warming', lastProbedAt: NOW - 1_000 })), { kind: 'probe' });
  // A 503 with some other error is still just an odd answer.
  assert.equal(classifyCommunityProbe({ status: 503, body: { error: 'other' } }).next, 'warming');
  assert.match((classifyCommunityProbe({ status: 503, body: { error: 'other' } }) as { detail: string }).detail, /HTTP 503/);
});

test('relay pushback is not an owner who is away, so a new order for the model is still taken', () => {
  assert.equal(lastErrorSaysAway(`${stageLabel(RELAY_BUSY_STAGE)} (${RELAY_BUSY_STAGE})`), false);
  assert.equal(lastErrorSaysAway(`${stageLabel('offline')} (offline)`), true);
  assert.match(stageLabel(RELAY_BUSY_STAGE), /relay/);
});

test('a job remembers the machines it failed on, bounded, and shrugs off junk', () => {
  assert.deepEqual(readAvoidList(null), []);
  assert.deepEqual(readAvoidList('[1,2]'), []);
  assert.deepEqual(readAvoidList([1, '2', -3, 4.5, 7]), [1, 7]);

  assert.deepEqual(withAvoided(null, 5), [5]);
  assert.deepEqual(withAvoided([5, 6], 5), [6, 5]);

  let list: number[] = [];
  for (let id = 1; id <= AVOID_LIST_LIMIT + 5; id++) list = withAvoided(list, id);
  assert.equal(list.length, AVOID_LIST_LIMIT);
  assert.equal(list.at(-1), AVOID_LIST_LIMIT + 5);
});

test('community-ness is decided by the provider slug', () => {
  assert.equal(isCommunitySlug('gpuxmine'), true);
  assert.equal(isCommunitySlug('simplepod'), false);
  assert.equal(isCommunitySlug(null), false);
});

// ---------------------------------------------------------------------------
// One tick's probing, bounded
// ---------------------------------------------------------------------------

test('a relay that is down costs a handful of timeouts, not one per node', () => {
  const budget = new ProbeBudget(NOW);
  for (let i = 0; i < RELAY_DOWN_AFTER; i++) {
    assert.equal(budget.next(NOW), 'probe');
    budget.record({ error: 'fetch failed' });
  }
  // Every probe so far failed at the network level and none answered: the
  // rest of the pool is read as unreachable without asking.
  assert.equal(budget.next(NOW), 'unreachable');
});

test('one node answering proves the relay is up, so failures stay per node', () => {
  const budget = new ProbeBudget(NOW);
  budget.record({ status: 503, body: { stage: 'offline' } });
  for (let i = 0; i < RELAY_DOWN_AFTER * 2; i++) budget.record({ error: 'timeout' });
  assert.equal(budget.next(NOW), 'probe');
});

test('probing stops starting after the time budget, leaving the rest for the next tick', () => {
  const budget = new ProbeBudget(NOW);
  assert.equal(budget.next(NOW + PROBE_BUDGET_MS - 1), 'probe');
  assert.equal(budget.next(NOW + PROBE_BUDGET_MS + 1), 'skip');
});
