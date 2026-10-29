import prisma from '@/lib/db';
import { baselineSeconds, typicalSeconds, type LiveTask, type VendorStage } from '@/lib/api-queue';

/**
 * The vendor's last word on each API order this process is waiting on (KIE's
 * task stage), for the status route. In memory: the process that polls the
 * vendor is the one that answers the studio, and after a restart there is
 * nothing to report until ApiOrderSweep collects the order.
 */
const live = new Map<number, LiveTask>();

const STAGES = new Set<VendorStage>(['waiting', 'queuing', 'generating']);

/** How long an ETA from history is trusted before it is read again. */
const ETA_CACHE_MS = 5 * 60_000;
const etaCache = new Map<string, { at: number; value: { seconds: number; basis: 'history' | 'baseline' } }>();

export const ApiProgress = {
  /** A stage the vendor reported; anything else (success, fail) is not a waiting stage. */
  report(generationId: number, state: string, now = Date.now()): void {
    if (!STAGES.has(state as VendorStage)) return;
    const stage = state as VendorStage;
    const prev = live.get(generationId);
    live.set(generationId, {
      stage,
      generatingSince: stage === 'generating' ? prev?.generatingSince ?? now : null,
    });
  },

  get(generationId: number): LiveTask | null {
    return live.get(generationId) ?? null;
  },

  clear(generationId: number): void {
    live.delete(generationId);
  },

  /** How long this model's orders take, from the last ones that delivered. */
  async eta(modelId: number, type: string, duration: number | null): Promise<{ seconds: number; basis: 'history' | 'baseline' }> {
    const key = `${modelId}:${duration ?? ''}`;
    const cached = etaCache.get(key);
    if (cached && Date.now() - cached.at < ETA_CACHE_MS) return cached.value;
    const rows = await prisma.aiGeneration.findMany({
      where: { modelId, status: 'completed', processingMs: { gt: 0 } },
      select: { processingMs: true, params: true },
      orderBy: { completedAt: 'desc' },
      take: 30,
    });
    const history = rows.map((r) => ({ ms: r.processingMs ?? 0, duration: paramDuration(r.params) }));
    const seconds = typicalSeconds(history, duration);
    const value = seconds != null ? { seconds, basis: 'history' as const } : { seconds: baselineSeconds(type), basis: 'baseline' as const };
    etaCache.set(key, { at: Date.now(), value });
    return value;
  },
};

/** The clip length an order was priced at, when it has one. */
export function paramDuration(params: unknown): number | null {
  const d = params && typeof params === 'object' ? Number((params as Record<string, unknown>).duration) : NaN;
  return Number.isFinite(d) && d > 0 ? d : null;
}
