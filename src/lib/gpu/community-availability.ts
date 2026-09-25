import prisma from '@/lib/db';
import { COMMUNITY_ORDERABLE_STATUSES, COMMUNITY_PROVIDER_SLUGS, communityRowMayServe } from './community-dispatch';

/**
 * Whether a GPUxMINE machine for this model is up, busy, or warming for a
 * reason its owner may undo in a minute (paused, their own work, a blip),
 * and not held out of the pool. A PC that is switched off does not count
 * (community-dispatch.ts communityRowMayServe). An order for a
 * community-only model with none would only wait out the grace and be
 * refunded.
 *
 * One answer for the two places that ask: the order path, before any credit
 * moves (GenerationService), and the studio's model list (/api/models), so
 * the list never offers what the order path would refuse.
 */
export async function communityMachineAvailable(modelKey: string, now: number = Date.now()): Promise<boolean> {
  const rows = await prisma.aiGpuWorker.findMany({
    where: {
      modelKey,
      providerSlug: { in: [...COMMUNITY_PROVIDER_SLUGS] },
      status: { in: [...COMMUNITY_ORDERABLE_STATUSES] },
      terminatedAt: null,
    },
    select: { status: true, endpoint: true, metadata: true, readyAt: true, lastJobAt: true, lastError: true },
    take: 500,
  });
  return rows.some((row) => communityRowMayServe(row, now));
}
