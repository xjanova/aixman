import prisma from '@/lib/db';
import { BUSY_INFLIGHT, getPolicy, noteDemand } from '@/lib/gpu/llm-policy';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';

/**
 * Which of our rented machines answers a self-hosted model's request.
 *
 * In-flight counts are per process, like rate-limit.ts — correct because the
 * app runs `instances: 1`. The least loaded ready machine wins. No machine:
 * the demand is noted (the next tick rents one) and the caller is told to come
 * back; every machine at BUSY_INFLIGHT: it still answers, and asks for another.
 */

const inflight = new Map<number, number>();
const touched = new Map<number, number>();
/** `lastJobAt` is what keeps a machine from its idle reaper; stamped at most this often. */
const TOUCH_EVERY_MS = 60_000;

export interface GpuTarget {
  workerId: number;
  url: string;
  token: string | undefined;
  release(): void;
}

export type GpuPick =
  | { kind: 'ready'; target: GpuTarget }
  | { kind: 'warming' }
  | { kind: 'starting' }
  | { kind: 'off' };

export async function pickGpuTarget(modelKey: string): Promise<GpuPick> {
  const policy = await getPolicy(modelKey);
  if (policy.mode === 'off') return { kind: 'off' };

  const workers = await prisma.aiGpuWorker.findMany({
    where: { modelKey, terminatedAt: null, status: { in: ['provisioning', 'warming', 'ready', 'busy'] } },
    orderBy: { rentedAt: 'asc' },
  });
  const ready = workers.filter((w) => (w.status === 'ready' || w.status === 'busy') && w.endpoint);
  if (ready.length === 0) {
    await noteDemand(modelKey, 'at');
    return workers.length > 0 ? { kind: 'warming' } : { kind: 'starting' };
  }

  const load = (id: number) => inflight.get(id) ?? 0;
  const worker = ready.reduce((best, w) => (load(w.id) < load(best.id) ? w : best));
  if (load(worker.id) >= BUSY_INFLIGHT) await noteDemand(modelKey, 'busyAt');

  inflight.set(worker.id, load(worker.id) + 1);
  const now = Date.now();
  if (now - (touched.get(worker.id) ?? 0) >= TOUCH_EVERY_MS) {
    touched.set(worker.id, now);
    await prisma.aiGpuWorker
      .update({ where: { id: worker.id }, data: { lastJobAt: new Date(now) } })
      .catch((error) => console.error('[llm] could not stamp worker activity:', (error as Error).message));
  }

  let released = false;
  return {
    kind: 'ready',
    target: {
      workerId: worker.id,
      url: `${worker.endpoint!.replace(/\/+$/, '')}/v1/chat/completions`,
      token: GpuWorkerManager.readAuthToken(worker),
      release() {
        if (released) return;
        released = true;
        inflight.set(worker.id, Math.max(0, load(worker.id) - 1));
        // The end of a long answer is activity too.
        touched.delete(worker.id);
        void prisma.aiGpuWorker.update({ where: { id: worker.id }, data: { lastJobAt: new Date() } }).catch(() => {});
      },
    },
  };
}
