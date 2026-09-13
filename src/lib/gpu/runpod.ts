import { randomBytes } from 'crypto';
import { bootFromEnv, gzipBase64 } from './script-encoding';
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
 * RunPod Pods, through REST v2 (GA 2026-08-18).
 *
 * v1 (`rest.runpod.io/v1`) retires on 2026-11-15 and its field names are
 * rejected by v2 with a 422 — `gpu.{id,count,minCudaVersion}`, `disk`, `args`
 * as one string, `env` as an object, `ports` as ["8189/http"]. The balance is
 * the one thing v2 does not offer: it is read from GraphQL, which retires in
 * early 2027, after which `getBalance` reports it as unknown and RunPod's own
 * 402 on an unfunded order does the job.
 *
 * RunPod is not a marketplace of hosts: an "offer" is a GPU type in one cloud
 * (SECURE: RunPod's data centres; COMMUNITY: vetted third-party hosts) with
 * the data centres that currently have it in stock. A pod is placed at order
 * time; a sold-out answer (400) is a refusal and the next offer is tried.
 *
 * Ports are published at `https://{podId}-{port}.proxy.runpod.net` — HTTPS,
 * so no tunnel of our own. That proxy cuts requests at 100 s, which nothing we
 * send comes close to.
 */

const API = 'https://api.runpod.io/v2';
const GRAPHQL = 'https://api.runpod.io/graphql';
const VENDOR = 'RunPod';
/** Container disk, $/GB-month while running (docs.runpod.io/pods/pricing). */
const CONTAINER_DISK_USD_PER_GB_MONTH = 0.1;
/** RunPod does not publish host bandwidth; its data centres pull from Hugging Face quickly. */
const ASSUMED_MBPS: Record<Cloud, number> = { SECURE: 2500, COMMUNITY: 1000 };
const RELIABILITY: Record<Cloud, number> = { SECURE: 99.5, COMMUNITY: 97 };
/** Pulling the stock PyTorch image before our script runs. */
const IMAGE_PULL_SECONDS = 60;
const RENT_SETTLE_TIMEOUT_MS = 60_000;
const BOOT_ENV = 'AIXMAN_BOOT_B64';

type Cloud = 'SECURE' | 'COMMUNITY';

interface CatalogGpu {
  id?: string;
  name?: string;
  memory?: number;
  price?: { secure?: number | null; community?: number | null };
  availability?: string;
  dataCenters?: { id?: string; availability?: string }[];
}

interface Pod {
  id?: string;
  name?: string;
  status?: string;
  cost?: number;
  ports?: string[];
  gpu?: { id?: string; count?: number; memory?: number } | null;
  dataCenterId?: string;
  createdAt?: string;
}

interface OfferRef {
  gpuId: string;
  cloud: Cloud;
  dataCenterIds: string[];
}

export class RunPodProvider implements GpuRentalProvider {
  readonly slug: GpuProviderSlug = 'runpod';
  readonly label = 'RunPod';
  readonly exposure = 'vendor-https' as const;
  readonly credential = 'api-key' as const;

  private call<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
    return vendorFetch<T>(VENDOR, `${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  }

  // ----------------------------------------------------------------
  // Market
  // ----------------------------------------------------------------

  async findOffers(filter: GpuOfferFilter, apiKey: string): Promise<GpuOffer[]> {
    const count = filter.gpuCount ?? 1;
    const clouds: Cloud[] = ['SECURE', 'COMMUNITY'];
    const catalogs = await Promise.all(
      clouds.map((cloud) => {
        const qs = new URLSearchParams({ include: 'AVAILABILITY', product: 'POD', cloud, count: String(count) });
        if (filter.minCudaVersion) qs.set('minCudaVersion', filter.minCudaVersion);
        return this.call<{ gpus?: CatalogGpu[] }>(apiKey, `/catalog/gpus?${qs.toString()}`).then((r) => ({ cloud, gpus: r?.gpus ?? [] }));
      })
    );

    const models = filter.gpuModels?.map((m) => m.toLowerCase().trim()).filter(Boolean);
    const offers: GpuOffer[] = [];
    for (const { cloud, gpus } of catalogs) {
      for (const gpu of gpus) {
        if (!gpu.id) continue;
        const price = cloud === 'SECURE' ? gpu.price?.secure : gpu.price?.community;
        if (typeof price !== 'number' || price <= 0) continue;
        if (!gpu.availability || gpu.availability === 'NONE') continue;
        const name = gpu.name || gpu.id;
        const vramMb = Math.round((gpu.memory ?? 0) * 1024);
        if (filter.minGpuMemoryMb && vramMb < filter.minGpuMemoryMb) continue;
        if (filter.maxPricePerHourUsd && price > filter.maxPricePerHourUsd) continue;
        if (models?.length && !models.some((m) => name.toLowerCase().includes(m) || gpu.id!.toLowerCase().includes(m))) continue;

        // Where it is in stock now — the order is placed there, not left to a
        // scheduler that may pick a sold-out data centre and answer 400.
        const dataCenterIds = (gpu.dataCenters ?? [])
          .filter((dc) => dc.id && dc.availability && dc.availability !== 'NONE')
          .map((dc) => dc.id as string)
          .filter((id) => !filter.region || id.toUpperCase().startsWith(filter.region.toUpperCase()));
        if (filter.region && dataCenterIds.length === 0) continue;

        const ref: OfferRef = { gpuId: gpu.id, cloud, dataCenterIds };
        offers.push({
          id: `${gpu.id}|${cloud}`,
          marketRef: JSON.stringify(ref),
          gpuModel: name,
          gpuCount: count,
          gpuMemoryMb: vramMb,
          cpuCores: 0,
          systemMemoryMb: 0,
          // Container disk is sized per order, not by the host.
          diskGb: filter.minDiskGb ?? 0,
          pricePerHourUsd: price,
          diskPricePerGbMonthUsd: CONTAINER_DISK_USD_PER_GB_MONTH,
          region: dataCenterIds.join(',') || undefined,
          reliability: RELIABILITY[cloud],
          downloadMbps: ASSUMED_MBPS[cloud],
          cudaVersion: filter.minCudaVersion,
          extraBootSeconds: IMAGE_PULL_SECONDS,
        });
      }
    }
    return offers.sort((a, b) => a.pricePerHourUsd - b.pricePerHourUsd);
  }

  // ----------------------------------------------------------------
  // Pods
  // ----------------------------------------------------------------

  async rent(spec: GpuRentSpec, apiKey: string): Promise<GpuInstance> {
    const ref = JSON.parse(spec.offer.marketRef) as OfferRef;
    if (spec.registry) {
      throw new Error('RunPod rentals do not support a private registry yet');
    }
    // Unique, so an order whose answer was lost can still be found by name.
    const name = `${spec.nameTag}-${randomBytes(3).toString('hex')}`;
    const before = await this.listPods(apiKey).catch(() => [] as Pod[]);

    const body = {
      name,
      image: `${spec.image}:${spec.imageTag}`,
      gpu: {
        id: ref.gpuId,
        count: spec.gpuCount,
        ...(spec.minCudaVersion ? { minCudaVersion: spec.minCudaVersion } : {}),
      },
      cloud: ref.cloud,
      ...(ref.dataCenterIds.length ? { dataCenterIds: ref.dataCenterIds } : {}),
      disk: spec.diskGb,
      ports: spec.exposePorts.map((p) => `${p}/http`),
      // The script rides in the environment; the start command only unpacks it.
      env: { ...(spec.env ?? {}), [BOOT_ENV]: gzipBase64(spec.startScript ?? '') },
      args: `bash -c '${bootFromEnv(BOOT_ENV)}'`,
    };

    try {
      const pod = await this.call<Pod>(apiKey, '/pods', { method: 'POST', body: JSON.stringify(body) });
      if (pod?.id) return this.toInstance(pod);
    } catch (error) {
      if (error instanceof VendorHttpError) {
        // 400 is how v2 says "no capacity"; 402 unfunded; 403 no access to
        // that pool; 409 conflict. None of them created anything.
        if ([400, 402, 403, 409].includes(error.status)) throw new RentRefusedError(error.message);
        // 422: our body broke the contract — a bug, not a sold-out market.
        if (error.status === 422 || error.status === 429 || error.status === 401) throw error;
      }
      console.warn('[gpu] RunPod order did not answer cleanly, checking whether it went through:', (error as Error).message);
    }

    // No clean answer: look for the pod by its unique name before deciding.
    const deadline = Date.now() + RENT_SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(4_000);
      const found = (await this.listPods(apiKey).catch(() => [] as Pod[])).find((p) => p.name === name);
      if (found?.id) return this.toInstance(found);
    }
    const pending: PendingRental = {
      before: before.map((p) => String(p.id)),
      at: Date.now(),
      nameTag: name,
      provider: 'runpod',
    };
    throw new RentUnconfirmedError(`RunPod order for ${name} was not confirmed`, pending);
  }

  /**
   * Every pod we create is already named `aixman-…`, so an unconfirmed one is
   * swept like any other orphan once past the grace period. This only reports
   * whether it has appeared.
   */
  async adoptUnconfirmed(pending: PendingRental, apiKey: string): Promise<number> {
    const pods = await this.listPods(apiKey);
    return pods.filter((p) => p.name === pending.nameTag && !pending.before.includes(String(p.id))).length;
  }

  async getInstance(id: string, apiKey: string): Promise<GpuInstance | null> {
    try {
      const pod = await this.call<Pod>(apiKey, `/pods/${encodeURIComponent(id)}`);
      if (!pod?.id || pod.status === 'TERMINATED') return null;
      return this.toInstance(pod);
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async terminate(id: string, apiKey: string): Promise<void> {
    try {
      await this.call<void>(apiKey, `/pods/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 404) return; // already gone
      throw error;
    }
  }

  async listInstances(apiKey: string): Promise<GpuInstance[]> {
    return (await this.listPods(apiKey)).filter((p) => p.id && p.status !== 'TERMINATED').map((p) => this.toInstance(p));
  }

  private async listPods(apiKey: string): Promise<Pod[]> {
    const res = await this.call<{ pods?: Pod[] }>(apiKey, '/pods');
    return res?.pods ?? [];
  }

  async getBalance(apiKey: string): Promise<GpuBalance> {
    try {
      const res = await vendorFetch<{ data?: { myself?: { clientBalance?: number; currentSpendPerHr?: number } } }>(
        VENDOR,
        GRAPHQL,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'query { myself { clientBalance currentSpendPerHr } }' }),
        }
      );
      const me = res?.data?.myself;
      if (typeof me?.clientBalance !== 'number') throw new Error('RunPod did not return a balance');
      const burn = me.currentSpendPerHr ?? 0;
      return {
        balanceUsd: me.clientBalance,
        availableRentalHours: burn > 0 ? me.clientBalance / burn : undefined,
      };
    } catch (error) {
      // GraphQL retired (early 2027): there is no other way to read it.
      if (error instanceof VendorHttpError && (error.status === 404 || error.status === 410)) {
        return { balanceUsd: Number.POSITIVE_INFINITY, unknown: true };
      }
      throw error;
    }
  }

  private toInstance(pod: Pod): GpuInstance {
    const id = String(pod.id);
    const endpoints: Record<number, string> = {};
    for (const entry of pod.ports ?? []) {
      const [port, kind] = String(entry).split('/');
      const n = Number(port);
      if (Number.isInteger(n) && kind === 'http') endpoints[n] = `https://${id}-${n}.proxy.runpod.net`;
    }
    return {
      id,
      name: pod.name,
      status: toStatus(pod.status),
      endpoints,
      pricePerHourUsd: typeof pod.cost === 'number' ? pod.cost : 0,
      gpuModel: pod.gpu?.id,
      gpuCount: pod.gpu?.count,
      createdAt: pod.createdAt ? new Date(pod.createdAt) : undefined,
      statusMessage: pod.status === 'ERROR' ? 'RunPod reports the pod in ERROR' : undefined,
    };
  }
}

function toStatus(status: string | undefined): GpuInstanceStatus {
  switch (status) {
    case 'RUNNING':
      return 'running';
    // Our boot script is the container's main process, so EXITED means the
    // worker died. Reported as an error, the pod is deleted — "stopped" would
    // only stop our watching it, and leave it in the account.
    case 'EXITED':
    case 'ERROR':
      return 'error';
    default:
      return 'provisioning'; // PROVISIONING, STARTING
  }
}
