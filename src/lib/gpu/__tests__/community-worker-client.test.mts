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
