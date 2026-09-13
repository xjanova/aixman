import { randomBytes } from 'crypto';
import { bootFromEnv, gzipBase64 } from './script-encoding';
import { MIN_ARCH, MIN_COMPUTE_CAP } from './gpu-specs';
import { VendorHttpError, sleep, vendorFetch } from './vendor-http';
import {
  RentRefusedError,
  RentUnconfirmedError,
  type GpuBalance,
  type GpuInstance,
  type GpuInstanceStatus,
  type GpuOffer,
  type GpuOfferFilter,
  type GpuProviderSlug,
  type GpuRentSpec,
  type GpuRentalProvider,
  type PendingRental,
} from './types';

/**
 * Vast.ai — the deepest and cheapest market, and the least uniform one.
 *
 * Every host sets its own prices, including for bandwidth: `inet_down_cost`
 * is charged per GB coming in, so pulling 46 GB of weights can cost more than
 * the render (the offer picker adds it). Only verified, rentable, on-demand
 * hosts are asked for.
 *
 * Ports are plain TCP on a random host port — no TLS — so these workers are
 * reached through the tunnel they open themselves (GpuExposure 'tunnel') and
 * publish nothing. That also means a host with no open ports is usable.
 *
 * The container runs our script as its main process (`runtype: "args"`); the
 * script rides in the environment, since `onstart` is capped at 4048 chars.
 */

const API = 'https://console.vast.ai/api/v0';
const API_V1 = 'https://console.vast.ai/api/v1';
const VENDOR = 'Vast.ai';
const BOOT_ENV = 'AIXMAN_BOOT_B64';
/** Image pull happens in "loading", which Vast does not bill for GPU time — only the wait. */
const IMAGE_PULL_SECONDS = 90;
const RENT_SETTLE_TIMEOUT_MS = 45_000;
const MIN_RELIABILITY = 0.97;

interface VastOffer {
  id?: number;
  gpu_name?: string;
  num_gpus?: number;
  gpu_ram?: number;
  dph_base?: number;
  dph_total?: number;
  storage_cost?: number;
  inet_down?: number;
  inet_down_cost?: number;
  reliability?: number;
  reliability2?: number;
  cuda_max_good?: number;
  geolocation?: string;
  disk_space?: number;
  cpu_cores_effective?: number;
  cpu_ram?: number;
  rented?: boolean;
}

interface VastInstance {
  id?: number;
  label?: string | null;
  actual_status?: string | null;
  intended_status?: string | null;
  status_msg?: string | null;
  gpu_name?: string;
  num_gpus?: number;
  gpu_ram?: number;
  dph_total?: number;
  start_date?: number | null;
}

export class VastProvider implements GpuRentalProvider {
  readonly slug: GpuProviderSlug = 'vast';
  readonly label = 'Vast.ai';
  readonly exposure = 'tunnel' as const;
  readonly credential = 'api-key' as const;

