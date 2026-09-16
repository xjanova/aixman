/**
 * GPU Rental Abstraction
 *
 * Unlike the `src/lib/providers/*` adapters — which call a vendor's *inference*
 * API — these adapters rent raw GPU machines. We boot a container image on the
 * rented machine, wait for the inference server inside it to come up, then talk
 * to that server over its public URL.
 *
 * The unit of billing here is *uptime*, not requests: a rented worker burns
 * money every second it exists, whether or not anyone is generating. Every
 * implementation must therefore treat `terminate()` as safe to call repeatedly
 * and never throw on an already-gone instance.
 */

import type { GpuArch } from './gpu-specs';

export type GpuProviderSlug = 'simplepod' | 'runpod' | 'vast' | 'verda';

export const GPU_PROVIDER_SLUGS: readonly GpuProviderSlug[] = ['simplepod', 'runpod', 'vast', 'verda'];

export function isGpuProviderSlug(value: unknown): value is GpuProviderSlug {
  return typeof value === 'string' && (GPU_PROVIDER_SLUGS as readonly string[]).includes(value);
}

/**
 * How the platform reaches a worker's port.
 *
 * - `vendor-https`: the vendor publishes it at an HTTPS URL (SimplePod's
 *   Cloudflare tunnel, RunPod's proxy) that the instance record carries.
 * - `tunnel`: the vendor only offers a raw IP and port. Sending the worker's
 *   bearer token and customers' prompts over plain HTTP would let anyone on
 *   the path read them, so the worker opens its own Cloudflare tunnel and
 *   reports the HTTPS URL back to us (`/api/gpu/tunnel/[id]`).
 */
export type GpuExposure = 'vendor-https' | 'tunnel';

/** A rentable machine offered by the marketplace. */
export interface GpuOffer {
  /** Vendor-native offer id, for logging/debugging. */
  id: string;
  /**
   * The vendor it came from. Adapters may leave it unset; the worker manager
   * stamps it when it merges every vendor's market into one ranking.
   */
  provider?: GpuProviderSlug;
  /** Opaque reference passed back to `rent()` (SimplePod: an IRI). */
  marketRef: string;
  gpuModel: string;
  gpuCount: number;
  /** VRAM per GPU, in MB. */
  gpuMemoryMb: number;
  cpuCores: number;
  systemMemoryMb: number;
  diskGb: number;
  /** USD per hour, per GPU. */
  pricePerHourUsd: number;
  /**
   * Disk rate as the vendor lists it. SimplePod shows `pricePerDiskSize` = 0.15
   * on hosts renting GPUs for $0.48–1.00/hr, which only makes sense as USD per
   * GB per month — per GB-hour, 120 GB would cost $18/hr. Treated that way
   * until a real invoice says otherwise.
   */
  diskPricePerGbMonthUsd?: number;
  region?: string;
  /** Host uptime percentage, 0-100. */
  reliability?: number;
  downloadMbps?: number;
  /** Host CUDA version as the vendor reported it, e.g. "13.3". */
  cudaVersion?: string;
  /** USD per GB downloaded into the machine, where the vendor charges for it (Vast hosts set their own). */
  ingressUsdPerGb?: number;
  /** The least a rental is billed, in seconds (Verda bills in 10-minute blocks). */
  minBillingSeconds?: number;
  /** Boot time this vendor adds before our script runs — a VM starting, an image pull. */
  extraBootSeconds?: number;
}

export interface GpuOfferFilter {
  /** Minimum VRAM in MB. MiniMax H3 quantised needs ~24 GB → 24576. */
  minGpuMemoryMb?: number;
  /** Restrict to these GPU models (vendor naming, e.g. 'RTX 4090'). */
  gpuModels?: string[];
  maxPricePerHourUsd?: number;
  minDiskGb?: number;
  minCpuCores?: number;
  minSystemMemoryMb?: number;
  /** Weights are tens of GB — a slow host makes cold start unbearable. */
  minDownloadMbps?: number;
  minReliability?: number;
  region?: string;
  gpuCount?: number;
  /**
   * Minimum host CUDA version. A container built against a newer CUDA than the
   * host driver provides fails at model load — after the rental is paid for.
   */
  minCudaVersion?: string;
  /**
   * Oldest GPU architecture the model runs on. Eligibility is decided by name
   * afterwards anyway (gpu-specs.ts); a market that reports compute capability
   * can drop older cards before they fill its page.
   */
  minArch?: GpuArch;
}

export type GpuInstanceStatus = 'provisioning' | 'running' | 'stopped' | 'error';

