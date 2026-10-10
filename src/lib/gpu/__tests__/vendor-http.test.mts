/**
 * Which vendor calls are tried again after a network blip, and which never are.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/vendor-http.test.mts)
 *
 * The orphan sweep and the balance check logged "fetch failed" and gateway
 * 502/503/504s from every vendor several times a day. A read can safely be
 * asked again; a POST that rents or stops a machine must not be.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { vendorFetch, VendorHttpError } from '@/lib/gpu/vendor-http';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch that answers from `script` in order and counts its calls. */
function scripted(script: (() => Response | never)[]): { calls: () => number } {
  let n = 0;
  globalThis.fetch = (async () => {
    const step = script[Math.min(n, script.length - 1)];
    n++;
    return step();
  }) as typeof fetch;
  return { calls: () => n };
}
const networkDown = () => {
  throw new TypeError('fetch failed');
};
const status = (code: number, body = '{}') => () => new Response(body, { status: code });
const fast = { retryDelaysMs: [0, 0] };

test('a read that got no answer is asked again', async () => {
  const f = scripted([networkDown, status(200, '{"ok":1}')]);
  assert.deepEqual(await vendorFetch('Vast.ai', 'https://v.example/api/v1/instances/', fast), { ok: 1 });
  assert.equal(f.calls(), 2);
});

test("a gateway's 503 is waited out, twice at most", async () => {
  const f = scripted([status(503), status(502), status(200, '[]')]);
  assert.deepEqual(await vendorFetch('RunPod', 'https://r.example/v2/pods', fast), []);
  assert.equal(f.calls(), 3);
  const g = scripted([status(504)]);
  await assert.rejects(vendorFetch('RunPod', 'https://r.example/v2/pods', fast), (e: VendorHttpError) => e.status === 504);
  assert.equal(g.calls(), 3);
});

test('a POST is sent once, whatever happened to it', async () => {
  const f = scripted([networkDown, status(200)]);
  await assert.rejects(vendorFetch('Vast.ai', 'https://v.example/asks/1/', { method: 'POST', ...fast }), (e: VendorHttpError) => e.status === 0);
  assert.equal(f.calls(), 1);
});

test('a real refusal is not asked again', async () => {
  const f = scripted([status(404, '{"detail":"no such instance"}')]);
  await assert.rejects(vendorFetch('Vast.ai', 'https://v.example/instances/9/', fast), /no such instance/);
  assert.equal(f.calls(), 1);
});

test('a timeout is not tried again', async () => {
  let n = 0;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    n++;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  }) as typeof fetch;
  await assert.rejects(vendorFetch('SimplePod', 'https://s.example/instances/list', { timeoutMs: 20, ...fast }), /timed out/);
  assert.equal(n, 1);
});
