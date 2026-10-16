/**
 * Google Compute Engine adapter against a mocked Compute API, built from the
 * documented response shapes. No real key and no real VM.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/gpu/__tests__/gce.test.mts)
 */
import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';

import { GceProvider, parseServiceAccount, resetGceTokens, signAssertion } from '@/lib/gpu/gce';
import { RentRefusedError, type GpuOffer, type GpuRentSpec } from '@/lib/gpu/types';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = {
  type: 'service_account',
  project_id: 'aixman-gpu',
  client_email: 'aixman-renter@aixman-gpu.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const KEY = JSON.stringify(SA);
const API = 'https://compute.googleapis.com/compute/v1/projects/aixman-gpu';

type Route = (url: URL, init: RequestInit) => Response | undefined;
let calls: { method: string; url: string; body?: string }[] = [];
const realFetch = globalThis.fetch;

function mock(...routes: Route[]) {
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ method, url: url.toString(), body: typeof init.body === 'string' ? init.body : undefined });
    if (url.hostname === 'oauth2.googleapis.com') {
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    for (const route of routes) {
      const res = route(url, { ...init, method });
      if (res) return res;
    }
    return json({ error: { code: 404, message: `not found: ${method} ${url.pathname}` } }, 404);
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const on = (method: string, path: string | RegExp, reply: () => Response): Route => (url, init) => {
  const p = url.toString().replace(API, '').split('?')[0];
  return init.method === method && (typeof path === 'string' ? p === path : path.test(p)) ? reply() : undefined;
};

beforeEach(() => {
  calls = [];
  resetGceTokens();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const market = (opts: { globalGpus?: number; l4?: number; preemptibleL4?: number } = {}) => [
  on('GET', '', () => json({ quotas: [{ metric: 'GPUS_ALL_REGIONS', limit: opts.globalGpus ?? 4, usage: 0 }] })),
  on('GET', '/regions', () =>
    json({
      items: [
        {
          name: 'us-central1',
          status: 'UP',
          quotas: [
            { metric: 'NVIDIA_L4_GPUS', limit: opts.l4 ?? 2, usage: 0 },
            { metric: 'PREEMPTIBLE_NVIDIA_L4_GPUS', limit: opts.preemptibleL4 ?? 0, usage: 0 },
            { metric: 'NVIDIA_H100_GPUS', limit: 1, usage: 0 },
            { metric: 'NVIDIA_T4_GPUS', limit: 0, usage: 0 },
          ],
        },
        { name: 'asia-southeast1', status: 'UP', quotas: [{ metric: 'NVIDIA_L4_GPUS', limit: 1, usage: 0 }] },
      ],
    })
  ),
  on('GET', '/aggregated/acceleratorTypes', () =>
    json({
      items: {
        'zones/us-central1-a': { acceleratorTypes: [{ name: 'nvidia-l4' }, { name: 'nvidia-tesla-t4' }, { name: 'nvidia-h100-80gb' }] },
        'zones/asia-southeast1-b': { acceleratorTypes: [{ name: 'nvidia-l4' }] },
        'zones/europe-west4-a': { warning: { code: 'NO_RESULTS_ON_PAGE' } },
      },
    })
  ),
];

test('the JSON key is checked, and the assertion is signed with it', () => {
  assert.throws(() => parseServiceAccount('not json'), /JSON key/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ ...SA, type: 'authorized_user' })), /not a service account/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ ...SA, private_key: '' })), /private_key/);
  const jwt = signAssertion(parseServiceAccount(KEY), 1_800_000_000);
  const [h, c, s] = jwt.split('.');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.exp - claims.iat, 3600);
});

test('no project-wide GPU quota means no offers at all', async () => {
  mock(...market({ globalGpus: 0 }));
  assert.deepEqual(await new GceProvider().findOffers({ minGpuMemoryMb: 20_000 }, KEY), []);
});

test('offers only where the card is in the zone and quota is free; Spot and on demand both', async () => {
  mock(...market());
  const offers = await new GceProvider().findOffers({ minGpuMemoryMb: 20_000 }, KEY);
  const ids = offers.map((o) => o.id);
  // T4 is in the zone but has no quota (and is too small); H100 is Spot-only.
  assert.ok(!ids.some((id) => id.startsWith('n1-standard-8')));
  assert.ok(ids.includes('a3-highgpu-1g-spot@us-central1-a'));
  assert.ok(!ids.includes('a3-highgpu-1g@us-central1-a'));
  // No preemptible quota: Spot falls back on the standard quota.
  assert.ok(ids.includes('g2-standard-8@us-central1-a'));
  assert.ok(ids.includes('g2-standard-8-spot@us-central1-a'));
  // Cheapest first; Spot is cheaper.
  assert.equal(offers[0].id, 'g2-standard-8-spot@us-central1-a');
  // Outside the US the table price is raised, never lowered.
  const sg = offers.find((o) => o.id === 'g2-standard-8@asia-southeast1-b')!;
  const us = offers.find((o) => o.id === 'g2-standard-8@us-central1-a')!;
  assert.ok(sg.pricePerHourUsd > us.pricePerHourUsd);
  assert.equal(us.cudaVersion, '13.0');
  assert.equal(us.minBillingSeconds, 60);
});

