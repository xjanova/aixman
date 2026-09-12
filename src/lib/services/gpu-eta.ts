import { Prisma } from '@/generated/prisma/client';
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
  /** Seconds of machine start-up still ahead of this job (0 once one is up). */
  warmupRemainingSeconds: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How many times longer a render of `seconds` of footage takes than one of the
 * model's unit length (5 s for H3). The price curve was fitted to measured
 * render time (lib/pricing.ts: A100, 5 s in 107 s, 15 s in 556 s), so the same
 * curve converts between clip lengths. 1 for a model priced flat.
 *
 * Without it every length shared one median: a 15 s render was quoted "under a
 * minute" for its whole nine, and a run of 15 s jobs in the history would then
 * quote every 5 s customer nine minutes.
 */
export function lengthFactor(modelKey: string, seconds: unknown): number {
  const curve = getCatalogEntry(modelKey)?.pricing.durationCurve;
  const s = Number(seconds);
  if (!curve || !Number.isFinite(s) || s <= 0) return 1;
  return Math.pow(s / curve.unitSeconds, curve.exponent);
}

interface RenderSampleRow {
  gpu_seconds: number;
  duration: unknown;
  gpu_model: string | null;
}

/**
 * Completed renders for a model, each with its clip length.
 *
 * Raw SQL so only `$.duration` leaves the database: the payload also carries
 * the start frame, which the studio sends as a data URL of several MB, and
 * this runs on every poll of a pending generation.
 */
async function renderSamples(modelKey: string, take: number): Promise<RenderSampleRow[]> {
  const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);
  try {
    return await prisma.$queryRaw<RenderSampleRow[]>`
      SELECT j.gpu_seconds, JSON_EXTRACT(j.payload, '$.duration') AS duration, w.gpu_model
      FROM ai_gpu_jobs j
      LEFT JOIN ai_gpu_workers w ON w.id = j.worker_id
      WHERE j.model_key = ${modelKey} AND j.status = 'completed' AND j.gpu_seconds > 0 AND j.queued_at >= ${since}
      ORDER BY j.completed_at DESC
      LIMIT ${take}`;
  } catch (error) {
    // An estimate is never worth failing for: addCapacity reads this, and an
    // error escaping it is taken for a broken setup and refunds the queue.
    // No history means the catalogue baseline, which is what a new model gets.
    console.error('[gpu-eta] render history query failed:', error);
    return [];
  }
}

/**
 * Clip lengths of a model's jobs in the given states, queued before `before`
 * when given (with `priority`, the jobs ahead of one job). Null if the query
 * fails — callers fall back to counting jobs as unit-length.
 */
async function jobDurations(
  modelKey: string,
  statuses: string[],
  ahead?: { priority: number; queuedAt: Date }
): Promise<unknown[] | null> {
  try {
    const rows = ahead
      ? await prisma.$queryRaw<{ duration: unknown }[]>`
          SELECT JSON_EXTRACT(payload, '$.duration') AS duration
          FROM ai_gpu_jobs
          WHERE model_key = ${modelKey} AND status IN (${Prisma.join(statuses)})
            AND (priority > ${ahead.priority} OR (priority = ${ahead.priority} AND queued_at < ${ahead.queuedAt}))`
      : await prisma.$queryRaw<{ duration: unknown }[]>`
          SELECT JSON_EXTRACT(payload, '$.duration') AS duration
          FROM ai_gpu_jobs
          WHERE model_key = ${modelKey} AND status IN (${Prisma.join(statuses)})`;
    return rows.map((r) => r.duration);
  } catch (error) {
    console.error('[gpu-eta] queued lengths query failed:', error);
    return null;
  }
}

