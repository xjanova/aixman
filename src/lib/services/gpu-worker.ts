import { randomBytes } from 'crypto';
import prisma from '@/lib/db';
import { decrypt, encrypt } from '@/lib/utils/encryption';
import { getGpuProvider } from '@/lib/gpu';
import {
  assertProfileUsable,
  getRegistryCredentials,
  getWorkerProfile,
  type GpuBudgetConfig,
  type WorkerProfile,
} from '@/lib/gpu/config';
import type { AiGpuWorker } from '@/generated/prisma/client';
import { buildComfyUiStartScript, renderEnvExports } from '@/lib/gpu/provision';
import { RentUnconfirmedError, type GpuOffer, type GpuRentalProvider, type PendingRental } from '@/lib/gpu/types';
import { isStorageConfigured } from '@/lib/storage/r2';

/**
 * Reserved prefix for instance names we own. The orphan sweep terminates any
 * marketplace instance carrying this prefix that our database does not know
 * about — so never name an unrelated instance `aixman-…` by hand.
 */
const NAME_PREFIX = 'aixman-';

/**
 * A freshly rented instance exists at the vendor before its row exists here.
 * The sweep ignores anything younger than this so it can never kill a machine
 * that a concurrent rent() is still registering.
 */
const ORPHAN_GRACE_MS = 5 * 60_000;

const HEALTH_TIMEOUT_MS = 8_000;

/** Unconfirmed rentals are chased this long before being given up on. */
const PENDING_RENTAL_TTL_MS = 30 * 60_000;
const PENDING_RENTAL_KEY = 'gpu_pending_rentals';

/** SimplePod lists disk per GB per month (see GpuOffer.diskPricePerGbMonthUsd). */
const HOURS_PER_MONTH = 730;

/** How long to hold off re-renting a model whose last boot failed. */
const BOOT_FAILURE_BACKOFF_MS = 10 * 60_000;
/** Termination reason for a boot the worker itself reported as failed. */
const BOOT_FAILURE_PREFIX = 'Worker failed to provision';

export interface WorkerProbe {
  state: 'ready' | 'warming' | 'failed';
  /** Progress or failure text from the worker, for the admin panel. */
  detail?: string;
}

export type WorkerStatus =
  | 'provisioning'
  | 'warming'
  | 'ready'
  | 'busy'
  | 'draining'
  | 'terminated'
  | 'error';

/** Statuses where the machine still exists at the vendor and still costs money. */
const LIVE_STATUSES: WorkerStatus[] = ['provisioning', 'warming', 'ready', 'busy', 'draining'];

export interface EnsureWorkerResult {
  worker: AiGpuWorker | null;
  /** Why no worker is usable yet — surfaced to admins and job error messages. */
  reason?: string;
}

export class GpuWorkerManager {
  // ----------------------------------------------------------------
  // Credentials
  // ----------------------------------------------------------------

  /**
   * The marketplace API key, stored (encrypted) as a normal account-pool row so
   * it is managed through the existing admin UI. Rotation semantics don't apply
   * — a GPU account is infrastructure, not a rate-limited key — so the first
   * active row wins.
   */
  static async getApiKey(providerSlug: string): Promise<string> {
    const provider = await prisma.aiProvider.findUnique({
      where: { slug: providerSlug },
      include: {
        accounts: {
          where: { isActive: true },
          orderBy: { priority: 'desc' },
          take: 1,
        },
      },
    });

    const account = provider?.accounts[0];
    if (!account) {
      throw new Error(
        `No active API key for GPU provider "${providerSlug}". Add one in Admin → Pools.`
      );
    }
    return decrypt(account.apiKey);
  }

  private static resolveProvider(slug: string): GpuRentalProvider {
    const provider = getGpuProvider(slug);
    if (!provider) throw new Error(`Unknown GPU rental provider: ${slug}`);
    return provider;
  }

  // ----------------------------------------------------------------
  // Cost accounting
  // ----------------------------------------------------------------

  /**
   * Uptime cost accrued between `rentedAt` and `until` (or termination).
   *
   * This is an estimate covering GPU-hours only — the vendor also bills for
   * disk and storage, so treat it as a floor. The vendor's own balance is
   * checked before every rental as the authoritative backstop.
   */
  static accruedCostUsd(
    worker: Pick<AiGpuWorker, 'rentedAt' | 'terminatedAt' | 'pricePerHourUsd'>,
    until: Date = new Date()
  ): number {
    const end = worker.terminatedAt && worker.terminatedAt < until ? worker.terminatedAt : until;
    const ms = end.getTime() - worker.rentedAt.getTime();
    if (ms <= 0) return 0;
    return (ms / 3_600_000) * Number(worker.pricePerHourUsd);
  }

