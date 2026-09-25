/**
 * A home node's "not now", as the queue sees it through WorkerClient.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/community-worker-client.test.mts)
 *
 * `fetch` is replaced by a scripted node: the schema comes from the vendored
 * ComfyUI baseline, and the answers to /object_info, /prompt and /view are the
 * ones contract C5 says a paused, busy or offline node gives. A rented worker
 * answering the same way must keep its old errors — nothing about renting
 * changes here.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The override store imports Prisma, whose adapter wants a URL at import time.
// Nothing here queries a database.
process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';

const { WorkerClient } = await import('@/lib/gpu/worker-client');
const { isNodeRefusal } = await import('@/lib/gpu/community-dispatch');
const baseline = (await import('@/lib/gpu/workflows/schema/baseline-v0.36.0.json')).default as { classes: Record<string, unknown> };

type WorkerProfile = ConstructorParameters<typeof WorkerClient>[1];

const PROFILE = { apiKind: 'comfyui', healthPath: '/aixman/ready', apiPort: 8189 } as unknown as WorkerProfile;

const JOB = {
  prompt: 'a lighthouse at dusk',
  width: 1024,
  height: 1024,
  duration: 0,
  fps: 0,
  seed: 7,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A scripted worker: `routes` maps "METHOD /path" to a response. */
function scripted(routes: Record<string, () => Response>): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url.pathname.replace(/^\/w\/[^/]+/, '')}`;
    seen.push(key);
    const route = routes[key];
    if (!route) return new Response('not scripted', { status: 599 });
    return route();
  }) as typeof fetch;
  return seen;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let n = 0;
/** A fresh endpoint per test: the schema cache is keyed by endpoint. */
const endpoint = () => `https://relay.test/w/gxm-test-${++n}`;

test('a paused node refusing /object_info is a refusal, not a failure', async () => {
  scripted({ 'GET /object_info': () => json(503, { ready: false, stage: 'paused', reason: 'owner schedule' }) });
  const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community', null, { community: true });

  await assert.rejects(client.submit(JOB), (error: unknown) => {
    assert.equal(isNodeRefusal(error), true);
    assert.equal((error as { stage: string }).stage, 'paused');
    return true;
  });
});

test('the relay answering offline for a node is a refusal too', async () => {
  scripted({ 'GET /object_info': () => json(503, { stage: 'offline', ready: false }) });
  const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community', null, { community: true });

  await assert.rejects(client.submit(JOB), (error: unknown) => isNodeRefusal(error) && (error as { stage: string }).stage === 'offline');
});

test('a node still busy with its previous prompt refuses the next with 409 busy', async () => {
  const seen = scripted({
    'GET /object_info': () => json(200, baseline.classes),
    'POST /prompt': () => json(409, { stage: 'busy', reason: 'a prompt is still running' }),
  });
  const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community', null, { community: true });

  await assert.rejects(client.submit(JOB), (error: unknown) => isNodeRefusal(error) && (error as { stage: string }).stage === 'busy');
  // The graph was built and validated first: the refusal came from /prompt itself.
  assert.deepEqual(seen, ['GET /object_info', 'POST /prompt']);
});

test('a node that accepts gets its prompt id back as the job id', async () => {
  scripted({
    'GET /object_info': () => json(200, baseline.classes),
    'POST /prompt': () => json(200, { prompt_id: 'abc-123', node_errors: {} }),
  });
  const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community', null, { community: true });

  const submitted = await client.submit(JOB);
  assert.equal(submitted.externalJobId, 'abc-123');
});

test('a real rejection from a home node stays a failure', async () => {
  scripted({
    'GET /object_info': () => json(200, baseline.classes),
    'POST /prompt': () => json(400, { error: { message: 'Prompt outputs failed validation' } }),
  });
  const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community', null, { community: true });

  await assert.rejects(client.submit(JOB), (error: unknown) => !isNodeRefusal(error) && /HTTP 400/.test((error as Error).message));
});

test('a rented worker answering 503 with a stage keeps its old error', async () => {
  scripted({ 'GET /object_info': () => json(503, { stage: 'downloading' }) });
  const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community');

  await assert.rejects(client.submit(JOB), (error: unknown) => {
    assert.equal(isNodeRefusal(error), false);
    assert.match((error as Error).message, /Could not read the worker's node schema \(HTTP 503\)/);
    return true;
  });
});

test('a finished render on a node that dropped offline is a refusal, so the queue can wait for it', async () => {
  scripted({ 'GET /view': () => json(503, { stage: 'offline', ready: false }) });
  const base = endpoint();
  const community = new WorkerClient(base, PROFILE, 'token', 'sdxl-community', null, { community: true });
  const rented = new WorkerClient(base, PROFILE, 'token', 'sdxl-community');

  await assert.rejects(community.download(`${base}/view?filename=a.png&type=output`), (error: unknown) => isNodeRefusal(error));
  await assert.rejects(rented.download(`${base}/view?filename=a.png&type=output`), /Failed to download render \(HTTP 503\)/);
});

// ---------------------------------------------------------------------------
// A modified node cannot fill the server's memory
// ---------------------------------------------------------------------------

const { readCapped } = await import('@/lib/gpu/worker-client');
const { isRejectedOutput } = await import('@/lib/gpu/community-plausibility');

const MB = 1_048_576;

/** A body that never ends, and how much of it was ever pulled. */
function endless(chunk = MB): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += chunk;
      controller.enqueue(new Uint8Array(chunk));
    },
  });
  return { stream, pulled: () => pulled };
}

