import { createHash } from 'crypto';
import {
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
  /** Host CUDA version as a string, e.g. "13.3". Filtered on client-side. */
  gpuCudaVer?: string;
  /** Disk rate, USD per GB per month (see GpuOffer.diskPricePerGbMonthUsd). */
  pricePerDiskSize?: number;
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
    // `gpuCudaVer` + `gpuCudaVerOperator=>=` is deliberately NOT sent. It does
    // not do a version comparison: asked for `>= 12.8` the marketplace returned
    // 0 rows, `>= 13.0` returned 34 — the same 34 whose own `gpuCudaVer` reads
    // 13.0. A looser floor returning fewer rows is backwards, so the parameter
    // behaves like an equality match on something we cannot see.
    //
    // Sending it meant every catalogue entry (they all inherit
    // DEFAULT_MIN_CUDA) found an empty market and reported
    // "No RTX 5090/RTX 4090/RTX PRO 6000 GPU available under $X/hr" — a phantom
    // shortage that reads like the market's fault. The floor is enforced below
    // instead, where the number we compare is the one the host reported.
    //
    // The price filter only accepts whole dollars, so it too can only be a
    // coarse pre-filter — the exact ceiling is enforced client-side below.
    if (filter.maxPricePerHourUsd) {
      qs.set('pricePerGpu[lte]', String(Math.max(1, Math.ceil(filter.maxPricePerHourUsd))));
    }

    const rows = await this.call<MarketRow[]>(apiKey, `/instances/market/list?${qs.toString()}`);
    if (!Array.isArray(rows)) return [];

    const models = filter.gpuModels?.map((m) => m.toLowerCase().trim()).filter(Boolean);
    const minCuda = parseCudaVersion(filter.minCudaVersion);

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
        cudaVersion: typeof r.gpuCudaVer === 'string' ? r.gpuCudaVer : undefined,
        diskPricePerGbMonthUsd: typeof r.pricePerDiskSize === 'number' ? r.pricePerDiskSize : undefined,
      }))
      .filter((o) => {
        if (o.pricePerHourUsd <= 0) return false;
        if (filter.maxPricePerHourUsd && o.pricePerHourUsd > filter.maxPricePerHourUsd) return false;
        if (filter.minGpuMemoryMb && o.gpuMemoryMb < filter.minGpuMemoryMb) return false;
        if (filter.minDiskGb && o.diskGb < filter.minDiskGb) return false;
        if (models?.length && !models.some((m) => o.gpuModel.toLowerCase().includes(m))) return false;
        if (minCuda) {
          const hostCuda = parseCudaVersion(o.cudaVersion);
          // A host that does not report its CUDA version is kept. Dropping it
          // would silently shrink the market on missing metadata, which is the
          // failure this whole block exists to undo.
          if (hostCuda && compareCudaVersions(hostCuda, minCuda) < 0) return false;
        }
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
   * by re-listing and matching on name. The name therefore carries a hash of
   * everything the template pins — image, tag, disk, ports, boot script — so a
   * change to any of them gets a fresh template instead of silently reusing
   * one that boots last month's image.
   *
   * The template never holds the worker's bearer token: it outlives the
   * machine, and the per-rental script and env are sent with each order.
   */
  private async ensureTemplate(spec: GpuRentSpec, apiKey: string): Promise<string> {
    const script = spec.templateStartScript ?? '';
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([spec.image, spec.imageTag, spec.diskGb, spec.exposePorts, spec.registry?.host ?? '', script])
      )
      .digest('hex')
      .slice(0, 10);
    const name = `${spec.nameTag}-${fingerprint}`;

    const existing = await this.findTemplateByName(name, apiKey);
    if (existing) return `/instances/templates/${existing}`;

    const body: Record<string, unknown> = {
      name,
      imageName: spec.image,
      defaultTag: spec.imageTag,
      categoryName: 'aixman',
      diskSize: spec.diskGb,
      exposePorts: spec.exposePorts.join(','),
      startScript: asSingleLine(script),
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
    const beforeRows = await this.listInstanceRows(apiKey);
    const before = new Set(beforeRows.map((r) => r.id).filter((id) => id != null).map(String));
    const pending: PendingRental = { before: [...before], at: Date.now(), nameTag: spec.nameTag };

    const body: Record<string, unknown> = {
      gpuCount: spec.gpuCount,
      instanceMarket: spec.offer.marketRef,
      instanceTemplate,
      startScript: asSingleLine(spec.startScript || ''),
    };
    if (spec.env && Object.keys(spec.env).length > 0) {
      body.envVariables = Object.entries(spec.env).map(([k, v]) => ({ name: k, value: v }));
    }

    try {
      await this.call(apiKey, '/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // A 4xx is a refusal — nothing was rented. Anything else (timeout, 502
      // from the vendor's edge) may have been processed anyway, so look for
      // the machine before deciding.
      if (/→ 4dd/.test((error as Error).message)) throw error;
      console.warn('[gpu] rent request did not complete cleanly, checking whether it went through:', (error as Error).message);
    }

    const deadline = Date.now() + RENT_SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      let rows: InstanceRow[];
      try {
        rows = await this.listInstanceRows(apiKey);
      } catch (error) {
        // The list endpoint fails intermittently (502s in production logs).
        // One bad poll must not abandon a machine that is already billing.
        console.warn('[gpu] instance list failed while confirming a rental, retrying:', (error as Error).message);
        await sleep(RENT_SETTLE_INTERVAL_MS);
        continue;
      }
      const fresh = rows.find((r) => r.id != null && !before.has(String(r.id)));
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

    throw new RentUnconfirmedError(
      `SimplePod may have accepted the rental but no new instance appeared within ${RENT_SETTLE_TIMEOUT_MS / 1000}s. ` +
        'It will be tagged and swept on the next ticks.',
      pending
    );
  }

  /**
   * Tag whatever an unconfirmed rental produced so the orphan sweep can kill it.
   *
   * Tagging marks a machine for termination, so this errs hard toward not
   * touching one: only an instance absent from the pre-order snapshot, created
   * within minutes of the order, qualifies — and only the first such, since one
   * order makes one machine. Someone renting by hand on the same account later
   * in the day is outside the window; an instance with no creation time is
   * never assumed to be ours.
   */
  async adoptUnconfirmed(pending: PendingRental, apiKey: string): Promise<number> {
    const before = new Set(pending.before);
    const rows = await this.listInstanceRows(apiKey);
    const windowStart = pending.at - 60_000; // vendor clock skew
    const windowEnd = pending.at + RENT_SETTLE_TIMEOUT_MS + 5 * 60_000;

    const candidates = rows
      .filter((row) => row.id != null && !before.has(String(row.id)))
      .map((row) => ({ row, created: row.createdAt ? new Date(row.createdAt).getTime() : NaN }))
      .filter(({ created }) => Number.isFinite(created) && created >= windowStart && created <= windowEnd)
      .sort((a, b) => a.created - b.created);

    const first = candidates[0]?.row;
    if (!first) return 0;
    // Already carries our tag (the rename landed after all): nothing to do.
    if (first.name?.startsWith(pending.nameTag)) return 1;
    await this.rename(String(first.id), pending.nameTag, apiKey);
    return 1;
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

/**
 * Where the boot script is written inside the container. The script creates
 * its own working directory; this only needs a location that exists before
 * anything has run, so it sits at the top of the image's workspace.
 */
const BOOT_SCRIPT_PATH = '/workspace/aixman-boot.sh';

/**
 * Turn a multi-line script into the single command SimplePod can run.
 *
 * SimplePod runs a start script one line at a time, not as a script: its own
 * Ollama template is `ollama serve` then `ollama run …`, which only works if
 * line one is not blocking line two. Found on the first real rental — our
 * 13 KB bash script arrived as hundreds of unrelated commands (functions,
 * heredocs and the supervisor loop all broken), nothing started, and the
 * machine sat idle while billing.
 *
 * So the script travels base64-encoded in one line that writes it to a file
 * and runs it with bash. base64 needs no quoting in any POSIX shell.
 */
export function asSingleLine(script: string): string {
  if (!script.includes('\n')) return script;
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  return (
    `mkdir -p /workspace && echo ${encoded} | base64 -d > ${BOOT_SCRIPT_PATH} ` +
    `&& exec bash ${BOOT_SCRIPT_PATH}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Split a CUDA version into numeric components, or null if it is not a version.
 *
 * Kept as a tuple rather than a float because `parseFloat` puts 12.10 *below*
 * 12.9, and CUDA minor versions do reach double digits.
 */
export function parseCudaVersion(raw: string | undefined | null): number[] | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split('.').map((p) => Number.parseInt(p, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts;
}

/** Standard version ordering: negative if `a` is older than `b`. */
export function compareCudaVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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

/** A published address that is actually usable, not "closed" / "checking". */
function liveUrl(entry: Record<string, unknown>): string | null {
  const protocol = typeof entry.protocol === 'string' ? entry.protocol : '';
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (!/^https?$/.test(protocol) || !/^https?:\/\//.test(url)) return null;
  return url.replace(/\/+$/, '');
}

/**
 * Normalise SimplePod's port mapping into `{ internalPort: publicUrl }`.
 *
 * What the instance detail actually returns (seen on the first real rental,
 * 2026-09-12) is two lists keyed by `srcPort`, the container-side port:
 *   { direct: [{ srcPort: 8189, protocol: "http",  url: "http://ip:58610" }],
 *     proxy:  [{ srcPort: 8189, protocol: "https", url: "https://….trycloudflare.com" }] }
 * `protocol` reads "checking" / "closed" until something listens. The earlier
 * parser only knew an object keyed by port, so every worker got no endpoint,
 * sat "warming" until the timeout and was killed — nothing could ever render.
 *
 * The documented object shape and a bare array are still accepted. A Cloudflare
 * tunnel URL always wins over a bare host:port.
 */
export function parsePorts(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!raw || typeof raw !== 'object') return out;

  const grouped = raw as { direct?: unknown; proxy?: unknown };
  if (Array.isArray(grouped.direct) || Array.isArray(grouped.proxy)) {
    // Tunnel first so it takes the slot; direct only fills ports it left empty.
    for (const list of [grouped.proxy, grouped.direct]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const entry = (item || {}) as Record<string, unknown>;
        const port = firstNumber(entry.srcPort);
        const url = liveUrl(entry);
        if (port != null && url && !out[port]) out[port] = url;
      }
    }
    return out;
  }

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