  /** Total GPU spend attributable to the current calendar day. */
  static async todaySpendUsd(): Promise<number> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const workers = await prisma.aiGpuWorker.findMany({
      where: { OR: [{ terminatedAt: null }, { terminatedAt: { gte: startOfDay } }] },
      select: { rentedAt: true, terminatedAt: true, pricePerHourUsd: true },
    });

    return workers.reduce((sum, w) => {
      // Only the slice of this worker's life that falls inside today counts.
      const from = w.rentedAt > startOfDay ? w.rentedAt : startOfDay;
      const to = w.terminatedAt && w.terminatedAt < now ? w.terminatedAt : now;
      const ms = to.getTime() - from.getTime();
      if (ms <= 0) return sum;
      return sum + (ms / 3_600_000) * Number(w.pricePerHourUsd);
    }, 0);
  }

  // ----------------------------------------------------------------
  // Health
  // ----------------------------------------------------------------

  /**
   * Ask the worker whether it can take a job.
   *
   * For a ComfyUI worker the health path is the proxy's readiness endpoint,
   * which answers 200 only once every weight file is on disk *and* ComfyUI is
   * up, 503 while it is still getting there, and 500 once the boot has failed.
   * The last one matters: a boot that fails early says so in a minute, rather
   * than billing until the warmup timeout.
   */
  static async probe(endpoint: string, profile: WorkerProfile, authToken?: string): Promise<WorkerProbe> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${endpoint}${profile.healthPath}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => null)) as
        | { ready?: boolean; failed?: string; stage?: string; bytes?: number; auth?: boolean }
        | null;

      if (res.ok) {
        if (body?.auth === false) {
          // The proxy fails open when it has no token. Still usable, but the
          // GPU is reachable by anyone holding the tunnel URL — say so loudly.
          console.error('[gpu] SECURITY: worker at ready endpoint is not enforcing its bearer token');
          return { state: 'ready', detail: 'Worker is not enforcing its bearer token' };
        }
        return { state: 'ready' };
      }
      if (body?.failed) return { state: 'failed', detail: body.failed };
      if (body?.stage === 'downloading' && typeof body.bytes === 'number') {
        return { state: 'warming', detail: `downloading weights, ${(body.bytes / 1024 ** 3).toFixed(1)} GB so far` };
      }
      return { state: 'warming', detail: body?.stage ? `${body.stage}` : `HTTP ${res.status}` };
    } catch {
      return { state: 'warming', detail: 'not reachable yet' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Decrypt a worker's bearer token. Returns undefined for pre-token workers. */
  static readAuthToken(worker: Pick<AiGpuWorker, 'authToken'>): string | undefined {
    if (!worker.authToken) return undefined;
    try {
      return decrypt(worker.authToken);
    } catch {
      // A token we can't read is worse than none: every request would 401.
      // Log and continue unauthenticated so an ENCRYPTION_KEY rotation doesn't
      // strand a machine that is already billing.
      console.error('[gpu] could not decrypt worker auth token');
      return undefined;
    }
  }

  // ----------------------------------------------------------------
  // Reconciliation — runs on every tick
  // ----------------------------------------------------------------

  /**
   * Pulls live state for every worker we believe exists, advances its state
   * machine, and reaps anything that has outlived its usefulness.
   *
   * Every exit path that leaves a machine running must be intentional: an
   * unhandled state here bills indefinitely.
   */
  static async reconcile(cfg: GpuBudgetConfig): Promise<void> {
    const workers = await prisma.aiGpuWorker.findMany({
      where: { status: { in: LIVE_STATUSES } },
    });
    if (workers.length === 0) return;

    const apiKey = await this.getApiKey(cfg.providerSlug);
    const provider = this.resolveProvider(cfg.providerSlug);
    const now = new Date();

    // Once the day's budget is gone, idle machines are pure loss. Reap them on
    // sight instead of waiting out the normal idle timeout. Jobs already
    // rendering are left to finish — that spend is already committed.
    const overBudget = (await this.todaySpendUsd()) >= cfg.dailyBudgetUsd;

    for (const worker of workers) {
      try {
        await this.reconcileOne(worker, provider, apiKey, cfg, now, overBudget);
      } catch (error) {
        // A reconcile failure must never abort the loop — the *next* worker may
        // be the one that needs reaping.
        console.error(`[gpu] reconcile failed for worker ${worker.id}:`, error);
        await prisma.aiGpuWorker.update({
          where: { id: worker.id },
          data: { lastError: String((error as Error).message).slice(0, 1000) },
        });
      }
    }
  }

  private static async reconcileOne(
    worker: AiGpuWorker,
    provider: GpuRentalProvider,
    apiKey: string,
    cfg: GpuBudgetConfig,
    now: Date,
    overBudget: boolean
  ): Promise<void> {
    const instance = await provider.getInstance(worker.externalId, apiKey);

    // Vanished at the vendor — stop the clock, it is no longer billing.
    if (!instance) {
      await this.markTerminated(worker.id, 'Instance no longer exists at provider', now);
      return;
    }

    // A broken gpu_worker_profiles blob must never stop a machine from being
    // reaped: the hard stops below run without it, and only the health/endpoint
    // logic is skipped until an admin fixes the JSON.
    let profile: WorkerProfile | null = null;
    try {
      profile = await getWorkerProfile(worker.modelKey);
    } catch (error) {
      console.error(`[gpu] worker ${worker.id} has an unreadable profile:`, (error as Error).message);
    }

    const endpoint =
      (profile ? instance.endpoints[profile.apiPort] : undefined) || worker.endpoint || null;
    const cost = this.accruedCostUsd(worker, now);

    await prisma.aiGpuWorker.update({
      where: { id: worker.id },
      data: {
        endpoint,
        totalCostUsd: cost,
        supportId: instance.supportId ?? worker.supportId,
        gpuModel: instance.gpuModel ?? worker.gpuModel,
        ...(instance.statusMessage ? { lastError: instance.statusMessage.slice(0, 1000) } : {}),
      },
    });

    const ageMs = now.getTime() - worker.rentedAt.getTime();

    // --- Hard stops, checked before anything else ---

    if (instance.status === 'error') {
      await this.terminate(worker.id, `Provider reported an error: ${instance.statusMessage || 'unknown'}`);
      return;
    }

    if (ageMs > cfg.maxWorkerLifetimeMinutes * 60_000) {
      await this.terminate(worker.id, `Reached maximum lifetime of ${cfg.maxWorkerLifetimeMinutes} min`);
      return;
    }

    if (worker.status === 'draining') {
      await this.terminate(worker.id, 'Drained');
      return;
    }

    if (instance.status === 'stopped') {
      await this.markTerminated(worker.id, 'Instance stopped at provider', now);
      return;
    }

    // --- Warmup path ---

    if (worker.status === 'provisioning' || worker.status === 'warming') {
      if (ageMs > cfg.warmupTimeoutMinutes * 60_000) {
        await this.terminate(
          worker.id,
          `Inference server never became healthy within ${cfg.warmupTimeoutMinutes} min`
        );
        return;
      }

      // A machine still booting has produced nothing yet, so there is no work
      // to protect — cut it loose the moment the budget is gone.
      if (overBudget) {
        await this.terminate(worker.id, 'Daily GPU budget exhausted while still warming up');
        return;
      }

      if (!profile) return; // cannot health-check without a profile; wait for a fix
      if (instance.status !== 'running' || !endpoint) {
        if (worker.status !== 'warming' && instance.status === 'running') {
          await prisma.aiGpuWorker.update({ where: { id: worker.id }, data: { status: 'warming' } });
        }
        return;
      }

      const probe = await this.probe(endpoint, profile, this.readAuthToken(worker));
      if (probe.state === 'failed') {
        await this.terminate(worker.id, `${BOOT_FAILURE_PREFIX}: ${probe.detail ?? 'unknown'}`);
        return;
      }
      await prisma.aiGpuWorker.update({
        where: { id: worker.id },
        data:
          probe.state === 'ready'
            ? { status: 'ready', readyAt: now, lastError: probe.detail ?? null }
            : { status: 'warming', lastError: probe.detail ? `Warming: ${probe.detail}` : undefined },
      });
      return;
    }

    // --- Idle reaping ---

    if (worker.status === 'ready') {
      const activeJobs = await prisma.aiGpuJob.count({
        where: { workerId: worker.id, status: { in: ['assigned', 'running'] } },
      });
      if (activeJobs > 0) return;

      if (overBudget) {
        await this.terminate(worker.id, 'Daily GPU budget exhausted and no work in progress');
        return;
      }

      const since = worker.lastJobAt ?? worker.readyAt ?? worker.rentedAt;
      if (now.getTime() - since.getTime() > cfg.idleTimeoutMinutes * 60_000) {
        await this.terminate(worker.id, `Idle for more than ${cfg.idleTimeoutMinutes} min`);
      }
      return;
    }

    // 'busy' is released by the queue once its job settles; the lifetime cap
    // above is the backstop if that never happens.
  }

  // ----------------------------------------------------------------
  // Renting
  // ----------------------------------------------------------------

  /**
   * Returns a worker able to serve `modelKey`, renting one if permitted.
   *
   * Never rents a second machine while one is still warming — a cold start can
   * take many minutes and impatience here doubles the bill.
   */
  static async ensureWorker(modelKey: string, cfg: GpuBudgetConfig): Promise<EnsureWorkerResult> {
    if (!cfg.enabled) {
      return { worker: null, reason: 'GPU rental is disabled (gpu_enabled = false)' };
    }

    const existing = await prisma.aiGpuWorker.findFirst({
      where: { modelKey, status: { in: ['ready', 'busy', 'warming', 'provisioning'] } },
      orderBy: [{ status: 'asc' }, { rentedAt: 'asc' }],
    });
    if (existing) {
      return existing.status === 'ready'
        ? { worker: existing }
        : { worker: null, reason: `Worker is starting up (${existing.status})` };
    }

    const liveCount = await prisma.aiGpuWorker.count({ where: { status: { in: LIVE_STATUSES } } });
    if (liveCount >= cfg.maxConcurrentWorkers) {
      // Every model needs its own weights, so a worker serving model A cannot
      // take a job for model B. With one concurrent worker allowed, a customer
      // switching models would otherwise wait out the whole idle timeout for a
      // machine that is doing nothing. Release it now instead.
      const freed = await this.releaseIdleWorkerForOtherModel(modelKey);
      return {
        worker: null,
        reason: freed
          ? 'กำลังปิดเครื่องที่ว่างเพื่อเปลี่ยนไปโมเดลที่คุณเลือก'
          : `At worker capacity (${liveCount}/${cfg.maxConcurrentWorkers})`,
      };
    }

    const spentToday = await this.todaySpendUsd();
    if (spentToday >= cfg.dailyBudgetUsd) {
      return {
        worker: null,
        reason: `Daily GPU budget reached ($${spentToday.toFixed(2)} of $${cfg.dailyBudgetUsd.toFixed(2)})`,
      };
    }

    // --- Configuration: a failure here cannot fix itself, so it throws and
    // the queue refunds the waiting jobs instead of retrying forever. ---
    const profile = await getWorkerProfile(modelKey);
    assertProfileUsable(modelKey, profile);

    const apiKey = await this.getApiKey(cfg.providerSlug);
    const provider = this.resolveProvider(cfg.providerSlug);

    // The render lives on the worker's tunnel and dies with the machine, so it
    // must be copied to R2 before the worker is released. Without R2 every
    // render would be thrown away after it was paid for — do not rent at all.
    if (!isStorageConfigured()) {
      throw new Error(
        'R2 storage is not configured, so a GPU render could not be kept once the worker is released. ' +
          'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_URL.'
      );
    }

    // A boot that just failed will most likely fail the same way again (a
    // weight file gone from the repo, a broken ComfyUI requirement). Pause
    // before paying for the next attempt, and say why.
    const recentBootFailure = await prisma.aiGpuWorker.findFirst({
      where: {
        modelKey,
        terminatedAt: { gte: new Date(Date.now() - BOOT_FAILURE_BACKOFF_MS) },
        lastError: { startsWith: BOOT_FAILURE_PREFIX },
      },
      orderBy: { terminatedAt: 'desc' },
    });
    if (recentBootFailure) {
      return {
        worker: null,
        reason: `Waiting before re-renting after a failed boot — ${recentBootFailure.lastError}`.slice(0, 500),
      };
    }

    // --- Vendor calls: SimplePod's API returns intermittent 502s, which say
    // nothing about whether renting can work. Report them as a reason and let
    // the next tick try again, rather than failing every queued job. ---
    try {
      // Renting with an empty vendor balance produces an instance that dies
      // mid-render; check before committing.
      const balance = await provider.getBalance(apiKey);
      if (balance.balanceUsd <= cfg.maxPricePerHourUsd) {
        return {
          worker: null,
          reason: `Provider balance too low ($${balance.balanceUsd.toFixed(2)}) to rent for an hour`,
        };
      }

      const offers = await provider.findOffers(
        {
          minGpuMemoryMb: profile.minVramMb,
          gpuModels: profile.gpuModels,
          maxPricePerHourUsd: cfg.maxPricePerHourUsd,
          minDiskGb: profile.diskGb,
          minDownloadMbps: profile.minDownloadMbps,
          minCudaVersion: profile.minCudaVersion,
          gpuCount: profile.gpuCount,
          region: cfg.region,
        },
        apiKey
      );

      if (offers.length === 0) {
        return {
          worker: null,
          reason:
            `No ${profile.gpuModels.join('/') || 'suitable'} GPU available under ` +
            `$${cfg.maxPricePerHourUsd}/hr with ${Math.round(profile.minVramMb / 1024)} GB VRAM`,
        };
      }

      return { worker: await this.rentWorker(offers[0], modelKey, profile, provider, apiKey, cfg) };
    } catch (error) {
      if (error instanceof RentUnconfirmedError) {
        // Possibly billing with nothing tracking it. Remember the order so the
        // sweep can find the machine, tag it and terminate it.
        await this.rememberPendingRental(error.pending);
      }
      const message = (error as Error).message;
      console.error(`[gpu] could not rent for ${modelKey}:`, message);
      return { worker: null, reason: `Could not rent a GPU right now: ${message}`.slice(0, 500) };
    }
  }

  /**
   * Drain a worker that is idle on a *different* model, freeing its slot.
   *
   * Only genuinely idle workers qualify: a machine mid-render keeps its slot,
   * because killing it would throw away work the customer already paid for and
   * the job would come back round as a retry.
   *
   * Returns true when something was released.
   */
  private static async releaseIdleWorkerForOtherModel(wantedModelKey: string): Promise<boolean> {
    const candidates = await prisma.aiGpuWorker.findMany({
      where: { status: 'ready', modelKey: { not: wantedModelKey } },
      orderBy: { lastJobAt: 'asc' }, // least recently useful first
    });

    for (const worker of candidates) {
      const active = await prisma.aiGpuJob.count({
        where: { workerId: worker.id, status: { in: ['assigned', 'running'] } },
      });
      if (active > 0) continue;

      // Anything still queued for *this* worker's model would have to re-warm
      // later; only release when nothing is waiting on it.
      const queuedForIt = await prisma.aiGpuJob.count({
        where: { status: 'queued', modelKey: worker.modelKey },
      });
      if (queuedForIt > 0) continue;

      await this.terminate(worker.id, `Released to make room for ${wantedModelKey}`);
      return true;
    }

    return false;
  }

  private static async rentWorker(
    offer: GpuOffer,
    modelKey: string,
    profile: WorkerProfile,
    provider: GpuRentalProvider,
    apiKey: string,
    cfg: GpuBudgetConfig
  ): Promise<AiGpuWorker> {
    const nameTag = `${NAME_PREFIX}${modelKey}`;
    // Fresh per worker: the container's port lands on a public tunnel, so the
    // image is expected to reject requests without this bearer token. A leaked
    // token dies with the machine.
    const authToken = randomBytes(32).toString('hex');
    const env = {
      ...(profile.env || {}),
      AIXMAN_MODEL_KEY: modelKey,
      AIXMAN_WORKER_TOKEN: authToken,
    };

    // For a ComfyUI worker on the stock PyTorch image, the start script installs
    // everything — no custom Docker build is needed. A 'simple' profile points
    // at an image that serves itself, so it only gets the env exports.
    const scriptFor = (scriptEnv: Record<string, string>, hfToken: string | undefined) =>
      profile.apiKind === 'comfyui'
        ? buildComfyUiStartScript({
            publicPort: profile.apiPort,
            extraScript: profile.startScript,
            hfToken,
            env: scriptEnv,
            // Each model brings its own weights and node packs, so the machine
            // is provisioned for exactly the job it was rented for.
            downloads: profile.downloads,
            customNodes: profile.customNodes,
          })
        : ['#!/usr/bin/env bash', 'set -uo pipefail', renderEnvExports(scriptEnv), profile.startScript ?? '']
            .filter(Boolean)
            .join('\n');

    const startScript = scriptFor(env, process.env.GPU_HF_TOKEN);
    // The vendor keeps templates after the machine is gone; nothing secret
    // goes into one.
    const publicEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key !== 'AIXMAN_WORKER_TOKEN'));
    const templateStartScript = scriptFor(publicEnv, undefined);

    const instance = await provider.rent(
      {
        offer,
        gpuCount: profile.gpuCount,
        image: profile.image,
        imageTag: profile.tag,
        diskGb: profile.diskGb,
        exposePorts: [profile.apiPort],
        startScript,
        templateStartScript,
        env,
        registry: getRegistryCredentials(),
        nameTag,
      },
      apiKey
    );

    try {
      return await prisma.aiGpuWorker.create({
        data: {
          providerSlug: cfg.providerSlug,
          externalId: instance.id,
          supportId: instance.supportId,
          status: 'provisioning',
          modelKey,
          endpoint: instance.endpoints[profile.apiPort] || null,
          authToken: encrypt(authToken),
          gpuModel: instance.gpuModel || offer.gpuModel,
          gpuCount: profile.gpuCount,
          gpuMemoryMb: instance.gpuMemoryMb ?? offer.gpuMemoryMb,
          // Stored as the instance's *total* burn rate, not per-GPU, so every
          // downstream cost calculation can multiply by hours and stop there.
          // Disk is billed for the whole rental too; leaving it out made the
          // daily budget under-count real spend.
          pricePerHourUsd:
            offer.pricePerHourUsd * profile.gpuCount +
            ((offer.diskPricePerGbMonthUsd ?? 0) * profile.diskGb) / HOURS_PER_MONTH,
          metadata: { offerId: offer.id, region: offer.region ?? null, image: `${profile.image}:${profile.tag}` },
        },
      });
    } catch (error) {
      // The machine exists but we failed to record it. Terminating immediately
      // is the only way to avoid paying for something we can no longer find.
      await provider.terminate(instance.id, apiKey).catch((termError) => {
        console.error(
          `[gpu] CRITICAL: rented instance ${instance.id} could not be recorded or terminated. ` +
            'Terminate it manually in the provider console.',
          termError
        );
      });
      throw error;
    }
  }

  // ----------------------------------------------------------------
  // Termination
  // ----------------------------------------------------------------

  /** Destroy the machine at the vendor, then close out the row. Idempotent. */
  static async terminate(workerId: number, reason: string): Promise<void> {
    const worker = await prisma.aiGpuWorker.findUnique({ where: { id: workerId } });
    if (!worker || worker.terminatedAt) return;

    try {
      const apiKey = await this.getApiKey(worker.providerSlug);
      await this.resolveProvider(worker.providerSlug).terminate(worker.externalId, apiKey);
    } catch (error) {
      // Leave the row live so the next tick retries; marking it terminated here
      // would hide a machine that is still billing.
      console.error(`[gpu] failed to terminate worker ${workerId} (${worker.externalId}):`, error);
      await prisma.aiGpuWorker.update({
        where: { id: workerId },
        data: {
          status: 'draining',
          lastError: `Terminate failed: ${(error as Error).message}`.slice(0, 1000),
        },
      });
      return;
    }

    await this.markTerminated(workerId, reason, new Date());
  }

  private static async markTerminated(workerId: number, reason: string, at: Date): Promise<void> {
    const worker = await prisma.aiGpuWorker.findUnique({ where: { id: workerId } });
    if (!worker || worker.terminatedAt) return;

    await prisma.aiGpuWorker.update({
      where: { id: workerId },
      data: {
        status: 'terminated',
        terminatedAt: at,
        totalCostUsd: this.accruedCostUsd({ ...worker, terminatedAt: at }, at),
        lastError: reason.slice(0, 1000),
      },
    });
  }

  /** Mark a worker for shutdown on the next tick, without waiting on the vendor. */
  static async drain(workerId: number, reason: string): Promise<void> {
    await prisma.aiGpuWorker.updateMany({
      where: { id: workerId, status: { in: LIVE_STATUSES } },
      data: { status: 'draining', lastError: reason.slice(0, 1000) },
    });
  }

  /**
   * Terminate marketplace instances tagged as ours that no live worker row
   * claims — the failure mode where a rental succeeded but the bookkeeping
   * didn't. Without this, a single crashed request bills forever.
   */
  static async sweepOrphans(cfg: GpuBudgetConfig): Promise<{ terminated: string[] }> {
    const apiKey = await this.getApiKey(cfg.providerSlug);
    const provider = this.resolveProvider(cfg.providerSlug);

    // First, tag anything an unconfirmed rental left behind, so the pass below
    // can see it as ours. It becomes eligible once past the grace period.
    await this.adoptPendingRentals(provider, apiKey);

    const [instances, known] = await Promise.all([
      provider.listInstances(apiKey),
      prisma.aiGpuWorker.findMany({
        where: { providerSlug: cfg.providerSlug, status: { in: LIVE_STATUSES } },
        select: { externalId: true },
      }),
    ]);

    const knownIds = new Set(known.map((w) => w.externalId));
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    const terminated: string[] = [];

    for (const instance of instances) {
      if (knownIds.has(instance.id)) continue;
      if (instance.status === 'stopped') continue;

      // Only ever destroy machines we can prove are ours. The same marketplace
      // account may hold instances rented by hand for unrelated work, and an
      // unnamed instance is not evidence of ownership — skipping a real orphan
      // costs a few dollars, terminating someone's running job costs their work.
      if (!instance.name?.startsWith(NAME_PREFIX)) continue;

      // Never touch an instance a concurrent rent() may still be registering.
      // A brand-new machine has not been named yet either, so this also covers
      // the window before rename() lands.
      if (!instance.createdAt || instance.createdAt.getTime() > cutoff) continue;

      try {
        await provider.terminate(instance.id, apiKey);
        terminated.push(instance.id);
        console.warn(`[gpu] terminated orphaned instance ${instance.id} (${instance.name})`);
      } catch (error) {
        console.error(`[gpu] failed to terminate orphan ${instance.id}:`, error);
      }
    }

    return { terminated };
  }

  // ----------------------------------------------------------------
  // Unconfirmed rentals
  // ----------------------------------------------------------------

  private static async readPendingRentals(): Promise<PendingRental[]> {
    const row = await prisma.aiSetting.findUnique({ where: { key: PENDING_RENTAL_KEY } });
    if (!row?.value) return [];
    try {
      const parsed = JSON.parse(row.value);
      return Array.isArray(parsed) ? (parsed as PendingRental[]) : [];
    } catch {
      return [];
    }
  }

  private static async writePendingRentals(list: PendingRental[]): Promise<void> {
    const value = JSON.stringify(list);
    await prisma.aiSetting.upsert({
      where: { key: PENDING_RENTAL_KEY },
      update: { value },
      create: { key: PENDING_RENTAL_KEY, value, type: 'json', group: 'gpu' },
    });
  }

  private static async rememberPendingRental(pending: PendingRental): Promise<void> {
    const list = await this.readPendingRentals();
    // Bounded: each entry is chased for PENDING_RENTAL_TTL_MS anyway.
    await this.writePendingRentals([...list, pending].slice(-5));
  }

  /**
   * Chase every unconfirmed rental until its machine is tagged or the order is
   * old enough that nothing is coming. A vendor that is still failing just
   * leaves the list for the next tick.
   */
  private static async adoptPendingRentals(provider: GpuRentalProvider, apiKey: string): Promise<void> {
    const list = await this.readPendingRentals();
    if (list.length === 0 || !provider.adoptUnconfirmed) return;

    const keep: PendingRental[] = [];
    for (const pending of list) {
      try {
        const tagged = await provider.adoptUnconfirmed(pending, apiKey);
        if (tagged > 0) {
          console.warn(`[gpu] tagged ${tagged} instance(s) from an unconfirmed rental for termination`);
          continue;
        }
      } catch (error) {
        console.error('[gpu] could not check an unconfirmed rental:', (error as Error).message);
      }
      if (Date.now() - pending.at < PENDING_RENTAL_TTL_MS) keep.push(pending);
    }
    if (keep.length !== list.length) await this.writePendingRentals(keep);
  }
}

