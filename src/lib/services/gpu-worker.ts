import { randomBytes } from 'crypto';
import prisma from '@/lib/db';
import { decrypt, encrypt } from '@/lib/utils/encryption';
import { getGpuProvider } from '@/lib/gpu';
import {
  assertProfileUsable,
  getGpuConfig,
  getRegistryCredentials,
  getWorkerProfile,
  type GpuBudgetConfig,
  type WorkerProfile,
} from '@/lib/gpu/config';
import type { AiGpuWorker, Prisma } from '@/generated/prisma/client';
import { MODEL_CATALOG, getCatalogEntry, downloadBytes } from '@/lib/gpu/catalog';
import { cardFamily, isEligibleGpu } from '@/lib/gpu/gpu-specs';
import { FUNDING_MARGIN, fundedOffers, offerKey, rankOffers, type RankedOffer } from '@/lib/gpu/offer-picker';
import { buildComfyUiStartScript, LOG_PATH, renderEnvExports } from '@/lib/gpu/provision';
import {
  GPU_PROVIDER_SLUGS,
  RentRefusedError,
  RentUnconfirmedError,
  isGpuProviderSlug,
  type GpuOffer,
  type GpuProviderSlug,
  type GpuRentalProvider,
  type PendingRental,
} from '@/lib/gpu/types';
import { isStorageConfigured } from '@/lib/storage/r2';
import { isStudioPresent } from './studio-presence';
import { GpuEta } from './gpu-eta';
import { GpuBalance } from './gpu-balance';
import { shouldAddMachine } from './gpu-scaler';

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
/**
 * A boot failure that is the host's fault, not the model's: the driver is
 * older than the image or no GPU was attached. Another host will do fine, so
 * this host is avoided instead of the whole model being paused.
 */
const HOST_FAULT = /CUDA is unavailable/i;

/** Offers we stop trusting for a while, keyed by offer id, in ai_settings. */
const OFFER_PENALTY_KEY = 'gpu_offer_penalties';
/** A host whose boot failed on its own account, or that never became ready. */
const HOST_FAILURE_PENALTY_MS = 3 * 3600_000;
/** An offer the vendor refused — usually someone else took it first. */
const REFUSED_PENALTY_MS = 30 * 60_000;
/** Offers tried in one tick when the vendor refuses the first choice. */
const RENT_ATTEMPTS = 3;

/** Card types kept away from a model, keyed `model|gpu`, in ai_settings. */
const CARD_PENALTY_KEY = 'gpu_card_penalties';
const CARD_FAILURE_PENALTY_MS = 24 * 3600_000;
/**
 * Render failures that say the card cannot hold or run the model — not that
 * the job or the host was bad. A generic "CUDA error" is left out: a flaky
 * host throws those too, and one must not ban a whole card type.
 */
const CARD_FAULT = /out of memory|OutOfMemory|no kernel image|illegal memory access|CUBLAS_STATUS|cuDNN error/i;

interface OfferPenalty {
  until: number;
  reason: string;
}

/** A vendor adapter with the key to use it. */
interface VendorClient {
  slug: GpuProviderSlug;
  provider: GpuRentalProvider;
  apiKey: string;
}

/** One vendor's answer to "what could we rent right now?". */
interface VendorMarket {
  slug: GpuProviderSlug;
  offers: GpuOffer[];
  balanceUsd?: number;
  /** Why this vendor contributed nothing, for the admin-facing reason. */
  note?: string;
}

/** A vendor's market lookup may not hold the tick: its lease is 150 s and a rental can take 90. */
const MARKET_TIMEOUT_MS = 25_000;
/** A tunnel-mode worker that has not reported its URL by now can never be reached. */
const TUNNEL_REPORT_TIMEOUT_MS = 15 * 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

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

export interface CapacityResult {
  /** A machine was rented this tick (it takes jobs once booted). */
  rented?: boolean;
  /** What was decided and why — surfaced to admins and job error messages. */
  reason?: string;
}

/**
 * How long a model must have waited before its jobs may take the slot of an
 * idle machine a customer is still using (studio open on it, or a job within
 * the last minute). Without it two customers on different models at the cap
 * evict each other's machine on every order — two minutes of boot each time.
 */
