import { randomBytes } from 'crypto';
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
 * Verda (formerly DataCrunch) — its own data centres in Finland, whole VMs
 * rather than containers.
 *
 * A VM runs a startup script once, as root, at first boot. Ours starts the
 * same stock PyTorch container every other vendor boots, with the same boot
 * script, so the worker inside is identical. The OS image must carry Docker,
 * the NVIDIA container toolkit and a CUDA 13 driver:
 * `ubuntu-24.04-cuda-13.0-open-docker`, offered on RTX PRO 6000, H100, H200,
 * A100 and L40S types — a type whose `supported_os` lacks it is not offered.
 *
 * The VM's public IP has every port open and no firewall API, so nothing is
 * published: the worker is reached through its own tunnel.
 *
 * Three things that would cost money if done the obvious way:
 *  - a startup script can be read back through the API, and ours holds the
 *    worker's token — it is deleted once the machine runs, and on terminate;
 *  - `shutdown` leaves a VM billing, and `offline` is billed too — both are
 *    treated as broken so the platform deletes the machine;
 *  - deleting with `volume_ids: []` keeps the OS disk (and its bill) — the OS
 *    volume is always named for deletion.
 *
 * Auth is OAuth client credentials: the stored credential is `id:secret`.
 */

const API = 'https://api.verda.com/v1';
const VENDOR = 'Verda';
const IMAGE = 'ubuntu-24.04-cuda-13.0-open-docker';
/** NVMe volumes, $/GB-month (GET /v1/volume-types, 2026-09-13). */
const OS_VOLUME_USD_PER_GB_MONTH = 0.2;
/** VM boot, Docker start and the PyTorch image pull, before our script runs. */
const VM_BOOT_SECONDS = 180;
const ASSUMED_MBPS = 2000;
const BOOT_ENV = 'AIXMAN_BOOT_B64';
const USER_AGENT = 'aixman-gpu/1.0';

interface InstanceType {
  instance_type?: string;
  price_per_hour?: string | number;
  gpu?: { number_of_gpus?: number; description?: string };
  gpu_memory?: { size_in_gigabytes?: number };
  cpu?: { number_of_cores?: number };
  memory?: { size_in_gigabytes?: number };
  supported_os?: string[];
}

interface VerdaInstance {
  id?: string;
  hostname?: string;
  status?: string;
  instance_type?: string;
  price_per_hour?: number;
  created_at?: string;
  startup_script_id?: string | null;
  os_volume_id?: string | null;
}

interface OfferRef {
  type: string;
  location: string;
}

// OAuth tokens live an hour; one per credential, refreshed a minute early.
// Requests in flight are shared, so parallel calls do not each sign in.
const store = globalThis as unknown as {
  __verdaTokens?: Map<string, { token: string; expires: number }>;
  __verdaTokenRequests?: Map<string, Promise<string>>;
};
const tokens = (store.__verdaTokens ??= new Map());
const pendingTokens = (store.__verdaTokenRequests ??= new Map());

export class VerdaProvider implements GpuRentalProvider {
  readonly slug: GpuProviderSlug = 'verda';
  readonly label = 'Verda';
  readonly exposure = 'tunnel' as const;
  readonly credential = 'client-id-secret' as const;

