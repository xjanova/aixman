import { randomBytes } from 'crypto';
import prisma, { SLOW_DB_TX } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import type { AiGpuJob, AiGpuWorker } from '@/generated/prisma/client';
import { getGpuConfig, getWorkerProfile, type GpuBudgetConfig } from '@/lib/gpu/config';
import { isAdminOnlyPreset } from '@/lib/gpu/catalog';
import { WorkerClient, type WorkerJobParams } from '@/lib/gpu/worker-client';
import { GpuWorkerManager } from './gpu-worker';
import { GpuBalance, INSUFFICIENT_BALANCE_GRACE_MS, RENDERING_PAUSED_MESSAGE } from './gpu-balance';
import { maybeSendDailyReport } from './gpu-report';
import { GenerationService } from './generation';
import { ModelReadiness } from './model-readiness';
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

/** Pause before the one retry of recording a render that was just submitted. */
const RECORD_RETRY_MS = 2_000;

/** Job failure reason when the vendor balance cannot rent; `userFacingError` matches it. */
const RENDERING_PAUSED_PREFIX = 'Rendering paused';

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
}

export class GpuQueue {
  /** Add a generation to the queue. The next tick picks it up. */
  static async enqueue({ generationId, modelKey, payload, priority = 50 }: EnqueueParams): Promise<AiGpuJob> {
    return prisma.aiGpuJob.create({
      data: {
        generationId,
        modelKey,
        priority,
        status: 'queued',
        payload: payload as unknown as Prisma.InputJsonValue,
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

    const dispatched = await this.dispatchQueued(cfg);
    report.dispatched = dispatched.dispatched;
    report.failed += dispatched.failed;
    if (dispatched.reason) report.reason = dispatched.reason;

    report.failed += await this.failStuckQueued(cfg, dispatched.reason);

    report.queued = await prisma.aiGpuJob.count({ where: { status: 'queued' } });
    report.liveWorkers = await prisma.aiGpuWorker.count({
      where: { status: { in: ['provisioning', 'warming', 'ready', 'busy', 'draining'] } },
    });
    report.spentTodayUsd = Number((await GpuWorkerManager.todaySpendUsd()).toFixed(4));

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
  ): Promise<{ dispatched: number; failed: number; reason?: string }> {
    const pending = await prisma.aiGpuJob.groupBy({
      by: ['modelKey'],
      where: { status: 'queued' },
      _count: { _all: true },
      _min: { queuedAt: true },
    });
    if (pending.length === 0) return { dispatched: 0, failed: 0 };

    let dispatched = 0;
    let failed = 0;
    let reason: string | undefined;

    for (const group of pending) {
      const modelKey = group.modelKey;
      let queued = group._count._all;

      // 1. Every booted, idle machine serving this model takes the next job —
      //    one GPU renders one job at a time. Only a booted machine can take
      //    one: submitting to one still starting fails and costs the job an
      //    attempt for nothing. Warmest first.
      const ready = await prisma.aiGpuWorker.findMany({
        where: { modelKey, status: 'ready', endpoint: { not: null } },
        orderBy: { lastJobAt: { sort: 'desc', nulls: 'last' } },
      });
      for (const worker of ready) {
        if (queued <= 0) break;
        const busy = await prisma.aiGpuJob.count({
          where: { workerId: worker.id, status: { in: ['assigned', 'running'] } },
        });
        if (busy > 0) continue;

        const job = await this.claimNextJob(modelKey, worker.id);
        if (!job) {
          queued = 0;
          break;
        }
        queued -= 1;
        try {
          await this.submitJob(job, worker);
          dispatched += 1;
        } catch (error) {
          await this.settleFailure(job, worker, (error as Error).message, true);
          failed += 1;
        }
      }
      if (queued <= 0) continue;

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
        failed += await this.failAllQueued(modelKey, message);
      }
    }

    return { dispatched, failed, reason };
  }

  /**
   * Atomically move the highest-priority queued job to `assigned`.
   * The conditional UPDATE is what guarantees a job is never dispatched twice,
   * even if two ticks somehow overlap.
   */
  private static async claimNextJob(modelKey: string, workerId: number): Promise<AiGpuJob | null> {
    const candidate = await prisma.aiGpuJob.findFirst({
      where: { status: 'queued', modelKey },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });
    if (!candidate) return null;

    const claimed = await prisma.aiGpuJob.updateMany({
      where: { id: candidate.id, status: 'queued' },
      data: {
        status: 'assigned',
        workerId,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) return null;

    return prisma.aiGpuJob.findUnique({ where: { id: candidate.id } });
  }

  private static async submitJob(job: AiGpuJob, worker: AiGpuWorker): Promise<void> {
    if (!worker.endpoint) throw new Error('Worker has no reachable endpoint');

    const profile = await getWorkerProfile(job.modelKey);
    const client = new WorkerClient(
      worker.endpoint,
      profile,
      GpuWorkerManager.readAuthToken(worker),
      job.modelKey
    );
    const { externalJobId } = await client.submit(job.payload as unknown as WorkerJobParams);

    // From here the GPU is rendering, so recording it must survive a slow
    // moment of the database. A throw used to put the job back in the queue
    // while the machine kept rendering it: the next job sat behind that orphan
    // in ComfyUI's own queue (a 10 min render took 19), and on a last attempt a
    // render that finished would have been refunded.
    const record = () =>
      prisma.$transaction(async (tx) => {
        await tx.aiGpuJob.update({
          where: { id: job.id },
          data: { status: 'running', externalJobId },
        });
        await tx.aiGpuWorker.update({
          where: { id: worker.id },
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
      throw error;
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
      if (!worker || worker.terminatedAt || worker.status === 'terminated') {
        await this.settleFailure(job, worker, 'GPU worker was terminated mid-render', true);
        failed += 1;
        continue;
      }

      const startedAt = job.startedAt ?? job.queuedAt;
      const elapsedMs = Date.now() - startedAt.getTime();

      try {
        const profile = await getWorkerProfile(job.modelKey);
        const client = new WorkerClient(
          worker.endpoint || '',
          profile,
          GpuWorkerManager.readAuthToken(worker),
          job.modelKey
        );
        const outcome = await client.poll(job.externalJobId as string);

        if (outcome.state === 'completed') {
          await this.settleSuccess(job, worker, outcome.assetUrls, client);
          completed += 1;
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
        if (elapsedMs > cfg.jobTimeoutMinutes * 60_000) {
          await this.settleFailure(job, worker, `Render exceeded ${cfg.jobTimeoutMinutes} min`, true);
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

  private static async settleSuccess(
    job: AiGpuJob,
    worker: AiGpuWorker,
    assetUrls: string[],
    client: WorkerClient
  ): Promise<void> {
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
      return;
    }

    const generation = await prisma.aiGeneration.findUnique({ where: { id: job.generationId } });
    const prefix = `generations/${generation?.userId ?? 'unknown'}/${job.generationId}`;

    let durableUrls: string[];
    try {
      // Downloaded through the worker client so the request carries the
      // worker's bearer token — a bare fetch would be rejected by a container
      // that correctly gates its port.
      durableUrls = await Promise.all(
        assetUrls.map(async (url) => {
          const { buffer, contentType } = await client.download(url);
          const key = `${prefix}/${Date.now()}-${randomBytes(6).toString('hex')}.${extensionFor(contentType, url)}`;
          return uploadBuffer(buffer, key, contentType);
        })
      );
    } catch (error) {
      await this.settleFailure(job, worker, `Failed to save render: ${(error as Error).message}`, true);
      return;
    }

    const now = new Date();
    const startedAt = job.startedAt ?? job.queuedAt;
    const gpuSeconds = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));
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
        data: {
          status: worker.status === 'busy' ? 'ready' : worker.status,
          jobsCompleted: { increment: 1 },
          lastJobAt: now,
        },
      });
    }, SLOW_DB_TX);

    // Fix the retention window at delivery time, same as the synchronous path.
    const { RetentionService } = await import('./retention');
    await RetentionService.stampExpiry(job.generationId, now);

    // First success is what promotes a self-hosted model out of 'tuning'.
    if (generation?.modelId) await ModelReadiness.recordSuccess(generation.modelId);
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
    { countAgainstModel = true }: { countAgainstModel?: boolean } = {}
  ): Promise<void> {
    const now = new Date();
    const canRetry = retryable && job.attempts < job.maxAttempts;

    if (worker) {
      await prisma.aiGpuWorker.update({
        where: { id: worker.id },
        data: {
          // Free a machine this job was holding, and otherwise leave its status
          // alone: writing back the one read before the job ran would undo a
          // drain made since — submitJob drains a machine it could not record.
          ...(worker.status === 'busy' ? { status: 'ready' } : {}),
          jobsFailed: { increment: 1 },
          lastJobAt: now,
          lastError: message.slice(0, 1000),
        },
      });
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
    if (countAgainstModel && !experiment && generation?.modelId) {
      await ModelReadiness.recordFailure(generation.modelId, message);
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
    const allowanceMs = paused
      ? INSUFFICIENT_BALANCE_GRACE_MS
      : (cfg.warmupTimeoutMinutes + cfg.jobTimeoutMinutes) * 60_000;
    const cutoff = new Date(Date.now() - allowanceMs);
    const stale = await prisma.aiGpuJob.findMany({
      where: { status: 'queued', queuedAt: { lt: cutoff } },
    });
    if (stale.length === 0) return 0;

    let failed = 0;
    const serving = new Map<string, boolean>();
    // While paused, a machine rented just before the money ran out is still on
    // its way and will take these jobs — the same test as GpuBalance.pausesModel.
    const servingStatuses = paused ? ['provisioning', 'warming', 'ready', 'busy'] : ['ready', 'busy'];
    for (const job of stale) {
      if (!serving.has(job.modelKey)) {
        const count = await prisma.aiGpuWorker.count({
          where: { modelKey: job.modelKey, status: { in: servingStatuses } },
        });
        serving.set(job.modelKey, count > 0);
      }
      if (serving.get(job.modelKey)) continue;

      const minutes = Math.round(allowanceMs / 60_000);
      await this.settleFailure(
        job,
        null,
        paused
          ? `${RENDERING_PAUSED_PREFIX} — provider balance $${(balance.usd ?? 0).toFixed(2)} cannot rent a machine (waited ${minutes} min)`
          : `No suitable GPU available within ${minutes} min${reason ? `: ${reason}` : ''}`,
        false,
        // Market shortage, a spent budget or an empty balance says nothing about the model.
        { countAgainstModel: false }
      );
      failed += 1;
    }
    return failed;
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
  };
  const hit = byType[contentType.split(';')[0].trim().toLowerCase()];
  if (hit) return hit;

  const fromUrl = /filename=([^&]+)/.exec(url)?.[1] ?? url;
  const ext = /\.([a-z0-9]{2,5})(?:$|[?&])/i.exec(decodeURIComponent(fromUrl))?.[1];
  return ext?.toLowerCase() ?? 'mp4';
}