test('a filter on GPU count, price or region narrows the market', async () => {
  mock(...market());
  const p = new GceProvider();
  assert.deepEqual(await p.findOffers({ gpuCount: 2 }, KEY), []);
  const cheap = await p.findOffers({ maxPricePerHourUsd: 0.5 }, KEY);
  assert.ok(cheap.length > 0 && cheap.every((o) => o.pricePerHourUsd <= 0.5));
  const asia = await p.findOffers({ region: 'asia' }, KEY);
  assert.ok(asia.length > 0 && asia.every((o) => o.region!.startsWith('asia-')));
});

const offerOf = async (id: string): Promise<GpuOffer> => {
  mock(...market());
  const offer = (await new GceProvider().findOffers({}, KEY)).find((o) => o.id === id);
  assert.ok(offer, `offer ${id}`);
  return offer;
};
const specFor = (offer: GpuOffer): GpuRentSpec => ({
  offer,
  gpuCount: 1,
  image: 'pytorch/pytorch',
  imageTag: '2.9.0-cuda13.0-cudnn9-runtime',
  diskGb: 120,
  exposePorts: [8188],
  startScript: 'echo boot',
  env: { AIXMAN_WORKER_TOKEN: 'secret-token' },
  nameTag: 'aixman-ltx_2.3',
});

test('a Spot rental asks for Spot, deletes itself when taken back, and carries a run-time ceiling', async () => {
  const offer = await offerOf('g2-standard-8-spot@us-central1-a');
  calls = [];
  mock(
    on('POST', '/zones/us-central1-a/instances', () => json({ name: 'op-1', status: 'RUNNING' })),
    on('POST', '/zones/us-central1-a/operations/op-1/wait', () => json({ name: 'op-1', status: 'DONE' })),
    on('GET', /^\/zones\/us-central1-a\/instances\/aixman-ltx-2-3-[0-9a-f]{6}$/, () =>
      json({
        id: '123',
        name: 'aixman-ltx-2-3-abcdef',
        status: 'PROVISIONING',
        machineType: 'zones/us-central1-a/machineTypes/g2-standard-8',
        scheduling: { provisioningModel: 'SPOT' },
      })
    )
  );
  const instance = await new GceProvider().rent(specFor(offer), KEY);
  assert.equal(instance.id, 'us-central1-a/aixman-ltx-2-3-abcdef');
  assert.equal(instance.status, 'provisioning');
  assert.equal(instance.pricePerHourUsd, offer.pricePerHourUsd);

  const insert = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/instances'))!.body!);
  assert.match(insert.name, /^aixman-ltx-2-3-[0-9a-f]{6}$/);
  assert.equal(insert.scheduling.provisioningModel, 'SPOT');
  assert.equal(insert.scheduling.instanceTerminationAction, 'DELETE');
  assert.equal(insert.scheduling.onHostMaintenance, 'TERMINATE');
  assert.ok(Number(insert.scheduling.maxRunDuration.seconds) > 0);
  assert.equal(insert.disks[0].autoDelete, true);
  assert.equal(insert.guestAccelerators, undefined); // G2 comes with its L4
  const script = insert.metadata.items.find((i: { key: string }) => i.key === 'startup-script').value as string;
  assert.match(script, /AIXMAN_WORKER_TOKEN='secret-token'/);
  assert.match(script, /--gpus all/);
});

test('an on-demand N1 rental attaches its GPU and is not Spot', async () => {
  // Routes match in order, so this /regions answer wins over market()'s.
  mock(
    on('GET', '/regions', () =>
      json({ items: [{ name: 'us-central1', status: 'UP', quotas: [{ metric: 'NVIDIA_T4_GPUS', limit: 1, usage: 0 }] }] })
    ),
    ...market()
  );
  const offer = (await new GceProvider().findOffers({}, KEY)).find((o) => o.id === 'n1-standard-8@us-central1-a')!;
  assert.ok(offer);
  calls = [];
  mock(on('POST', '/zones/us-central1-a/instances', () => json({ name: 'op-2', status: 'DONE' })));
  await new GceProvider().rent(specFor(offer), KEY);
  const insert = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/instances'))!.body!);
  assert.equal(insert.scheduling.provisioningModel, undefined);
  assert.equal(insert.guestAccelerators[0].acceleratorCount, 1);
  assert.match(insert.guestAccelerators[0].acceleratorType, /nvidia-tesla-t4$/);
});

