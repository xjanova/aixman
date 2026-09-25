import { randomBytes } from 'crypto';
import prisma, { SLOW_DB_TX } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import type { AiGpuJob, AiGpuWorker } from '@/generated/prisma/client';
import { getGpuConfig, getWorkerProfile, type GpuBudgetConfig } from '@/lib/gpu/config';
import { getCatalogEntry, inPool, isAdminOnlyPreset, isCommunityModel, isCommunityOnlyModel } from '@/lib/gpu/catalog';
import { WorkerClient, purgeCommunityJob, type SubmitResult, type WorkerJobParams } from '@/lib/gpu/worker-client';
import {
  COMMUNITY_PROVIDER_SLUGS,
  COMMUNITY_SAFE_JOB,
  communityLastServingAt,
  communityQueueGraceMs,
  isNodeRefusal,
  laneOf,
  payloadHasInputMedia,
  pickClaimCandidate,
  planSubmitFailure,
  rankCommunityCandidates,
  readAvoidList,
  readCommunityMeta,
  slowLaneOpen,
  stageLabel,
  withAvoided,
} from '@/lib/gpu/community-dispatch';
import { isCommunitySafe, readContentTier, type ContentTier } from '@/lib/safety/content-tier';
import {
  communityOutputBudget,
  examineOutput,
  isRejectedOutput,
  joinReviewReasons,
  judgeRenderTime,
  MAX_COMMUNITY_OUTPUTS,
  oversizeReason,
  RejectedOutputError,
} from '@/lib/gpu/community-plausibility';
import { isLotterySlot } from './gpux-settlement';
import {
  claimStampFor,
  communityPriority,
  ledgerSnapshot,
  recordEarningSafely,
  RENTED_CLAIM_STAMP,
  sumsFor,
  sweepMissingEarnings,
  type ClaimStamp,
} from './gpux-ledger';
import {
  effectiveWorkflow,
  getSchemaSnapshot,
  getStoredWorkflow,
  saveLastGraph,
  saveSchemaSnapshot,
  type EffectiveWorkflow,
} from '@/lib/gpu/workflow-overrides';
import { GpuWorkerManager } from './gpu-worker';
import { GpuBalance, INSUFFICIENT_BALANCE_GRACE_MS, RENDERING_PAUSED_MESSAGE } from './gpu-balance';
import { maybeSendDailyReport } from './gpu-report';
import { raiseAlert } from '@/lib/notify/alerts';
import { GenerationService } from './generation';
import { ModelReadiness } from './model-readiness';
import { prewarmDemand } from './studio-presence';
import { uploadBuffer, isStorageConfigured } from '@/lib/storage/r2';

/**
 * Queue for GPU-backed generations.
 *
 * A rented GPU renders one video at a time, so this is a genuine FIFO queue
 * rather than a rotation pool: jobs wait, a worker is rented on demand, each
 * job is dispatched to an idle worker, and the worker is reaped once the queue
 * drains.
 *
 * `tick()` is the single entry point that advances everything. It is designed
 * to be called repeatedly and concurrently-safely (callers wrap it in the tick
 * lease lock) — every state transition is idempotent.
 */

/** A job claimed but not yet submitted for longer than this is presumed crashed. */
const ASSIGN_STALE_MS = 5 * 60_000;

/** A worker in any of these is up, or on its way up, and costs money. */
const LIVE_WORKER_STATUSES = ['provisioning', 'warming', 'ready', 'busy', 'draining'];

/** Rows we rent — community rows hold no rental slot and are never pre-warmed. */
const RENTED_ONLY = { providerSlug: { notIn: [...COMMUNITY_PROVIDER_SLUGS] } };

/**
 * How many queued jobs a machine looks through for one it may take. Only jobs
 * that failed on this machine before are skipped, so the head of the queue is
 * almost always the answer.
 */
const CLAIM_SCAN = 20;

/** Pause before the one retry of recording a render that was just submitted. */
const RECORD_RETRY_MS = 2_000;

/**
 * How often a model's stored schema is refreshed from a live worker. The node
 * set cannot change while a ComfyUI version is pinned, so once a process has
 * stored one per model it only needs a periodic refresh.
 */
const SCHEMA_REFRESH_MS = 6 * 60 * 60_000;
const schemaSavedAt = new Map<string, number>();

/** Job failure reason when the vendor balance cannot rent; `userFacingError` matches it. */
const RENDERING_PAUSED_PREFIX = 'Rendering paused';

/** Why a community-only model's jobs are waiting rather than renting. */
const COMMUNITY_ONLY_REASON = 'Community-only model: nothing is rented, waiting for a GPUxMINE machine';
/** Job failure reasons for community-only models; `userFacingError` matches both. */
const NO_COMMUNITY_MACHINE_PREFIX = 'No community machine took this job within';
const PRIVATE_FOR_COMMUNITY_PREFIX = 'Not community-safe';

/**
 * A delivered community job is purged from its node right away; one the node
 * did not confirm is asked again, while the node is up, for this long.
 */
const PURGE_RETRY_WINDOW_MS = 24 * 3_600_000;
/** Left alone this long after delivery: the first attempt is still in flight. */
const PURGE_RETRY_AFTER_MS = 2 * 60_000;
/** At most this many retries per tick, all at once, each bounded by the client's timeout. */
const PURGE_SWEEP_BATCH = 10;
/**
 * One job is asked again at most this often, so a node that keeps answering
 * 503 cannot hold the sweep's batch for a day while other jobs wait.
 */
const PURGE_RETRY_EVERY_MS = 10 * 60_000;
/** When this process last asked a node to purge each job (job id → ms). */
const purgeAttemptedAt = new Map<number, number>();
let purgeSweepRunning = false;

/**
 * How often the tick looks for delivered community jobs with no earning row
 * (gpux-ledger.ts sweepMissingEarnings). Each such job is retried at most
 * every 10 min anyway, so a minute-by-minute look would only repeat the query.
 */
const EARNINGS_SWEEP_EVERY_MS = 5 * 60_000;
let earningsSweptAt = 0;
let earningsSweepRunning = false;

/**
 * When this process last saw each community row ready or busy (worker id →
 * ms). A community-only job's grace (D5) runs from when its pool went dark,
 * and a row that steps out for one tick — a failed job sends it to warming —
 * must not look like a pool that has been dark since the order was placed.
 */
const communitySeenServingAt = new Map<number, number>();
/** Before this the process saw nothing: a row it never saw serving is given the benefit of the doubt from here. */
const PROCESS_STARTED_AT = Date.now();

/** Warn admins once a day when today's GPU spend reaches this share of the budget. */
const BUDGET_WARN_AT = 0.8;
/** This many terminal job failures inside the window is worth an alert. */
const FAILURE_BURST_COUNT = 3;
const FAILURE_BURST_WINDOW_MS = 30 * 60_000;

export interface TickReport {
  enabled: boolean;
  queued: number;
  dispatched: number;
  completed: number;
  failed: number;
  liveWorkers: number;
  orphansTerminated: number;
  spentTodayUsd: number;
  /** Why queued work isn't moving, when it isn't. */
  reason?: string;
}

export interface EnqueueParams {
  generationId: number;
  modelKey: string;
  payload: WorkerJobParams;
  priority?: number;
  /** From the order's words (content-tier.ts). Missing reads as 'unknown': never community-safe. */
  contentTier?: ContentTier;
  /** The customer attached media. Also read from the payload, so it cannot be forgotten. */
  hasInputMedia?: boolean;
}

export class GpuQueue {
  /** Add a generation to the queue. The next tick picks it up. */
  static async enqueue({
    generationId,
    modelKey,
    payload,
    priority = 50,
    contentTier,
    hasInputMedia,
  }: EnqueueParams): Promise<AiGpuJob> {
    return prisma.aiGpuJob.create({
      data: {
        generationId,
        modelKey,
        priority,
        status: 'queued',
        payload: payload as unknown as Prisma.InputJsonValue,
        contentTier: readContentTier(contentTier),
        hasInputMedia: hasInputMedia === true || payloadHasInputMedia(payload),
      },
    });
  }

