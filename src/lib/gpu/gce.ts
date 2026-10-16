import { createHash, createSign, randomBytes } from 'crypto';
import { bootFromEnv, gzipBase64 } from './script-encoding';
import { VendorHttpError, vendorFetch } from './vendor-http';
import {
  RentRefusedError,
  type GpuBalance,
  type GpuInstance,
  type GpuInstanceStatus,
  type GpuOffer,
  type GpuOfferFilter,
  type GpuProviderSlug,
  type GpuRentSpec,
  type GpuRentalProvider,
} from './types';

/**
 * Google Compute Engine — whole VMs in Google's own regions, rented through
 * the Compute API with a service account. The same shape as Verda: a VM runs
 * a startup script that starts the stock PyTorch container every other vendor
 * boots, and the worker inside reaches us through its own tunnel.
 *
 * Not Colab. Consumer Colab (free, Pro, Pro+) has no API to create a runtime,
 * and its terms forbid serving third parties from one on every tier, so it
 * cannot be a vendor here. Colab Enterprise runs on these same VMs.
 *
 * Things that differ from the other vendors and would cost money or fail
 * quietly if missed:
 *  - **No balance.** Google bills a card or invoice afterwards; there is no
 *    prepaid balance to read. `getBalance` verifies the key and answers
 *    `unknown`; the daily budget cap is the only spend limit.
 *  - **Quota, not stock, is the usual "no".** A new project may rent zero GPUs
 *    until the owner asks for `GPUS_ALL_REGIONS` and a per-region GPU quota.
 *    Offers are only made where quota is free, and setup warns when none is.
 *  - **Stockouts arrive late.** An insert answers 200 with an operation; a zone
 *    out of cards fails that operation seconds later. `rent` waits up to 20 s, so
 *    a refusal still lets the same tick try the next zone.
 *  - **Spot.** Every card is offered on demand and as Spot (60–90 % cheaper).
 *    Google may take a Spot VM back at any moment; it is created with
 *    `instanceTerminationAction: DELETE`, so it disappears (disk included) and
 *    the platform sees a vanished worker and retries the job elsewhere.
 *  - **A kill switch of our own.** Every VM carries `maxRunDuration`: Google
 *    deletes it after `MAX_RUN_SECONDS` even if the tick that reaps machines
 *    has stopped.
 *  - **Prices are not in the Compute API.** They come from the table below
 *    (us-central1 list prices). Regions outside the US are priced
 *    `NON_US_PRICE_FACTOR` higher, which overstates most of them — erring on
 *    the side of renting less. The invoice in Cloud Billing is the truth.
 *  - **The startup script is readable** through the API by anyone with access
 *    to the project, and holds the worker's token. The VM (and its metadata)
 *    is deleted on terminate; the token dies with the rental.
 *
 * The stored credential is the service account's JSON key, as downloaded.
 */

const API = 'https://compute.googleapis.com/compute/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/compute';
const VENDOR = 'Google Cloud';
/**
 * Deep Learning VM, Ubuntu 24.04 with the NVIDIA 580 driver. The image family
 * says CUDA 12.9, but that is its toolkit: driver 580 runs CUDA 13.0
 * containers, which is all the worker needs from the host.
 */
const IMAGE = 'projects/deeplearning-platform-release/global/images/family/common-cu129-ubuntu-2404-nvidia-580';
const HOST_CUDA = '13.0';
/** pd-balanced, $/GB-month (us-central1). */
const DISK_USD_PER_GB_MONTH = 0.1;
/** VM boot, driver check, Docker start and the PyTorch image pull, before our script runs. */
const VM_BOOT_SECONDS = 240;
/** Google bills per second after the first minute. */
const MIN_BILLING_SECONDS = 60;
const ASSUMED_MBPS = 2000;
/** Hard ceiling Google enforces on every VM we create (12 h). */
const MAX_RUN_SECONDS = 12 * 3600;
const NON_US_PRICE_FACTOR = 1.25;
const BOOT_ENV = 'AIXMAN_BOOT_B64';