  private async token(credential: string): Promise<string> {
    const cached = tokens.get(credential);
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const inFlight = pendingTokens.get(credential);
    if (inFlight) return inFlight;

    const split = credential.indexOf(':');
    if (split <= 0) throw new Error('Verda credential must be "client_id:client_secret"');
    const request = vendorFetch<{ access_token?: string; expires_in?: number }>(VENDOR, `${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: credential.slice(0, split),
        client_secret: credential.slice(split + 1),
      }),
    })
      .then((res) => {
        if (!res?.access_token) throw new Error('Verda did not issue an access token');
        tokens.set(credential, { token: res.access_token, expires: Date.now() + (res.expires_in ?? 3600) * 1000 });
        return res.access_token;
      })
      .finally(() => pendingTokens.delete(credential));
    pendingTokens.set(credential, request);
    return request;
  }

  private async call<T>(credential: string, path: string, init: RequestInit & { text?: boolean } = {}): Promise<T> {
    const token = await this.token(credential);
    try {
      return await vendorFetch<T>(VENDOR, `${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      // A token revoked early: forget it so the next call signs in again.
      if (error instanceof VendorHttpError && error.status === 401) tokens.delete(credential);
      throw error;
    }
  }

  // ----------------------------------------------------------------
  // Market
  // ----------------------------------------------------------------

  async findOffers(filter: GpuOfferFilter, credential: string): Promise<GpuOffer[]> {
    const count = filter.gpuCount ?? 1;
    const [types, availability] = await Promise.all([
      this.call<InstanceType[]>(credential, '/instance-types?currency=usd'),
      this.call<{ location_code?: string; availabilities?: string[] }[]>(credential, '/instance-availability?is_spot=false'),
    ]);

    const where = new Map<string, string[]>();
    for (const loc of availability ?? []) {
      if (!loc.location_code) continue;
      if (filter.region && !loc.location_code.toUpperCase().startsWith(filter.region.toUpperCase())) continue;
      for (const type of loc.availabilities ?? []) {
        where.set(type, [...(where.get(type) ?? []), loc.location_code]);
      }
    }

    const models = filter.gpuModels?.map((m) => m.toLowerCase().trim()).filter(Boolean);
    const offers: GpuOffer[] = [];
    for (const t of types ?? []) {
      const type = t.instance_type;
      const gpus = t.gpu?.number_of_gpus ?? 0;
      if (!type || gpus !== count) continue;
      if (!(t.supported_os ?? []).includes(IMAGE)) continue;
      const price = Number(t.price_per_hour);
      if (!Number.isFinite(price) || price <= 0) continue;
      const perGpu = price / gpus;
      if (filter.maxPricePerHourUsd && perGpu > filter.maxPricePerHourUsd) continue;
      // `gpu_memory` is the total across the type's cards.
      const vramMb = Math.round(((t.gpu_memory?.size_in_gigabytes ?? 0) / gpus) * 1024);
      if (filter.minGpuMemoryMb && vramMb < filter.minGpuMemoryMb) continue;
      const name = (t.gpu?.description ?? type).replace(/^\s*\d+\s*x\s*/i, '').trim();
      if (models?.length && !models.some((m) => name.toLowerCase().includes(m))) continue;

      for (const location of where.get(type) ?? []) {
        const ref: OfferRef = { type, location };
        offers.push({
          id: `${type}@${location}`,
          marketRef: JSON.stringify(ref),
          gpuModel: name,
          gpuCount: gpus,
          gpuMemoryMb: vramMb,
          cpuCores: t.cpu?.number_of_cores ?? 0,
          systemMemoryMb: Math.round((t.memory?.size_in_gigabytes ?? 0) * 1024),
          // The OS volume is sized per order.
          diskGb: filter.minDiskGb ?? 0,
          pricePerHourUsd: perGpu,
          diskPricePerGbMonthUsd: OS_VOLUME_USD_PER_GB_MONTH,
          region: location,
          reliability: 99,
          downloadMbps: ASSUMED_MBPS,
          cudaVersion: '13.0',
          extraBootSeconds: VM_BOOT_SECONDS,
        });
      }
    }
    return offers.sort((a, b) => a.pricePerHourUsd - b.pricePerHourUsd);
  }

  // ----------------------------------------------------------------
  // Instances
  // ----------------------------------------------------------------

  async rent(spec: GpuRentSpec, credential: string): Promise<GpuInstance> {
    if (spec.registry) throw new Error('Verda rentals do not support a private registry yet');
    const ref = JSON.parse(spec.offer.marketRef) as OfferRef;
    const hostname = `${spec.nameTag}-${randomBytes(3).toString('hex')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);

    // The startup script only starts the worker container; the boot script it
    // carries is the one every vendor runs.
    let scriptId: string;
    try {
      scriptId = parseId(
        await this.call<string>(credential, '/scripts', {
          method: 'POST',
          body: JSON.stringify({ name: hostname, script: vmStartupScript(spec) }),
          text: true,
        })
      );
    } catch (error) {
      // Nothing is running yet; a refusal of the script is a refusal of the order.
      if (error instanceof VendorHttpError && error.status >= 400 && error.status < 500 && error.status !== 401) {
        throw new RentRefusedError(error.message);
      }
      throw error;
    }

    try {
      const id = parseId(
        await this.call<string>(credential, '/instances', {
          method: 'POST',
          text: true,
          body: JSON.stringify({
            instance_type: ref.type,
            image: IMAGE,
            hostname,
            description: 'aixman GPU worker',
            location_code: ref.location,
            startup_script_id: scriptId,
            os_volume: { name: `${hostname}-os`, size: spec.diskGb },
            is_spot: false,
            contract: 'PAY_AS_YOU_GO',
            tags: [{ key: 'aixman', value: 'worker' }],
          }),
        })
      );
      const instance = await this.getInstance(id, credential).catch(() => null);
      return (
        instance ?? {
          id,
          name: hostname,
          status: 'provisioning',
          endpoints: {},
          pricePerHourUsd: spec.offer.pricePerHourUsd * spec.gpuCount,
          gpuModel: spec.offer.gpuModel,
          gpuCount: spec.gpuCount,
          createdAt: new Date(),
        }
      );
    } catch (error) {
      await this.deleteScript(credential, scriptId);
      // 503 "No capacity available", 402 insufficient funds, 400 a type not
      // offered in that location: nothing was created.
      if (error instanceof VendorHttpError && [400, 402, 403, 409, 503].includes(error.status)) {
        throw new RentRefusedError(error.message);
      }
      // Anything else may or may not have created a VM. Its hostname starts
      // `aixman-`, so the orphan sweep finds and deletes it if it exists.
      throw error;
    }
  }

  async getInstance(id: string, credential: string): Promise<GpuInstance | null> {
    try {
      const vm = await this.call<VerdaInstance>(credential, `/instances/${encodeURIComponent(id)}`);
      if (!vm?.id || GONE.has(vm.status ?? '')) return null;
      // The script holds the worker's token and is only needed at first boot.
      if (vm.status === 'running' && vm.startup_script_id) await this.deleteScript(credential, vm.startup_script_id);
      return toInstance(vm);
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async terminate(id: string, credential: string): Promise<void> {
    let vm: VerdaInstance | null = null;
    try {
      vm = await this.call<VerdaInstance>(credential, `/instances/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof VendorHttpError && error.status === 404) return; // already gone
      throw error;
    }
    if (!vm?.id || GONE.has(vm.status ?? '')) return;
    try {
      await this.call<unknown>(credential, '/instances', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'delete',
          id,
          // Named, or the OS disk is detached and keeps billing.
          ...(vm.os_volume_id ? { volume_ids: [vm.os_volume_id] } : {}),
          delete_permanently: true,
        }),
      });
    } catch (error) {
      if (!(error instanceof VendorHttpError && error.status === 404)) throw error;
    }
    if (vm.startup_script_id) await this.deleteScript(credential, vm.startup_script_id);
  }

  async listInstances(credential: string): Promise<GpuInstance[]> {
    const vms = await this.call<VerdaInstance[]>(credential, '/instances');
    return (vms ?? []).filter((vm) => vm.id && !GONE.has(vm.status ?? '')).map(toInstance);
  }

  async getBalance(credential: string): Promise<GpuBalance> {
    const res = await this.call<{ amount?: number; currency?: string }>(credential, '/balance');
    if (typeof res?.amount !== 'number') throw new Error('Verda did not return a balance');
    // A EUR account is read as if it were USD: it understates the balance
    // (EUR is worth more), which errs on the side of not renting.
    return { balanceUsd: res.amount };
  }

  private async deleteScript(credential: string, scriptId: string): Promise<void> {
    await this.call<unknown>(credential, `/scripts/${encodeURIComponent(scriptId)}`, { method: 'DELETE' }).catch(() => {
      // Best effort: gone already, or the next look at the machine retries.
    });
  }
}