export interface GpuInstance {
  /** Vendor-native instance id — persisted so we can always reap it. */
  id: string;
  /** Human-facing support id, when the vendor exposes one. */
  supportId?: string;
  /**
   * Instance name as the vendor reports it. The orphan sweep identifies our
   * machines by this, so an adapter that cannot report it must leave it
   * undefined rather than guess — the sweep refuses to terminate anything it
   * cannot positively identify as ours.
   */
  name?: string;
  status: GpuInstanceStatus;
  /** Internal container port → publicly reachable URL (https when tunnelled). */
  endpoints: Record<number, string>;
  pricePerHourUsd: number;
  gpuModel?: string;
  gpuCount?: number;
  gpuMemoryMb?: number;
  createdAt?: Date;
  /** Vendor-reported error/warning text, for the admin panel. */
  statusMessage?: string;
}

export interface GpuRentSpec {
  offer: GpuOffer;
  gpuCount: number;
  /** Docker image, e.g. 'myorg/comfyui-minimax-h3'. */
  image: string;
  imageTag: string;
  diskGb: number;
  /** Container ports to publish. The first one is the inference API. */
  exposePorts: number[];
  /** Bash run at container start. Env vars are exported here (see below). */
  startScript?: string;
  /**
   * The same script minus per-rental secrets, for the vendor-side template.
   * Templates outlive machines and are reused, so a bearer token baked into
   * one would be stale for the next rental and linger at the vendor.
   */
  templateStartScript?: string;
  /**
   * Passed to the vendor when it supports structured env vars. Adapters MUST
   * also fold these into `startScript` as exports, because vendor env-var
   * payload shapes are inconsistent and silently dropping them would leave the
   * container misconfigured with no error.
   */
  env?: Record<string, string>;
  /** Private registry auth, when the image isn't public. */
  registry?: { host: string; username: string; password: string };
  /** Tag written into the instance name so orphan sweeps can identify us. */
  nameTag: string;
  /**
   * Oldest host CUDA the image runs on. Offers were filtered on it already;
   * vendors that place the machine at order time (RunPod) need it again.
   */
  minCudaVersion?: string;
}

/** An order the vendor accepted whose instance we never saw. */
export interface PendingRental {
  /** Instance ids that existed before the order — anything else new is ours. */
  before: string[];
  /** When the order was placed, ms since epoch. */
  at: number;
  nameTag: string;
  /** Which vendor took the order; SimplePod for entries written before there were others. */
  provider?: GpuProviderSlug;
}

export class RentUnconfirmedError extends Error {
  constructor(message: string, readonly pending: PendingRental) {
    super(message);
    this.name = 'RentUnconfirmedError';
  }
}

/**
 * The vendor refused the order outright (a 4xx) — nothing was rented, so the
 * next offer can be tried at once. Anything less certain than a refusal must
 * not be retried elsewhere: the first order may have gone through.
 */
export class RentRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentRefusedError';
  }
}

export interface GpuBalance {
  /** Infinity when the vendor no longer says (see `unknown`). */
  balanceUsd: number;
  /** Vendor's own estimate of remaining runway at current burn. */
  availableRentalHours?: number;
  /**
   * The vendor has no way to read the balance any more (RunPod's only balance
   * query is on an API it is retiring). Renting proceeds; the vendor refuses
   * an order it cannot fund, which is treated as a refusal.
   */
  unknown?: boolean;
}

export interface GpuRentalProvider {
  readonly slug: GpuProviderSlug;
  /** What admins see. */
  readonly label: string;
  readonly exposure: GpuExposure;
  /**
   * How the stored credential is shaped, for the setup form: most vendors take
   * one API key; Verda's OAuth needs a client id and secret, stored together as
   * `id:secret`.
   */
  readonly credential: 'api-key' | 'client-id-secret';

  /** Cheapest-first list of machines matching `filter`. */
  findOffers(filter: GpuOfferFilter, apiKey: string): Promise<GpuOffer[]>;

  /**
   * Rent a machine and boot `spec.image` on it. Resolves once the instance
   * exists — not once it is ready.
   *
   * Throws `RentUnconfirmedError` when the vendor accepted the order but the
   * new instance could not be identified: it may be billing, so the caller
   * must not treat that like an ordinary failure.
   */
  rent(spec: GpuRentSpec, apiKey: string): Promise<GpuInstance>;

  /**
   * Find instances created by an unconfirmed rental and tag them as ours, so
   * the orphan sweep can terminate them. Returns how many were tagged.
   */
  adoptUnconfirmed?(pending: PendingRental, apiKey: string): Promise<number>;

  /** Current state. Returns null when the instance no longer exists. */
  getInstance(id: string, apiKey: string): Promise<GpuInstance | null>;

  /** Destroy the instance and stop billing. MUST be idempotent. */
  terminate(id: string, apiKey: string): Promise<void>;

  /**
   * Container logs kept by the vendor, for a machine the platform cannot reach
   * itself. Optional: only vendors that expose their own logs can serve this,
   * and it is the only window into a boot that never opened a port.
   */
  fetchVendorLogs?(id: string, apiKey: string): Promise<string>;

  /** Every instance the account currently has, used for orphan sweeps. */
  listInstances(apiKey: string): Promise<GpuInstance[]>;

  getBalance(apiKey: string): Promise<GpuBalance>;
}