const PING_PONG_GRACE_MS = 90_000;

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

  /**
   * Every vendor we hold a key for, listed for renting or not. Reconciling and
   * the orphan sweep use this set: switching a vendor off must not leave its
   * machines running unwatched.
   */
  static async keyedProviders(): Promise<Map<GpuProviderSlug, VendorClient>> {
    const out = new Map<GpuProviderSlug, VendorClient>();
    for (const slug of GPU_PROVIDER_SLUGS) {
      const provider = getGpuProvider(slug);
      if (!provider) continue;
      try {
        out.set(slug, { slug, provider, apiKey: await this.getApiKey(slug) });
      } catch {
        // No key for this vendor — nothing of ours can be running there.
      }
    }
    return out;
  }

  /**
   * Where a tunnel-mode worker reports its URL. Must be HTTPS: the worker sends
   * its bearer token there.
   */
  private static tunnelCallbackBase(): string | null {
    const base = (process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'https://ai.xman4289.com').replace(/\/+$/, '');
    return base.startsWith('https://') ? base : null;
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

  /**
   * The tail of a live worker's boot, ComfyUI and proxy logs.
   *
   * The machine — and its disk — vanish on release, so while it is up this is
   * the only place a failed boot explains itself. Fetched through the same
   * token-gated proxy as everything else.
   */
  static async fetchLogs(workerId: number): Promise<Record<string, string>> {
    const worker = await prisma.aiGpuWorker.findUnique({ where: { id: workerId } });
    if (!worker || worker.terminatedAt) throw new Error('เครื่องนี้ถูกปิดไปแล้ว');
    if (!worker.endpoint) throw new Error('เครื่องยังไม่มี endpoint (ยังบูตไม่ถึงขั้นเปิดพอร์ต)');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const token = this.readAuthToken(worker);
      const res = await fetch(`${worker.endpoint.replace(/\/+$/, '')}${LOG_PATH}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`เครื่องตอบ HTTP ${res.status}`);
      return (await res.json()) as Record<string, string>;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Copy the tail of a failing worker's logs onto its row (`metadata.bootLog`)
   * and into the server log, before it is terminated. Best effort: a worker too
   * broken to answer is still terminated.
   */
  private static async preserveBootLog(worker: AiGpuWorker): Promise<void> {
    try {
      const logs = await this.fetchLogs(worker.id);
      const tail = (name: string, chars: number) => (logs[name] ?? '').slice(-chars);
      const bootLog = {
        at: new Date().toISOString(),
        boot: tail('boot.log', 8000),
        comfyui: tail('comfyui.log', 3000),
      };
      const metadata = (worker.metadata && typeof worker.metadata === 'object' ? worker.metadata : {}) as Record<string, unknown>;
      await prisma.aiGpuWorker.update({
        where: { id: worker.id },
        data: { metadata: { ...metadata, bootLog } },
      });
      console.error(`[gpu] worker ${worker.id} boot failed — last boot.log lines:\n${bootLog.boot.split('\n').slice(-25).join('\n')}`);
    } catch (error) {
      console.error(`[gpu] could not read logs of failing worker ${worker.id}:`, (error as Error).message);
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

    // Each machine is watched through the vendor it was rented from.
    const vendors = await this.keyedProviders();
    const now = new Date();

    // Once the day's budget is gone, idle machines are pure loss. Reap them on
    // sight instead of waiting out the normal idle timeout. Jobs already
    // rendering are left to finish — that spend is already committed.
    const overBudget = (await this.todaySpendUsd()) >= cfg.dailyBudgetUsd;

    for (const worker of workers) {
      try {
        const vendor = isGpuProviderSlug(worker.providerSlug) ? vendors.get(worker.providerSlug) : undefined;
        if (!vendor) {
          // Nothing here can reach this machine — it bills until someone acts.
          throw new Error(
            `No API key for ${worker.providerSlug}: cannot check or stop this machine. ` +
              'Restore the key in Admin → GPU, or terminate it in the vendor console.'
          );
        }
        await this.reconcileOne(worker, vendor.provider, vendor.apiKey, cfg, now, overBudget);
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

    // Only a URL the vendor reports is written back. A tunnel-mode worker's
    // URL arrives through its own callback at any moment, and writing back
    // the value read at the start of this tick could erase it.
    const vendorEndpoint = profile ? instance.endpoints[profile.apiPort] : undefined;
    const endpoint = vendorEndpoint || worker.endpoint || null;
    const cost = this.accruedCostUsd(worker, now);

    await prisma.aiGpuWorker.update({
      where: { id: worker.id },
      data: {
        ...(vendorEndpoint && vendorEndpoint !== worker.endpoint ? { endpoint: vendorEndpoint } : {}),
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
        // Boots elsewhere take minutes; one that outlived the whole warmup
        // window is a slow or broken host, and would be picked again.
        await this.penalizeWorkerOffer(worker, HOST_FAILURE_PENALTY_MS, 'never became ready');
        return;
      }

      // A machine still booting has produced nothing yet, so there is no work
      // to protect — cut it loose the moment the budget is gone.
      if (overBudget) {
        await this.terminate(worker.id, 'Daily GPU budget exhausted while still warming up');
        return;
      }

      if (!profile) return; // cannot health-check without a profile; wait for a fix

      // A worker that must open its own tunnel and has not said where it is
      // can never be reached; waiting out the whole warmup would only bill.
      if (provider.exposure === 'tunnel' && !endpoint && ageMs > TUNNEL_REPORT_TIMEOUT_MS) {
        await this.terminate(worker.id, `Never reported its HTTPS tunnel within ${TUNNEL_REPORT_TIMEOUT_MS / 60_000} min`);
        await this.penalizeWorkerOffer(worker, HOST_FAILURE_PENALTY_MS, 'tunnel never came up');
        return;
      }

      if (instance.status !== 'running' || !endpoint) {
        if (worker.status !== 'warming' && instance.status === 'running') {
          await prisma.aiGpuWorker.update({ where: { id: worker.id }, data: { status: 'warming' } });
        }
        return;
      }

      const probe = await this.probe(endpoint, profile, this.readAuthToken(worker));
      if (probe.state === 'failed') {
        // The disk goes with the machine; keep the evidence first. Found on
        // the first real rental: the one-line failure said "No module named
        // sqlalchemy", and the pip error that explained it died with the box.
        await this.preserveBootLog(worker);
        await this.terminate(worker.id, `${BOOT_FAILURE_PREFIX}: ${probe.detail ?? 'unknown'}`);
        if (HOST_FAULT.test(probe.detail ?? '')) {
          await this.penalizeWorkerOffer(worker, HOST_FAILURE_PENALTY_MS, 'no usable CUDA');
        }
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
      const idleMs = now.getTime() - since.getTime();
      if (idleMs > cfg.idleTimeoutMinutes * 60_000) {
        // A customer still on the studio with this model selected is likely
        // about to order again — a few minutes' grace beats making them wait
        // for a fresh boot. Bounded, so an open tab cannot keep a machine up.
        // Only the machine that customer would be served by next — the most
        // recently used one of its model — waits; extra machines rented for a
        // burst close on the plain idle timeout once the burst is over.
        const graceMs = (cfg.idleTimeoutMinutes + cfg.presenceExtensionMinutes) * 60_000;
        if (
          cfg.presenceExtensionMinutes > 0 &&
          idleMs <= graceMs &&
          (await isStudioPresent(worker.modelKey, now.getTime())) &&
          (await this.isWarmestIdle(worker))
        ) {
          return;
        }
        await this.terminate(worker.id, `Idle for more than ${Math.floor(idleMs / 60_000)} min`);
      }
      return;
    }

    // 'busy' is released by the queue once its job settles; the lifetime cap
    // above is the backstop if that never happens.
  }

  // ----------------------------------------------------------------
  // Offer memory
  // ----------------------------------------------------------------

  /** Live entries of a penalty store (an ai_settings JSON blob), expired ones dropped. */
  private static async readPenalties(key: string, now = Date.now()): Promise<Map<string, OfferPenalty>> {
    const row = await prisma.aiSetting.findUnique({ where: { key } });
    const out = new Map<string, OfferPenalty>();
    if (!row?.value) return out;
    try {
      const parsed = JSON.parse(row.value) as Record<string, OfferPenalty>;
      for (const [id, p] of Object.entries(parsed ?? {})) {
        if (p && typeof p.until === 'number' && p.until > now) out.set(id, p);
      }
    } catch {
      // A garbled blob only costs the memory; renting must not stop over it.
    }
    return out;
  }

  private static async addPenalty(key: string, id: string, ms: number, reason: string): Promise<void> {
    const now = Date.now();
    const current = await this.readPenalties(key, now);
    const until = Math.max(now + ms, current.get(id)?.until ?? 0);
    current.set(id, { until, reason: reason.slice(0, 200) });
    const value = JSON.stringify(Object.fromEntries(current));
    await prisma.aiSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value, type: 'json', group: 'gpu' },
    });
  }

  /**
   * Offers to leave alone for now. Marketplace hosts differ: one that failed
   * to boot or refused an order will likely do so again, and the picker would
   * otherwise choose it again on price alone.
   */
  static async penalizedOffers(now = Date.now()): Promise<Map<string, OfferPenalty>> {
    return this.readPenalties(OFFER_PENALTY_KEY, now);
  }

  static async penalizeOffer(offerId: string, ms: number, reason: string): Promise<void> {
    await this.addPenalty(OFFER_PENALTY_KEY, offerId, ms, reason);
  }

  /** Card families (gpu-specs.ts cardFamily) kept away from this model for now. */
  static async penalizedCards(modelKey: string, now = Date.now()): Promise<Set<string>> {
    const prefix = `${modelKey}|`;
    const out = new Set<string>();
    for (const id of (await this.readPenalties(CARD_PENALTY_KEY, now)).keys()) {
      if (id.startsWith(prefix)) out.add(id.slice(prefix.length));
    }
    return out;
  }

  /**
   * Learn from a render that failed because of the card it ran on.
   *
   * Widening eligibility from four named cards to every capable one means
   * renting types this deployment has never used, and one may turn out unable
   * to hold a model (a 24 GB card and a 46 GB video model). Such a card type is
   * kept away from that model for a day, and the failure is not held against
   * the model — otherwise a run of them would take it off sale.
   *
   * A card type that has completed this model's work before is never banned:
   * an out-of-memory there is the job's doing (a long clip), and banning the
   * A100s H3 runs on would leave it with nothing to rent.
   *
   * Returns true when the failure was the card's.
   */
  static async noteRenderFailure(modelKey: string, worker: AiGpuWorker | null, message: string): Promise<boolean> {
    const gpu = worker?.gpuModel;
    if (!gpu || !CARD_FAULT.test(message)) return false;
    const family = cardFamily(gpu);
    const served = await prisma.aiGpuJob.findMany({
      where: { modelKey, status: 'completed', workerId: { not: null } },
      select: { worker: { select: { gpuModel: true } } },
      distinct: ['workerId'],
      take: 500,
    });
    if (served.some((j) => cardFamily(j.worker?.gpuModel) === family)) return false;
    await this.addPenalty(CARD_PENALTY_KEY, `${modelKey}|${family}`, CARD_FAILURE_PENALTY_MS, message);
    console.warn(`[gpu] ${modelKey}: ${gpu} cannot run this model (${message.slice(0, 120)}); avoiding it for a day`);
    return true;
  }

  private static async penalizeWorkerOffer(worker: AiGpuWorker, ms: number, reason: string): Promise<void> {
    const offerId = (worker.metadata as { offerId?: unknown } | null)?.offerId;
    if (typeof offerId !== 'string') return;
    const key = offerKey(worker.providerSlug, offerId);
    await this.penalizeOffer(key, ms, reason).catch((error) =>
      console.error(`[gpu] could not record a penalty for offer ${key}:`, (error as Error).message)
    );
  }

  // ----------------------------------------------------------------
  // Renting
  // ----------------------------------------------------------------

  /**
   * Rent one more machine for `modelKey` when its backlog warrants it.
   *
   * The queue calls this after handing a job to every idle, booted machine
   * for the model, with what is still waiting. In order:
   *   - rental switched off → nothing;
   *   - the model already has machines (up or booting) → only if a new one
   *     would finish the backlog sooner (shouldAddMachine, gpu-scaler.ts);
   *   - at the concurrency cap → a model with no machine at all may take the
   *     slot of an idle machine serving another model — never a busy one,
   *     and not one a customer is using unless this model has waited a while;
   *   - otherwise budget, config, boot-failure, balance and market checks,
   *     then rent. The new machine takes jobs once it has booted.
   *
   * Different models get their own machines side by side up to the cap, so a
   * customer switching models no longer evicts everyone else's.
   */
  static async addCapacity(
    modelKey: string,
    cfg: GpuBudgetConfig,
    backlog: { queued: number; oldestQueuedAt: Date | null }
  ): Promise<CapacityResult> {
    if (!cfg.enabled) {
      return { reason: 'GPU rental is disabled (gpu_enabled = false)' };
    }

    const serving = await prisma.aiGpuWorker.count({
      where: { modelKey, status: { in: ['ready', 'busy', 'warming', 'provisioning'] } },
    });
    if (serving > 0) {
      const [unitRenderSeconds, bootSeconds, lengthFactor] = await Promise.all([
        GpuEta.typicalRenderSeconds(modelKey),
        // This model's own boots: its weights decide the download.
        GpuEta.typicalBootSeconds(modelKey),
        GpuEta.queuedLengthFactor(modelKey),
      ]);
      // The waiting jobs' own length: a backlog of 15 s clips clears five
      // times slower than one of 5 s clips, and is worth a machine sooner.
      const renderSeconds = unitRenderSeconds * lengthFactor;
      const decision = shouldAddMachine({ queued: backlog.queued, machines: serving, renderSeconds, bootSeconds });
      if (!decision.add) return { reason: decision.reason };
    }

    const liveCount = await prisma.aiGpuWorker.count({ where: { status: { in: LIVE_STATUSES } } });
    if (liveCount >= cfg.maxConcurrentWorkers) {
      // Every model needs its own weights, so a machine serving model A
      // cannot take a job for model B. With no slot free, an idle machine of
      // another model — one with nothing queued for it — gives its slot up
      // rather than making this model wait out that machine's idle timeout.
      // That holds for a model with no machine at all and, since the scaler
      // got us here, for one whose backlog has outgrown the machines it has:
      // an image burst should not queue behind a video machine sitting idle.
      const waitedMs = backlog.oldestQueuedAt ? Date.now() - backlog.oldestQueuedAt.getTime() : 0;
      const freed = await this.releaseIdleWorkerForOtherModel(modelKey, waitedMs);
      if (freed) return { reason: 'Released an idle machine of another model to make room' };
      return {
        reason:
          serving > 0
            ? `At worker capacity (${liveCount}/${cfg.maxConcurrentWorkers}); the queue continues on ${serving} machine(s)`
            : `At worker capacity (${liveCount}/${cfg.maxConcurrentWorkers})`,
      };
    }

    const spentToday = await this.todaySpendUsd();
    if (spentToday >= cfg.dailyBudgetUsd) {
      return {
        reason: `Daily GPU budget reached ($${spentToday.toFixed(2)} of $${cfg.dailyBudgetUsd.toFixed(2)})`,
      };
    }

    // --- Configuration: a failure here cannot fix itself, so it throws and
    // the queue refunds the waiting jobs instead of retrying forever. ---
    const profile = await getWorkerProfile(modelKey);
    assertProfileUsable(modelKey, profile);

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
    // A failure that was the host's own is handled by avoiding that host.
    const recentBootFailure = await prisma.aiGpuWorker.findFirst({
      where: {
        modelKey,
        terminatedAt: { gte: new Date(Date.now() - BOOT_FAILURE_BACKOFF_MS) },
        lastError: { startsWith: BOOT_FAILURE_PREFIX },
        NOT: { lastError: { contains: 'CUDA is unavailable' } },
      },
      orderBy: { terminatedAt: 'desc' },
    });
    if (recentBootFailure) {
      return {
        reason: `Waiting before re-renting after a failed boot — ${recentBootFailure.lastError}`.slice(0, 500),
      };
    }

    // --- Every vendor at once. One vendor's outage, sold-out market or empty
    // wallet is that vendor's problem — the others are still asked, and the
    // best machine anywhere wins. Vendor hiccups (SimplePod returns
    // intermittent 502s) become a reason for the next tick, never a refund. ---
    const { markets, clients } = await this.gatherMarkets(cfg, profile);
    // The balances just read keep the stored reading fresh — admins are
    // alerted, and orders pause only when no vendor can pay (gpu-balance.ts).
    await GpuBalance.recordMarkets(
      cfg,
      markets
        .filter((m) => m.note !== 'no API key')
        .map((m) => ({ slug: m.slug, label: this.resolveProvider(m.slug).label, balanceUsd: m.balanceUsd }))
    ).catch((error) => console.error('[gpu] could not store vendor balances:', (error as Error).message));
    // Not one vendor holds a key: that cannot fix itself, so it throws and the
    // queue refunds now rather than holding credits until the stale sweep.
    if (markets.length > 0 && markets.every((m) => m.note === 'no API key')) {
      throw new Error('No active API key for any GPU provider. Connect one in Admin → GPU.');
    }
    const offers = markets.flatMap((m) => m.offers);
    const vendorNotes = markets
      .filter((m) => m.note)
      .map((m) => `${this.resolveProvider(m.slug).label}: ${m.note}`)
      .join('; ');

    // Every card that can run the model competes — capability, not a name
    // list (gpu-specs.ts) — minus hosts and card types that failed us.
    const [penalties, badCards] = await Promise.all([this.penalizedOffers(), this.penalizedCards(modelKey)]);
    const eligible = offers.filter(
      (o) =>
        isEligibleGpu(o.gpuModel, profile.gpuModels, profile.minArch) &&
        !penalties.has(offerKey(o.provider, o.id)) &&
        !badCards.has(cardFamily(o.gpuModel))
    );
    if (eligible.length === 0) {
      const skipped = offers.length > 0 ? ` (${offers.length} listed, none usable or all recently failed)` : '';
      return {
        reason: (
          `No ${profile.gpuModels.join('/') || 'suitable'} GPU at any vendor under ` +
          `$${cfg.maxPricePerHourUsd}/hr with ${Math.round(profile.minVramMb / 1024)} GB VRAM${skipped}` +
          (vendorNotes ? ` — ${vendorNotes}` : '')
        ).slice(0, 500),
      };
    }

    // The cheapest *work*, not the cheapest hour: boot at that host's speed
    // (shared with any of our machines already downloading there), the jobs
    // it is expected to take at that GPU's speed, the idle tail after them,
    // and each vendor's own extras (offer-picker.ts).
    const ranked = await this.rankOffersFor(eligible, modelKey, profile, cfg, backlog.queued, serving);

    // Machines first, then money: of the best-value machines, only those whose
    // own vendor account can pay for the work planned on them.
    const balances = new Map(markets.map((m) => [m.slug as string, m.balanceUsd ?? 0]));
    const funded = fundedOffers(ranked, balances);
    if (funded.length === 0) {
      const best = ranked[0];
      const vendor = best.offer.provider ?? 'simplepod';
      return {
        reason:
          `Not enough credit at any vendor for the work: the best machine (${best.offer.gpuModel} at ` +
          `${this.resolveProvider(vendor).label}) needs ≈ $${(best.costUsd * FUNDING_MARGIN).toFixed(2)}, ` +
          `the account holds $${(balances.get(vendor) ?? 0).toFixed(2)}`,
      };
    }

    // A machine the budget cannot carry through even one job would be killed
    // mid-boot by the next tick — money spent for nothing.
    const headroom = cfg.dailyBudgetUsd - spentToday;
    const affordable = funded.filter((r) => r.firstJobCostUsd <= headroom);
    if (affordable.length === 0) {
      return {
        reason:
          `Daily GPU budget has $${headroom.toFixed(2)} left; the cheapest machine needs ` +
          `≈ $${funded[0].firstJobCostUsd.toFixed(2)} to boot and render one job`,
      };
    }

    // Down the ranking until one rents. A refusal rented nothing, so the next
    // offer is tried at once. A vendor that fails some other way is skipped for
    // the rest of this tick — another vendor may still have the machine. An
    // order that may have gone through stops everything: it is chased by the
    // orphan sweep, and renting elsewhere too could mean paying for two.
    const failedVendors = new Set<GpuProviderSlug>();
    const problems: string[] = [];
    let attempts = 0;
    for (const pick of affordable) {
      if (attempts >= RENT_ATTEMPTS) break;
      const vendor = pick.offer.provider ? clients.get(pick.offer.provider) : undefined;
      if (!vendor || failedVendors.has(vendor.slug)) continue;
      attempts += 1;
      console.log(
        `[gpu] ${modelKey}: renting ${pick.offer.gpuModel} at ${vendor.provider.label} (offer ${pick.offer.id}, ` +
          `$${pick.offer.pricePerHourUsd}/hr) ≈ $${pick.costUsd.toFixed(3)} for boot ${pick.bootSeconds}s + ` +
          `render ${pick.renderSeconds}s (${pick.renderBasis}), best of ${eligible.length} from ${markets.length} vendor(s)`
      );
      try {
        const rented = await this.rentWorker(pick.offer, modelKey, profile, vendor, {
          provider: vendor.slug,
          costUsd: Number(pick.costUsd.toFixed(4)),
          scoreUsd: Number(pick.scoreUsd.toFixed(4)),
          bootSeconds: pick.bootSeconds,
          renderSeconds: pick.renderSeconds,
          renderBasis: pick.renderBasis,
          candidates: eligible.length,
          vendors: markets.map((m) => ({ slug: m.slug, offers: m.offers.length, note: m.note ?? null })),
          cheapestHourly: Math.min(...eligible.map((o) => o.pricePerHourUsd)),
        });
        // A machine rented this tick has not booted — it has no endpoint yet,
        // and the queue only hands jobs to booted machines (submitting to one
        // still starting fails and spends one of the job's two attempts).
        return {
          rented: true,
          reason: `Rented worker #${rented.id} (${rented.gpuModel ?? 'GPU'} at ${vendor.provider.label}); waiting for it to boot`,
        };
      } catch (error) {
        const message = (error as Error).message;
        if (error instanceof RentUnconfirmedError) {
          // Possibly billing with nothing tracking it. Remember the order so
          // the sweep can find the machine, tag it and terminate it.
          await this.rememberPendingRental({ ...error.pending, provider: vendor.slug });
          console.error(`[gpu] ${modelKey}: order at ${vendor.provider.label} unconfirmed:`, message);
          return { reason: `Could not confirm a rental at ${vendor.provider.label}: ${message}`.slice(0, 500) };
        }
        if (error instanceof RentRefusedError) {
          console.warn(`[gpu] ${modelKey}: ${vendor.provider.label} refused offer ${pick.offer.id}, trying the next —`, message);
          await this.penalizeOffer(offerKey(vendor.slug, pick.offer.id), REFUSED_PENALTY_MS, 'refused by provider');
        } else {
          console.error(`[gpu] ${modelKey}: renting at ${vendor.provider.label} failed:`, message);
          failedVendors.add(vendor.slug);
        }
        problems.push(`${vendor.provider.label}: ${message}`);
      }
    }
    return { reason: `Could not rent a GPU right now — ${problems.join('; ') || 'no offer could be tried'}`.slice(0, 500) };
  }

  // ----------------------------------------------------------------
  // Admin test tools
  // ----------------------------------------------------------------

  /**
   * "Test connection" for one vendor: its balance, and for each catalogue
   * model how many free machines fit and which the picker would take. Reads
   * only — nothing is rented.
   */
  static async testVendor(slug: GpuProviderSlug): Promise<{
    balanceUsd: number | null;
    balanceUnknown: boolean;
    models: {
      modelKey: string;
      name: string;
      offers: number;
      eligible: number;
      best: { gpuModel: string; pricePerHourUsd: number; region: string | null; costUsd: number; bootSeconds: number; renderSeconds: number } | null;
      note?: string;
    }[];
  }> {
    const cfg = await getGpuConfig();
    const vendor = (await this.keyedProviders()).get(slug);
    if (!vendor) throw new Error('ยังไม่ได้ใส่ key ของเจ้านี้');
    const balance = await withTimeout(vendor.provider.getBalance(vendor.apiKey), MARKET_TIMEOUT_MS, `${vendor.provider.label} balance`);
    const [penalties] = await Promise.all([this.penalizedOffers()]);

    const models = [];
    for (const entry of MODEL_CATALOG) {
      const profile = await getWorkerProfile(entry.key);
      try {
        const found = await withTimeout(
          vendor.provider.findOffers(
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
            vendor.apiKey
          ),
          MARKET_TIMEOUT_MS,
          `${vendor.provider.label} market`
        );
        const badCards = await this.penalizedCards(entry.key);
        const eligible = found
          .map((o) => ({ ...o, provider: slug }))
          .filter(
            (o) =>
              isEligibleGpu(o.gpuModel, profile.gpuModels, profile.minArch) &&
              !penalties.has(offerKey(slug, o.id)) &&
              !badCards.has(cardFamily(o.gpuModel))
          );
        const ranked = eligible.length ? await this.rankOffersFor(eligible, entry.key, profile, cfg, 1, 0) : [];
        const best = ranked[0];
        models.push({
          modelKey: entry.key,
          name: entry.name,
          offers: found.length,
          eligible: eligible.length,
          best: best
            ? {
                gpuModel: best.offer.gpuModel,
                pricePerHourUsd: best.offer.pricePerHourUsd * best.offer.gpuCount,
                region: best.offer.region ?? null,
                costUsd: Number(best.costUsd.toFixed(4)),
                bootSeconds: best.bootSeconds,
                renderSeconds: best.renderSeconds,
              }
            : null,
        });
      } catch (error) {
        models.push({ modelKey: entry.key, name: entry.name, offers: 0, eligible: 0, best: null, note: (error as Error).message.slice(0, 200) });
      }
    }
    return {
      balanceUsd: Number.isFinite(balance.balanceUsd) ? balance.balanceUsd : null,
      balanceUnknown: Boolean(balance.unknown),
      models,
    };
  }

  /**
   * Rent one machine for a model at one vendor, now, for an admin to test
   * that vendor end to end: boot, a render from the studio, termination. Every
   * guardrail of a normal rental still applies — the concurrency cap, the
   * daily budget, the vendor's credit, R2 — only the "is it worth it" scaling
   * rule is skipped. With no job it closes on the idle timeout like any other.
   */
  static async rentTestMachine(slug: GpuProviderSlug, modelKey: string): Promise<AiGpuWorker> {
    const cfg = await getGpuConfig();
    if (!getCatalogEntry(modelKey)) throw new Error('ไม่รู้จักโมเดลนี้');
    if (!isStorageConfigured()) throw new Error('ยังไม่ได้ตั้งค่า R2 — งานที่เรนเดอร์จะหายไปพร้อมเครื่อง');

    const liveCount = await prisma.aiGpuWorker.count({ where: { status: { in: LIVE_STATUSES } } });
    if (liveCount >= cfg.maxConcurrentWorkers) {
      throw new Error(`เครื่องเต็มเพดานแล้ว (${liveCount}/${cfg.maxConcurrentWorkers}) — ปิดเครื่องอื่นหรือเพิ่มเพดานก่อน`);
    }
    const spentToday = await this.todaySpendUsd();

    const profile = await getWorkerProfile(modelKey);
    assertProfileUsable(modelKey, profile);
    const { markets, clients } = await this.gatherMarkets({ ...cfg, providers: [slug] }, profile);
    const market = markets[0];
    const vendor = clients.get(slug);
    if (!vendor || !market) throw new Error(market?.note ?? 'ยังไม่ได้ใส่ key ของเจ้านี้');

    const [penalties, badCards] = await Promise.all([this.penalizedOffers(), this.penalizedCards(modelKey)]);
    const eligible = market.offers.filter(
      (o) =>
        isEligibleGpu(o.gpuModel, profile.gpuModels, profile.minArch) &&
        !penalties.has(offerKey(slug, o.id)) &&
        !badCards.has(cardFamily(o.gpuModel))
    );
    if (eligible.length === 0) throw new Error(`${vendor.provider.label} ไม่มีเครื่องว่างที่รันโมเดลนี้ได้ตอนนี้${market.note ? ` (${market.note})` : ''}`);

    const ranked = await this.rankOffersFor(eligible, modelKey, profile, cfg, 1, 0);
    const funded = fundedOffers(ranked, new Map([[slug as string, market.balanceUsd ?? 0]]));
    if (funded.length === 0) throw new Error(`เครดิตใน ${vendor.provider.label} ไม่พอสำหรับเครื่องที่ถูกที่สุด`);
    const affordable = funded.filter((r) => r.firstJobCostUsd <= cfg.dailyBudgetUsd - spentToday);
    if (affordable.length === 0) throw new Error('งบต่อวันที่เหลือไม่พอเช่าเครื่องทดสอบ');

    let lastRefusal = '';
    for (const pick of affordable.slice(0, RENT_ATTEMPTS)) {
      try {
        const worker = await this.rentWorker(pick.offer, modelKey, profile, vendor, {
          provider: slug,
          test: true,
          costUsd: Number(pick.costUsd.toFixed(4)),
          bootSeconds: pick.bootSeconds,
          renderSeconds: pick.renderSeconds,
          renderBasis: pick.renderBasis,
          candidates: eligible.length,
        });
        console.log(`[gpu] admin test rental: worker #${worker.id} ${pick.offer.gpuModel} at ${vendor.provider.label} for ${modelKey}`);
        return worker;
      } catch (error) {
        if (error instanceof RentUnconfirmedError) {
          await this.rememberPendingRental({ ...error.pending, provider: slug });
          throw new Error(`สั่งเช่าแล้วแต่ยืนยันไม่ได้ — ระบบจะตามหาและปิดเครื่องนั้นเอง (${error.message})`);
        }
        if (!(error instanceof RentRefusedError)) throw error;
        lastRefusal = error.message;
        await this.penalizeOffer(offerKey(slug, pick.offer.id), REFUSED_PENALTY_MS, 'refused by provider');
      }
    }
    throw new Error(`${vendor.provider.label} ปฏิเสธทุกเครื่องที่ลอง: ${lastRefusal}`.slice(0, 400));
  }

  /**
   * Ask every vendor we may rent from for its balance and matching machines,
   * side by side, each on a timer. An offer only survives if that vendor's
   * balance can carry an hour of it: renting on an empty account produces an
   * instance that dies mid-render.
   */
  private static async gatherMarkets(
    cfg: GpuBudgetConfig,
    profile: WorkerProfile
  ): Promise<{ markets: VendorMarket[]; clients: Map<GpuProviderSlug, VendorClient> }> {
    const keyed = await this.keyedProviders();
    const clients = new Map<GpuProviderSlug, VendorClient>();
    const markets = await Promise.all(
      cfg.providers.map(async (slug): Promise<VendorMarket> => {
        const vendor = keyed.get(slug);
        if (!vendor) return { slug, offers: [], note: 'no API key' };
        if (vendor.provider.exposure === 'tunnel') {
          if (!this.tunnelCallbackBase()) {
            return { slug, offers: [], note: 'needs an https NEXTAUTH_URL for its tunnel to report to' };
          }
          // The tunnel is opened by our ComfyUI proxy; a self-serving image has none.
          if (profile.apiKind !== 'comfyui') return { slug, offers: [], note: 'reachable only through the ComfyUI worker' };
        }
        clients.set(slug, vendor);
        try {
          const [balance, found] = await withTimeout(
            Promise.all([
              vendor.provider.getBalance(vendor.apiKey),
              vendor.provider.findOffers(
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
                vendor.apiKey
              ),
            ]),
            MARKET_TIMEOUT_MS,
            `${vendor.provider.label} market`
          );
          // Every free machine is kept; whether this account can pay for one
          // is decided per machine once the work planned on it is priced.
          const offers = found.map((o) => ({ ...o, provider: slug }));
          return { slug, offers, balanceUsd: balance.balanceUsd, note: found.length === 0 ? 'no free machine that fits' : undefined };
        } catch (error) {
          return { slug, offers: [], note: `unavailable (${(error as Error).message.slice(0, 120)})` };
        }
      })
    );
    return { markets, clients };
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
  /** No other ready machine of the same model was used more recently. */
  private static async isWarmestIdle(worker: AiGpuWorker): Promise<boolean> {
    const warmer = await prisma.aiGpuWorker.count({
      where: {
        modelKey: worker.modelKey,
        status: 'ready',
        id: { not: worker.id },
        lastJobAt: { gt: worker.lastJobAt ?? new Date(0) },
      },
    });
    return warmer === 0;
  }

  private static async releaseIdleWorkerForOtherModel(wantedModelKey: string, waitedMs: number): Promise<boolean> {
    const candidates = await prisma.aiGpuWorker.findMany({
      where: { status: 'ready', modelKey: { not: wantedModelKey } },
      orderBy: { lastJobAt: 'asc' }, // least recently useful first
    });
    const now = Date.now();

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

      // A machine someone is plainly still using — studio open on its model,
      // or a job just finished — keeps its slot for a short grace, so two
      // customers on different models do not evict each other on every order.
      if (waitedMs < PING_PONG_GRACE_MS) {
        const justUsed = worker.lastJobAt !== null && now - worker.lastJobAt.getTime() < 60_000;
        if (justUsed || (await isStudioPresent(worker.modelKey, now))) continue;
      }

      await this.terminate(worker.id, `Released to make room for ${wantedModelKey}`);
      return true;
    }

    return false;
  }

  /** Rank offers by the estimated cost of this model's work on each (offer-picker.ts). */
  private static async rankOffersFor(
    offers: GpuOffer[],
    modelKey: string,
    profile: WorkerProfile,
    cfg: GpuBudgetConfig,
    queued: number,
    serving: number
  ): Promise<RankedOffer[]> {
    const entry = getCatalogEntry(modelKey);
    const [renderProfile, lengthFactor, booting] = await Promise.all([
      GpuEta.renderProfile(modelKey),
      GpuEta.queuedLengthFactor(modelKey),
      prisma.aiGpuWorker.findMany({
        where: { status: { in: ['provisioning', 'warming'] } },
        select: { metadata: true, providerSlug: true },
      }),
    ]);
    // History is kept at the unit length; price each card on the waiting jobs'
    // own length, or a slow card looks as cheap for 15 s clips as for 5 s.
    const renderStatsByGpu = new Map(
      [...renderProfile.statsByGpu].map(([gpu, s]) => [gpu, { median: s.median * lengthFactor, n: s.n }])
    );
    const bootingOnOffer = new Map<string, number>();
    for (const w of booting) {
      const offerId = (w.metadata as { offerId?: unknown } | null)?.offerId;
      if (typeof offerId !== 'string') continue;
      const key = offerKey(w.providerSlug, offerId);
      bootingOnOffer.set(key, (bootingOnOffer.get(key) ?? 0) + 1);
    }
    return rankOffers(offers, {
      weightsGb: entry ? downloadBytes(entry) / 1e9 : 40,
      diskGb: profile.diskGb,
      renderStatsByGpu,
      referenceRenderSeconds: renderProfile.referenceUnitSeconds * lengthFactor,
      // Its share of what is waiting, counting itself among the machines.
      jobsExpected: Math.max(1, Math.ceil(queued / (serving + 1))),
      bootingOnOffer,
      // Every machine idles this long after its last job before the reaper
      // releases it (a customer on the studio can extend it, not shorten it).
      idleTailSeconds: cfg.idleTimeoutMinutes * 60,
      waitValueUsdPerHour: cfg.waitValueUsdPerHour,
    });
  }

  private static async rentWorker(
    offer: GpuOffer,
    modelKey: string,
    profile: WorkerProfile,
    vendor: VendorClient,
    pick?: Record<string, unknown>
  ): Promise<AiGpuWorker> {
    const { provider, apiKey } = vendor;
    const nameTag = `${NAME_PREFIX}${modelKey}`;
    // Fresh per worker: the container's port lands on a public tunnel, so the
    // image is expected to reject requests without this bearer token. A leaked
    // token dies with the machine.
    const authToken = randomBytes(32).toString('hex');
    // A vendor with only a bare IP and port: the worker opens its own HTTPS
    // tunnel and reports it to this URL, which carries a random id rather than
    // the row id (the row does not exist yet, and ids are guessable).
    const tunnel = provider.exposure === 'tunnel';
    const callbackId = tunnel ? randomBytes(12).toString('hex') : null;
    const env: Record<string, string> = {
      ...(profile.env || {}),
      AIXMAN_MODEL_KEY: modelKey,
      AIXMAN_WORKER_TOKEN: authToken,
      ...(callbackId ? { AIXMAN_CALLBACK_URL: `${this.tunnelCallbackBase()}/api/gpu/tunnel/${callbackId}` } : {}),
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
            tunnel,
          })
        : ['#!/usr/bin/env bash', 'set -uo pipefail', renderEnvExports(scriptEnv), profile.startScript ?? '']
            .filter(Boolean)
            .join('\n');

    const startScript = scriptFor(env, process.env.GPU_HF_TOKEN);
    // The vendor keeps templates after the machine is gone; nothing secret
    // goes into one.
    const publicEnv = Object.fromEntries(
      Object.entries(env).filter(([key]) => key !== 'AIXMAN_WORKER_TOKEN' && key !== 'AIXMAN_CALLBACK_URL')
    );
    const templateStartScript = scriptFor(publicEnv, undefined);

    const instance = await provider.rent(
      {
        offer,
        gpuCount: profile.gpuCount,
        image: profile.image,
        imageTag: profile.tag,
        diskGb: profile.diskGb,
        // Behind a tunnel nothing is published: the proxy listens on loopback.
        exposePorts: tunnel ? [] : [profile.apiPort],
        startScript,
        templateStartScript,
        env,
        registry: getRegistryCredentials(),
        nameTag,
        minCudaVersion: profile.minCudaVersion,
      },
      apiKey
    );

    try {
      return await prisma.aiGpuWorker.create({
        data: {
          providerSlug: vendor.slug,
          externalId: instance.id,
          supportId: instance.supportId,
          status: 'provisioning',
          modelKey,
          endpoint: tunnel ? null : instance.endpoints[profile.apiPort] || null,
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
          // offerId also tells the picker which host's uplink this machine
          // shares while it downloads; `pick` records why this offer won.
          metadata: {
            offerId: offer.id,
            provider: vendor.slug,
            region: offer.region ?? null,
            image: `${profile.image}:${profile.tag}`,
            // Where the worker's tunnel report is matched to this row.
            ...(callbackId ? { callbackId } : {}),
            ...(pick ? { pick: pick as Prisma.InputJsonValue } : {}),
          },
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
    void cfg; // every keyed vendor is swept, listed for renting or not
    const vendors = await this.keyedProviders();
    if (vendors.size === 0) throw new Error('No active API key for any GPU provider');

    const terminated: string[] = [];
    for (const vendor of vendors.values()) {
      try {
        terminated.push(...(await this.sweepVendor(vendor)));
      } catch (error) {
        // One vendor's outage must not stop the others being swept.
        console.error(`[gpu] orphan sweep failed for ${vendor.provider.label}:`, (error as Error).message);
      }
    }
    return { terminated };
  }

  private static async sweepVendor({ slug, provider, apiKey }: VendorClient): Promise<string[]> {
    // First, tag anything an unconfirmed rental left behind, so the pass below
    // can see it as ours. It becomes eligible once past the grace period.
    await this.adoptPendingRentals(slug, provider, apiKey);

    const [instances, known] = await Promise.all([
      provider.listInstances(apiKey),
      prisma.aiGpuWorker.findMany({
        where: { providerSlug: slug, status: { in: LIVE_STATUSES } },
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
        terminated.push(`${slug}:${instance.id}`);
        console.warn(`[gpu] terminated orphaned ${provider.label} instance ${instance.id} (${instance.name})`);
      } catch (error) {
        console.error(`[gpu] failed to terminate orphan ${slug}:${instance.id}:`, error);
      }
    }

    return terminated;
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
  private static async adoptPendingRentals(
    slug: GpuProviderSlug,
    provider: GpuRentalProvider,
    apiKey: string
  ): Promise<void> {
    const list = await this.readPendingRentals();
    const mine = (p: PendingRental) => (p.provider ?? 'simplepod') === slug;
    if (!list.some(mine) || !provider.adoptUnconfirmed) return;

    const keep: PendingRental[] = [];
    for (const pending of list) {
      // Another vendor's orders are left for that vendor's pass.
      if (!mine(pending)) {
        keep.push(pending);
        continue;
      }
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

