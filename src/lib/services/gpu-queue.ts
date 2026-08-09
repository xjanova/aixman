import { randomBytes } from 'crypto';
import prisma from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import type { AiGpuJob, AiGpuWorker } from '@/generated/prisma/client';
import { getGpuConfig, getWorkerProfile, type GpuBudgetConfig } from '@/lib/gpu/config';
import { WorkerClient, type WorkerJobParams } from '@/lib/gpu/worker-client';
import { GpuWorkerManager } from './gpu-worker';
import { GenerationService } from './generation';
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
      await this.markSwept();
    } catch (error) {
      console.error('[gpu] orphan sweep failed:', (error as Error).message);
    }

    try {
      await GpuWorkerManager.reconcile(cfg);
    } catch (error) {
      console.error('[gpu] reconcile failed:', (error as Error).message);
    }

    await this.requeueStaleAssignments();

    const polled = await this.pollRunningJobs(cfg);
    report.completed = polled.completed;
    report.failed = polled.failed;

    const dispatched = await this.dispatchQueued(cfg);
    report.dispatched = dispatched.dispatched;
    report.failed += dispatched.failed;
    if (dispatched.reason) report.reason = dispatched.reason;

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
    });
    if (pending.length === 0) return { dispatched: 0, failed: 0 };

    let dispatched = 0;
    let failed = 0;
    let reason: string | undefined;

    for (const group of pending) {
      const modelKey = group.modelKey;

      let worker: AiGpuWorker | null = null;
      try {
        const result = await GpuWorkerManager.ensureWorker(modelKey, cfg);
        worker = result.worker;
        if (!worker) {
          reason ??= result.reason;
          continue;
        }
      } catch (error) {
        // A misconfigured profile (no image, no workflow) can never succeed —
        // fail the queued jobs instead of retrying forever and refunding late.
        const message = (error as Error).message;
        reason ??= message;
        failed += await this.failAllQueued(modelKey, message);
        continue;
      }

      // One GPU renders one video at a time.
      const busy = await prisma.aiGpuJob.count({
        where: { workerId: worker.id, status: { in: ['assigned', 'running'] } },
      });
      if (busy > 0) continue;

      const job = await this.claimNextJob(modelKey, worker.id);
      if (!job) continue;

      try {
        await this.submitJob(job, worker);
        dispatched += 1;
      } catch (error) {
        await this.settleFailure(job, worker, (error as Error).message, true);
        failed += 1;
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
    const client = new WorkerClient(worker.endpoint, profile, GpuWorkerManager.readAuthToken(worker));
    const { externalJobId } = await client.submit(job.payload as unknown as WorkerJobParams);

    await prisma.$transaction([
      prisma.aiGpuJob.update({
        where: { id: job.id },
        data: { status: 'running', externalJobId },
      }),
      prisma.aiGpuWorker.update({
        where: { id: worker.id },
        data: { status: 'busy', lastJobAt: new Date() },
      }),
      prisma.aiGeneration.update({
        where: { id: job.generationId },
        data: { status: 'processing', startedAt: new Date(), providerJobId: externalJobId },
      }),
    ]);
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
          GpuWorkerManager.readAuthToken(worker)
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
        false
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

    await prisma.$transaction([
      prisma.aiGpuJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          resultUrl: durableUrls[0],
          gpuSeconds,
          costUsd,
          completedAt: now,
          errorMessage: null,
        },
      }),
      prisma.aiGeneration.update({
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
      }),
      prisma.aiGpuWorker.update({
        where: { id: worker.id },
        data: {
          status: worker.status === 'busy' ? 'ready' : worker.status,
          jobsCompleted: { increment: 1 },
          lastJobAt: now,
        },
      }),
    ]);
  }

  /**
   * Fail a job, retrying it on a fresh worker when attempts remain.
   * On terminal failure the user's credits are refunded.
   */
  private static async settleFailure(
    job: AiGpuJob,
    worker: AiGpuWorker | null,
    message: string,
    retryable: boolean
  ): Promise<void> {
    const now = new Date();
    const canRetry = retryable && job.attempts < job.maxAttempts;

    if (worker) {
      await prisma.aiGpuWorker.update({
        where: { id: worker.id },
        data: {
          status: worker.status === 'busy' ? 'ready' : worker.status,
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
  }

  /** Terminal-fail every queued job for a model whose configuration cannot work. */
  private static async failAllQueued(modelKey: string, message: string): Promise<number> {
    const jobs = await prisma.aiGpuJob.findMany({ where: { status: 'queued', modelKey } });
    for (const job of jobs) {
      await this.settleFailure(job, null, message, false);
    }
    return jobs.length;
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

  if (/terminated mid-render|worker was terminated|no longer exists/i.test(technical)) {
    return 'เครื่อง GPU หยุดทำงานระหว่างเรนเดอร์ กรุณาลองใหม่อีกครั้ง' + REFUNDED;
  }
  if (/exceeded \d+ min|timed out|timeout/i.test(technical)) {
    return 'ใช้เวลาเรนเดอร์นานเกินกำหนด กรุณาลองใหม่หรือลดความยาวคลิป' + REFUNDED;
  }
  if (/no container image|workflow|invalid nodes|profile/i.test(technical)) {
    return 'โมเดลนี้ยังตั้งค่าไม่เสร็จ กรุณาติดต่อผู้ดูแลระบบ' + REFUNDED;
  }
  if (/R2 storage is not configured|Failed to save render/i.test(technical)) {
    return 'บันทึกไฟล์ผลลัพธ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' + REFUNDED;
  }
  if (/budget|capacity|balance too low/i.test(technical)) {
    return 'ระบบ GPU ไม่ว่างอยู่ในขณะนี้ กรุณาลองใหม่ภายหลัง' + REFUNDED;
  }
  if (/no .* GPU available|No available/i.test(technical)) {
    return 'ไม่มีเครื่อง GPU ว่างในขณะนี้ กรุณาลองใหม่ภายหลัง' + REFUNDED;
  }
  return 'สร้างวิดีโอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' + REFUNDED;
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
  };
  const hit = byType[contentType.split(';')[0].trim().toLowerCase()];
  if (hit) return hit;

  const fromUrl = /filename=([^&]+)/.exec(url)?.[1] ?? url;
  const ext = /\.([a-z0-9]{2,5})(?:$|[?&])/i.exec(decodeURIComponent(fromUrl))?.[1];
  return ext?.toLowerCase() ?? 'mp4';
}
