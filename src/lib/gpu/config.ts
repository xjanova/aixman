import prisma from '@/lib/db';
import { DEFAULT_BASE_IMAGE, DEFAULT_BASE_TAG, DEFAULT_MIN_CUDA } from './provision';

/**
 * GPU rental configuration, backed by `ai_settings` (group: `gpu`).
 *
 * These values are the difference between "a worker that costs $0.30 for a
 * video" and "a worker nobody noticed that billed $250 over a weekend". They
 * are read fresh on every tick — an admin lowering the budget must take effect
 * immediately, not after a redeploy.
 *
 * Secrets (registry passwords) deliberately live in env vars, never here:
 * `ai_settings` is plaintext and the project forbids unencrypted secrets in
 * `ai_` tables.
 */

export interface GpuBudgetConfig {
  /** Master kill switch. When false nothing is ever rented. */
  enabled: boolean;
  providerSlug: string;
  /** Hard ceiling on simultaneously rented machines. */
  maxConcurrentWorkers: number;
  /** Refuse any offer above this hourly price. */
  maxPricePerHourUsd: number;
  /** Stop renting once today's accrued GPU spend crosses this. */
  dailyBudgetUsd: number;
  /** Terminate a worker with no jobs for this long. */
  idleTimeoutMinutes: number;
  /** Absolute kill switch — a worker is never allowed to outlive this. */
  maxWorkerLifetimeMinutes: number;
  /** Give up (and reap) if the inference server never becomes healthy. */
  warmupTimeoutMinutes: number;
  /** Give up on a single generation after this long. */
  jobTimeoutMinutes: number;
  /** Optional marketplace region filter. */
  region?: string;
}

export interface WorkerProfile {
  /** Docker image that boots an inference server for this model. */
  image: string;
  tag: string;
  /** Container port the inference API listens on. */
  apiPort: number;
  /** Which HTTP dialect the server speaks. */
  apiKind: 'comfyui' | 'simple';
  /** Health endpoint, relative to the API root. */
  healthPath: string;
  diskGb: number;
  /** Minimum VRAM in MB. Quantised MiniMax H3 needs ~24 GB. */
  minVramMb: number;
  /** Preferred GPU models; empty means "any that meets minVramMb". */
  gpuModels: string[];
  gpuCount: number;
  /** Weights are tens of GB — a slow host makes cold start unbearable. */
  minDownloadMbps?: number;
  /** Minimum host CUDA version, so the image's runtime actually loads. */
  minCudaVersion?: string;
  /** Extra bash appended to the generated start script. */
  startScript?: string;
  env?: Record<string, string>;
  /**
   * ComfyUI API-format workflow graph. Placeholders `{{prompt}}`,
   * `{{negative_prompt}}`, `{{width}}`, `{{height}}`, `{{seed}}`,
   * `{{duration}}`, `{{fps}}` are substituted per job.
   */
  workflow?: unknown;
  /** Node id in `workflow` whose outputs hold the finished video. */
  outputNodeId?: string;
}

const SETTING_GROUP = 'gpu';

export const GPU_DEFAULTS: GpuBudgetConfig = {
  enabled: false,
  providerSlug: 'simplepod',
  maxConcurrentWorkers: 1,
  maxPricePerHourUsd: 0.6,
  dailyBudgetUsd: 10,
  idleTimeoutMinutes: 10,
  maxWorkerLifetimeMinutes: 240,
  // A fresh machine installs ComfyUI and pulls ~42.5 GB of weights. At the
  // 500 Mbps floor we require, that is ~12 minutes of download alone, plus
  // install and model load — so this has to be generous or every rental is
  // killed just before it becomes useful.
  warmupTimeoutMinutes: 60,
  jobTimeoutMinutes: 30,
};

/**
 * Default profile for MiniMax H3 (Hailuo 3.0) — works with no configuration.
 *
 * A stock PyTorch image is booted and the start script installs ComfyUI and
 * pulls the quantised weights, so no custom Docker build is required. The
 * published port is the auth proxy, not ComfyUI itself, which stays on
 * loopback inside the container.
 */
export const MINIMAX_H3_PROFILE: WorkerProfile = {
  image: DEFAULT_BASE_IMAGE,
  tag: DEFAULT_BASE_TAG,
  // The token-gated proxy. ComfyUI listens on 8188, reachable only inside the
  // container — never expose 8188, it has no authentication.
  apiPort: 8189,
  apiKind: 'comfyui',
  healthPath: '/system_stats',
  // ~42.5 GB of weights plus ComfyUI, torch and render output.
  diskGb: 120,
  minVramMb: 24576,
  gpuModels: ['RTX 5090', 'RTX 4090', 'RTX PRO 6000'],
  gpuCount: 1,
  // Weights are tens of gigabytes; below this the cold start alone outlives the
  // warmup timeout and the rental is wasted before it renders anything.
  minDownloadMbps: 500,
  minCudaVersion: DEFAULT_MIN_CUDA,
};