/** A sample's render time scaled to the model's unit length. */
function unitSeconds(modelKey: string, row: RenderSampleRow): number {
  return Number(row.gpu_seconds) / lengthFactor(modelKey, row.duration);
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

  /**
   * Median render seconds for a model at its unit length (a 5 s clip, one
   * image), from jobs that actually completed. Scale by `lengthFactor` for
   * another length.
   */
  static async medianRenderSeconds(modelKey: string): Promise<number | null> {
    const rows = await renderSamples(modelKey, 50);
    const samples = rows.map((r) => unitSeconds(modelKey, r)).filter((s) => s > 0);
    return samples.length >= MIN_SAMPLES ? median(samples) : null;
  }

  /**
   * Median unit-length render seconds per GPU model for one model, where a GPU
   * has enough history — so the offer picker can price a card by how fast it
   * really is.
   */
  static async medianRenderSecondsByGpu(modelKey: string): Promise<Map<string, number>> {
    const rows = await renderSamples(modelKey, 200);
    const byGpu = new Map<string, number[]>();
    for (const r of rows) {
      const gpu = r.gpu_model;
      if (!gpu) continue;
      const list = byGpu.get(gpu) ?? [];
      list.push(unitSeconds(modelKey, r));
      byGpu.set(gpu, list);
    }
    const out = new Map<string, number>();
    for (const [gpu, samples] of byGpu) {
      const m = samples.length >= MIN_SAMPLES ? median(samples) : null;
      if (m !== null) out.set(gpu, m);
    }
    return out;
  }

  /** Render seconds for a unit-length job (a 5 s clip, one image) — history first. */
  static async typicalRenderSeconds(modelKey: string): Promise<number> {
    return (await this.medianRenderSeconds(modelKey)) ?? this.baselineRenderSeconds(modelKey, { duration: 5 });
  }

  /**
   * How much longer than a unit-length render the average waiting job takes —
   * a queue of 15 s H3 clips is 5.2 — so the scaler and the offer picker weigh
   * the backlog they would actually have to clear. 1 when nothing is queued.
   */
  static async queuedLengthFactor(modelKey: string): Promise<number> {
    const durations = await jobDurations(modelKey, ['queued']);
    if (!durations || durations.length === 0) return 1;
    return durations.reduce<number>((sum, d) => sum + lengthFactor(modelKey, d), 0) / durations.length;
  }

  /** Seconds from renting a machine to it being ready — history first. */
  static async typicalBootSeconds(): Promise<number> {
    return (await this.medianWarmupSeconds()) ?? DEFAULT_WARMUP_SECONDS;
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
      return { seconds: null, basis: 'baseline', queuePosition: null, includesWarmup: false, warmupRemainingSeconds: 0 };
    }

    const [historyRender, historyWarmup, cfg] = await Promise.all([
      this.medianRenderSeconds(job.modelKey),
      this.medianWarmupSeconds(),
      getGpuConfig(),
    ]);

    // History is kept at the unit length; each job is quoted at its own.
    const renderFor = (duration: unknown): number =>
      historyRender !== null
        ? historyRender * lengthFactor(job.modelKey, duration)
        : this.baselineRenderSeconds(job.modelKey, { duration });
    const render = renderFor((job.payload as { duration?: unknown } | null)?.duration);
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
        warmupRemainingSeconds: 0,
      };
    }

    // Queued: everything ahead of it for the same model has to render first,
    // each at its own length. Only `$.duration` is read — see renderSamples.
    const statuses = ['queued', 'assigned', 'running'];
    const aheadDurations = await jobDurations(job.modelKey, statuses, job);
    let ahead: number;
    let workAhead: number;
    if (aheadDurations) {
      ahead = aheadDurations.length;
      workAhead = aheadDurations.reduce<number>((sum, d) => sum + renderFor(d), 0);
    } else {
      // Lengths unreadable: count the jobs ahead as if they were this one.
      ahead = await prisma.aiGpuJob.count({
        where: {
          modelKey: job.modelKey,
          status: { in: statuses },
          OR: [
            { priority: { gt: job.priority } },
            { priority: job.priority, queuedAt: { lt: job.queuedAt } },
          ],
        },
      });
      workAhead = ahead * render;
    }

    // Machines already up share the queue; with several, the jobs ahead are
    // rendered side by side rather than one after another — but this job's own
    // render still takes as long as it takes.
    const upForModel = await prisma.aiGpuWorker.count({
      where: { modelKey: job.modelKey, status: { in: ['ready', 'busy'] } },
    });
    let seconds = Math.max(render, (workAhead + render) / Math.max(1, upForModel));
    let includesWarmup = false;
    let warmupRemainingSeconds = 0;

    const worker = job.worker;
    const usableWorker = await prisma.aiGpuWorker.findFirst({
      where: { modelKey: job.modelKey, status: { in: ['ready', 'busy', 'warming', 'provisioning'] } },
      // Any machine already up beats one still booting.
      orderBy: [{ readyAt: { sort: 'desc', nulls: 'last' } }, { rentedAt: 'asc' }],
    });
    const live = worker ?? usableWorker;

    if (!live) {
      // Nothing running for this model — a machine must be rented first.
      warmupRemainingSeconds = warmup;
      includesWarmup = true;
    } else if (live.status === 'warming' || live.status === 'provisioning') {
      // Credit the warmup already served, so the number falls as it progresses.
      const elapsed = (Date.now() - live.rentedAt.getTime()) / 1000;
      warmupRemainingSeconds = Math.max(30, warmup - elapsed);
      includesWarmup = true;
    }
    seconds += warmupRemainingSeconds;

    // Never quote longer than the point at which the system would give up.
    const ceiling = (cfg.warmupTimeoutMinutes + cfg.jobTimeoutMinutes) * 60;
    return {
      seconds: Math.min(Math.round(seconds), ceiling),
      basis,
      queuePosition: ahead + 1,
      includesWarmup,
      warmupRemainingSeconds: Math.round(warmupRemainingSeconds),
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
