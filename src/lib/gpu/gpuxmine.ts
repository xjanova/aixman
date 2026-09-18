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
 * The credential is the relay's admin key, which is only needed to *read* who
 * is online. Without one the pool still works end to end; the admin pages just
 * cannot show live presence.
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

/** Where the relay lives. Overridable so staging can point at its own. */
const RELAY_BASE = (process.env.GPUXMINE_RELAY_URL || 'https://relay.gpuxmine.com').replace(/\/+$/, '');

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
    endpoints: { 8189: `${RELAY_BASE}/w/${worker.workerId}` },
    pricePerHourUsd: 0,
    gpuModel: worker.telemetry?.gpuName ?? undefined,
    gpuCount: 1,
    gpuMemoryMb: worker.telemetry?.vramTotalMb,
    createdAt: worker.connectedAt ? new Date(worker.connectedAt) : undefined,
    statusMessage: worker.online ? undefined : 'node offline',
  };
}

export class GpuxMineProvider implements GpuRentalProvider {
  readonly slug = 'gpuxmine' as const;
  readonly label = 'GPUxMINE (เครื่องชุมชน)';
  readonly exposure = 'pool-relay' as const;
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
   * account. Infinity is how this interface says "never blocked on funds".
   */
  async getBalance(_apiKey: string): Promise<GpuBalance> {
    return { balanceUsd: Number.POSITIVE_INFINITY };
  }

  private async fetchWorkers(apiKey: string): Promise<GpuInstance[]> {
    const workers = await vendorFetch<RelayWorker[]>('gpuxmine', `${RELAY_BASE}/admin/workers`, {
      headers: { 'X-Admin-Key': apiKey },
      timeoutMs: 15_000,
    });
    return (workers ?? []).map(toInstance);
  }
}