/**
 * Single-GPU shapes we rent, cheapest card first. Prices are whole-machine USD
 * per hour in us-central1 (Google's pricing pages, 2026-10); Spot prices move
 * up to once a month, so they are a ceiling-ish estimate rather than a quote.
 */
export interface GceShape {
  accelerator: string;
  gpuModel: string;
  vramGb: number;
  machineType: string;
  cpuCores: number;
  ramGb: number;
  onDemandUsd: number;
  spotUsd: number;
  /** Regional quota metric; Spot draws on `PREEMPTIBLE_<metric>` when it has any. */
  quotaMetric: string;
  /** N1 machines take the GPU as an attachment; G2/A2/A3 come with it. */
  attachGpu?: boolean;
  /** A3 High with one GPU is sold only as Spot (or Flex-start), never on demand. */
  spotOnly?: boolean;
}

export const GCE_SHAPES: GceShape[] = [
  { accelerator: 'nvidia-tesla-t4', gpuModel: 'Tesla T4', vramGb: 16, machineType: 'n1-standard-8', cpuCores: 8, ramGb: 30, onDemandUsd: 0.73, spotUsd: 0.27, quotaMetric: 'NVIDIA_T4_GPUS', attachGpu: true },
  { accelerator: 'nvidia-l4', gpuModel: 'L4', vramGb: 24, machineType: 'g2-standard-8', cpuCores: 8, ramGb: 32, onDemandUsd: 0.86, spotUsd: 0.35, quotaMetric: 'NVIDIA_L4_GPUS' },
  { accelerator: 'nvidia-tesla-a100', gpuModel: 'A100 40GB', vramGb: 40, machineType: 'a2-highgpu-1g', cpuCores: 12, ramGb: 85, onDemandUsd: 3.68, spotUsd: 1.48, quotaMetric: 'NVIDIA_A100_GPUS' },
  { accelerator: 'nvidia-a100-80gb', gpuModel: 'A100 80GB', vramGb: 80, machineType: 'a2-ultragpu-1g', cpuCores: 12, ramGb: 170, onDemandUsd: 5.07, spotUsd: 2.1, quotaMetric: 'NVIDIA_A100_80GB_GPUS' },
  { accelerator: 'nvidia-h100-80gb', gpuModel: 'H100 80GB', vramGb: 80, machineType: 'a3-highgpu-1g', cpuCores: 26, ramGb: 234, onDemandUsd: 11.07, spotUsd: 3.2, quotaMetric: 'NVIDIA_H100_GPUS', spotOnly: true },
];

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface OfferRef {
  zone: string;
  machineType: string;
  accelerator: string;
  spot: boolean;
}

interface Quota {
  metric?: string;
  limit?: number;
  usage?: number;
}

interface GceOperation {
  name?: string;
  status?: string;
  error?: { errors?: { code?: string; message?: string }[] };
}

interface GceInstance {
  id?: string;
  name?: string;
  zone?: string;
  status?: string;
  statusMessage?: string;
  machineType?: string;
  creationTimestamp?: string;
  scheduling?: { provisioningModel?: string };
}

/** Parse and check the JSON key. Messages never echo any of its contents. */
export function parseServiceAccount(credential: string): ServiceAccount {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(credential) as Record<string, unknown>;
  } catch {
    throw new Error('Google Cloud credential must be the service account JSON key file');
  }
  const { type, project_id, client_email, private_key } = parsed;
  if (type !== 'service_account') throw new Error('Google Cloud credential is not a service account key');
  if (typeof project_id !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project_id)) {
    throw new Error('Google Cloud key has no valid project_id');
  }
  if (typeof client_email !== 'string' || !client_email.includes('@')) throw new Error('Google Cloud key has no client_email');
  if (typeof private_key !== 'string' || !private_key.includes('PRIVATE KEY')) throw new Error('Google Cloud key has no private_key');
  return { project_id, client_email, private_key };
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** A signed JWT asserting the service account, for the OAuth token exchange. */
export function signAssertion(sa: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 })
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

