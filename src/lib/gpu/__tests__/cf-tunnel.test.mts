/**
 * Named Cloudflare Tunnels against a mocked Cloudflare API v4, built from the
 * documented envelope ({ success, result, errors, result_info }). No real token.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/cf-tunnel.test.mts)
 */
import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  TUNNEL_PREFIX,
  createWorkerTunnel,
  deleteWorkerTunnel,
  namedTunnelConfig,
  readNamedTunnel,
  sweepOrphanTunnels,
  type NamedTunnelConfig,
} from '@/lib/gpu/cf-tunnel';

const CFG: NamedTunnelConfig = { accountId: 'acc', apiToken: 'tok', zoneId: 'zone', domain: 'xman4289.com' };
const API = 'https://api.cloudflare.com/client/v4';

type Reply = Response | undefined;
type Route = (method: string, path: string, body: unknown) => Reply;
let calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
const realFetch = globalThis.fetch;

function mock(...routes: Route[]) {
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input).replace(API, '');
    const method = (init.method || 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const auth = new Headers(init.headers).get('authorization');
    calls.push({ method, path: url, body, auth });
    for (const route of routes) {
      const res = route(method, url, body);
      if (res) return res;
    }
    return ok(null, 404, [{ code: 1003, message: `not found: ${method} ${url}` }]);
  }) as typeof fetch;
}
const ok = (result: unknown, status = 200, errors: unknown[] = [], resultInfo?: unknown) =>
  new Response(JSON.stringify({ success: status < 400, result, errors, ...(resultInfo ? { result_info: resultInfo } : {}) }), { status });
const on = (method: string, path: string | RegExp, reply: (body: unknown) => Response): Route => (m, p, body) =>
  m === method && (typeof path === 'string' ? p.split('?')[0] === path : path.test(p)) ? reply(body) : undefined;

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const happy = [
  on('POST', '/accounts/acc/cfd_tunnel', () => ok({ id: 't-1', token: 'conn-token' })),
  on('PUT', '/accounts/acc/cfd_tunnel/t-1/configurations', () => ok({})),
  on('POST', '/zones/zone/dns_records', () => ok({ id: 'dns-1' })),
];

test('creates tunnel, routes only the proxy port, and points a proxied CNAME at it', async () => {
  mock(...happy);
  const t = await createWorkerTunnel(CFG, `${TUNNEL_PREFIX}abc123`, 8189);

  assert.deepEqual(t, { tunnelId: 't-1', dnsRecordId: 'dns-1', hostname: 'aixman-gpu-abc123.xman4289.com', token: 'conn-token' });
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));

  const [create, config, dns] = calls;
  assert.deepEqual(create.body, { name: 'aixman-gpu-abc123', config_src: 'cloudflare' });
  const ingress = (config.body as { config: { ingress: { hostname?: string; service: string }[] } }).config.ingress;
  assert.deepEqual(ingress, [
    { hostname: 'aixman-gpu-abc123.xman4289.com', service: 'http://127.0.0.1:8189' },
    { service: 'http_status:404' },
  ]);
  assert.equal((dns.body as { content: string }).content, 't-1.cfargotunnel.com');
  assert.equal((dns.body as { proxied: boolean }).proxied, true);
});

test('fetches the connector token separately when the create answer has none', async () => {
  mock(
    on('POST', '/accounts/acc/cfd_tunnel', () => ok({ id: 't-1' })),
    on('GET', '/accounts/acc/cfd_tunnel/t-1/token', () => ok('fetched-token')),
    ...happy.slice(1)
  );
  const t = await createWorkerTunnel(CFG, `${TUNNEL_PREFIX}abc123`, 8189);
  assert.equal(t.token, 'fetched-token');
});

test('a failed DNS step removes the tunnel it had already created', async () => {
  mock(
    ...happy.slice(0, 2),
    on('POST', '/zones/zone/dns_records', () => ok(null, 400, [{ code: 81053, message: 'record already exists' }])),
    on('DELETE', '/accounts/acc/cfd_tunnel/t-1/connections', () => ok({})),
    on('DELETE', '/accounts/acc/cfd_tunnel/t-1', () => ok({}))
  );
  await assert.rejects(createWorkerTunnel(CFG, `${TUNNEL_PREFIX}abc123`, 8189), /record already exists/);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === '/accounts/acc/cfd_tunnel/t-1'));
  // No record was made, so none is deleted.
  assert.ok(!calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/zones/')));
});

