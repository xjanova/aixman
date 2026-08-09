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

export type GpuProviderSlug = 'simplepod';

/** A rentable machine offered by the marketplace. */
export interface GpuOffer {
  /** Vendor-native offer id, for logging/debugging. */
  id: string;
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
  region?: string;
  /** Host uptime percentage, 0-100. */
  reliability?: number;
  downloadMbps?: number;
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
}

export interface GpuBalance {
  balanceUsd: number;
  /** Vendor's own estimate of remaining runway at current burn. */
  availableRentalHours?: number;
}

export interface GpuRentalProvider {
  readonly slug: GpuProviderSlug;

  /** Cheapest-first list of machines matching `filter`. */
  findOffers(filter: GpuOfferFilter, apiKey: string): Promise<GpuOffer[]>;

  /** Rent a machine and boot `spec.image` on it. Resolves once the instance exists — not once it is ready. */
  rent(spec: GpuRentSpec, apiKey: string): Promise<GpuInstance>;

  /** Current state. Returns null when the instance no longer exists. */
  getInstance(id: string, apiKey: string): Promise<GpuInstance | null>;

  /** Destroy the instance and stop billing. MUST be idempotent. */
  terminate(id: string, apiKey: string): Promise<void>;

  /** Every instance the account currently has, used for orphan sweeps. */
  listInstances(apiKey: string): Promise<GpuInstance[]>;

  getBalance(apiKey: string): Promise<GpuBalance>;
}