test('a node that says up front it is sending gigabytes is refused before a byte is read', async () => {
  const body = endless();
  scripted({
    'GET /view': () =>
      new Response(body.stream, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(2 * 1024 * MB) } }),
  });
  const base = endpoint();
  const client = new WorkerClient(base, PROFILE, 'token', 'sdxl-community', null, { community: true });

  // No limit passed: a community client still has its model's (image: 64 MB).
  await assert.rejects(client.download(`${base}/view?filename=a.png&type=output`), (error: unknown) => {
    assert.equal(isRejectedOutput(error), true);
    assert.match((error as Error).message, /offered 2048 MB/);
    return true;
  });
  assert.ok(body.pulled() <= 2 * MB, `pulled ${body.pulled() / MB} MB`);
});

test('an endless stream is cut where it crosses the limit, not after the node gives up', async () => {
  const body = endless();
  scripted({ 'GET /view': () => new Response(body.stream, { status: 200, headers: { 'Content-Type': 'image/png' } }) });
  const base = endpoint();
  const client = new WorkerClient(base, PROFILE, 'token', 'sdxl-community', null, { community: true });

  await assert.rejects(client.download(`${base}/view?filename=a.png&type=output`, { maxBytes: 4 * MB }), (error: unknown) => {
    assert.equal(isRejectedOutput(error), true);
    assert.match((error as Error).message, /more than 4 MB/);
    return true;
  });
  assert.ok(body.pulled() <= 8 * MB, `pulled ${body.pulled() / MB} MB for a 4 MB limit`);
});

test('a render within the limit arrives whole, and a rented worker has no limit unless asked', async () => {
  const png = new Uint8Array(3 * MB).fill(7);
  scripted({ 'GET /view': () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }) });
  const base = endpoint();
  const community = new WorkerClient(base, PROFILE, 'token', 'sdxl-community', null, { community: true });
  const rented = new WorkerClient(base, PROFILE, 'token', 'sdxl-community');

  assert.equal((await community.download(`${base}/view?filename=a.png`, { maxBytes: 3 * MB })).buffer.byteLength, 3 * MB);
  assert.equal((await rented.download(`${base}/view?filename=a.png`)).buffer.byteLength, 3 * MB);
});

test('a history answer of megabytes is not a render report: the job moves on', async () => {
  const body = endless();
  scripted({ 'GET /history/p-1': () => new Response(body.stream, { status: 200, headers: { 'Content-Type': 'application/json' } }) });
  const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community', null, { community: true });

  const outcome = await client.poll('p-1');
  assert.equal(outcome.state, 'failed');
  assert.match((outcome as { error: string }).error, /larger than 8 MB/);
  assert.ok(body.pulled() <= 12 * MB);
});

test("the relay's own relay-busy and rate limit on /prompt are pushback, not the node failing the job", async () => {
  const { isRelayPushback } = await import('@/lib/gpu/community-dispatch');
  for (const answer of [
    () => {
      const res = json(503, { error: 'relay-busy' });
      res.headers.set('Retry-After', '5');
      return res;
    },
    () => json(429, { error: 'rate-limited' }),
  ]) {
    scripted({ 'GET /object_info': () => json(200, baseline.classes), 'POST /prompt': answer });
    const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community', null, { community: true });
    await assert.rejects(client.submit(JOB), (error: unknown) => {
      assert.equal(isRelayPushback(error), true);
      assert.equal((error as { stage: string }).stage, 'relay-busy');
      return true;
    });
  }

  // A rented worker behind some proxy answering the same keeps its old error.
  scripted({ 'GET /object_info': () => json(200, baseline.classes), 'POST /prompt': () => json(503, { error: 'relay-busy' }) });
  const rented = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community');
  await assert.rejects(rented.submit(JOB), (error: unknown) => !isNodeRefusal(error) && /HTTP 503/.test((error as Error).message));
});

test('a finished render the relay rate-limits is waited for, not thrown away', async () => {
  scripted({ 'GET /view': () => json(429, { error: 'rate-limited' }) });
  const base = endpoint();
  const community = new WorkerClient(base, PROFILE, 'token', 'sdxl-community', null, { community: true });

  await assert.rejects(community.download(`${base}/view?filename=a.png&type=output`), (error: unknown) => isNodeRefusal(error));
});

test('a node the relay has disabled refuses /prompt as a "not now", so no attempt is spent', async () => {
  scripted({
    'GET /object_info': () => json(200, baseline.classes),
    'POST /prompt': () => json(403, { error: 'worker-disabled' }),
  });
  const client = new WorkerClient(endpoint(), PROFILE, 'token', 'sdxl-community', null, { community: true });

  await assert.rejects(client.submit(JOB), (error: unknown) => isNodeRefusal(error) && (error as { stage: string }).stage === 'disabled');
});

test('readCapped reads up to the limit, says there was more, and gives up on a body that stalls', async () => {
  const small = await readCapped(new Response('{"ok":true}'), 1024, 1_000);
  assert.deepEqual(small, { text: '{"ok":true}', overflow: false });

  const big = await readCapped(new Response(endless(1024).stream), 4096, 1_000);
  assert.equal(big.overflow, true);
  assert.equal(big.text.length, 4096);

  const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
  await assert.rejects(readCapped(new Response(stalled), 1024, 50), /did not finish within/);
});
