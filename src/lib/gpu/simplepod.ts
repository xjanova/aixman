import type {
  GpuBalance,
  GpuInstance,
  GpuInstanceStatus,
  GpuOffer,
  GpuOfferFilter,
  GpuProviderSlug,
  GpuRentSpec,
  GpuRentalProvider,
} from './types';

const DEFAULT_BASE_URL = 'https://api.simplepod.ai';
const REQUEST_TIMEOUT_MS = 30_000;
/** How long to wait for a freshly rented instance to appear in /instances/list. */
const RENT_SETTLE_TIMEOUT_MS = 90_000;
const RENT_SETTLE_INTERVAL_MS = 3_000;

/** Shape of a marketplace row. Only fields we actually read are typed. */
interface MarketRow {
  id?: number;
  instanceMarket?: string;
  gpuModel?: string;
  gpuCount?: number;
  gpuMemorySize?: number;
  cpuCoreCount?: number;
  systemMemory?: number;
  diskSize?: number;
  pricePerGpu?: number;
  sla?: number;
  downloadSpeedtest?: number;
  rentalStatus?: string;
  isAvailableForDemand?: boolean;
}

interface InstanceRow {
  id?: number;
  supportId?: string;
  name?: string;
  status?: string;
  gpuModel?: string;
  gpuCount?: number;
  gpuMemorySize?: number;
  pricePerGpu?: number;
  createdAt?: string;
  errors?: unknown;
  warnings?: unknown;
  ports?: unknown;
  portMappings?: unknown;
  exposePortMappings?: unknown;
}

interface TemplateRow {
  id?: number;
  name?: string;
}

/**
 * SimplePod.ai — GPU rental marketplace.
 *
 * IMPORTANT: SimplePod does not run models. It rents a machine and boots a
 * Docker image; each exposed port is published both directly (host IP) and
 * through a Cloudflare tunnel (HTTPS). We always prefer the tunnel URL because
 * the app calls it from a browser-adjacent server context and mixed content /
 * bare IPs are a liability.
 *
 * Docs: https://api.simplepod.ai/docs_ai.html
 */
export class SimplePodProvider implements GpuRentalProvider {
  readonly slug: GpuProviderSlug = 'simplepod';

  private baseUrl(): string {
    return process.env.SIMPLEPOD_BASE_URL || DEFAULT_BASE_URL;
  }