// Tokens live an hour; one per key, refreshed a minute early, keyed by a hash
// so the map never holds a second copy of the private key as its key.
const store = globalThis as unknown as {
  __gceTokens?: Map<string, { token: string; expires: number }>;
  __gceTokenRequests?: Map<string, Promise<string>>;
};
const tokens = (store.__gceTokens ??= new Map());
const pendingTokens = (store.__gceTokenRequests ??= new Map());

/** For tests: forget every cached token. */
export function resetGceTokens(): void {
  tokens.clear();
  pendingTokens.clear();
}

const regionOf = (zone: string) => zone.replace(/-[a-z]$/, '');
const lastSegment = (url: string | undefined) => (url ?? '').split('/').pop() ?? '';

function priceOf(shape: GceShape, spot: boolean, zone: string): number {
  const base = spot ? shape.spotUsd : shape.onDemandUsd;
  return regionOf(zone).startsWith('us-') ? base : Math.round(base * NON_US_PRICE_FACTOR * 10000) / 10000;
}

/** Free units of a quota metric; 0 when the metric is absent. */
function freeQuota(quotas: Quota[] | undefined, metric: string): number {
  const q = quotas?.find((x) => x.metric === metric);
  return q ? Math.max(0, (q.limit ?? 0) - (q.usage ?? 0)) : 0;
}

/** Whether a Spot VM fits: its own preemptible quota, or the standard one when it has none. */
function spotQuotaFree(quotas: Quota[] | undefined, metric: string): number {
  const preemptible = quotas?.find((x) => x.metric === `PREEMPTIBLE_${metric}`);
  return preemptible && (preemptible.limit ?? 0) > 0 ? freeQuota(quotas, `PREEMPTIBLE_${metric}`) : freeQuota(quotas, metric);
}

/** `zone/name` — instance names are unique within a zone, and every call needs the zone. */
function instanceRef(id: string): { zone: string; name: string } {
  const [zone, name] = id.split('/');
  if (!zone || !name || !/^[a-z0-9-]+$/.test(zone) || !/^[a-z0-9-]+$/.test(name)) throw new Error(`Bad Google Cloud instance id: ${id}`);
  return { zone, name };
}

export class GceProvider implements GpuRentalProvider {
  readonly slug: GpuProviderSlug = 'gce';
  readonly label = 'Google Cloud';
  readonly exposure = 'tunnel' as const;
  readonly credential = 'service-account-json' as const;

