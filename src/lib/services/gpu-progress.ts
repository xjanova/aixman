import type { AiGpuJob, AiGpuWorker } from '@/generated/prisma/client';
import { getWorkerProfile } from '@/lib/gpu/config';
import { renderFraction, type RenderProgress } from '@/lib/gpu/render-progress';
import { WorkerClient, type WorkerProgress } from '@/lib/gpu/worker-client';
import { GpuWorkerManager } from './gpu-worker';

export { estimatedFraction, type RenderPhase, type RenderProgress } from '@/lib/gpu/render-progress';

/**
 * Reads a running job's progress off its worker, for the status endpoint.
 * The arithmetic lives in `render-progress.ts`; this is the I/O around it.
 */

/** Worker reads are shared by every customer polling the same job. */
const CACHE_MS = 2_500;

interface CacheEntry {
  at: number;
  value: Promise<WorkerProgress | null>;
}

// Route handlers and the scheduler are bundled apart; a global keeps one
// cache for all the handlers in this process.
const store = globalThis as unknown as { __gpuProgressCache?: Map<number, CacheEntry> };
const cache = (store.__gpuProgressCache ??= new Map<number, CacheEntry>());

async function readWorker(job: Pick<AiGpuJob, 'modelKey'>, worker: AiGpuWorker): Promise<WorkerProgress | null> {
  const now = Date.now();
  const hit = cache.get(worker.id);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const value = (async () => {
    const profile = await getWorkerProfile(job.modelKey);
    const client = new WorkerClient(
      worker.endpoint as string,
      profile,
      GpuWorkerManager.readAuthToken(worker),
      job.modelKey
    );
    return client.progress();
  })().catch(() => null);

  cache.set(worker.id, { at: now, value });
  for (const [id, entry] of cache) {
    if (now - entry.at > 60_000) cache.delete(id);
  }
  return value;
}

export class GpuProgress {
  /**
   * Measured progress of a running job, or null when the worker cannot report
   * it — the caller then shows `estimatedFraction` instead.
   */
  static async forRunningJob(
    job: Pick<AiGpuJob, 'modelKey' | 'externalJobId'>,
    worker: AiGpuWorker | null
  ): Promise<RenderProgress | null> {
    if (!worker?.endpoint || !job.externalJobId) return null;
    const report = await readWorker(job, worker);
    // Not listening means the numbers are stale — ComfyUI may have died under
    // the render, which the queue will notice on its own.
    if (!report?.listening) return null;
    if (report.promptId !== job.externalJobId) {
      // Another prompt is executing ahead of ours inside ComfyUI.
      return report.promptId ? { fraction: 0.01, phase: 'waiting' } : null;
    }
    return renderFraction(report);
  }
}