const GONE = new Set(['deleting', 'discontinued', 'notfound']);

function toStatus(status: string | undefined): GpuInstanceStatus {
  switch (status) {
    case 'running':
      return 'running';
    // `offline` still bills, and neither it nor a failed start comes back on
    // its own: reported as an error, the platform deletes the machine.
    case 'offline':
    case 'no_capacity':
    case 'error':
    case 'installation_failed':
      return 'error';
    default:
      return 'provisioning'; // ordered, new, validating, provisioning, unknown
  }
}

function toInstance(vm: VerdaInstance): GpuInstance {
  return {
    id: String(vm.id),
    name: vm.hostname,
    status: toStatus(vm.status),
    endpoints: {},
    pricePerHourUsd: typeof vm.price_per_hour === 'number' ? vm.price_per_hour : 0,
    gpuModel: vm.instance_type,
    createdAt: vm.created_at ? new Date(vm.created_at) : undefined,
    statusMessage: vm.status && toStatus(vm.status) === 'error' ? `Verda reports the VM ${vm.status}` : undefined,
  };
}

/**
 * Verda answers an id as plain text on some calls and as a JSON string (or an
 * object) on others; the body is read as text and taken apart here.
 */
function parseId(body: string): string {
  const raw = (body ?? '').trim();
  if (raw.startsWith('"') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
      if (parsed && typeof (parsed as { id?: unknown }).id === 'string') return (parsed as { id: string }).id;
    } catch {
      // fall through to the plain-text reading
    }
  }
  if (raw && !/[\s{}"]/.test(raw)) return raw;
  throw new Error('Verda returned no id');
}

/**
 * The VM's first-boot script: start the worker container with the GPUs and
 * the boot script in its environment. No port is published — the worker
 * reaches out through its own tunnel.
 */
export function vmStartupScript(spec: GpuRentSpec): string {
  const env = { ...(spec.env ?? {}), [BOOT_ENV]: gzipBase64(spec.startScript ?? '') };
  const envFlags = Object.entries(env)
    .filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
    .map(([k, v]) => `-e ${k}=${shellQuote(v)}`)
    .join(' \\\n  ');
  const image = `${spec.image}:${spec.imageTag}`;
  return `#!/bin/bash
# aixman GPU worker — Verda first boot
exec > /var/log/aixman-startup.log 2>&1
set -u
for i in $(seq 1 30); do docker info > /dev/null 2>&1 && break; sleep 2; done
# The -docker images ship the NVIDIA container toolkit; wire it in if Docker
# does not know the runtime yet.
if ! docker info 2> /dev/null | grep -qi nvidia && command -v nvidia-ctk > /dev/null; then
  nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
fi
docker pull ${shellQuote(image)}
docker run -d --name aixman-worker --gpus all --shm-size 16g \\
  ${envFlags} \\
  ${shellQuote(image)} bash -c ${shellQuote(bootFromEnv(BOOT_ENV))}
`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
