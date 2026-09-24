/**
 * What a home PC may be given, what a community-only model may accept, and
 * how a finished job is wiped off the node that ran it.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/community-privacy.test.mts)
 *
 * Owner decisions D4 and D5 (2026-09-18 / 2026-09-25): adult work and
 * anything a customer uploaded never runs on a GPUxMINE machine; a model
 * built only for those machines is never rented for, refuses what it cannot
 * serve before charging, and gives up on a queued job after a short grace.
 * `fetch` is replaced where the node is asked to purge a job.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// worker-client imports the override store, whose Prisma adapter wants a URL
// at import time. Nothing here queries a database.
process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';

const {
  COMMUNITY_SAFE_JOB,
  communityOrderRefusal,
  communityQueueGraceMs,
  communityRefusalMessage,
  communityRowMayServe,
  payloadHasInputMedia,
  pickClaimCandidate,
} = await import('@/lib/gpu/community-dispatch');
const { isCommunitySafe } = await import('@/lib/safety/content-tier');
const { purgeCommunityJob, readPurgeOutcome } = await import('@/lib/gpu/worker-client');
const { isCommunityOnlyModel } = await import('@/lib/gpu/catalog');

const job = (id: number, contentTier: string | null, hasInputMedia: boolean | null = false, avoidWorkerIds: unknown = null) => ({
  id,
  contentTier,
  hasInputMedia,
  avoidWorkerIds,
});

// ---------------------------------------------------------------------------
// The claim filter
// ---------------------------------------------------------------------------

test('a community machine skips adult, unknown and uploaded work and takes the first general job', () => {
  const queue = [job(1, 'adult'), job(2, 'unknown'), job(3, 'general', true), job(4, 'blocked'), job(5, 'general'), job(6, 'general')];
  assert.equal(pickClaimCandidate(queue, 99, true)?.id, 5);
});

test('a rented machine takes the head of the queue, whatever it contains', () => {
  const queue = [job(1, 'adult'), job(2, 'general', true), job(3, 'general')];
  assert.equal(pickClaimCandidate(queue, 99, false)?.id, 1);
});

test('a community machine with only private work queued gets nothing', () => {
  assert.equal(pickClaimCandidate([job(1, 'adult'), job(2, 'general', true), job(3, null, null)], 7, true), null);
});

test('the avoid list still applies on top of the content rule', () => {
  const queue = [job(1, 'general', false, [7]), job(2, 'adult'), job(3, 'general', false, [8])];
  assert.equal(pickClaimCandidate(queue, 7, true)?.id, 3);
  assert.equal(pickClaimCandidate(queue, 8, true)?.id, 1);
});

test('the Prisma filter and the rule agree', () => {
  assert.equal(isCommunitySafe(COMMUNITY_SAFE_JOB), true);
  assert.deepEqual(COMMUNITY_SAFE_JOB, { contentTier: 'general', hasInputMedia: false });
});

test('uploads are found in the payload, including inside extra', () => {
  assert.equal(payloadHasInputMedia({ prompt: 'x', inputImage: 'data:image/png;base64,AAAA' }), true);
  assert.equal(payloadHasInputMedia({ prompt: 'x', extra: { inputImageEnd: 'https://r2/uploads/a.png' } }), true);
  assert.equal(payloadHasInputMedia({ prompt: 'x', extra: { inputAudio: 'https://r2/uploads/a.flac' } }), true);
  assert.equal(payloadHasInputMedia({ prompt: 'x', extra: { inputVideo: 'https://r2/uploads/a.mp4' } }), true);
  assert.equal(payloadHasInputMedia({ prompt: 'x', inputImage: '', extra: { inputAudio: '  ' } }), false);
  assert.equal(payloadHasInputMedia({ prompt: 'x', extra: { resolution: '720p' } }), false);
  assert.equal(payloadHasInputMedia(null), false);
  assert.equal(payloadHasInputMedia('nonsense'), false);
});

// ---------------------------------------------------------------------------
// Orders for a community-only model
// ---------------------------------------------------------------------------

test('sdxl-community is the community-only model', () => {
  assert.equal(isCommunityOnlyModel('sdxl-community'), true);
  assert.equal(isCommunityOnlyModel('minimax-h3'), false);
  assert.equal(isCommunityOnlyModel('no-such-model'), false);
});

test('an order a community machine may not take is refused before charging, whatever is online', () => {
  const up = { machineAvailable: true };
  assert.equal(communityOrderRefusal({ contentTier: 'adult', hasInputMedia: false, ...up }), 'adult');
  assert.equal(communityOrderRefusal({ contentTier: 'unknown', hasInputMedia: false, ...up }), 'unreadable');
  assert.equal(communityOrderRefusal({ contentTier: 'general', hasInputMedia: true, ...up }), 'input-media');
  // The upload is named first: it is what the customer can remove.
  assert.equal(communityOrderRefusal({ contentTier: 'adult', hasInputMedia: true, ...up }), 'input-media');
});

test('a general order is refused only when no machine could take it', () => {
  assert.equal(communityOrderRefusal({ contentTier: 'general', hasInputMedia: false, machineAvailable: false }), 'no-machine');
  assert.equal(communityOrderRefusal({ contentTier: 'general', hasInputMedia: false, machineAvailable: true }), null);
});

test('every refusal is Thai and says no credit was taken', () => {
  for (const refusal of ['adult', 'unreadable', 'input-media', 'no-machine'] as const) {
    const message = communityRefusalMessage(refusal);
    assert.match(message, /[฀-๿]/);
    assert.match(message, /ไม่ได้หักเครดิต/);
  }
});

test('ready, busy and warming machines count; retired, suspended and ineligible ones do not', () => {
  const row = (status: string, metadata: unknown = { eligibility: 'eligible' }, endpoint: string | null = 'https://relay/w/1') => ({
    status,
    endpoint,
    metadata,
  });
  assert.equal(communityRowMayServe(row('ready')), true);
  assert.equal(communityRowMayServe(row('busy')), true);
  // Paused by its owner, or a relay blip: it may be back before the grace ends.
  assert.equal(communityRowMayServe(row('warming', { eligibility: 'offline' })), true);
  assert.equal(communityRowMayServe(row('warming', null)), true);
  assert.equal(communityRowMayServe(row('terminated')), false);
  assert.equal(communityRowMayServe(row('draining')), false);
  assert.equal(communityRowMayServe(row('ready', { eligibility: 'eligible' }, null)), false);
  assert.equal(communityRowMayServe(row('warming', { adminRetired: true })), false);
  assert.equal(communityRowMayServe(row('warming', { suspended: true })), false);
  assert.equal(communityRowMayServe(row('warming', { eligibility: 'no-model', note: 'ไม่มีโมเดลที่รันได้' })), false);
});

test('the queue grace is 5 minutes unless configured, and stays within 1..120', () => {
  assert.equal(communityQueueGraceMs({}), 5 * 60_000);
  assert.equal(communityQueueGraceMs({ GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN: '12' }), 12 * 60_000);
  assert.equal(communityQueueGraceMs({ GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN: '0.5' }), 60_000);
  assert.equal(communityQueueGraceMs({ GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN: '9999' }), 120 * 60_000);
  assert.equal(communityQueueGraceMs({ GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN: 'soon' }), 5 * 60_000);
  assert.equal(communityQueueGraceMs({ GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN: '-3' }), 5 * 60_000);
});

// ---------------------------------------------------------------------------
// Purging a delivered job off the node (contract C5)
// ---------------------------------------------------------------------------

test('both calls answered: the job is gone from the node', () => {
  const outcome = readPurgeOutcome({ status: 200, body: '{"purged":2}' }, { status: 200, body: '' });
  assert.deepEqual(outcome, { done: true, files: 'purged', history: 'deleted' });
});

test('a node too old for /aixman/purge is done once its history is gone — asking again changes nothing', () => {
  assert.equal(readPurgeOutcome({ status: 404, body: '' }, { status: 200, body: '' }).done, true);
  assert.equal(readPurgeOutcome({ status: 404, body: '' }, { status: 200, body: '' }).files, 'unsupported');
  assert.equal(readPurgeOutcome({ status: 403, body: '{"error":"path-not-allowed"}' }, { status: 200, body: '' }).done, true);
});

test('a permanent no is not asked again, and is kept for the log', () => {
  // An id the relay's allowlist refuses: a node cannot pin a job in the retry
  // sweep for a day by handing back a prompt id it knows will be refused.
  const refused = readPurgeOutcome({ status: 200, body: '' }, { status: 403, body: '{"error":"path-not-allowed"}' });
  assert.equal(refused.done, true);
  assert.equal(refused.history, 'refused');
  assert.match(refused.detail ?? '', /HTTP 403/);
  assert.equal(readPurgeOutcome({ status: 400, body: '' }, { status: 400, body: '' }).done, true);
  assert.equal(readPurgeOutcome({ status: 403, body: '{"error":"path-not-allowed"}' }, { status: 200, body: '' }).files, 'refused');
});

test('an offline or silent node is asked again later', () => {
  const offline = readPurgeOutcome({ status: 503, body: '{"stage":"offline"}' }, { status: 503, body: '{"stage":"offline"}' });
  assert.equal(offline.done, false);
  assert.match(offline.detail ?? '', /HTTP 503/);
  assert.equal(readPurgeOutcome({ error: 'aborted' }, { error: 'aborted' }).done, false);
  // Files gone but the prompt still in history: not done.
  assert.equal(readPurgeOutcome({ status: 200, body: '' }, { status: 500, body: '' }).done, false);
  // A relay that refuses the token is not "unsupported".
  assert.equal(readPurgeOutcome({ status: 403, body: '{"error":"forbidden"}' }, { status: 200, body: '' }).done, false);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('the node is asked to purge before its history is deleted, with the tunnel token', async () => {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: JSON.parse(String(init?.body ?? 'null')),
      auth: headers.get('authorization'),
    });
    return new Response(url.pathname.endsWith('/aixman/purge') ? '{"purged":1}' : '', { status: 200 });
  }) as typeof fetch;

  const outcome = await purgeCommunityJob('https://relay.test/w/gxm-1/', 'tunnel-token', 'prompt-abc');
  assert.equal(outcome.done, true);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ['POST /w/gxm-1/aixman/purge', 'POST /w/gxm-1/history']
  );
  assert.deepEqual(calls[0].body, { prompt_id: 'prompt-abc' });
  // Only the shape the relay's allowlist accepts: {delete:[ids]}, never {clear:true}.
  assert.deepEqual(calls[1].body, { delete: ['prompt-abc'] });
  assert.ok(calls.every((c) => c.auth === 'Bearer tunnel-token'));
});

test('a network failure never throws out of a purge', async () => {
  globalThis.fetch = (async () => {
    throw new Error('connect ECONNREFUSED');
  }) as typeof fetch;
  const outcome = await purgeCommunityJob('https://relay.test/w/gxm-2', 'token', 'prompt-x');
  assert.equal(outcome.done, false);
  assert.equal(outcome.files, 'failed');
  assert.equal(outcome.history, 'failed');
  assert.match(outcome.detail ?? '', /ECONNREFUSED/);
});