  static async tick(): Promise<TickReport> {
    const cfg = await getGpuConfig();
    const report: TickReport = {
      enabled: cfg.enabled,
      queued: 0,
      dispatched: 0,
      completed: 0,
      failed: 0,
      liveWorkers: 0,
      orphansTerminated: 0,
      spentTodayUsd: 0,
    };

    const [liveWorkers, pendingJobs] = await Promise.all([
      prisma.aiGpuWorker.count({
        where: { status: { in: ['provisioning', 'warming', 'ready', 'busy', 'draining'] } },
      }),
      prisma.aiGpuJob.count({ where: { status: { in: ['queued', 'assigned', 'running'] } } }),
    ]);

    // The scheduler ticks every minute forever. When the feature is off and
    // nothing is in flight there is nothing to reconcile, so skip the provider
    // API entirely — except for an occasional sweep, which is the only thing
    // that can find a machine our database lost track of.
    const idle = !cfg.enabled && liveWorkers === 0 && pendingJobs === 0;
    if (idle && !(await this.sweepDue())) {
      report.liveWorkers = 0;
      return report;
    }

    // Orphan sweeping and reconciliation run even when GPU rental is disabled —
    // switching the feature off must still shut down machines already running.
    try {
      const sweep = await GpuWorkerManager.sweepOrphans(cfg);
      report.orphansTerminated = sweep.terminated.length;
    } catch (error) {
      const message = (error as Error).message;
      // Before setup there is no key and never will be a machine to find, so
      // this is expected rather than an error — saying so once every 30 min
      // beats a stack trace every minute for as long as the key is missing.
      if (message.includes('No active API key')) {
        console.log('[gpu] skipping orphan sweep — no provider API key configured yet');
      } else {
        console.error('[gpu] orphan sweep failed:', message);
      }
    } finally {
      // Stamp regardless of outcome: a sweep that keeps failing must back off to
      // its normal interval, not retry every tick.
      await this.markSwept();
    }

    try {
      await GpuWorkerManager.reconcile(cfg);
    } catch (error) {
      console.error('[gpu] reconcile failed:', (error as Error).message);
    }

    // Watch the vendor balance even while nothing is queued, so a low balance
    // is reported before a batch runs into it. Throttled inside to one vendor
    // call every few minutes.
    if (cfg.enabled) {
      try {
        await GpuBalance.check(cfg);
      } catch (error) {
        const message = (error as Error).message;
        if (!message.includes('No active API key')) console.error('[gpu] balance check failed:', message);
      }
      // Yesterday's numbers as a picture on Telegram, once a morning.
      try {
        await maybeSendDailyReport(cfg);
      } catch (error) {
        console.error('[gpu] daily report failed:', (error as Error).message);
      }
    }

    await this.requeueStaleAssignments();

    const polled = await this.pollRunningJobs(cfg);
    report.completed = polled.completed;
    report.failed = polled.failed;

    // Not awaited: each purge may take two client timeouts, and the tick's
    // lease has renting still to fit in. A privacy clean-up can wait a tick;
    // it is never worth failing one over.
    if (!purgeSweepRunning) {
      purgeSweepRunning = true;
      void this.purgeDeliveredOnNodes()
        .catch((error) => console.error('[gpu] community purge sweep failed:', (error as Error).message))
        .finally(() => {
          purgeSweepRunning = false;
        });
    }

    // Also not awaited: a community job whose earning could not be written
    // right after delivery (XMAN Studio's table missing a column, a database
    // stall, a restart in between) is written here, for up to a week.
    if (!earningsSweepRunning && Date.now() - earningsSweptAt >= EARNINGS_SWEEP_EVERY_MS) {
      earningsSweepRunning = true;
      earningsSweptAt = Date.now();
      void sweepMissingEarnings()
        .then((written) => {
          if (written > 0) console.log(`[gpux] earnings sweep wrote ${written} missing row(s)`);
        })
        .catch((error) => console.error('[gpux] earnings sweep failed:', (error as Error).message))
        .finally(() => {
          earningsSweepRunning = false;
        });
    }

    const dispatched = await this.dispatchQueued(cfg);
    report.dispatched = dispatched.dispatched;
    report.failed += dispatched.failed;
    const why = dispatched.reason ?? dispatched.communityReason;
    if (why) report.reason = why;

    report.failed += await this.failStuckQueued(cfg, dispatched.reason);

    if (cfg.enabled && cfg.prewarmCooldownMinutes > 0) {
      try {
        await this.prewarm(cfg);
      } catch (error) {
        // A guess about an order that has not happened: never worth failing the tick.
        console.error('[gpu] pre-warm failed:', (error as Error).message);
      }
    }

    report.queued = await prisma.aiGpuJob.count({ where: { status: 'queued' } });
    report.liveWorkers = await prisma.aiGpuWorker.count({
      where: { status: { in: ['provisioning', 'warming', 'ready', 'busy', 'draining'] } },
    });
    report.spentTodayUsd = Number((await GpuWorkerManager.todaySpendUsd()).toFixed(4));

    // Early warning, once a day: at 100% renting simply stops (gpu-worker.ts).
    if (cfg.enabled && cfg.dailyBudgetUsd > 0) {
      const used = report.spentTodayUsd / cfg.dailyBudgetUsd;
      if (used >= BUDGET_WARN_AT && used < 1) {
        raiseAlert({
          type: 'budget',
          key: `80:${new Date().toDateString()}`,
          level: 'warning',
          title: `งบค่าเครื่องวันนี้ใช้ไปแล้ว ${Math.round(used * 100)}%`,
          lines: [
            `ใช้ไป $${report.spentTodayUsd.toFixed(2)} จากงบ $${cfg.dailyBudgetUsd.toFixed(2)} · เครื่องเปิดอยู่ ${report.liveWorkers} · คิว ${report.queued}`,
            'ครบงบแล้วระบบหยุดเช่าเครื่องใหม่จนขึ้นวันใหม่ — เพิ่มงบได้ที่หน้า GPU',
          ],
          cooldownMs: 24 * 3_600_000,
        });
      }
    }

    return report;
  }

  /** How often to sweep for orphans while the system is otherwise idle. */
  private static readonly IDLE_SWEEP_INTERVAL_MS = 30 * 60_000;

  private static async sweepDue(): Promise<boolean> {
    const row = await prisma.aiSetting.findUnique({ where: { key: 'gpu_last_sweep_at' } });
    const last = Number(row?.value || 0);
    return !Number.isFinite(last) || Date.now() - last > this.IDLE_SWEEP_INTERVAL_MS;
  }

  private static async markSwept(): Promise<void> {
    const value = String(Date.now());
    await prisma.aiSetting.upsert({
      where: { key: 'gpu_last_sweep_at' },
      update: { value },
      create: { key: 'gpu_last_sweep_at', value, type: 'string', group: 'gpu' },
    });
  }

  // ----------------------------------------------------------------
  // Dispatch
  // ----------------------------------------------------------------

  private static async dispatchQueued(
    cfg: GpuBudgetConfig
  ): Promise<{ dispatched: number; failed: number; reason?: string; communityReason?: string }> {
    const pending = await prisma.aiGpuJob.groupBy({
      by: ['modelKey'],
      where: { status: 'queued' },
      _count: { _all: true },
      _min: { queuedAt: true },
    });
    if (pending.length === 0) return { dispatched: 0, failed: 0 };
    // Models are served in the order their oldest job arrived, so whoever
    // ordered first gets the next free slot — a customer's image does not
    // wait behind a video ordered after it just because of how groups sort.
    pending.sort((a, b) => (a._min.queuedAt?.getTime() ?? 0) - (b._min.queuedAt?.getTime() ?? 0));

    let dispatched = 0;
    let failed = 0;
    let reason: string | undefined;
    // Kept apart so a community model served first cannot hide why a rented
    // model's jobs are not moving (failStuckQueued quotes `reason` to them).
    let communityReason: string | undefined;

    for (const group of pending) {
      const modelKey = group.modelKey;
      const communityOnly = isCommunityOnlyModel(modelKey);

      // 0. A community-only model has no machine for private work at all: a
      //    job no community node may take is refunded now, not after a wait.
      //    New orders are refused before charging (GenerationService); these
      //    are rows written before the gate, or by a path that skipped it.
      let waiting = group._count._all;
      if (communityOnly) {
        const refunded = await this.failPrivateCommunityJobs(modelKey);
        failed += refunded;
        waiting -= refunded;
        if (waiting <= 0) continue;
      }

      // 1. Machines already up take what they can.
      const assigned = await this.assignIdleWorkers(modelKey, waiting);
      dispatched += assigned.dispatched;
      failed += assigned.failed;
      const queued = assigned.remaining;
      if (queued <= 0) continue;

      // Nothing is ever rented for a community-only model (owner decision
      // D5): the jobs wait for a home PC, and failStuckQueued refunds them
      // after GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN if none takes them.
      if (communityOnly) {
        communityReason ??= COMMUNITY_ONLY_REASON;
        continue;
      }

      // 2. Jobs still waiting: rent another machine if that finishes them
      //    sooner (or if this model has none) — see addCapacity.
      try {
        const result = await GpuWorkerManager.addCapacity(modelKey, cfg, {
          queued,
          oldestQueuedAt: group._min.queuedAt,
        });
        reason ??= result.reason;
      } catch (error) {
        // Only configuration errors reach here (bad profile, no key, no R2) —
        // addCapacity turns vendor hiccups into a reason instead. Those can
        // never succeed, so refund now rather than retrying forever.
        const message = (error as Error).message;
        reason ??= message;
        const refunded = await this.failAllQueued(modelKey, message);
        failed += refunded;
        raiseAlert({
          type: 'config-error',
          key: modelKey,
          level: 'critical',
          title: `ระบบเช่า GPU ตั้งค่าไม่ครบ — เช่าเครื่องให้ ${modelKey} ไม่ได้`,
          lines: [
            message,
            `คืนเครดิตงานในคิว ${refunded} งาน — งานใหม่ของโมเดลนี้จะถูกคืนเครดิตแบบเดียวกันจนกว่าจะแก้`,
          ],
        });
      }
    }

    return { dispatched, failed, reason, communityReason };
  }

  /**
   * Rent a machine for a customer who has not ordered yet.
   *
   * The first order on a model with no machine waits for a rental, a boot and
   * the weights. A customer with credits who has just opened the studio on
   * that model (studio-presence.ts) is likely to order within minutes, and the
   * boot can run while they write the prompt. Speculative, so every guard
   * leans towards not renting:
   *   - the model has no machine at all and nothing queued (the queue's own
   *     scaling handles that);
   *   - some vendor can comfortably pay — not while the balance is low;
   *   - no pre-warmed machine for the model closed unused within the cooldown,
   *     which bounds what a visitor who never orders can cost;
   *   - one per tick; addCapacity adds the rest (free slot only, budget, the
   *     boot-failure pause, vendor credit).
   * Unused, the machine closes on the idle timeout like any other.
   */
  private static async prewarm(cfg: GpuBudgetConfig): Promise<void> {
    const wanted = await prewarmDemand();
    if (wanted.length === 0) return;
    const balance = await GpuBalance.read(cfg);
    if (balance.state === 'low' || balance.state === 'insufficient') return;

    for (const modelKey of wanted) {
      const [machines, jobs] = await Promise.all([
        prisma.aiGpuWorker.count({ where: { ...RENTED_ONLY, modelKey, status: { in: LIVE_WORKER_STATUSES } } }),
        prisma.aiGpuJob.count({ where: { modelKey, status: { in: ['queued', 'assigned', 'running'] } } }),
      ]);
      if (machines > 0 || jobs > 0) continue;
      if (await this.recentUnusedPrewarm(modelKey, cfg.prewarmCooldownMinutes)) continue;

      try {
        const result = await GpuWorkerManager.addCapacity(
          modelKey,
          cfg,
          { queued: 0, oldestQueuedAt: null },
          { prewarm: true }
        );
        if (result.rented) {
          console.log(`[gpu] ${modelKey}: pre-warmed for a customer on the studio — ${result.reason}`);
          return;
        }
      } catch (error) {
        // A configuration error: the customer's order will meet it too, and be
        // refunded there. Nothing to undo for a machine never rented.
        console.error(`[gpu] ${modelKey}: pre-warm failed:`, (error as Error).message);
      }
    }
  }