function parseNumber(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseBool(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export async function getGpuConfig(): Promise<GpuBudgetConfig> {
  const rows = await prisma.aiSetting.findMany({ where: { group: SETTING_GROUP } });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const cfg: GpuBudgetConfig = {
    enabled: parseBool(map.get('gpu_enabled'), GPU_DEFAULTS.enabled),
    providerSlug: map.get('gpu_provider')?.trim() || GPU_DEFAULTS.providerSlug,
    maxConcurrentWorkers: Math.max(
      0,
      Math.floor(parseNumber(map.get('gpu_max_concurrent_workers'), GPU_DEFAULTS.maxConcurrentWorkers))
    ),
    maxPricePerHourUsd: parseNumber(map.get('gpu_max_price_per_hour_usd'), GPU_DEFAULTS.maxPricePerHourUsd),
    dailyBudgetUsd: parseNumber(map.get('gpu_daily_budget_usd'), GPU_DEFAULTS.dailyBudgetUsd),
    idleTimeoutMinutes: parseNumber(map.get('gpu_idle_timeout_minutes'), GPU_DEFAULTS.idleTimeoutMinutes),
    maxWorkerLifetimeMinutes: parseNumber(
      map.get('gpu_max_worker_lifetime_minutes'),
      GPU_DEFAULTS.maxWorkerLifetimeMinutes
    ),
    warmupTimeoutMinutes: parseNumber(map.get('gpu_warmup_timeout_minutes'), GPU_DEFAULTS.warmupTimeoutMinutes),
    jobTimeoutMinutes: parseNumber(map.get('gpu_job_timeout_minutes'), GPU_DEFAULTS.jobTimeoutMinutes),
    region: map.get('gpu_region')?.trim() || undefined,
  };

  // A zero/absent lifetime cap would let a leaked worker bill indefinitely.
  // Refuse to honour "unlimited" here regardless of what is in the DB.
  if (!(cfg.maxWorkerLifetimeMinutes > 0)) {
    cfg.maxWorkerLifetimeMinutes = GPU_DEFAULTS.maxWorkerLifetimeMinutes;
  }
  if (!(cfg.idleTimeoutMinutes > 0)) {
    cfg.idleTimeoutMinutes = GPU_DEFAULTS.idleTimeoutMinutes;
  }

  return cfg;
}

/**
 * Worker profiles, stored as one JSON blob under `gpu_worker_profiles`:
 *   { "minimax-h3": { image: "...", tag: "...", ... } }
 * Unknown keys fall back to the MiniMax H3 defaults so a partial override
 * (e.g. just `image`) is valid.
 */
export async function getWorkerProfile(modelKey: string): Promise<WorkerProfile> {
  const row = await prisma.aiSetting.findUnique({ where: { key: 'gpu_worker_profiles' } });

  let stored: Record<string, Partial<WorkerProfile>> = {};
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object') stored = parsed as Record<string, Partial<WorkerProfile>>;
    } catch {
      // A malformed blob must not silently fall back to defaults that could
      // rent the wrong hardware — surface it instead.
      throw new Error('gpu_worker_profiles is not valid JSON. Fix it in Admin → Settings.');
    }
  }

  const override = stored[modelKey] || {};
  return { ...MINIMAX_H3_PROFILE, ...override };
}

/**
 * Guard against renting hardware for a profile that cannot possibly work.
 * Called before any money is spent.
 *
 * A ComfyUI profile needs no workflow: the built-in MiniMax H3 graph is used
 * when none is supplied, and it is validated against the worker's own
 * `/object_info` before a render is submitted.
 */
export function assertProfileUsable(modelKey: string, profile: WorkerProfile): void {
  if (!profile.image?.trim()) {
    throw new Error(
      `No container image configured for "${modelKey}". Clear ` +
        `gpu_worker_profiles.${modelKey}.image in Admin → Settings to restore the default.`
    );
  }
  if (!(profile.apiPort > 0 && profile.apiPort < 65536)) {
    throw new Error(`Invalid apiPort for "${modelKey}"`);
  }
  if (profile.apiKind === 'simple' && !profile.workflow) {
    // The 'simple' dialect targets a custom image that implements its own
    // contract; nothing here can supply a default for it.
    return;
  }
}

/** Private registry credentials, from env only — never from the database. */
export function getRegistryCredentials():
  | { host: string; username: string; password: string }
  | undefined {
  const host = process.env.GPU_REGISTRY_HOST;
  const username = process.env.GPU_REGISTRY_USERNAME;
  const password = process.env.GPU_REGISTRY_PASSWORD;
  if (!host || !username || !password) return undefined;
  return { host, username, password };
}