  private call<T>(apiKey: string, url: string, init: RequestInit = {}): Promise<T> {
    return vendorFetch<T>(VENDOR, url, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  }

  // ----------------------------------------------------------------
  // Market
  // ----------------------------------------------------------------

  async findOffers(filter: GpuOfferFilter, apiKey: string): Promise<GpuOffer[]> {
    const count = filter.gpuCount ?? 1;
    const query: Record<string, unknown> = {
      verified: { eq: true },
      rentable: { eq: true },
      rented: { eq: false },
      external: { eq: false },
      num_gpus: { eq: count },
      reliability: { gte: MIN_RELIABILITY },
      type: 'on-demand',
      order: [['dph_total', 'asc']],
      limit: 200,
    };
    if (filter.minGpuMemoryMb) query.gpu_ram = { gte: filter.minGpuMemoryMb };
    if (filter.minDiskGb) {
      query.disk_space = { gte: filter.minDiskGb };
      // Prices dph_total with this much storage included.
      query.allocated_storage = filter.minDiskGb;
    }
    if (filter.minDownloadMbps) query.inet_down = { gte: filter.minDownloadMbps };
    if (filter.minCudaVersion) query.cuda_max_good = { gte: Number(filter.minCudaVersion) };
    if (filter.maxPricePerHourUsd) query.dph_base = { lte: filter.maxPricePerHourUsd * count };
    // The cheapest rows are V100s with CUDA 13 drivers (compute 7.0); unfiltered
    // they fill the price-ordered page ahead of cards that can do the work.
    query.compute_cap = { gte: MIN_COMPUTE_CAP[filter.minArch ?? MIN_ARCH] };

    const res = await this.call<{ offers?: VastOffer[] }>(apiKey, `${API}/bundles/`, {
      method: 'POST',
      body: JSON.stringify(query),
    });

    const models = filter.gpuModels?.map((m) => m.toLowerCase().trim()).filter(Boolean);
    const offers: GpuOffer[] = [];
    for (const o of res?.offers ?? []) {
      if (!o.id || !o.gpu_name || o.rented) continue; // the search returns rented rows too
      // Hugging Face and Docker Hub are blocked from mainland China: a host
      // there cannot fetch the image or the weights, and the boot would fail
      // after it was paid for. Found on the first live query (2026-09-13):
      // the top H3 pick was a CN host.
      if (isMainlandChina(o.geolocation)) continue;
      const gpus = o.num_gpus || count;
      const perGpu = (o.dph_base ?? 0) / gpus;
      if (perGpu <= 0) continue;
      if (filter.maxPricePerHourUsd && perGpu > filter.maxPricePerHourUsd) continue;
      if (models?.length && !models.some((m) => o.gpu_name!.toLowerCase().includes(m))) continue;
      offers.push({
        id: String(o.id),
        marketRef: String(o.id),
        gpuModel: o.gpu_name,
        gpuCount: gpus,
        gpuMemoryMb: o.gpu_ram ?? 0,
        cpuCores: o.cpu_cores_effective ?? 0,
        systemMemoryMb: o.cpu_ram ?? 0,
        diskGb: o.disk_space ?? 0,
        pricePerHourUsd: perGpu,
        diskPricePerGbMonthUsd: o.storage_cost,
        // Vast documents this as MB/s in one place and Mb/s in another;
        // megabits is the reading that underestimates, so it is the one taken.
        downloadMbps: o.inet_down,
        ingressUsdPerGb: o.inet_down_cost,
        reliability: typeof o.reliability === 'number' ? o.reliability * 100 : undefined,
        cudaVersion: typeof o.cuda_max_good === 'number' ? String(o.cuda_max_good) : undefined,
        region: o.geolocation,
        extraBootSeconds: IMAGE_PULL_SECONDS,
      });
    }
    return offers.sort((a, b) => a.pricePerHourUsd - b.pricePerHourUsd);
  }

  // ----------------------------------------------------------------
  // Instances
  // ----------------------------------------------------------------

  async rent(spec: GpuRentSpec, apiKey: string): Promise<GpuInstance> {
    if (spec.registry) throw new Error('Vast.ai rentals do not support a private registry yet');
    const label = `${spec.nameTag}-${randomBytes(3).toString('hex')}`;
    const body = {
      client_id: 'me',
      image: `${spec.image}:${spec.imageTag}`,
      label,
      disk: spec.diskGb,
      runtype: 'args',
      args: ['bash', '-c', bootFromEnv(BOOT_ENV)],
      env: {
        ...(spec.env ?? {}),
        [BOOT_ENV]: gzipBase64(spec.startScript ?? ''),
        // Published only when the platform asked for a port (tunnel mode asks for none).
        ...Object.fromEntries(spec.exposePorts.map((p) => [`-p ${p}:${p}`, '1'])),
      },
      // Never leave a stopped instance behind that bills its storage.
      cancel_unavail: true,
      target_state: 'running',
    };

    let contract: number | undefined;
    try {
      const res = await this.call<{ success?: boolean; new_contract?: number; msg?: string }>(
        apiKey,
        `${API}/asks/${encodeURIComponent(spec.offer.marketRef)}/`,
        { method: 'PUT', body: JSON.stringify(body) }
      );
      if (res?.success === false) throw new RentRefusedError(`Vast.ai refused the order: ${res.msg ?? 'no reason given'}`);
      contract = res?.new_contract;
    } catch (error) {
      if (error instanceof RentRefusedError) throw error;
      if (error instanceof VendorHttpError) {
        // A bad key comes back as 404 too ("auth_error: Invalid user key") —
        // not a taken offer; trying the next one would only fail the same way.
        if (AUTH_ERROR.test(error.message)) throw error;
        // The offer was taken or withdrawn (no_such_ask), or the order was bad.
        if ([400, 402, 404, 410].includes(error.status) || /no_such_ask/i.test(error.message)) {
          throw new RentRefusedError(error.message);
        }
        // Too frequent: nothing was created, but trying another offer at once
        // would only hit the same limit — let the vendor sit out this tick.
        if (error.status === 429 || error.status === 401 || error.status === 403) throw error;
      }
      console.warn('[gpu] Vast.ai order did not answer cleanly, checking whether it went through:', (error as Error).message);
    }

    if (contract) {
      const instance = await this.getInstance(String(contract), apiKey).catch(() => null);
      return (
        instance ?? {
          id: String(contract),
          name: label,
          status: 'provisioning',
          endpoints: {},
          pricePerHourUsd: spec.offer.pricePerHourUsd * spec.gpuCount,
          gpuModel: spec.offer.gpuModel,
          gpuCount: spec.gpuCount,
          createdAt: new Date(),
        }
      );
    }

    // No clean answer: look for our label before deciding.
    const deadline = Date.now() + RENT_SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(5_000);
      const found = (await this.listVast(apiKey).catch(() => [] as VastInstance[])).find((i) => i.label === label);
      if (found?.id) return this.toInstance(found);
    }
    throw new RentUnconfirmedError(`Vast.ai order for ${label} was not confirmed`, {
      before: [],
      at: Date.now(),
      nameTag: label,
      provider: 'vast',
    });
  }