  /** A pre-warmed machine for this model closed, within the window, having rendered nothing. */
  private static async recentUnusedPrewarm(modelKey: string, windowMinutes: number): Promise<boolean> {
    const recent = await prisma.aiGpuWorker.findMany({
      where: { modelKey, terminatedAt: { gte: new Date(Date.now() - windowMinutes * 60_000) } },
      select: { id: true, metadata: true },
      orderBy: { terminatedAt: 'desc' },
      take: 20,
    });
    const prewarmed = recent
      .filter((w) => (w.metadata as { pick?: { prewarm?: unknown } } | null)?.pick?.prewarm === true)
      .map((w) => w.id);
    if (prewarmed.length === 0) return false;
    const used = await prisma.aiGpuJob.groupBy({
      by: ['workerId'],
      where: { workerId: { in: prewarmed } },
    });
    return used.length < prewarmed.length;
  }

  /**
   * Every booted, idle machine serving this model takes the next job — one
   * GPU renders one job at a time. Only a booted machine can take one:
   * submitting to one still starting fails and costs the job an attempt for
   * nothing. `remaining` is what is left queued.
   *
   * Rented machines first, warmest first: they bill whether they work or not.
   * Community machines only for models built for them (catalogue `pools`) —
   * a home PC has none of a rented model's weights — full lane before slow,
   * and the one given work least recently first (community-dispatch.ts). A
   * machine is reserved (ready → busy, conditionally) before its job is
   * claimed, so two passes can never hand one machine two jobs.
   */
  private static async assignIdleWorkers(
    modelKey: string,
    queued: number
  ): Promise<{ dispatched: number; failed: number; remaining: number }> {
    let dispatched = 0;
    let failed = 0;
    const communityAllowed = inPool(getCatalogEntry(modelKey), 'community');
    const ready = await prisma.aiGpuWorker.findMany({
      where: {
        modelKey,
        status: 'ready',
        // A retired row is never handed work, whatever its status says: a
        // write that raced the retirement can leave one reading 'ready'.
        terminatedAt: null,
        endpoint: { not: null },
        ...(communityAllowed ? {} : RENTED_ONLY),
      },
      orderBy: { lastJobAt: { sort: 'desc', nulls: 'last' } },
    });

    const rented = ready.filter((w) => !GpuWorkerManager.isCommunity(w.providerSlug));
    const communityRows = ready.filter((w) => GpuWorkerManager.isCommunity(w.providerSlug));
    // The ledger's 30-day sums, read at most once a minute (never throws): what
    // an owner has given and earned places their machines in the queue, and
    // decides each machine's free share when it claims.
    const ledger = communityRows.length > 0 ? await ledgerSnapshot() : null;
    const community = rankCommunityCandidates(
      communityRows.map((w) => {
        const meta = readCommunityMeta(w.metadata);
        return {
          id: w.id,
          lane: meta.lane ?? null,
          lastJobAt: w.lastJobAt,
          priority: ledger
            ? communityPriority({
                ownerSums: sumsFor(ledger.byOwner, typeof meta.ownerUserId === 'number' ? meta.ownerUserId : null),
                pro: meta.pro === true,
                jobsCompleted: w.jobsCompleted,
                jobsFailed: w.jobsFailed,
                lane: meta.lane === 'slow' ? 'slow' : 'full',
              })
            : 0,
          worker: w,
        };
      }),
      // One pass in ten ignores priority, so a node with no record yet still
      // gets work and can start building one.
      { lottery: isLotterySlot(Math.random()) }
    );
    const idleFullRows = community.filter((c) => laneOf(c) === 'full').length;
    let fullRowsBlocked = false;
    const slots = [
      ...rented.map((worker) => ({ worker, community: false, lane: 'full' as const })),
      ...community.map((c) => ({ worker: c.worker, community: true, lane: laneOf(c) })),
    ];

    for (const { worker, community: isCommunity, lane } of slots) {
      if (queued <= 0) break;
      if (isCommunity && lane === 'slow' && !slowLaneOpen(idleFullRows, fullRowsBlocked)) continue;

      const busy = await prisma.aiGpuJob.count({
        where: { workerId: worker.id, status: { in: ['assigned', 'running'] } },
      });
      if (busy > 0) continue;

      // Reserve the machine first. The DB count above is not atomic with the
      // claim below; this conditional flip is, so an overlapping pass (a tick
      // that outlived its lease) finds it busy and moves on.
      const reserved = await prisma.aiGpuWorker.updateMany({
        where: { id: worker.id, status: 'ready' },
        data: { status: 'busy' },
      });
      if (reserved.count === 0) continue;
      const held: AiGpuWorker = { ...worker, status: 'busy' };

      // What the job is to this machine's owner — its free share or paid,
      // Pro or not, whose — fixed now, with the claim, so the earning written
      // after delivery settles the job as it was dispatched. A ledger that
      // could not be read decides nothing (claimStampFor pays the job).
      const stamp = isCommunity
        ? claimStampFor(
            readCommunityMeta(worker.metadata),
            sumsFor(ledger?.byWorker ?? new Map(), worker.externalId),
            ledger?.ok !== false
          )
        : RENTED_CLAIM_STAMP;
      const claim = await this.claimNextJob(modelKey, worker.id, isCommunity, stamp);
      if (!claim.job) {
        await prisma.aiGpuWorker.updateMany({ where: { id: worker.id, status: 'busy' }, data: { status: 'ready' } });
        if (!claim.anyQueued) return { dispatched, failed, remaining: 0 };
        // What is left has all failed on this machine before, or is not for
        // a community machine.
        if (isCommunity && lane === 'full') fullRowsBlocked = true;
        continue;
      }
      // The claim filtered on the job's columns; the payload is the last word.
      // A job carrying the customer's upload never leaves for a home PC, even
      // if its row was written without the flag.
      if (isCommunity) {
        const media = payloadHasInputMedia(claim.job.payload);
        if (media || !isCommunitySafe(claim.job)) {
          await this.unclaim(claim.job, 'Not sent to a community machine: private content or an upload');
          await prisma.aiGpuWorker.updateMany({ where: { id: worker.id, status: 'busy' }, data: { status: 'ready' } });
          // Recorded, so the next claim's filter skips it without loading it.
          if (media && !claim.job.hasInputMedia) {
            await prisma.aiGpuJob.update({ where: { id: claim.job.id }, data: { hasInputMedia: true } }).catch(() => {});
          }
          continue;
        }
      }
      queued -= 1;
      try {
        await this.submitJob(claim.job, held);
        dispatched += 1;
      } catch (error) {
        const plan = planSubmitFailure(error, isCommunity);
        if (plan.requeueWithoutAttempt) {
          await this.requeueRefused(claim.job, held, error as Error);
          queued += 1;
          continue;
        }
        await this.settleFailure(claim.job, held, (error as Error).message, true, { avoidWorker: plan.avoidWorker });
        failed += 1;
      }
    }
    return { dispatched, failed, remaining: queued };
  }

  /**
   * A community node said "not now" — paused by its owner, busy with their
   * own work, or offline (contract C5). Nothing is wrong with the job: it goes
   * back to the queue with its attempt handed back, and the node leaves
   * rotation until the reconciler hears a 200 from its /aixman/ready.
   */
  private static async requeueRefused(job: AiGpuJob, worker: AiGpuWorker, error: Error): Promise<void> {
    const stage = isNodeRefusal(error) ? error.stage : 'unknown';
    await prisma.aiGpuJob.updateMany({
      where: { id: job.id, status: 'assigned' },
      data: {
        status: 'queued',
        workerId: null,
        externalJobId: null,
        startedAt: null,
        attempts: { decrement: 1 },
        errorMessage: `Node #${worker.id} refused (${stage}); requeued without spending an attempt`.slice(0, 1000),
      },
    });
    await prisma.aiGpuWorker.updateMany({
      where: { id: worker.id, status: 'busy' },
      data: { status: 'warming', lastError: `${stageLabel(stage)} (${stage})`.slice(0, 1000) },
    });
    console.log(`[gpu] ${job.modelKey}: community node #${worker.id} refused job ${job.id} (${stage}) — requeued`);
  }

  /** Hand a claimed, never-submitted job back to the queue with its attempt returned. */
  private static async unclaim(job: AiGpuJob, why: string): Promise<void> {
    await prisma.aiGpuJob.updateMany({
      where: { id: job.id, status: 'assigned' },
      data: { status: 'queued', workerId: null, startedAt: null, attempts: { decrement: 1 }, errorMessage: why.slice(0, 1000) },
    });
  }