  private async call<T>(
    apiKey: string,
    path: string,
    init: RequestInit & { timeout?: number } = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeout ?? REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        headers: {
          'X-AUTH-TOKEN': apiKey,
          Accept: 'application/json',
          ...(init.headers || {}),
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (res.status === 204) return undefined as T;

      const text = await res.text();
      if (!res.ok) {
        // Never echo the body verbatim to callers that might surface it to end
        // users — it can carry account details. Callers log it server-side.
        const detail = this.extractError(text);
        throw new Error(`SimplePod ${init.method || 'GET'} ${path} → ${res.status}${detail ? `: ${detail}` : ''}`);
      }

      return (text ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractError(body: string): string {
    try {
      const parsed = JSON.parse(body) as { detail?: string; title?: string; message?: string };
      return (parsed.detail || parsed.title || parsed.message || '').slice(0, 300);
    } catch {
      return body.slice(0, 300);
    }
  }

  // ----------------------------------------------------------------
  // Marketplace
  // ----------------------------------------------------------------

  async findOffers(filter: GpuOfferFilter, apiKey: string): Promise<GpuOffer[]> {
    const qs = new URLSearchParams({
      rentalStatus: 'active',
      'order[pricePerGpu]': 'asc',
    });

    if (filter.minGpuMemoryMb) qs.set('gpuMemorySize[gte]', String(filter.minGpuMemoryMb));
    if (filter.minDiskGb) qs.set('diskSize[gte]', String(filter.minDiskGb));
    if (filter.minCpuCores) qs.set('cpuCoreCount[gte]', String(filter.minCpuCores));
    if (filter.minSystemMemoryMb) qs.set('systemMemory[gte]', String(filter.minSystemMemoryMb));
    if (filter.minDownloadMbps) qs.set('downloadSpeedtest[gte]', String(Math.floor(filter.minDownloadMbps)));
    if (filter.minReliability) qs.set('sla[gte]', String(Math.floor(filter.minReliability)));
    if (filter.region) qs.set('region', filter.region);
    if (filter.gpuCount) qs.set('gpuCount[gte]', String(filter.gpuCount));
    if (filter.minCudaVersion) {
      qs.set('gpuCudaVer', filter.minCudaVersion);
      qs.set('gpuCudaVerOperator', '>=');
    }
    // The price filter only accepts whole dollars, so it can only be a coarse
    // pre-filter — the exact ceiling is enforced client-side below.
    if (filter.maxPricePerHourUsd) {
      qs.set('pricePerGpu[lte]', String(Math.max(1, Math.ceil(filter.maxPricePerHourUsd))));
    }

    const rows = await this.call<MarketRow[]>(apiKey, `/instances/market/list?${qs.toString()}`);
    if (!Array.isArray(rows)) return [];

    const models = filter.gpuModels?.map((m) => m.toLowerCase().trim()).filter(Boolean);

    return rows
      .filter((r) => r.instanceMarket && r.isAvailableForDemand !== false)
      .map<GpuOffer>((r) => ({
        id: String(r.id ?? r.instanceMarket),
        marketRef: r.instanceMarket as string,
        gpuModel: r.gpuModel || 'unknown',
        gpuCount: r.gpuCount ?? 1,
        gpuMemoryMb: r.gpuMemorySize ?? 0,
        cpuCores: r.cpuCoreCount ?? 0,
        systemMemoryMb: r.systemMemory ?? 0,
        diskGb: r.diskSize ?? 0,
        pricePerHourUsd: Number(r.pricePerGpu ?? 0),
        reliability: r.sla,
        downloadMbps: r.downloadSpeedtest,
      }))
      .filter((o) => {
        if (o.pricePerHourUsd <= 0) return false;
        if (filter.maxPricePerHourUsd && o.pricePerHourUsd > filter.maxPricePerHourUsd) return false;
        if (filter.minGpuMemoryMb && o.gpuMemoryMb < filter.minGpuMemoryMb) return false;
        if (filter.minDiskGb && o.diskGb < filter.minDiskGb) return false;
        if (models?.length && !models.some((m) => o.gpuModel.toLowerCase().includes(m))) return false;
        return true;
      })
      .sort((a, b) => a.pricePerHourUsd - b.pricePerHourUsd);
  }

  // ----------------------------------------------------------------
  // Templates
  // ----------------------------------------------------------------

  /**
   * Find-or-create the private template that describes our container.
   *
   * `POST /instances/templates` returns an empty body, so the id is recovered
   * by re-listing and matching on name. Template names are therefore treated as
   * unique keys and must be stable per image+config.
   */
  private async ensureTemplate(spec: GpuRentSpec, apiKey: string): Promise<string> {
    const name = spec.nameTag;

    const existing = await this.findTemplateByName(name, apiKey);
    if (existing) return `/instances/templates/${existing}`;

    const body: Record<string, unknown> = {
      name,
      imageName: spec.image,
      defaultTag: spec.imageTag,
      categoryName: 'aixman',
      diskSize: spec.diskGb,
      exposePorts: spec.exposePorts.join(','),
      startScript: spec.startScript || '',
      notes: 'Managed by AIXMAN. Deleting this template does not stop running instances.',
      isPasswordProtected: Boolean(spec.registry),
      isRunSshServerOn: false,
      isRunJupyterOn: false,
    };

    if (spec.registry) {
      body.host = spec.registry.host;
      body.username = spec.registry.username;
      body.password = spec.registry.password;
    }
    if (spec.env && Object.keys(spec.env).length > 0) {
      body.envVariables = Object.entries(spec.env).map(([k, v]) => ({ name: k, value: v }));
    }

    await this.call(apiKey, '/instances/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const created = await this.findTemplateByName(name, apiKey);
    if (!created) {
      throw new Error(`SimplePod template "${name}" was created but could not be found afterwards`);
    }
    return `/instances/templates/${created}`;
  }

  private async findTemplateByName(name: string, apiKey: string): Promise<number | null> {
    const rows = await this.call<TemplateRow[]>(
      apiKey,
      `/instances/templates/list?itemsPerPage=100&search=${encodeURIComponent(name)}`
    );
    if (!Array.isArray(rows)) return null;
    const hit = rows.find((r) => r.name === name && typeof r.id === 'number');
    return hit?.id ?? null;
  }

  // ----------------------------------------------------------------
  // Instances
  // ----------------------------------------------------------------

  async rent(spec: GpuRentSpec, apiKey: string): Promise<GpuInstance> {
    const instanceTemplate = await this.ensureTemplate(spec, apiKey);

    // `POST /instances` returns an empty body, so the new instance is identified
    // by diffing the instance list before and after. Snapshot first.
    const before = new Set((await this.listInstanceRows(apiKey)).map((r) => r.id).filter(Boolean));

    const body: Record<string, unknown> = {
      gpuCount: spec.gpuCount,
      instanceMarket: spec.offer.marketRef,
      instanceTemplate,
      startScript: spec.startScript || '',
    };
    if (spec.env && Object.keys(spec.env).length > 0) {
      body.envVariables = Object.entries(spec.env).map(([k, v]) => ({ name: k, value: v }));
    }

    await this.call(apiKey, '/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const deadline = Date.now() + RENT_SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const rows = await this.listInstanceRows(apiKey);
      const fresh = rows.find((r) => r.id != null && !before.has(r.id));
      if (fresh) {
        const id = String(fresh.id);
        // Name it so an orphan sweep (or a human in the SimplePod console) can
        // tell at a glance that AIXMAN owns this machine. Best-effort: the
        // database row is the primary record, but a failure here removes our
        // backstop, so it must be visible in the logs rather than swallowed.
        let name = fresh.name;
        try {
          await this.rename(id, spec.nameTag, apiKey);
          name = spec.nameTag;
        } catch (error) {
          console.error(
            `[gpu] instance ${id} could not be tagged "${spec.nameTag}"; the orphan sweep ` +
              'will not be able to identify it if its database row is lost:',
            (error as Error).message
          );
        }
        return { ...this.mapInstance(fresh, spec.offer.pricePerHourUsd), name };
      }
      await sleep(RENT_SETTLE_INTERVAL_MS);
    }

    // The rental may still have succeeded — we simply can't identify it. Say so
    // loudly: the caller must trigger an orphan sweep rather than silently retry.
    throw new Error(
      'SimplePod accepted the rental but no new instance appeared within 90s. ' +
        'Run an orphan sweep before renting again to avoid paying for a machine we lost track of.'
    );
  }

  private async rename(id: string, name: string, apiKey: string): Promise<void> {
    await this.call(apiKey, `/instances/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  private async listInstanceRows(apiKey: string): Promise<InstanceRow[]> {
    const rows = await this.call<InstanceRow[]>(apiKey, '/instances/list?itemsPerPage=200');
    return Array.isArray(rows) ? rows : [];
  }

  async listInstances(apiKey: string): Promise<GpuInstance[]> {
    const rows = await this.listInstanceRows(apiKey);
    return rows.map((r) => this.mapInstance(r));
  }

  async getInstance(id: string, apiKey: string): Promise<GpuInstance | null> {
    try {
      const row = await this.call<InstanceRow>(apiKey, `/instances/${id}`);
      if (!row || row.id == null) return null;
      return this.mapInstance(row);
    } catch (error) {
      if (/→ 404/.test((error as Error).message)) return null;
      throw error;
    }
  }

  async terminate(id: string, apiKey: string): Promise<void> {
    try {
      await this.call(apiKey, `/instances/${id}`, { method: 'DELETE' });
    } catch (error) {
      // Already gone is the desired end state, not a failure. Anything else must
      // propagate — a swallowed error here means a machine bills forever.
      if (/→ 404/.test((error as Error).message)) return;
      throw error;
    }
  }

  async getBalance(apiKey: string): Promise<GpuBalance> {
    const summary = await this.call<{
      rentalAvailability?: { balanceRental?: number; availableRentalHours?: number };
    }>(apiKey, '/instances/summary');

    return {
      balanceUsd: Number(summary?.rentalAvailability?.balanceRental ?? 0),
      availableRentalHours: summary?.rentalAvailability?.availableRentalHours,
    };
  }

  // ----------------------------------------------------------------
  // Mapping
  // ----------------------------------------------------------------

  private mapInstance(row: InstanceRow, fallbackPrice?: number): GpuInstance {
    const messages = [...toStringArray(row.errors), ...toStringArray(row.warnings)];

    return {
      id: String(row.id),
      supportId: row.supportId,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : undefined,
      status: mapStatus(row.status, messages.length > 0),
      endpoints: parsePorts(row.ports ?? row.portMappings ?? row.exposePortMappings),
      pricePerHourUsd: Number(row.pricePerGpu ?? fallbackPrice ?? 0),
      gpuModel: row.gpuModel,
      gpuCount: row.gpuCount,
      gpuMemoryMb: row.gpuMemorySize,
      createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
      statusMessage: messages.length > 0 ? messages.join('; ').slice(0, 500) : undefined,
    };
  }
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function mapStatus(raw: string | undefined, hasErrors: boolean): GpuInstanceStatus {
  const status = (raw || '').toLowerCase();
  if (['active', 'running', 'ready'].includes(status)) return 'running';
  if (['created', 'creating', 'pending', 'starting', 'provisioning', 'queued'].includes(status)) {
    return 'provisioning';
  }
  if (['error', 'failed', 'unavailable'].includes(status)) return 'error';
  if (['paused', 'stopped', 'deleted', 'removed', 'expired'].includes(status)) return 'stopped';
  // Unknown status with vendor-reported errors is treated as broken so the
  // worker manager reaps it instead of waiting out the full warmup timeout.
  return hasErrors ? 'error' : 'provisioning';
}

/**
 * Normalise SimplePod's port mapping into `{ internalPort: publicUrl }`.
 *
 * The documented container-side shape is an object keyed by internal port:
 *   { "20000": { protocol, proxyProtocol, proxyUrl, service } }
 * but list/detail responses have been observed carrying an array instead, so
 * both are accepted. A Cloudflare tunnel URL always wins over a bare host:port.
 */
export function parsePorts(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!raw || typeof raw !== 'object') return out;

  const entries: Array<[string | undefined, Record<string, unknown>]> = Array.isArray(raw)
    ? raw.map((v) => [undefined, (v || {}) as Record<string, unknown>])
    : Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
        k,
        (v || {}) as Record<string, unknown>,
      ]);

  for (const [key, value] of entries) {
    if (typeof value !== 'object') continue;

    const internal = firstNumber(
      key,
      value.internalPort,
      value.containerPort,
      value.port,
      value.privatePort
    );
    if (internal == null) continue;

    const proxyUrl = typeof value.proxyUrl === 'string' ? value.proxyUrl : undefined;
    if (proxyUrl) {
      out[internal] = proxyUrl.replace(/\/+$/, '');
      continue;
    }

    const host = firstString(value.ip, value.host, value.hostIp, value.publicIp);
    const external = firstNumber(value.externalPort, value.hostPort, value.publicPort, value.mappedPort);
    if (host && external != null) {
      const scheme = typeof value.protocol === 'string' && value.protocol === 'https' ? 'https' : 'http';
      out[internal] = `${scheme}://${host}:${external}`;
    }
  }

  return out;
}

function firstNumber(...values: unknown[]): number | null {
  for (const v of values) {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