  /** Our instances carry their `aixman-…` label from creation, so the sweep finds them unaided. */
  async adoptUnconfirmed(pending: PendingRental, apiKey: string): Promise<number> {
    return (await this.listVast(apiKey)).filter((i) => i.label === pending.nameTag).length;
  }

  async getInstance(id: string, apiKey: string): Promise<GpuInstance | null> {
    try {
      const res = await this.call<{ instances?: VastInstance | null }>(
        apiKey,
        `${API}/instances/${encodeURIComponent(id)}/?owner=me`
      );
      const instance = res?.instances;
      if (!instance || !instance.id) return null;
      return this.toInstance(instance);
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async terminate(id: string, apiKey: string): Promise<void> {
    try {
      const res = await this.call<{ success?: boolean; error?: string; msg?: string }>(
        apiKey,
        `${API}/instances/${encodeURIComponent(id)}/`,
        { method: 'DELETE' }
      );
      if (res?.success === false && res.error !== 'not_found') {
        throw new Error(`Vast.ai would not destroy instance ${id}: ${res.msg ?? res.error ?? 'unknown'}`);
      }
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 404) return; // already gone
      throw error;
    }
  }

  async listInstances(apiKey: string): Promise<GpuInstance[]> {
    return (await this.listVast(apiKey)).filter((i) => i.id).map((i) => this.toInstance(i));
  }

  /** v1 listing, 25 a page. Bounded, so a runaway cursor cannot hold the tick. */
  private async listVast(apiKey: string): Promise<VastInstance[]> {
    const all: VastInstance[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ limit: '25' });
      if (after) qs.set('after_token', after);
      const res = await this.call<{ instances?: VastInstance[]; next_token?: string | null }>(
        apiKey,
        `${API_V1}/instances/?${qs.toString()}`
      );
      all.push(...(res?.instances ?? []));
      if (!res?.next_token) break;
      after = res.next_token;
    }
    return all;
  }

  async getBalance(apiKey: string): Promise<GpuBalance> {
    // The response also carries the account's API key: read one field, log nothing.
    const me = await this.call<{ credit?: number; balance?: number }>(apiKey, `${API}/users/current/`);
    const credit = typeof me?.credit === 'number' ? me.credit : me?.balance;
    if (typeof credit !== 'number') throw new Error('Vast.ai did not return a credit balance');
    return { balanceUsd: credit };
  }

  private toInstance(i: VastInstance): GpuInstance {
    return {
      id: String(i.id),
      name: i.label ?? undefined,
      status: toStatus(i.actual_status),
      // Reached through its own tunnel; the raw port is never used.
      endpoints: {},
      pricePerHourUsd: i.dph_total ?? 0,
      gpuModel: i.gpu_name,
      gpuCount: i.num_gpus,
      gpuMemoryMb: i.gpu_ram,
      createdAt: typeof i.start_date === 'number' ? new Date(i.start_date * 1000) : undefined,
      statusMessage: i.status_msg ?? undefined,
    };
  }
}

/** Vast answers a bad key with 404 and this text, not with 401. */
const AUTH_ERROR = /auth_error|invalid user key/i;

/** Vast's geolocation reads "Yunnan, CN", or a bare "CN". */
function isMainlandChina(geolocation: string | undefined): boolean {
  return /(^|,\s*)CN\s*$/i.test(geolocation ?? '');
}

function toStatus(status: string | null | undefined): GpuInstanceStatus {
  switch (status) {
    case 'running':
      return 'running';
    // We never stop an instance, and a stopped one still bills its storage:
    // whatever stopped it (an empty balance, the host), it is destroyed.
    // Once exited, unknown or offline, an instance never comes back at all.
    case 'stopped':
    case 'frozen':
    case 'exited':
    case 'unknown':
    case 'offline':
      return 'error';
    default:
      return 'provisioning'; // null, created, loading, rebooting
  }
}