  /** Whether the fast lane has anything to do — checked before taking the lock. */
  static async hasFastWork(): Promise<boolean> {
    const n = await prisma.aiGpuJob.count({ where: { status: { in: ['queued', 'running'] } } });
    return n > 0;
  }

  /**
   * The lane between minute ticks: collect finished renders and hand queued
   * jobs to machines already up. Nothing is rented, reaped or swept here —
   * that stays on the minute tick, whose pace the budget logic assumes.
   *
   * Without it a finished render was noticed up to a minute late — dead time
   * the customer watched and the machine was billed for — and a machine
   * rendering 20-second images could take only one job a minute.
   */
  static async fastTick(): Promise<{ completed: number; failed: number; dispatched: number }> {
    const cfg = await getGpuConfig();
    const polled = await this.pollRunningJobs(cfg);
    let { failed } = polled;
    let dispatched = 0;

    const pending = await prisma.aiGpuJob.groupBy({
      by: ['modelKey'],
      where: { status: 'queued' },
      _count: { _all: true },
      _min: { queuedAt: true },
    });
    pending.sort((a, b) => (a._min.queuedAt?.getTime() ?? 0) - (b._min.queuedAt?.getTime() ?? 0));
    for (const group of pending) {
      const assigned = await this.assignIdleWorkers(group.modelKey, group._count._all);
      dispatched += assigned.dispatched;
      failed += assigned.failed;
    }
    return { completed: polled.completed, failed, dispatched };
  }

  /**
   * Atomically move the highest-priority queued job to `assigned`.
   * The conditional UPDATE is what guarantees a job is never dispatched twice,
   * even if two ticks somehow overlap.
   */
  private static async claimNextJob(
    modelKey: string,
    workerId: number,
    community: boolean,
    stamp: ClaimStamp = RENTED_CLAIM_STAMP
  ): Promise<{ job: AiGpuJob | null; anyQueued: boolean }> {
    // A community machine is shown only what it may take (general content,
    // nothing uploaded — owner decision D4), so an adult order at the head of
    // the queue cannot hide the general one behind it from the scan.
    const queued = await prisma.aiGpuJob.findMany({
      where: { status: 'queued', modelKey, ...(community ? COMMUNITY_SAFE_JOB : {}) },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
      take: CLAIM_SCAN,
      select: { id: true, avoidWorkerIds: true, contentTier: true, hasInputMedia: true },
    });
    if (queued.length === 0) {
      // "Nothing for this machine" is not "nothing queued": the rest may be
      // for a rented machine, which still has to be asked (or rented).
      const anyQueued = community ? (await prisma.aiGpuJob.count({ where: { status: 'queued', modelKey } })) > 0 : false;
      return { job: null, anyQueued };
    }
    // Not a job that already failed on this machine, and never a private one
    // on a community machine.
    const candidate = pickClaimCandidate(queued, workerId, community);
    if (!candidate) return { job: null, anyQueued: true };

    const claimed = await prisma.aiGpuJob.updateMany({
      where: { id: candidate.id, status: 'queued', ...(community ? COMMUNITY_SAFE_JOB : {}) },
      data: {
        status: 'assigned',
        workerId,
        startedAt: new Date(),
        attempts: { increment: 1 },
        // Every claim writes all three, so a job requeued off a community
        // machine carries nothing of that machine to the next one.
        freeShare: stamp.freeShare,
        pro: stamp.pro,
        ownerUserId: stamp.ownerUserId,
      },
    });
    if (claimed.count === 0) return { job: null, anyQueued: true };

    return { job: await prisma.aiGpuJob.findUnique({ where: { id: candidate.id } }), anyQueued: true };
  }

  private static async submitJob(job: AiGpuJob, worker: AiGpuWorker): Promise<void> {
    if (!worker.endpoint) throw new Error('Worker has no reachable endpoint');

    const profile = await getWorkerProfile(job.modelKey);
    const payload = job.payload as unknown as WorkerJobParams;
    const workflow = await this.workflowFor(job.modelKey, payload.adminRun === true);
    const client = new WorkerClient(
      worker.endpoint,
      profile,
      GpuWorkerManager.readAuthToken(worker),
      job.modelKey,
      workflow,
      { community: GpuWorkerManager.isCommunity(worker.providerSlug) }
    );
    const submitted = await client.submit(payload);
    const { externalJobId } = submitted;

    // From here the GPU is rendering, so recording it must survive a slow
    // moment of the database. A throw used to put the job back in the queue
    // while the machine kept rendering it: the next job sat behind that orphan
    // in ComfyUI's own queue (a 10 min render took 19), and on a last attempt a
    // render that finished would have been refunded.
    //
    // The machine was reserved (ready → busy) before the claim, so 'busy' is
    // only re-asserted over 'ready'/'busy'. A retirement or suspension that
    // landed during the submit (admin DELETE, XMAN Studio's push) is left
    // standing: the poll then sees it and moves the job elsewhere, instead of
    // the retired row reading busy and later 'ready' with work on offer.
    const record = () =>
      prisma.$transaction(async (tx) => {
        await tx.aiGpuJob.update({
          where: { id: job.id },
          data: { status: 'running', externalJobId },
        });
        await tx.aiGpuWorker.updateMany({
          where: { id: worker.id, status: { in: ['ready', 'busy'] }, terminatedAt: null },
          data: { status: 'busy', lastJobAt: new Date() },
        });
        await tx.aiGeneration.update({
          where: { id: job.generationId },
          data: { status: 'processing', startedAt: new Date(), providerJobId: externalJobId },
        });
      }, SLOW_DB_TX);
    try {
      await record().catch(async () => {
        await new Promise((resolve) => setTimeout(resolve, RECORD_RETRY_MS));
        return record();
      });
    } catch (error) {
      // Still unrecorded: this machine is busy with a render nothing tracks.
      // Take it out of rotation so no job queues behind it; the caller puts
      // this one back in the queue for another machine.
      await GpuWorkerManager.drain(worker.id, `Could not record a submitted render: ${(error as Error).message}`)
        .catch(() => {});
      raiseAlert({
        type: 'render-unrecorded',
        key: String(job.id),
        level: 'warning',
        title: 'ส่งงานเข้าเครื่องแล้วแต่บันทึกฐานข้อมูลไม่ได้ — ปิดเครื่องนั้นแล้ว',
        lines: [
          `งาน #${job.generationId} · เครื่อง #${worker.id} (${worker.providerSlug})`,
          `ข้อผิดพลาด: ${(error as Error).message}`,
          'งานถูกส่งไปเครื่องอื่นอัตโนมัติ — ถ้าเกิดบ่อย แปลว่าฐานข้อมูลช้าหรือล่ม',
        ],
      });
      throw error;
    }

    // What was sent, for /admin/workflows. After the job is recorded and never
    // awaited: a slow settings write must not hold the tick.
    void this.rememberSubmission(job, worker, submitted, workflow, payload.adminRun === true).catch((error) =>
      console.error(`[gpu] could not store the submitted graph for ${job.modelKey}:`, (error as Error).message)
    );
  }

  /**
   * The admin's override as it applies to this job — or the catalogue as
   * shipped when there is none, it is switched off, or it is still being tried
   * by admins only and this is a customer's order. A settings read that fails
   * must not stop a render, so it falls back to the catalogue too.
   */
  private static async workflowFor(modelKey: string, adminRun: boolean): Promise<EffectiveWorkflow | null> {
    const entry = getCatalogEntry(modelKey);
    if (!entry) return null;
    const stored = await getStoredWorkflow(modelKey).catch((error) => {
      console.error(`[gpu] could not read the workflow override for ${modelKey}:`, (error as Error).message);
      return null;
    });
    return effectiveWorkflow(entry, stored, adminRun);
  }

  private static async rememberSubmission(
    job: AiGpuJob,
    worker: AiGpuWorker,
    submitted: SubmitResult,
    workflow: EffectiveWorkflow | null,
    adminRun: boolean
  ): Promise<void> {
    if (submitted.fellBack) {
      raiseAlert({
        type: 'workflow-fallback',
        key: job.modelKey,
        level: 'warning',
        title: `กราฟกำหนดเองของ ${job.modelKey} ใช้กับเครื่องจริงไม่ได้ — ระบบใช้ workflow มาตรฐานแทน`,
        lines: [
          `งาน #${job.generationId} · เครื่อง #${worker.id} (${worker.gpuModel ?? worker.providerSlug})`,
          `สาเหตุ: ${submitted.fellBack.slice(0, 300)}`,
          'ลูกค้าไม่เสียงาน แต่กราฟที่แก้ไว้ยังไม่ถูกใช้ — ตรวจที่หน้า Workflow ComfyUI',
        ],
        path: '/admin/workflows',
        cooldownMs: 6 * 60 * 60_000,
      });
    }
    if (!submitted.graph) return;

    await saveLastGraph(job.modelKey, {
      capturedAt: new Date().toISOString(),
      generationId: job.generationId,
      jobId: job.id,
      workerId: worker.id,
      gpuModel: worker.gpuModel,
      overrideVersion: workflow?.version ?? null,
      adminRun,
      custom: submitted.custom === true,
      warnings: submitted.warnings ?? [],
      graph: submitted.graph,
    });

    const last = schemaSavedAt.get(job.modelKey) ?? 0;
    if (submitted.schema && Date.now() - last > SCHEMA_REFRESH_MS) {
      schemaSavedAt.set(job.modelKey, Date.now());
      const existing = await getSchemaSnapshot(job.modelKey);
      // Keep a fresh one; replace anything older than the refresh window.
      if (!existing || existing.source !== 'worker' || Date.now() - Date.parse(existing.capturedAt) > SCHEMA_REFRESH_MS) {
        await saveSchemaSnapshot(job.modelKey, {
          capturedAt: new Date().toISOString(),
          source: 'worker',
          gpuModel: worker.gpuModel,
          classes: submitted.schema,
        });
      }
    }
  }

