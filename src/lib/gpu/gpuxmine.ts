/**
 * GPUxMINE — the community pool.
 *
 * Every other adapter here rents a machine: we pay by the second, we boot it,
 * we destroy it. This one does none of that. The machines are consumer PCs
 * whose owners installed our agent; they enlist themselves, they are already
 * running, and they cost nothing per hour — the owner is paid per job instead.
 *
 * It implements `GpuRentalProvider` anyway so that the worker manager, the
 * admin pages and the orphan sweep can keep treating every worker the same. The
 * rental half of the interface is therefore deliberately inert:
 *
 *   - `findOffers` returns nothing. Community nodes must never appear in the
 *     cost-ranked market, because "rent the cheapest machine" has no meaning
 *     for a machine that is not for rent.
 *   - `rent` throws. Reaching it would be a bug in the caller, and failing
 *     loudly beats silently doing nothing.
 *   - `terminate` is a no-op that succeeds. There is nothing to stop billing:
 *     the PC belongs to its owner and keeps running. Ending our relationship
 *     with it means marking the row terminated, which the caller already does.
 *
 * What keeps a node in the pool is not this adapter. XMAN Studio pushes each
 * node's endpoint (`{relay}/w/{workerId}`) and tunnel token to
 * POST /api/gpux/nodes, and GpuWorkerManager.reconcileCommunity asks the node
 * itself, through that endpoint with the row's own token, whether it can take
 * work (`/aixman/ready`). Neither needs the relay's admin key: the pool works
 * end to end without one. The key, stored as this vendor's account-pool row,
 * only buys the admin pages a live list of who is connected (`/admin/workers`).
 */
import type {
  GpuBalance,
  GpuInstance,
  GpuOffer,
  GpuOfferFilter,
  GpuRentSpec,
  GpuRentalProvider,
} from './types';
import { vendorFetch } from './vendor-http';

/**
 * The relay deployed on 2026-09-18 (GpuXmine docs/RELAY-DEPLOY.md). Overridable
 * so staging can point at its own. The endpoints of community rows come from
 * XMAN Studio, not from here — this is read only for the admin list and the
 * health check, so a wrong value here cannot misroute a job.
 */
const DEFAULT_RELAY_URL = 'https://relay.xman4289.com:8443';

export function relayBaseUrl(): string {
  return (process.env.GPUXMINE_RELAY_URL || DEFAULT_RELAY_URL).replace(/\/+$/, '');
}

/** One relay listing serves every caller for this long (the admin page, a health check, a sweep). */
const LIST_TTL_MS = 20_000;
let listCache: { key: string; at: number; workers: Promise<GpuInstance[]> } | null = null;

interface RelayWorker {
  workerId: string;
  label?: string | null;
  online: boolean;
  agentVersion?: string | null;
  connectedAt?: string | null;
  telemetry?: {
    gpuName?: string | null;
    vramTotalMb?: number;
    gpuLoadPct?: number;
    accepting?: boolean;
  } | null;
}

function toInstance(worker: RelayWorker): GpuInstance {
  return {
    id: worker.workerId,
    // The orphan sweep terminates only what it can positively identify as ours.
    // Naming them keeps that contract even though terminate() is a no-op here.
    name: `gpuxmine-${worker.workerId}`,
    status: worker.online ? 'running' : 'stopped',
    endpoints: { 8189: `${relayBaseUrl()}/w/${worker.workerId}` },
    pricePerHourUsd: 0,
    gpuModel: worker.telemetry?.gpuName ?? undefined,
    gpuCount: 1,
    gpuMemoryMb: worker.telemetry?.vramTotalMb,
    createdAt: worker.connectedAt ? new Date(worker.connectedAt) : undefined,
    statusMessage: worker.online ? undefined : 'node offline',
  };
}

/**
 * The relay's unauthenticated liveness endpoint (`GET /healthz` →
 * `{ok, online, utc}`), for the admin health check. Never throws.
 */
export async function relayHealth(timeoutMs = 8_000): Promise<{ reachable: boolean; online?: number; detail?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${relayBaseUrl()}/healthz`, { signal: controller.signal, cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as { ok?: unknown; online?: unknown } | null;
    if (!res.ok) return { reachable: false, detail: `HTTP ${res.status}` };
    return { reachable: true, online: typeof body?.online === 'number' ? body.online : undefined };
  } catch (error) {
    return { reachable: false, detail: (error as Error).message.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export class GpuxMineProvider implements GpuRentalProvider {
  readonly slug = 'gpuxmine' as const;
  readonly label = 'GPUxMINE (เครื่องชุมชน)';
  readonly exposure = 'pool-relay' as const;
  /** Optional: the relay's admin key, for the admin list only (see the header). */
  readonly credential = 'api-key' as const;

  /** Community machines are not rented, so they are never offered. */
  async findOffers(_filter: GpuOfferFilter, _apiKey: string): Promise<GpuOffer[]> {
    return [];
  }

  async rent(_spec: GpuRentSpec, _apiKey: string): Promise<GpuInstance> {
    throw new Error('GPUxMINE nodes enlist themselves — they cannot be rented');
  }

  async getInstance(id: string, apiKey: string): Promise<GpuInstance | null> {
    const workers = await this.fetchWorkers(apiKey);
    return workers.find((w) => w.id === id) ?? null;
  }

  /**
   * Nothing to destroy: the machine is somebody's PC and goes on existing.
   * Idempotent by construction, as the interface requires.
   */
  async terminate(_id: string, _apiKey: string): Promise<void> {
    return;
  }

  async listInstances(apiKey: string): Promise<GpuInstance[]> {
    return this.fetchWorkers(apiKey);
  }

  /**
   * There is no balance to run out of — community capacity is paid for per
   * completed job, out of the job's own revenue, not out of a prepaid vendor
   * account. Infinity is how this interface says "never blocked on funds";
   * the balance readers leave `pool-relay` vendors out of their totals so it
   * cannot mask a rented vendor running dry.
   */
  async getBalance(_apiKey: string): Promise<GpuBalance> {
    return { balanceUsd: Number.POSITIVE_INFINITY };
  }

  /**
   * The relay's full worker list, shared for LIST_TTL_MS: callers that ask per
   * node would otherwise fetch the whole fleet once per node.
   */
  private fetchWorkers(apiKey: string): Promise<GpuInstance[]> {
    const now = Date.now();
    const key = `${relayBaseUrl()}|${apiKey}`;
    if (listCache && listCache.key === key && now - listCache.at < LIST_TTL_MS) return listCache.workers;
    const workers = vendorFetch<RelayWorker[]>('gpuxmine', `${relayBaseUrl()}/admin/workers`, {
      headers: { 'X-Admin-Key': apiKey },
      timeoutMs: 15_000,
    }).then((list) => (list ?? []).map(toInstance));
    listCache = { key, at: now, workers };
    // A failed read must not be served to the next caller.
    workers.catch(() => {
      if (listCache?.workers === workers) listCache = null;
    });
    return workers;
  }
}