  private async token(credential: string): Promise<string> {
    const key = createHash('sha256').update(credential).digest('hex');
    const cached = tokens.get(key);
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const inFlight = pendingTokens.get(key);
    if (inFlight) return inFlight;

    const sa = parseServiceAccount(credential);
    const request = vendorFetch<{ access_token?: string; expires_in?: number }>(VENDOR, TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signAssertion(sa),
      }).toString(),
    })
      .then((res) => {
        if (!res?.access_token) throw new Error('Google did not issue an access token');
        tokens.set(key, { token: res.access_token, expires: Date.now() + (res.expires_in ?? 3600) * 1000 });
        return res.access_token;
      })
      .finally(() => pendingTokens.delete(key));
    pendingTokens.set(key, request);
    return request;
  }

  private async call<T>(credential: string, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    const token = await this.token(credential);
    try {
      return await vendorFetch<T>(VENDOR, `${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 401) {
        tokens.delete(createHash('sha256').update(credential).digest('hex'));
      }
      throw error;
    }
  }

  private project(credential: string): string {
    return parseServiceAccount(credential).project_id;
  }

  /** Every page of an aggregated list, bounded so a huge project cannot stall the tick. */
  private async aggregated<T>(credential: string, path: string, field: string): Promise<Record<string, T[]>> {
    const out: Record<string, T[]> = {};
    let pageToken = '';
    for (let page = 0; page < 10; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const res = await this.call<{ items?: Record<string, Record<string, T[] | undefined>>; nextPageToken?: string }>(
        credential,
        `${path}${sep}returnPartialSuccess=true&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      );
      for (const [scope, entry] of Object.entries(res?.items ?? {})) {
        const list = entry?.[field];
        if (list?.length) out[scope] = [...(out[scope] ?? []), ...list];
      }
      if (!res?.nextPageToken) break;
      pageToken = res.nextPageToken;
    }
    return out;
  }

  // ----------------------------------------------------------------
  // Market
  // ----------------------------------------------------------------

  async findOffers(filter: GpuOfferFilter, credential: string): Promise<GpuOffer[]> {
    if ((filter.gpuCount ?? 1) !== 1) return [];
    if (filter.minCudaVersion && compareVersions(HOST_CUDA, filter.minCudaVersion) < 0) return [];
    const project = this.project(credential);
    const [accelerators, regions, proj] = await Promise.all([
      this.aggregated<{ name?: string }>(credential, `/projects/${project}/aggregated/acceleratorTypes`, 'acceleratorTypes'),
      this.call<{ items?: { name?: string; status?: string; quotas?: Quota[] }[] }>(credential, `/projects/${project}/regions`),
      this.call<{ quotas?: Quota[] }>(credential, `/projects/${project}`),
    ]);
    if (freeQuota(proj?.quotas, 'GPUS_ALL_REGIONS') < 1) return [];

    const regionQuotas = new Map<string, Quota[]>();
    for (const r of regions?.items ?? []) {
      if (r.name && r.status !== 'DOWN') regionQuotas.set(r.name, r.quotas ?? []);
    }

    const models = filter.gpuModels?.map((m) => m.toLowerCase().trim()).filter(Boolean);
    const offers: GpuOffer[] = [];
    for (const [scope, types] of Object.entries(accelerators)) {
      const zone = scope.replace(/^zones\//, '');
      const region = regionOf(zone);
      if (filter.region && !zone.toLowerCase().startsWith(filter.region.toLowerCase())) continue;
      const quotas = regionQuotas.get(region);
      if (!quotas) continue;
      const here = new Set(types.map((t) => t.name));

      for (const shape of GCE_SHAPES) {
        if (!here.has(shape.accelerator)) continue;
        const vramMb = shape.vramGb * 1024;
        if (filter.minGpuMemoryMb && vramMb < filter.minGpuMemoryMb) continue;
        if (filter.minCpuCores && shape.cpuCores < filter.minCpuCores) continue;
        if (filter.minSystemMemoryMb && shape.ramGb * 1024 < filter.minSystemMemoryMb) continue;
        if (models?.length && !models.some((m) => shape.gpuModel.toLowerCase().includes(m))) continue;

        for (const spot of shape.spotOnly ? [true] : [false, true]) {
          const free = spot ? spotQuotaFree(quotas, shape.quotaMetric) : freeQuota(quotas, shape.quotaMetric);
          if (free < 1) continue;
          const price = priceOf(shape, spot, zone);
          if (filter.maxPricePerHourUsd && price > filter.maxPricePerHourUsd) continue;
          const ref: OfferRef = { zone, machineType: shape.machineType, accelerator: shape.accelerator, spot };
          offers.push({
            id: `${shape.machineType}${spot ? '-spot' : ''}@${zone}`,
            marketRef: JSON.stringify(ref),
            gpuModel: shape.gpuModel,
            gpuCount: 1,
            gpuMemoryMb: vramMb,
            cpuCores: shape.cpuCores,
            systemMemoryMb: shape.ramGb * 1024,
            diskGb: filter.minDiskGb ?? 0,
            pricePerHourUsd: price,
            diskPricePerGbMonthUsd: DISK_USD_PER_GB_MONTH,
            region: spot ? `${zone} (spot)` : zone,
            // Spot can be taken back at any moment; ranked as a less reliable host.
            reliability: spot ? 90 : 99,
            downloadMbps: ASSUMED_MBPS,
            cudaVersion: HOST_CUDA,
            minBillingSeconds: MIN_BILLING_SECONDS,
            extraBootSeconds: VM_BOOT_SECONDS,
          });
        }
      }
    }
    return offers.sort((a, b) => a.pricePerHourUsd - b.pricePerHourUsd);
  }

  // ----------------------------------------------------------------
  // Instances
  // ----------------------------------------------------------------

  async rent(spec: GpuRentSpec, credential: string): Promise<GpuInstance> {
    if (spec.registry) throw new Error('Google Cloud rentals do not support a private registry yet');
    if (spec.gpuCount !== 1) throw new RentRefusedError('Google Cloud offers single-GPU machines only');
    const ref = JSON.parse(spec.offer.marketRef) as OfferRef;
    const shape = GCE_SHAPES.find((s) => s.machineType === ref.machineType);
    if (!shape) throw new RentRefusedError(`Unknown Google Cloud machine type ${ref.machineType}`);
    const project = this.project(credential);
    const zone = ref.zone;
    const name = `${spec.nameTag}-${randomBytes(3).toString('hex')}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^[^a-z]+/, '')
      .slice(0, 62)
      .replace(/-+$/, '');

    const body = {
      name,
      description: 'aixman GPU worker',
      machineType: `zones/${zone}/machineTypes/${shape.machineType}`,
      labels: { aixman: 'worker' },
      disks: [
        {
          boot: true,
          autoDelete: true,
          initializeParams: {
            sourceImage: IMAGE,
            diskSizeGb: String(spec.diskGb),
            diskType: `zones/${zone}/diskTypes/pd-balanced`,
          },
        },
      ],
      // An external IP for outbound traffic (weights, the tunnel); the default
      // firewall lets nothing in, and nothing needs to come in.
      networkInterfaces: [{ network: 'global/networks/default', accessConfigs: [{ type: 'ONE_TO_ONE_NAT', name: 'External NAT' }] }],
      ...(shape.attachGpu
        ? { guestAccelerators: [{ acceleratorType: `zones/${zone}/acceleratorTypes/${shape.accelerator}`, acceleratorCount: 1 }] }
        : {}),
      scheduling: {
        onHostMaintenance: 'TERMINATE', // GPU VMs cannot live-migrate
        automaticRestart: false,
        instanceTerminationAction: 'DELETE',
        maxRunDuration: { seconds: String(MAX_RUN_SECONDS) },
        ...(ref.spot ? { provisioningModel: 'SPOT' } : {}),
      },
      metadata: {
        items: [
          { key: 'startup-script', value: gceStartupScript(spec) },
          { key: 'install-nvidia-driver', value: 'True' },
        ],
      },
    };

    let op: GceOperation;
    try {
      op = await this.call<GceOperation>(credential, `/projects/${project}/zones/${zone}/instances`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (error) {
      // 403 quota exceeded / API off, 400 a shape not offered there, 409 name
      // taken, 429 rate limited: nothing was created.
      if (error instanceof VendorHttpError && [400, 403, 404, 409, 412, 429].includes(error.status)) {
        throw new RentRefusedError(error.message);
      }
      // Anything else may or may not have created a VM; its name starts
      // `aixman-`, so the orphan sweep finds and deletes it if it exists.
      throw error;
    }

    // A zone out of cards fails the operation, not the request. Wait a little
    // for it so the tick can move on to the next offer.
    const settled = await this.settle(credential, project, zone, op);
    const failure = settled?.error?.errors?.[0];
    if (failure) {
      await this.terminate(`${zone}/${name}`, credential).catch(() => {
        // Not created is the usual case; the orphan sweep covers the rest.
      });
      throw new RentRefusedError(`Google Cloud ${zone}: ${failure.code ?? 'error'} ${failure.message ?? ''}`.trim());
    }

    const instance = await this.getInstance(`${zone}/${name}`, credential).catch(() => null);
    return (
      instance ?? {
        id: `${zone}/${name}`,
        name,
        status: 'provisioning',
        endpoints: {},
        pricePerHourUsd: spec.offer.pricePerHourUsd,
        gpuModel: shape.gpuModel,
        gpuCount: 1,
        gpuMemoryMb: shape.vramGb * 1024,
        createdAt: new Date(),
      }
    );
  }

  /**
   * The operation once done, or as last seen if it is still running after
   * 20 s. Kept short: a refused offer is followed by the next one in the same
   * tick, all inside the 150 s tick lease. A stockout reported later shows up
   * as a machine that is gone (404), which the worker manager already handles.
   */
  private async settle(credential: string, project: string, zone: string, op: GceOperation): Promise<GceOperation | null> {
    if (!op?.name || op.status === 'DONE') return op ?? null;
    try {
      // `wait` returns when the operation finishes or after Google's own
      // deadline, whichever is first; it changes nothing, so a timeout is fine.
      return await this.call<GceOperation>(
        credential,
        `/projects/${project}/zones/${zone}/operations/${encodeURIComponent(op.name)}/wait`,
        { method: 'POST', timeoutMs: 20_000 }
      );
    } catch {
      return op;
    }
  }

  async getInstance(id: string, credential: string): Promise<GpuInstance | null> {
    const { zone, name } = instanceRef(id);
    try {
      const vm = await this.call<GceInstance>(credential, `/projects/${this.project(credential)}/zones/${zone}/instances/${name}`);
      if (!vm?.name) return null;
      return toInstance(vm, zone);
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async terminate(id: string, credential: string): Promise<void> {
    const { zone, name } = instanceRef(id);
    try {
      // The boot disk was created with autoDelete, so it goes with the VM.
      await this.call<unknown>(credential, `/projects/${this.project(credential)}/zones/${zone}/instances/${name}`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 404) return; // already gone
      throw error;
    }
  }

  async fetchVendorLogs(id: string, credential: string): Promise<string> {
    const { zone, name } = instanceRef(id);
    const res = await this.call<{ contents?: string }>(
      credential,
      `/projects/${this.project(credential)}/zones/${zone}/instances/${name}/serialPort?port=1`
    );
    return (res?.contents ?? '').slice(-20_000);
  }

  async listInstances(credential: string): Promise<GpuInstance[]> {
    const all = await this.aggregated<GceInstance>(credential, `/projects/${this.project(credential)}/aggregated/instances`, 'instances');
    return Object.entries(all).flatMap(([scope, vms]) =>
      vms.filter((vm) => vm.name).map((vm) => toInstance(vm, scope.replace(/^zones\//, '')))
    );
  }

  async getBalance(credential: string): Promise<GpuBalance> {
    // Reading the project proves the key works and the Compute API is on.
    await this.call<unknown>(credential, `/projects/${this.project(credential)}`);
    return { balanceUsd: Number.POSITIVE_INFINITY, unknown: true };
  }

  /**
   * Why renting would fail even though the key works — a project with no GPU
   * quota is the usual one. Null when at least one card can be rented.
   */
  async readiness(credential: string): Promise<string | null> {
    const project = this.project(credential);
    const [proj, regions] = await Promise.all([
      this.call<{ quotas?: Quota[] }>(credential, `/projects/${project}`),
      this.call<{ items?: { quotas?: Quota[] }[] }>(credential, `/projects/${project}/regions`),
    ]);
    if (freeQuota(proj?.quotas, 'GPUS_ALL_REGIONS') < 1) {
      return 'โปรเจกต์นี้ยังไม่มีโควตา GPU (GPUS_ALL_REGIONS = 0) — ขอเพิ่มที่ IAM & Admin → Quotas ก่อน ระบบจึงจะเช่าเครื่องได้';
    }
    const any = (regions?.items ?? []).some((r) =>
      GCE_SHAPES.some((s) => freeQuota(r.quotas, s.quotaMetric) > 0 || freeQuota(r.quotas, `PREEMPTIBLE_${s.quotaMetric}`) > 0)
    );
    return any ? null : 'ยังไม่มีโควตา GPU รายภูมิภาค (เช่น NVIDIA_L4_GPUS) ในภูมิภาคใดเลย — ขอเพิ่มที่ IAM & Admin → Quotas';
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function toStatus(status: string | undefined): GpuInstanceStatus {
  switch (status) {
    case 'RUNNING':
      return 'running';
    // A stopped or suspended VM never comes back on its own and its disk
    // bills: reported as an error, the platform deletes it.
    case 'STOPPING':
    case 'STOPPED':
    case 'TERMINATED':
    case 'SUSPENDING':
    case 'SUSPENDED':
      return 'error';
    default:
      return 'provisioning'; // PROVISIONING, STAGING, REPAIRING
  }
}

function toInstance(vm: GceInstance, zone: string): GpuInstance {
  const machine = lastSegment(vm.machineType);
  const shape = GCE_SHAPES.find((s) => s.machineType === machine);
  const spot = vm.scheduling?.provisioningModel === 'SPOT';
  const status = toStatus(vm.status);
  return {
    id: `${zone}/${vm.name}`,
    supportId: vm.id,
    name: vm.name,
    status,
    endpoints: {},
    pricePerHourUsd: shape ? priceOf(shape, spot, zone) : 0,
    gpuModel: shape?.gpuModel ?? machine,
    gpuCount: shape ? 1 : undefined,
    gpuMemoryMb: shape ? shape.vramGb * 1024 : undefined,
    createdAt: vm.creationTimestamp ? new Date(vm.creationTimestamp) : undefined,
    statusMessage:
      status === 'error' ? `Google Cloud reports the VM ${vm.status}${vm.statusMessage ? `: ${vm.statusMessage}` : ''}` : undefined,
  };
}

/**
 * The VM's startup script: wait for the driver, make sure Docker can hand the
 * GPU to a container, then start the worker with the boot script in its
 * environment. Google re-runs startup scripts on every boot, so it replaces
 * any container already there. Output goes to the serial console, which
 * `fetchVendorLogs` reads.
 */
export function gceStartupScript(spec: GpuRentSpec): string {
  const env = { ...(spec.env ?? {}), [BOOT_ENV]: gzipBase64(spec.startScript ?? '') };
  const envFlags = Object.entries(env)
    .filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
    .map(([k, v]) => `-e ${k}=${shellQuote(v)}`)
    .join(' \\\n  ');
  const image = `${spec.image}:${spec.imageTag}`;
  return `#!/bin/bash
# aixman GPU worker — Google Compute Engine startup
set -u
echo "aixman: waiting for the NVIDIA driver"
for i in $(seq 1 120); do nvidia-smi > /dev/null 2>&1 && break; sleep 5; done
nvidia-smi -L || echo "aixman: no GPU visible"
if ! command -v docker > /dev/null; then
  echo "aixman: installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
for i in $(seq 1 30); do docker info > /dev/null 2>&1 && break; sleep 2; done
if ! docker info 2> /dev/null | grep -qi nvidia; then
  if ! command -v nvidia-ctk > /dev/null; then
    echo "aixman: installing the NVIDIA container toolkit"
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \\
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \\
      > /etc/apt/sources.list.d/nvidia-container-toolkit.list
    apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q nvidia-container-toolkit
  fi
  nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
  for i in $(seq 1 30); do docker info > /dev/null 2>&1 && break; sleep 2; done
fi
docker rm -f aixman-worker > /dev/null 2>&1 || true
docker pull ${shellQuote(image)}
docker run -d --name aixman-worker --gpus all --shm-size 16g \\
  ${envFlags} \\
  ${shellQuote(image)} bash -c ${shellQuote(bootFromEnv(BOOT_ENV))}
echo "aixman: worker container started"
`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