  // ----------------------------------------------------------------
  // Polling running jobs
  // ----------------------------------------------------------------

  private static async pollRunningJobs(cfg: GpuBudgetConfig): Promise<{ completed: number; failed: number }> {
    const jobs = await prisma.aiGpuJob.findMany({
      where: { status: 'running' },
      include: { worker: true },
    });

    let completed = 0;
    let failed = 0;

    for (const job of jobs) {
      const worker = job.worker;

      // The worker died under the job. Retry on a fresh machine if the job has
      // attempts left — the render is lost either way, but the user shouldn't be.
      // A community machine that merely dropped off the relay is not dead: the
      // reconciler leaves a row with a job alone, its polls read as pending,
      // and the job timeout below is what gives up on it. Only a retirement
      // (XMAN Studio's DELETE, an admin, a refused token) lands here.
      if (!worker || worker.terminatedAt || worker.status === 'terminated') {
        await this.settleFailure(job, worker, 'GPU worker was terminated mid-render', true);
        failed += 1;
        continue;
      }

      const startedAt = job.startedAt ?? job.queuedAt;
      const elapsedMs = Date.now() - startedAt.getTime();
      const jobTimeoutMs = cfg.jobTimeoutMinutes * 60_000;
      const community = GpuWorkerManager.isCommunity(worker.providerSlug);

      try {
        const profile = await getWorkerProfile(job.modelKey);
        const client = new WorkerClient(
          worker.endpoint || '',
          profile,
          GpuWorkerManager.readAuthToken(worker),
          job.modelKey,
          undefined,
          { community }
        );
        const outcome = await client.poll(job.externalJobId as string);

        if (outcome.state === 'completed') {
          if (
            await this.settleSuccess(job, worker, outcome.assetUrls, client, elapsedMs < jobTimeoutMs, outcome.renderSeconds)
          ) {
            completed += 1;
          }
          continue;
        }

        if (outcome.state === 'failed') {
          await this.settleFailure(job, worker, outcome.error, true);
          failed += 1;
          continue;
        }

        if (outcome.state === 'lost') {
          await this.settleFailure(job, worker, outcome.error, true);
          failed += 1;
          continue;
        }

        if (elapsedMs > cfg.jobTimeoutMinutes * 60_000) {
          // A hung render also implies a suspect worker — drain it rather than
          // feeding the next job to the same machine.
          await this.settleFailure(job, worker, `Render exceeded ${cfg.jobTimeoutMinutes} min`, true);
          await GpuWorkerManager.drain(worker.id, 'Job timed out on this worker');
          failed += 1;
        }
      } catch (error) {
        console.error(`[gpu] poll failed for job ${job.id}:`, (error as Error).message);
        if (elapsedMs > jobTimeoutMs) {
          await this.settleFailure(job, worker, `Render exceeded ${cfg.jobTimeoutMinutes} min`, true);
          // A home node that stopped answering for a whole job timeout is
          // checked (draining → re-probed) before it gets another job.
          if (community) await GpuWorkerManager.drain(worker.id, 'Job timed out on this worker').catch(() => {});
          failed += 1;
        }
      }
    }

    return { completed, failed };
  }

  /** Jobs claimed but never submitted (process crashed between the two). */
  private static async requeueStaleAssignments(): Promise<void> {
    const cutoff = new Date(Date.now() - ASSIGN_STALE_MS);
    const stale = await prisma.aiGpuJob.findMany({
      where: { status: 'assigned', startedAt: { lt: cutoff } },
    });

    for (const job of stale) {
      await this.settleFailure(job, null, 'Dispatch was interrupted before the job started', true);
    }
  }

  // ----------------------------------------------------------------
  // Settlement
  // ----------------------------------------------------------------

