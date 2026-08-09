import prisma from '@/lib/db';
import { getGpuConfig } from '@/lib/gpu/config';
import { getCatalogEntry } from '@/lib/gpu/catalog';

/**
 * Wait-time estimates for GPU-backed jobs.
 *
 * Built from this deployment's own history rather than fixed guesses, because
 * the two costs that dominate — how long a machine takes to warm up, and how
 * long a render takes — depend on the marketplace host that happened to be
 * cheapest, and vary by an order of magnitude between models.
 *
 * Medians, not means: one pathological 40-minute warmup on a slow host would
 * drag an average far enough to make every future estimate useless.
 */

/** Fallback when a model has never completed here — the catalogue's own guess. */
const DEFAULT_RENDER_SECONDS = 240;
/** Fallback warmup: install ComfyUI plus tens of GB of weights. */
const DEFAULT_WARMUP_SECONDS = 20 * 60;
/** Ignore samples older than this; hosts and model versions move on. */
const HISTORY_WINDOW_DAYS = 14;
/** Below this, history is too thin to beat the baseline. */
const MIN_SAMPLES = 3;

export type EtaBasis = 'history' | 'baseline' | 'mixed';

export interface EtaEstimate {
  /** Best guess in seconds, or null when nothing can be predicted. */
  seconds: number | null;
  /** Where the numbers came from, so the UI can hedge its wording. */
  basis: EtaBasis;
  /** Position in the queue for this model, 1-based. */
  queuePosition: number | null;
  /** True when a machine still has to be rented and warmed. */
  includesWarmup: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class GpuEta {
  /** Median seconds from rental to a healthy inference server. */
  static async medianWarmupSeconds(): Promise<number | null> {
    const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);
    const workers = await prisma.aiGpuWorker.findMany({
      where: { readyAt: { not: null }, rentedAt: { gte: since } },
      select: { rentedAt: true, readyAt: true },
      take: 50,
      orderBy: { rentedAt: 'desc' },
    });

    const samples = workers
      .map((w) => ((w.readyAt as Date).getTime() - w.rentedAt.getTime()) / 1000)
      .filter((s) => s > 0 && s < 4 * 3600);

    return samples.length >= MIN_SAMPLES ? median(samples) : null;
  }

  /** Median render seconds for a model, from jobs that actually completed. */
  static async medianRenderSeconds(modelKey: string): Promise<number | null> {
    const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);
    const jobs = await prisma.aiGpuJob.findMany({
      where: { modelKey, status: 'completed', gpuSeconds: { gt: 0 }, queuedAt: { gte: since } },
      select: { gpuSeconds: true },
      take: 50,
      orderBy: { completedAt: 'desc' },
    });

    const samples = jobs.map((j) => j.gpuSeconds).filter((s) => s > 0);
    return samples.length >= MIN_SAMPLES ? median(samples) : null;
  }

  /**
   * Baseline render estimate for a model that has no history yet, scaled by how
   * much output was asked for.
   */
  private static baselineRenderSeconds(modelKey: string, payload: unknown): number {
    const entry = getCatalogEntry(modelKey);
    if (!entry) return DEFAULT_RENDER_SECONDS;

    const p = (payload ?? {}) as { duration?: number };
    const units = entry.outputKind === 'image' ? 1 : Math.max(1, Number(p.duration) || 5);
    return Math.round(entry.baselineSecondsPerUnit * units);
  }

  /**
   * Estimate the remaining wait for one generation.
   *
   * Accounts for the queue ahead of it, whether a worker exists at all, and how
   * far through warmup that worker already is — a job behind a machine that is
   * nearly ready should not be quoted a full cold start.
   */
  static async estimate(generationId: number): Promise<EtaEstimate> {
    const job = await prisma.aiGpuJob.findUnique({
      where: { generationId },
      include: { worker: true },
    });
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) {
      return { seconds: null, basis: 'baseline', queuePosition: null, includesWarmup: false };
    }

    const [historyRender, historyWarmup, cfg] = await Promise.all([
      this.medianRenderSeconds(job.modelKey),
      this.medianWarmupSeconds(),
      getGpuConfig(),
    ]);

    const render = historyRender ?? this.baselineRenderSeconds(job.modelKey, job.payload);
    const warmup = historyWarmup ?? DEFAULT_WARMUP_SECONDS;
    const basis: EtaBasis =
      historyRender && historyWarmup ? 'history' : historyRender || historyWarmup ? 'mixed' : 'baseline';

    // Already rendering: what is left of this one render.
    if (job.status === 'running' && job.startedAt) {
      const elapsed = (Date.now() - job.startedAt.getTime()) / 1000;
      return {
        seconds: Math.max(15, Math.round(render - elapsed)),
        basis,
        queuePosition: 0,
        includesWarmup: false,
      };
    }

    // Queued: everything ahead of it for the same model has to render first.
    const ahead = await prisma.aiGpuJob.count({
      where: {
        modelKey: job.modelKey,
        status: { in: ['queued', 'assigned', 'running'] },
        OR: [
          { priority: { gt: job.priority } },
          { priority: job.priority, queuedAt: { lt: job.queuedAt } },
        ],
      },
    });

    let seconds = render * (ahead + 1);
    let includesWarmup = false;

    const worker = job.worker;
    const usableWorker = await prisma.aiGpuWorker.findFirst({
      where: { modelKey: job.modelKey, status: { in: ['ready', 'busy', 'warming', 'provisioning'] } },
      orderBy: { rentedAt: 'asc' },
    });
    const live = worker ?? usableWorker;

    if (!live) {
      // Nothing running for this model — a machine must be rented first.
      seconds += warmup;
      includesWarmup = true;
    } else if (live.status === 'warming' || live.status === 'provisioning') {
      // Credit the warmup already served, so the number falls as it progresses.
      const elapsed = (Date.now() - live.rentedAt.getTime()) / 1000;
      seconds += Math.max(30, warmup - elapsed);
      includesWarmup = true;
    }

    // Never quote longer than the point at which the system would give up.
    const ceiling = (cfg.warmupTimeoutMinutes + cfg.jobTimeoutMinutes) * 60;
    return {
      seconds: Math.min(Math.round(seconds), ceiling),
      basis,
      queuePosition: ahead + 1,
      includesWarmup,
    };
  }
}

/** Thai, rounded — a countdown to the second would be false precision. */
export function formatEta(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds < 90) return 'ไม่เกิน 1 นาที';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `ประมาณ ${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `ประมาณ ${hours} ชม. ${rest} นาที` : `ประมาณ ${hours} ชม.`;
}
