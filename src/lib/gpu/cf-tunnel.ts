/**
 * Named Cloudflare Tunnels for tunnel-mode workers (GpuExposure 'tunnel').
 *
 * Without this, a worker opens a *quick* tunnel (`*.trycloudflare.com`): a URL
 * nobody knows until cloudflared prints it, which the worker then has to post
 * back to us. Every link of that chain has failed silently at least once
 * (a dropped env, a WAF refusing urllib, cloudflared never downloading), and
 * Cloudflare itself documents quick tunnels as for testing, without uptime.
 *
 * Here the tunnel is created through the API *before* the machine is rented:
 * its hostname is known up front and written as the worker's endpoint, and the
 * worker only has to run `cloudflared tunnel run` with the token it was booted
 * with. There is nothing to report back.
 *
 * Configured by env (all four, or quick tunnels are used as before):
 *   CF_TUNNEL_ACCOUNT_ID  account that owns the tunnels
 *   CF_TUNNEL_API_TOKEN   token with Account › Cloudflare Tunnel › Edit and
 *                         Zone › DNS › Edit on CF_TUNNEL_ZONE_ID
 *   CF_TUNNEL_ZONE_ID     zone the worker hostnames live in
 *   CF_TUNNEL_DOMAIN      that zone's name: hostnames are one label under it
 *                         (`aixman-gpu-<hex>.<domain>`), which Universal SSL
 *                         covers; a deeper name would need its own certificate
 *
 * Every tunnel and DNS record is named with `TUNNEL_PREFIX`, so the orphan
 * sweep can tell ours from anything else in the account.
 */

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 20_000;

/** Tunnel names and hostname labels we own. Never use it for anything else. */
export const TUNNEL_PREFIX = 'aixman-gpu-';

export interface NamedTunnelConfig {
  accountId: string;
  apiToken: string;
  zoneId: string;
  domain: string;
}

/** What a worker row keeps in `metadata.namedTunnel` to clean up after itself. */
export interface NamedTunnel {
  tunnelId: string;
  dnsRecordId: string;
  hostname: string;
}

export interface CreatedTunnel extends NamedTunnel {
  /** The connector token. Secret: whoever holds it can serve this hostname. */
  token: string;
}

export function namedTunnelConfig(): NamedTunnelConfig | null {
  const accountId = process.env.CF_TUNNEL_ACCOUNT_ID?.trim();
  const apiToken = process.env.CF_TUNNEL_API_TOKEN?.trim();
  const zoneId = process.env.CF_TUNNEL_ZONE_ID?.trim();
  const domain = process.env.CF_TUNNEL_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!accountId || !apiToken || !zoneId || !domain) return null;
  return { accountId, apiToken, zoneId, domain };
}

/** Read a row's `metadata.namedTunnel`, or null when it used a quick tunnel. */
export function readNamedTunnel(metadata: unknown): NamedTunnel | null {
  const raw = (metadata as { namedTunnel?: unknown } | null)?.namedTunnel as Partial<NamedTunnel> | undefined;
  if (!raw || typeof raw.tunnelId !== 'string' || typeof raw.hostname !== 'string') return null;
  return { tunnelId: raw.tunnelId, dnsRecordId: typeof raw.dnsRecordId === 'string' ? raw.dnsRecordId : '', hostname: raw.hostname };
}

interface CfEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
  result_info?: { page?: number; total_pages?: number };
}