  /**
   * Returns false when the job was left running to be collected on a later
   * poll (a community node that went offline between finishing and handing
   * over its file); true when it was settled one way or the other.
   */
  private static async settleSuccess(
    job: AiGpuJob,
    worker: AiGpuWorker,
    assetUrls: string[],
    client: WorkerClient,
    mayWait: boolean,
    /** How long the node says the prompt executed (ComfyUI's own timestamps), when it says. */
    nodeRenderSeconds?: number
  ): Promise<boolean> {
    // The asset lives on the worker's Cloudflare tunnel, which dies the moment
    // the machine is reaped. Copying it to R2 is mandatory, not best-effort —
    // `persistAssetSafe` would hand back a URL that breaks minutes later.
    if (!isStorageConfigured()) {
      await this.settleFailure(
        job,
        worker,
        'R2 storage is not configured. GPU-rendered videos cannot be kept once the worker is released.',
        false,
        { countAgainstModel: false }
      );
      return true;
    }

    const generation = await prisma.aiGeneration.findUnique({ where: { id: job.generationId } });
    const prefix = `generations/${generation?.userId ?? 'unknown'}/${job.generationId}`;
    const community = GpuWorkerManager.isCommunity(worker.providerSlug);
    const entry = getCatalogEntry(job.modelKey);
    // Why a community render is delivered but its earning held for an admin.
    const reviewNotes: string[] = [];

    let durableUrls: string[];
    try {
      // Downloaded through the worker client so the request carries the
      // worker's bearer token — a bare fetch would be rejected by a container
      // that correctly gates its port. Every file is fetched (and, from a home
      // PC, examined) before any is stored, so a rejected one leaves nothing
      // behind in R2.
      const files = community
        ? await this.collectCommunityFiles(job, worker, assetUrls, client, entry?.outputKind ?? null, reviewNotes)
        : await Promise.all(
            assetUrls.map(async (url) => {
              const downloaded = await client.download(url);
              return { url, buffer: downloaded.buffer, contentType: downloaded.contentType };
            })
          );
      durableUrls = await Promise.all(
        files.map(({ url, buffer, contentType }) => {
          const key = `${prefix}/${Date.now()}-${randomBytes(6).toString('hex')}.${extensionFor(contentType, url)}`;
          return uploadBuffer(buffer, key, contentType);
        })
      );
    } catch (error) {
      const message = (error as Error).message;
      // A home node that paused or dropped off the relay after finishing
      // still has the file. Paying for the render again elsewhere (and not
      // paying its owner) would be worse than waiting — up to the job timeout.
      if (mayWait && isNodeRefusal(error) && community) {
        console.warn(`[gpu] job ${job.id}: community node #${worker.id} finished but is not handing over yet (${error.stage}) — will retry`);
        return false;
      }
      // Not a render of this model at all — or a blank, a sliver, more bytes
      // than any render could be. The customer never sees it, the job moves
      // to another machine (settleFailure adds this one to its avoid list
      // and parks it until it answers /aixman/ready again), and the node is
      // paid nothing, because it delivered nothing. An honest node lands here
      // only when broken (a VAE rendering black), so an admin hears about
      // each one.
      if (isRejectedOutput(error)) {
        await this.settleFailure(job, worker, `Rejected community render: ${message}`, true, { countAgainstModel: false });
        const owner = readCommunityMeta(worker.metadata).ownerUserId;
        raiseAlert({
          type: 'gpux-output-rejected',
          key: String(worker.id),
          level: 'warning',
          title: 'เครื่องชุมชนส่งไฟล์ที่ไม่ใช่ผลงาน — ไม่ส่งให้ลูกค้า และส่งงานไปเครื่องอื่นแล้ว',
          lines: [
            `เครื่อง #${worker.id} (${worker.externalId}${owner ? ` · เจ้าของ user #${owner}` : ''}) · งาน #${job.generationId} (${job.modelKey})`,
            `สาเหตุ: ${message}`,
            'ถ้าเกิดซ้ำจากเครื่องเดิม อาจเป็นโปรแกรมที่ถูกดัดแปลง — ระงับเครื่องได้ที่ XMAN Studio หรือปลดที่ แอดมิน → GPU → เครื่องชุมชน',
          ],
        });
        return true;
      }
      // The render finished — what failed was carrying it home. That is the
      // tunnel's fault or R2's, never the model's, so it must not count
      // towards the model's failure streak (same reasoning as the
      // no-storage branch above).
      await this.settleFailure(job, worker, `Failed to save render: ${message}`, true, {
        countAgainstModel: false,
      });
      // And the machine goes. A tunnel that could not deliver these bytes will
      // not deliver the retry's either: job #100 spent both of its attempts on
      // one stalled worker and the customer got a refund instead of the song
      // that was sitting there finished. Draining takes it out of
      // `assignIdleWorkers` (which only looks at 'ready'), so the retry lands
      // on a fresh rental. Ordered after settleFailure, which writes the
      // worker row back from the copy it was handed.
      await GpuWorkerManager.drain(worker.id, `Could not deliver a finished render: ${message}`).catch(
        (err) => console.error('[gpu] could not drain a worker that failed to deliver:', (err as Error).message)
      );
      return true;
    }

    const now = new Date();
    const startedAt = job.startedAt ?? job.queuedAt;
    const gpuSeconds = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));
    if (community) {
      // Claim-to-delivery is an upper bound on the render; the node's own
      // execution timestamps, when it sends them, are tighter. Either being
      // under what the lane allows holds the earning for an admin.
      const wall = Math.max(0, (now.getTime() - startedAt.getTime()) / 1000);
      const observed = typeof nodeRenderSeconds === 'number' ? Math.min(wall, nodeRenderSeconds) : wall;
      const tooFast = judgeRenderTime({
        observedSeconds: observed,
        baselineSecondsPerUnit: entry?.baselineSecondsPerUnit,
        lane: readCommunityMeta(worker.metadata).lane,
      });
      if (tooFast) reviewNotes.push(tooFast);
    }
    const reviewReason = community ? joinReviewReasons(reviewNotes) : null;
    // Per-job cost covers only the seconds this job held the GPU. Warmup and
    // idle time are real spend too — they are tracked on the worker row, which
    // is the number to trust for margin analysis.
    const costUsd = (gpuSeconds / 3600) * Number(worker.pricePerHourUsd);
    const processingMs = now.getTime() - startedAt.getTime();

    // If this still fails the job stays 'running' and the next tick finds the
    // same finished render and settles it again.
    await prisma.$transaction(async (tx) => {
      await tx.aiGpuJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          resultUrl: durableUrls[0],
          gpuSeconds,
          costUsd,
          completedAt: now,
          errorMessage: null,
          reviewReason,
        },
      });
      await tx.aiGeneration.update({
        where: { id: job.generationId },
        data: {
          status: 'completed',
          resultUrl: durableUrls[0],
          resultUrls: durableUrls as unknown as Prisma.InputJsonValue,
          thumbnailUrl: durableUrls[0],
          costUsd,
          processingMs,
          completedAt: now,
          errorMessage: null,
        },
      });
      await tx.aiGpuWorker.update({
        where: { id: worker.id },
        data: { jobsCompleted: { increment: 1 }, lastJobAt: now },
      });
      // Released only if it is still the busy machine it was when this poll
      // read it: the download can take minutes, and a retirement, a
      // suspension or a drain made meanwhile must stand. Writing back the
      // status read before the loop turned a just-retired node 'ready', and
      // the same tick handed it the next customer's prompt.
      await tx.aiGpuWorker.updateMany({
        where: { id: worker.id, status: 'busy', terminatedAt: null },
        data: { status: 'ready' },
      });
    }, SLOW_DB_TX);

    // The render is in R2 and delivered: a home PC is told to forget the job
    // (the customer's prompt is in its ComfyUI history, the image in its
    // output folder). Only now — deleting the history before the delivery was
    // recorded would make a retried settle read the render as lost. Not
    // awaited, and it never throws: the customer has their render whatever
    // the node answers, and a node that did not confirm is asked again by
    // purgeDeliveredOnNodes while it is up.
    if (community && job.externalJobId) {
      void this.purgeOnNode(job.id, job.externalJobId, worker, true);
    }

    // The node's owner is owed for it (gpux-ledger.ts): written now, after the
    // delivery is on record and outside its transaction, so a ledger that
    // cannot be written never costs the customer their render. It never
    // throws; a row it could not write is found by the tick's sweep.
    if (community) {
      if (reviewReason) console.warn(`[gpux] job ${job.id}: delivered, earning held for review — ${reviewReason}`);
      await recordEarningSafely(job.id, 'delivery');
    }

    // Fix the retention window at delivery time, same as the synchronous path.
    const { RetentionService } = await import('./retention');
    await RetentionService.stampExpiry(job.generationId, now);

    // First success is what promotes a self-hosted model out of 'tuning'.
    if (generation?.modelId) await ModelReadiness.recordSuccess(generation.modelId);
    return true;
  }

  /**
   * A home PC's files for one job, fetched one at a time and judged as each
   * arrives. The node decides what /history lists and what /view sends, so
   * nothing it says is taken on trust:
   *   - at most MAX_COMMUNITY_OUTPUTS files, the model's own kind first
   *     (collectComfyOutputs sorts them so);
   *   - together no more than the model's MAX_COMMUNITY_OUTPUT_BYTES, each
   *     download stopped the moment it would cross what is left — a node
   *     streaming garbage cannot fill the server's memory;
   *   - each file is what its bytes are, not what its Content-Type says:
   *     serving an HTML page as the customer's "image" from our storage is a
   *     script on our domain. Stored as the sniffed type; rejected when it is
   *     not the model's kind of media, or not a picture anyone ordered
   *     (community-plausibility.ts).
   * Throws RejectedOutputError for any of those; one file rejected stops the
   * rest from being fetched.
   */
  private static async collectCommunityFiles(
    job: AiGpuJob,
    worker: AiGpuWorker,
    assetUrls: string[],
    client: WorkerClient,
    expected: 'image' | 'video' | 'audio' | null,
    reviewNotes: string[]
  ): Promise<{ url: string; buffer: Buffer; contentType: string }[]> {
    const urls = assetUrls.slice(0, MAX_COMMUNITY_OUTPUTS);
    if (assetUrls.length > urls.length) {
      console.warn(
        `[gpu] job ${job.id}: community node #${worker.id} listed ${assetUrls.length} outputs; taking the first ${urls.length}`
      );
    }
    const budget = communityOutputBudget(expected);
    let left = budget;
    const files: { url: string; buffer: Buffer; contentType: string }[] = [];
    for (const url of urls) {
      if (left <= 0) throw new RejectedOutputError(oversizeReason(budget));
      const downloaded = await client.download(url, { maxBytes: left });
      left -= downloaded.buffer.byteLength;
      const examined = await examineOutput(downloaded.buffer, expected);
      if (examined.reject) throw new RejectedOutputError(examined.reject);
      if (examined.review) reviewNotes.push(examined.review);
      files.push({ url, buffer: downloaded.buffer, contentType: examined.mime });
    }
    return files;
  }

  /**
   * Ask a community node to delete one job's files and history (contract C5)
   * and, when `track`, record that it did. Never throws.
   */
  private static async purgeOnNode(
    jobId: number,
    promptId: string,
    worker: Pick<AiGpuWorker, 'id' | 'endpoint' | 'authToken'>,
    track: boolean
  ): Promise<boolean> {
    const workerId = worker.id;
    if (!worker.endpoint) return false;
    try {
      const outcome = await purgeCommunityJob(worker.endpoint, GpuWorkerManager.readAuthToken(worker), promptId);
      if (!outcome.done) {
        console.warn(`[gpu] job ${jobId}: community node #${workerId} has not purged it yet — ${outcome.detail}`);
        return false;
      }
      if (track) {
        await prisma.aiGpuJob.updateMany({ where: { id: jobId, nodePurgedAt: null }, data: { nodePurgedAt: new Date() } });
      }
      if (outcome.files === 'unsupported' && outcome.history === 'deleted') {
        console.log(`[gpu] job ${jobId}: node #${workerId} deleted the history; its build has no /aixman/purge for the files`);
      } else if (outcome.detail) {
        // A permanent "no" — asking again would get the same answer.
        console.warn(`[gpu] job ${jobId}: node #${workerId} refused part of the purge, not asking again — ${outcome.detail}`);
      }
      return true;
    } catch (error) {
      console.warn(`[gpu] job ${jobId}: purge on node #${workerId} failed:`, (error as Error).message);
      return false;
    }
  }

  /**
   * Retry the purge of community jobs delivered in the last day that their
   * node never confirmed — it went offline, paused, or dropped the call.
   * Only nodes that are up (ready/busy) are asked, so a relay that is down
   * costs nothing; a handful per tick, all at once, each call bounded.
   */
  private static async purgeDeliveredOnNodes(): Promise<void> {
    const now = Date.now();
    // Asked within the last PURGE_RETRY_EVERY_MS: skipped in the query itself,
    // so jobs a node keeps failing cannot crowd out the ones behind them.
    const recent: number[] = [];
    for (const [id, at] of purgeAttemptedAt) {
      if (now - at >= PURGE_RETRY_EVERY_MS) purgeAttemptedAt.delete(id);
      else recent.push(id);
    }
    const due = await prisma.aiGpuJob.findMany({
      where: {
        status: 'completed',
        nodePurgedAt: null,
        ...(recent.length > 0 ? { id: { notIn: recent } } : {}),
        externalJobId: { not: null },
        completedAt: { gte: new Date(now - PURGE_RETRY_WINDOW_MS), lte: new Date(now - PURGE_RETRY_AFTER_MS) },
        worker: {
          providerSlug: { in: [...COMMUNITY_PROVIDER_SLUGS] },
          status: { in: ['ready', 'busy'] },
          endpoint: { not: null },
        },
      },
      include: { worker: true },
      orderBy: { completedAt: 'asc' },
      take: PURGE_SWEEP_BATCH,
    });
    for (const job of due) purgeAttemptedAt.set(job.id, now);
    await Promise.allSettled(
      due.map(async (job) => {
        if (!job.worker || !job.externalJobId) return;
        await this.purgeOnNode(job.id, job.externalJobId, job.worker, true);
      })
    );
  }

  /**
   * Fail a job, retrying it on a fresh worker when attempts remain.
   * On terminal failure the user's credits are refunded.
   */
  private static async settleFailure(
    job: AiGpuJob,
    worker: AiGpuWorker | null,
    message: string,
    retryable: boolean,
    { countAgainstModel = true, avoidWorker }: { countAgainstModel?: boolean; avoidWorker?: boolean } = {}
  ): Promise<void> {
    const now = new Date();
    const canRetry = retryable && job.attempts < job.maxAttempts;
    // One home PC failing — a checkpoint its owner deleted, a flaky uplink —
    // says nothing about the model, and must not take it off sale for every
    // customer. Nor does it teach the rental picker anything about a card.
    const community = worker ? GpuWorkerManager.isCommunity(worker.providerSlug) : false;
    const counts = countAgainstModel && !community;
    // A card type that cannot run this model is avoided from now on, and its
    // failure is not the model's (GpuWorkerManager.noteRenderFailure).
    const cardFault = community
      ? false
      : await GpuWorkerManager.noteRenderFailure(job.modelKey, worker, message).catch(() => false);

    // Whatever became of the render, the customer's prompt sits in that home
    // PC's ComfyUI history: ask it to forget the job, once, without waiting.
    // (A node that is offline keeps it until its own clean-up.)
    if (worker && community && job.externalJobId) {
      void this.purgeOnNode(job.id, job.externalJobId, worker, false);
    }

    if (worker) {
      await prisma.aiGpuWorker.update({
        where: { id: worker.id },
        data: {
          jobsFailed: { increment: 1 },
          lastJobAt: now,
          lastError: message.slice(0, 1000),
        },
      });
      // Free a machine this job was holding — only if it is still the busy
      // it was: writing back the status read before the job ran would undo a
      // drain made since (submitJob drains a machine it could not record). A
      // community machine is not trusted straight back into rotation: it is
      // asked (/aixman/ready) on the next tick first.
      if (worker.status === 'busy') {
        await prisma.aiGpuWorker.updateMany({
          where: { id: worker.id, status: 'busy' },
          data: { status: community ? 'warming' : 'ready' },
        });
      }
    }

    if (canRetry) {
      await prisma.aiGpuJob.update({
        where: { id: job.id },
        data: {
          status: 'queued',
          workerId: null,
          externalJobId: null,
          startedAt: null,
          errorMessage: `Attempt ${job.attempts} failed: ${message}`.slice(0, 1000),
          // The retry goes to another home PC, not the one that just failed it.
          ...(worker && community && (avoidWorker ?? true)
            ? { avoidWorkerIds: withAvoided(job.avoidWorkerIds, worker.id) }
            : {}),
        },
      });
      await prisma.aiGeneration.update({
        where: { id: job.generationId },
        data: { status: 'pending' },
      });
      return;
    }

    const generation = await prisma.aiGeneration.findUnique({ where: { id: job.generationId } });

    await prisma.aiGpuJob.update({
      where: { id: job.id },
      data: { status: 'failed', errorMessage: message.slice(0, 1000), completedAt: now },
    });
    await prisma.aiGeneration.update({
      where: { id: job.generationId },
      // The generation's message is shown verbatim in the UI, so it carries the
      // Thai summary; the raw technical text stays on the job row for admins.
      data: { status: 'failed', errorMessage: userFacingError(message), completedAt: now },
    });

    if (generation && generation.creditsUsed > 0) {
      await GenerationService.refundCredits(generation.userId, generation.creditsUsed, generation.id);
    }

    // A model failing repeatedly stops taking orders rather than quietly
    // burning credits — one failure is not enough, a spot host can vanish.
    // An admin experiment (a preset customers cannot order, e.g. H3 at 1080p
    // running out of memory) says nothing about the model they do order.
    const extra = (job.payload as { extra?: { resolution?: unknown } } | null)?.extra;
    const experiment = isAdminOnlyPreset(job.modelKey, extra?.resolution);
    if (counts && !experiment && !cardFault && generation?.modelId) {
      await ModelReadiness.recordFailure(generation.modelId, message);
    }

    // Several renders failing close together is a pattern worth a look even
    // when each one was refunded. Only failures on a machine count: an admin's
    // stop, a stale-queue refund and a config error are not render failures,
    // and the last two have alerts of their own.
    if (counts && !experiment) {
      const recent = await prisma.aiGpuJob
        .count({
          where: {
            status: 'failed',
            workerId: { not: null },
            completedAt: { gte: new Date(now.getTime() - FAILURE_BURST_WINDOW_MS) },
            NOT: { errorMessage: { startsWith: 'Stopped by admin' } },
          },
        })
        .catch(() => 0);
      if (recent >= FAILURE_BURST_COUNT) {
        raiseAlert({
          type: 'failure-burst',
          level: 'warning',
          title: `งานล้ม ${recent} งานใน ${FAILURE_BURST_WINDOW_MS / 60_000} นาทีล่าสุด`,
          lines: [
            `ล่าสุด: งาน #${job.generationId} (${job.modelKey}) — ${message}`,
            'เครดิตคืนให้ลูกค้าอัตโนมัติแล้ว — ดูสาเหตุในตาราง "งานล่าสุด" ที่หน้า GPU',
          ],
        });
      }
    }
  }

  /**
   * Refund every job that has not finished — the job half of an emergency stop.
   *
   * Terminating machines alone does not stop anything: a render cut off
   * mid-way is retryable, so the next tick re-queues it and rents a fresh
   * machine, and queued jobs keep customers' credits held until the stale-queue
   * sweep runs out (warmup + job timeout, 90 min by default). Call this with
   * rental already switched off, so nothing it fails can be picked up again.
   */
  static async cancelAllPending(message: string): Promise<number> {
    const jobs = await prisma.aiGpuJob.findMany({
      where: { status: { in: ['queued', 'assigned', 'running'] } },
    });
    for (const job of jobs) {
      // An admin decision says nothing about the model — keep it on sale.
      await this.settleFailure(job, null, message, false, { countAgainstModel: false });
    }
    return jobs.length;
  }

  /** Terminal-fail every queued job for a model whose configuration cannot work. */
  private static async failAllQueued(modelKey: string, message: string): Promise<number> {
    const jobs = await prisma.aiGpuJob.findMany({ where: { status: 'queued', modelKey } });
    for (const job of jobs) {
      // The setup is at fault, not the model — do not pull it from sale.
      await this.settleFailure(job, null, message, false, { countAgainstModel: false });
    }
    return jobs.length;
  }

  /**
   * Refund every queued job of a community-only model that no community
   * machine may take: adult or unreadable words, or a customer's upload
   * (owner decision D4). The model has no other pool, so waiting would only
   * hold the customer's credits until the stale sweep.
   */
  private static async failPrivateCommunityJobs(modelKey: string): Promise<number> {
    const jobs = await prisma.aiGpuJob.findMany({
      where: { status: 'queued', modelKey, OR: [{ contentTier: { not: 'general' } }, { hasInputMedia: true }] },
    });
    for (const job of jobs) {
      const what = job.hasInputMedia ? `an upload (content tier ${job.contentTier})` : `content tier ${job.contentTier}`;
      // The order is at fault, not the model — keep it on sale.
      await this.settleFailure(
        job,
        null,
        `${PRIVATE_FOR_COMMUNITY_PREFIX}: ${what}, and ${modelKey} runs only on community machines`,
        false,
        { countAgainstModel: false }
      );
    }
    if (jobs.length > 0) console.log(`[gpu] ${modelKey}: refunded ${jobs.length} job(s) no community machine may take`);
    return jobs.length;
  }

  /**
   * Refund jobs that have waited too long for a machine that never came.
   *
   * Transient vendor errors, an empty market or a spent budget all leave jobs
   * queued so a later tick can serve them — which, unbounded, means credits held
   * forever for a render that never starts. A job is stuck once it has waited
   * the full warmup-plus-render allowance *and* no worker for its model is
   * serving. A long queue behind a working GPU is not stuck.
   *
   * A vendor balance too low to rent is different: nothing will change until
   * someone tops it up, and they have just been alerted. Jobs get a short grace
   * for that instead of 90 minutes (two waited that long on 2026-09-13).
   */
  private static async failStuckQueued(cfg: GpuBudgetConfig, reason: string | undefined): Promise<number> {
    const balance = await GpuBalance.read(cfg);
    const paused = balance.state === 'insufficient';
    const rentalAllowanceMs = paused
      ? INSUFFICIENT_BALANCE_GRACE_MS
      : (cfg.warmupTimeoutMinutes + cfg.jobTimeoutMinutes) * 60_000;
    // A community-only model rents nothing, so there is no boot to wait out:
    // its jobs get a short grace for a home PC to come back (owner decision
    // D5), whatever the vendor balance says.
    const communityAllowanceMs = communityQueueGraceMs();
    const now = Date.now();
    await this.noteCommunityServing(now);
    const cutoff = new Date(now - Math.min(rentalAllowanceMs, communityAllowanceMs));
    const stale = await prisma.aiGpuJob.findMany({
      where: { status: 'queued', queuedAt: { lt: cutoff } },
    });
    if (stale.length === 0) return 0;

    let failed = 0;
    let communityFailed = 0;
    const serving = new Map<string, boolean>();
    const poolRows = new Map<string, { id: number; readyAt: Date | null; lastJobAt: Date | null }[]>();
    for (const job of stale) {
      const communityOnly = isCommunityOnlyModel(job.modelKey);
      const allowanceMs = communityOnly ? communityAllowanceMs : rentalAllowanceMs;
      if (now - job.queuedAt.getTime() < allowanceMs) continue;

      // A machine this job already failed on will never be offered it again,
      // so it is not "serving" this job — without this a job that failed on
      // the only home node would wait for it forever with the credits held.
      // Home nodes count only for models they may run, and only for work
      // they may be given (general, nothing uploaded).
      const avoid = readAvoidList(job.avoidWorkerIds);
      const community = isCommunityModel(job.modelKey) && isCommunitySafe(job);
      const key = `${job.modelKey}|${community}|${avoid.join(',')}`;
      if (!serving.has(key)) {
        serving.set(key, await this.anyMachineServing(job.modelKey, { rented: !communityOnly, community, paused, avoid }));
      }
      if (serving.get(key)) continue;

      // A community-only job's grace runs from when its pool went dark, not
      // from when it was ordered: a queue that waited behind a busy node is
      // not refunded the first tick that node reads 'warming' (a failed job,
      // a thirty-second pause), only once no machine for it has been seen
      // for the whole grace.
      if (communityOnly && community) {
        if (!poolRows.has(job.modelKey)) {
          poolRows.set(
            job.modelKey,
            await prisma.aiGpuWorker.findMany({
              where: { modelKey: job.modelKey, providerSlug: { in: [...COMMUNITY_PROVIDER_SLUGS] }, terminatedAt: null },
              select: { id: true, readyAt: true, lastJobAt: true },
              take: 500,
            })
          );
        }
        const lastServing = communityLastServingAt(poolRows.get(job.modelKey) ?? [], communitySeenServingAt, avoid, PROCESS_STARTED_AT);
        if (lastServing !== null && now - Math.max(job.queuedAt.getTime(), lastServing) < allowanceMs) continue;
      }

      const minutes = Math.round(allowanceMs / 60_000);
      await this.settleFailure(
        job,
        null,
        communityOnly
          ? `${NO_COMMUNITY_MACHINE_PREFIX} ${minutes} min`
          : paused
            ? `${RENDERING_PAUSED_PREFIX} — provider balance $${(balance.usd ?? 0).toFixed(2)} cannot rent a machine (waited ${minutes} min)`
            : `No suitable GPU available within ${minutes} min${reason ? `: ${reason}` : ''}`,
        false,
        // Market shortage, a spent budget, an empty balance or owners who
        // are all away says nothing about the model.
        { countAgainstModel: false }
      );
      if (communityOnly) communityFailed += 1;
      else failed += 1;
    }
    if (failed > 0) {
      raiseAlert({
        type: 'stuck-refund',
        level: 'warning',
        title: `งานรอเครื่องนานเกินกำหนด — ยกเลิกและคืนเครดิต ${failed} งาน`,
        lines: [
          paused
            ? `สาเหตุ: ยอดเงินผู้ให้เช่าไม่พอเช่าเครื่อง ($${(balance.usd ?? 0).toFixed(2)}) — เติมเงินแล้วกด "อ่านยอดใหม่" ที่หน้า GPU`
            : `สาเหตุ: ${reason ?? 'ไม่มีเครื่องที่ตรงเงื่อนไขในเวลาที่กำหนด'}`,
        ],
      });
    }
    if (communityFailed > 0) {
      raiseAlert({
        type: 'stuck-refund',
        key: 'community',
        level: 'warning',
        title: `งานโมเดลเครื่องชุมชนไม่มีเครื่องรับภายใน ${Math.round(communityAllowanceMs / 60_000)} นาที — ยกเลิกและคืนเครดิต ${communityFailed} งาน`,
        lines: [
          'ไม่มีเครื่อง GPUxMINE ที่พร้อมรับงานโมเดลนี้ (ออฟไลน์ / เจ้าของพักการแชร์ / ติดงานของตัวเอง) — โมเดลเครื่องชุมชนไม่เช่าเครื่องแทน',
          'ดูสถานะรายเครื่องที่ แอดมิน → GPU → เครื่องชุมชน',
        ],
      });
    }
    return failed + communityFailed;
  }

  /**
   * Remember which community rows are taking work right now
   * (communitySeenServingAt). Once a tick; one small query. Entries for rows
   * that stopped existing are dropped after a day, so the map cannot grow.
   */
  private static async noteCommunityServing(now: number): Promise<void> {
    try {
      const up = await prisma.aiGpuWorker.findMany({
        where: { providerSlug: { in: [...COMMUNITY_PROVIDER_SLUGS] }, status: { in: ['ready', 'busy'] }, terminatedAt: null },
        select: { id: true },
        take: 5_000,
      });
      for (const { id } of up) communitySeenServingAt.set(id, now);
      for (const [id, at] of communitySeenServingAt) {
        if (now - at > 24 * 3_600_000) communitySeenServingAt.delete(id);
      }
    } catch (error) {
      // Only the grace's starting point is lost for a tick: it falls back to readyAt/lastJobAt.
      console.error('[gpu] could not note serving community machines:', (error as Error).message);
    }
  }

  /**
   * Whether any machine that may take this job is taking work: rented ones
   * (up, or on their way while the balance is paused — the same test as
   * GpuBalance.pausesModel) and community ones that are up. A warming home
   * PC is paused or offline, not on its way. A retired row never counts,
   * whatever its status says.
   */
  private static async anyMachineServing(
    modelKey: string,
    opts: { rented: boolean; community: boolean; paused: boolean; avoid: number[] }
  ): Promise<boolean> {
    const pools: Prisma.AiGpuWorkerWhereInput[] = [];
    if (opts.rented) {
      pools.push({ ...RENTED_ONLY, status: { in: opts.paused ? ['provisioning', 'warming', 'ready', 'busy'] : ['ready', 'busy'] } });
    }
    if (opts.community) {
      pools.push({ providerSlug: { in: [...COMMUNITY_PROVIDER_SLUGS] }, status: { in: ['ready', 'busy'] } });
    }
    if (pools.length === 0) return false;
    const count = await prisma.aiGpuWorker.count({
      where: { modelKey, terminatedAt: null, OR: pools, ...(opts.avoid.length > 0 ? { id: { notIn: opts.avoid } } : {}) },
    });
    return count > 0;
  }

  // ----------------------------------------------------------------
  // Read models
  // ----------------------------------------------------------------

  /** Queue position for a pending generation, for the "คิวที่ N" UI. */
  static async getQueuePosition(generationId: number): Promise<number | null> {
    const job = await prisma.aiGpuJob.findUnique({ where: { generationId } });
    if (!job || job.status !== 'queued') return null;

    const ahead = await prisma.aiGpuJob.count({
      where: {
        status: 'queued',
        modelKey: job.modelKey,
        OR: [
          { priority: { gt: job.priority } },
          { priority: job.priority, queuedAt: { lt: job.queuedAt } },
        ],
      },
    });
    return ahead + 1;
  }
}