test('a zone out of cards is a refusal, and anything half-made is deleted', async () => {
  const offer = await offerOf('g2-standard-8@us-central1-a');
  calls = [];
  mock(
    on('POST', '/zones/us-central1-a/instances', () => json({ name: 'op-3', status: 'RUNNING' })),
    on('POST', '/zones/us-central1-a/operations/op-3/wait', () =>
      json({
        name: 'op-3',
        status: 'DONE',
        error: { errors: [{ code: 'ZONE_RESOURCE_POOL_EXHAUSTED', message: 'The zone does not have enough resources' }] },
      })
    )
  );
  await assert.rejects(new GceProvider().rent(specFor(offer), KEY), (e: Error) => e instanceof RentRefusedError && /ZONE_RESOURCE_POOL_EXHAUSTED/.test(e.message));
  assert.ok(calls.some((c) => c.method === 'DELETE' && /\/instances\/aixman-/.test(c.url)));
});

test('a quota refusal at insert is a refusal; a server error is not', async () => {
  const offer = await offerOf('g2-standard-8@us-central1-a');
  mock(on('POST', '/zones/us-central1-a/instances', () => json({ error: { code: 403, message: "Quota 'NVIDIA_L4_GPUS' exceeded" } }, 403)));
  await assert.rejects(new GceProvider().rent(specFor(offer), KEY), (e: Error) => e instanceof RentRefusedError && /NVIDIA_L4_GPUS/.test(e.message));
  mock(on('POST', '/zones/us-central1-a/instances', () => json({ error: { code: 500, message: 'backend' } }, 500)));
  await assert.rejects(new GceProvider().rent(specFor(offer), KEY), (e: Error) => !(e instanceof RentRefusedError));
});

test('status, gone machines and an idempotent terminate', async () => {
  const p = new GceProvider();
  mock(
    on('GET', '/zones/us-central1-a/instances/aixman-a', () =>
      json({ name: 'aixman-a', status: 'TERMINATED', machineType: 'x/a2-highgpu-1g' })
    ),
    on('GET', '/zones/us-central1-a/instances/aixman-b', () =>
      json({ name: 'aixman-b', status: 'RUNNING', machineType: 'x/a2-highgpu-1g' })
    )
  );
  assert.equal((await p.getInstance('us-central1-a/aixman-a', KEY))!.status, 'error');
  const running = (await p.getInstance('us-central1-a/aixman-b', KEY))!;
  assert.equal(running.status, 'running');
  assert.equal(running.gpuModel, 'A100 40GB');
  assert.equal(await p.getInstance('us-central1-a/aixman-gone', KEY), null);
  await p.terminate('us-central1-a/aixman-gone', KEY); // 404: already gone, no throw
  await assert.rejects(p.getInstance('../../etc', KEY), /Bad Google Cloud instance id/);
});

test('listInstances walks every zone and every page', async () => {
  let page = 0;
  mock(
    on('GET', '/aggregated/instances', () => {
      page++;
      return page === 1
        ? json({ items: { 'zones/us-central1-a': { instances: [{ name: 'aixman-x', status: 'RUNNING' }] } }, nextPageToken: 'p2' })
        : json({ items: { 'zones/asia-southeast1-b': { instances: [{ name: 'other-vm', status: 'RUNNING' }] }, 'zones/x-y-z': {} } });
    })
  );
  const list = await new GceProvider().listInstances(KEY);
  assert.deepEqual(list.map((i) => i.id).sort(), ['asia-southeast1-b/other-vm', 'us-central1-a/aixman-x']);
  assert.ok(calls.some((c) => c.url.includes('pageToken=p2')));
});

test('balance is unknown but the key is verified; readiness explains missing quota', async () => {
  mock(...market({ globalGpus: 0 }));
  const p = new GceProvider();
  assert.deepEqual(await p.getBalance(KEY), { balanceUsd: Number.POSITIVE_INFINITY, unknown: true });
  assert.match((await p.readiness(KEY))!, /GPUS_ALL_REGIONS/);
  mock(...market());
  assert.equal(await p.readiness(KEY), null);
  mock(on('GET', '', () => json({ error: { code: 403, message: 'Compute Engine API has not been used in project' } }, 403)));
  await assert.rejects(p.getBalance(KEY), /Compute Engine API has not been used/);
});