class CfError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function cf<T>(cfg: NamedTunnelConfig, method: string, path: string, body?: unknown): Promise<CfEnvelope<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
    if (!res.ok || !data?.success) {
      const reason = data?.errors?.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ') || `HTTP ${res.status}`;
      throw new CfError(`Cloudflare ${method} ${path.split('?')[0]}: ${reason}`, res.status);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** A delete of something already gone is a success. */
async function cfDelete(cfg: NamedTunnelConfig, path: string): Promise<void> {
  try {
    await cf(cfg, 'DELETE', path);
  } catch (error) {
    if (error instanceof CfError && error.status === 404) return;
    throw error;
  }
}

/**
 * Create a tunnel whose only route is `hostname → 127.0.0.1:<port>` on the
 * worker, plus the proxied CNAME that points the hostname at it. Anything
 * created before a failure is removed again before the error is thrown.
 */
export async function createWorkerTunnel(cfg: NamedTunnelConfig, label: string, port: number): Promise<CreatedTunnel> {
  if (!label.startsWith(TUNNEL_PREFIX) || !/^[a-z0-9-]{1,63}$/.test(label)) {
    throw new Error(`Invalid tunnel label: ${label}`);
  }
  const hostname = `${label}.${cfg.domain}`;
  const acct = `/accounts/${cfg.accountId}/cfd_tunnel`;

  const created = await cf<{ id: string; token?: string }>(cfg, 'POST', acct, { name: label, config_src: 'cloudflare' });
  const tunnelId = created.result?.id;
  if (!tunnelId) throw new Error('Cloudflare created a tunnel but returned no id');

  let dnsRecordId = '';
  try {
    const token =
      created.result?.token || (await cf<string>(cfg, 'GET', `${acct}/${tunnelId}/token`)).result || '';
    if (!token) throw new Error('Cloudflare returned no connector token for the tunnel');

    await cf(cfg, 'PUT', `${acct}/${tunnelId}/configurations`, {
      config: {
        ingress: [
          { hostname, service: `http://127.0.0.1:${port}` },
          // Required catch-all: anything else asked of this tunnel is refused.
          { service: 'http_status:404' },
        ],
      },
    });

    const record = await cf<{ id: string }>(cfg, 'POST', `/zones/${cfg.zoneId}/dns_records`, {
      type: 'CNAME',
      name: hostname,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
      comment: 'aixman rented GPU worker (deleted with the machine)',
    });
    dnsRecordId = record.result?.id ?? '';
    if (!dnsRecordId) throw new Error('Cloudflare created a DNS record but returned no id');

    return { tunnelId, dnsRecordId, hostname, token };
  } catch (error) {
    await deleteWorkerTunnel(cfg, { tunnelId, dnsRecordId, hostname }).catch((cleanup) => {
      console.error(`[gpu] could not remove half-created tunnel ${tunnelId}:`, (cleanup as Error).message);
    });
    throw error;
  }
}

/**
 * Remove a worker's DNS record and tunnel. Idempotent. Live connections are
 * cleared first: Cloudflare refuses to delete a tunnel that still has any, and
 * a vendor's "terminated" can precede the connector actually going away.
 */
export async function deleteWorkerTunnel(cfg: NamedTunnelConfig, tunnel: NamedTunnel): Promise<void> {
  if (tunnel.dnsRecordId) await cfDelete(cfg, `/zones/${cfg.zoneId}/dns_records/${tunnel.dnsRecordId}`);
  const path = `/accounts/${cfg.accountId}/cfd_tunnel/${tunnel.tunnelId}`;
  await cfDelete(cfg, `${path}/connections`);
  await cfDelete(cfg, path);
}

/**
 * Remove every tunnel and DNS record of ours that no live worker claims.
 * Only names starting with `TUNNEL_PREFIX` are ever touched, and only ones
 * older than `graceMs` — a rental in flight creates its tunnel before its row.
 */
export async function sweepOrphanTunnels(
  cfg: NamedTunnelConfig,
  liveTunnelIds: Set<string>,
  graceMs: number,
  now = Date.now()
): Promise<string[]> {
  const removed: string[] = [];
  const cutoff = now - graceMs;

  const tunnels = await listAll<{ id: string; name: string; created_at?: string }>(
    cfg,
    `/accounts/${cfg.accountId}/cfd_tunnel?is_deleted=false`
  );
  for (const t of tunnels) {
    if (!t.name?.startsWith(TUNNEL_PREFIX) || liveTunnelIds.has(t.id)) continue;
    const created = t.created_at ? Date.parse(t.created_at) : NaN;
    if (!Number.isFinite(created) || created > cutoff) continue;
    await deleteWorkerTunnel(cfg, { tunnelId: t.id, dnsRecordId: '', hostname: t.name });
    removed.push(`tunnel ${t.name}`);
  }

  const records = await listAll<{ id: string; name: string; content?: string; created_on?: string }>(
    cfg,
    `/zones/${cfg.zoneId}/dns_records?type=CNAME`
  );
  const ourLabel = (name: string) => name.toLowerCase().startsWith(TUNNEL_PREFIX) && name.toLowerCase().endsWith(`.${cfg.domain}`);
  for (const r of records) {
    if (!ourLabel(r.name ?? '') || !r.content?.endsWith('.cfargotunnel.com')) continue;
    if (liveTunnelIds.has(r.content.slice(0, -'.cfargotunnel.com'.length))) continue;
    const created = r.created_on ? Date.parse(r.created_on) : NaN;
    if (!Number.isFinite(created) || created > cutoff) continue;
    await cfDelete(cfg, `/zones/${cfg.zoneId}/dns_records/${r.id}`);
    removed.push(`dns ${r.name}`);
  }
  return removed;
}

async function listAll<T>(cfg: NamedTunnelConfig, path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  // Bounded: a runaway total_pages must not keep a tick busy.
  for (let page = 1; page <= 20; page++) {
    const data = await cf<T[]>(cfg, 'GET', `${path}${sep}per_page=100&page=${page}`);
    out.push(...(data.result ?? []));
    const total = data.result_info?.total_pages ?? 1;
    if (page >= total || (data.result ?? []).length === 0) break;
  }
  return out;
}