/**
 * Translate an internal failure into Thai UI copy.
 *
 * Raw messages carry endpoints, provider names and stack detail — useful to an
 * admin, but noise to a user and needless attack-surface disclosure. Credits are
 * always refunded on these paths, so every message says so.
 */
function userFacingError(technical: string): string {
  const REFUNDED = ' (คืนเครดิตแล้ว)';

  // How the work is run is not the customer's concern (and is a trade
  // secret): no message here names machines, GPUs, renting or providers.
  //
  // An empty vendor balance first: "queue too busy" was false — nothing was
  // queued ahead, rendering had simply stopped until someone paid.
  if (technical.startsWith(RENDERING_PAUSED_PREFIX) || /balance too low/i.test(technical)) {
    return RENDERING_PAUSED_MESSAGE + REFUNDED;
  }
  // A community-only model (its name says เครื่องชุมชน, so saying so here
  // gives nothing away): no home PC took the job, or the job was never one a
  // home PC may be given.
  if (technical.startsWith(NO_COMMUNITY_MACHINE_PREFIX)) {
    return 'ตอนนี้ไม่มีเครื่องชุมชนว่างรับงานโมเดลนี้ กรุณาลองใหม่ภายหลัง หรือเลือกโมเดลอื่น' + REFUNDED;
  }
  if (technical.startsWith(PRIVATE_FOR_COMMUNITY_PREFIX)) {
    return 'โมเดลเครื่องชุมชนรับเฉพาะงานเนื้อหาทั่วไปที่ไม่มีไฟล์แนบ กรุณาเลือกโมเดลอื่น' + REFUNDED;
  }
  // Checked before the rest: it quotes the last vendor reason, which can itself
  // contain "timeout" or "budget" and would otherwise be misread below.
  if (/^No suitable GPU available within/i.test(technical)) {
    return 'คิวหนาแน่นเกินเวลาที่กำหนด กรุณาลองใหม่ภายหลัง' + REFUNDED;
  }
  if (/^Stopped by admin/i.test(technical)) {
    return 'ผู้ดูแลระบบหยุดระบบสร้างงานชั่วคราว กรุณาลองใหม่ภายหลัง' + REFUNDED;
  }
  if (/terminated mid-render|worker was terminated|no longer exists/i.test(technical)) {
    return 'ระบบขัดข้องระหว่างสร้างงาน กรุณาลองใหม่อีกครั้ง' + REFUNDED;
  }
  if (/exceeded \d+ min|timed out|timeout/i.test(technical)) {
    return 'ใช้เวลาสร้างนานเกินกำหนด กรุณาลองใหม่หรือลดความยาวคลิป' + REFUNDED;
  }
  if (/no container image|workflow|invalid nodes|profile|R2 storage is not configured|No active API key/i.test(technical)) {
    return 'โมเดลนี้ยังตั้งค่าไม่เสร็จ กรุณาติดต่อผู้ดูแลระบบ' + REFUNDED;
  }
  if (/Failed to save render/i.test(technical)) {
    return 'บันทึกไฟล์ผลลัพธ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' + REFUNDED;
  }
  if (/budget|capacity/i.test(technical)) {
    return 'ระบบไม่ว่างอยู่ในขณะนี้ กรุณาลองใหม่ภายหลัง' + REFUNDED;
  }
  if (/no .* GPU available|No available/i.test(technical)) {
    return 'คิวเต็มอยู่ในขณะนี้ กรุณาลองใหม่ภายหลัง' + REFUNDED;
  }
  return 'สร้างผลงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' + REFUNDED;
}

/**
 * File extension for a stored render. Content-Type is trusted first, with the
 * URL's own extension as a fallback, because ComfyUI's /view endpoint serves
 * a generic type for some video nodes.
 */
function extensionFor(contentType: string, url: string): string {
  const byType: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    // Music models (ACE-Step saves FLAC).
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'image/avif': 'avif',
    'video/x-matroska': 'mkv',
    'video/x-msvideo': 'avi',
  };
  const hit = byType[contentType.split(';')[0].trim().toLowerCase()];
  if (hit) return hit;

  const fromUrl = /filename=([^&]+)/.exec(url)?.[1] ?? url;
  const ext = /\.([a-z0-9]{2,5})(?:$|[?&])/i.exec(decodeURIComponent(fromUrl))?.[1];
  return ext?.toLowerCase() ?? 'mp4';
}