test('refuses a label outside our prefix', async () => {
  mock(...happy);
  await assert.rejects(createWorkerTunnel(CFG, 'someone-elses', 8189), /Invalid tunnel label/);
  assert.equal(calls.length, 0);
});

test('delete clears DNS, connections and tunnel; already-gone counts as done', async () => {
  mock(
    on('DELETE', '/zones/zone/dns_records/dns-1', () => ok(null, 404, [{ code: 81044, message: 'Record does not exist' }])),
    on('DELETE', '/accounts/acc/cfd_tunnel/t-1/connections', () => ok({})),
    on('DELETE', '/accounts/acc/cfd_tunnel/t-1', () => ok({}))
  );
  await deleteWorkerTunnel(CFG, { tunnelId: 't-1', dnsRecordId: 'dns-1', hostname: 'h' });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    [
      'DELETE /zones/zone/dns_records/dns-1',
      'DELETE /accounts/acc/cfd_tunnel/t-1/connections',
      'DELETE /accounts/acc/cfd_tunnel/t-1',
    ]
  );
});

test('delete surfaces a real failure so the sweep retries', async () => {
  mock(on('DELETE', /cfd_tunnel/, () => ok(null, 403, [{ code: 10000, message: 'Authentication error' }])));
  await assert.rejects(
    deleteWorkerTunnel(CFG, { tunnelId: 't-1', dnsRecordId: '', hostname: 'h' }),
    /Authentication error/
  );
});

test('sweep removes only old, unclaimed pieces carrying our prefix', async () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const old = '2026-10-27T11:00:00Z';
  const fresh = '2026-10-27T11:55:00Z';
  mock(
    on('GET', '/accounts/acc/cfd_tunnel', () =>
      ok(
        [
          { id: 'live', name: `${TUNNEL_PREFIX}live`, created_at: old },
          { id: 'orphan', name: `${TUNNEL_PREFIX}orphan`, created_at: old },
          { id: 'young', name: `${TUNNEL_PREFIX}young`, created_at: fresh },
          { id: 'mine-by-hand', name: 'home-nas', created_at: old },
        ],
        200,
        [],
        { page: 1, total_pages: 1 }
      )
    ),
    on('GET', '/zones/zone/dns_records', () =>
      ok([
        { id: 'r-live', name: `${TUNNEL_PREFIX}live.xman4289.com`, content: 'live.cfargotunnel.com', created_on: old },
        { id: 'r-orphan', name: `${TUNNEL_PREFIX}gone.xman4289.com`, content: 'gone.cfargotunnel.com', created_on: old },
        { id: 'r-site', name: 'ai.xman4289.com', content: 'site.cfargotunnel.com', created_on: old },
      ])
    ),
    on('DELETE', /./, () => ok({}))
  );

  const removed = await sweepOrphanTunnels(CFG, new Set(['live']), 15 * 60_000, now);

  assert.deepEqual(removed, [`tunnel ${TUNNEL_PREFIX}orphan`, `dns ${TUNNEL_PREFIX}gone.xman4289.com`]);
  const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.path);
  assert.ok(deletes.includes('/accounts/acc/cfd_tunnel/orphan'));
  assert.ok(deletes.includes('/zones/zone/dns_records/r-orphan'));
  assert.ok(!deletes.some((p) => /live|young|mine-by-hand|r-site/.test(p)));
});

test('config needs all four variables; metadata reader ignores quick-tunnel rows', () => {
  const saved = { ...process.env };
  try {
    process.env.CF_TUNNEL_ACCOUNT_ID = 'acc';
    process.env.CF_TUNNEL_API_TOKEN = 'tok';
    process.env.CF_TUNNEL_ZONE_ID = 'zone';
    delete process.env.CF_TUNNEL_DOMAIN;
    assert.equal(namedTunnelConfig(), null);
    process.env.CF_TUNNEL_DOMAIN = '.XMAN4289.com.';
    assert.equal(namedTunnelConfig()?.domain, 'xman4289.com');
  } finally {
    process.env = saved;
  }
  assert.equal(readNamedTunnel({ callbackId: 'abc' }), null);
  assert.equal(readNamedTunnel(null), null);
  assert.deepEqual(readNamedTunnel({ namedTunnel: { tunnelId: 't', dnsRecordId: 'd', hostname: 'h' } }), {
    tunnelId: 't',
    dnsRecordId: 'd',
    hostname: 'h',
  });
});
