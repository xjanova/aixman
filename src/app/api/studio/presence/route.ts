import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { getGpuProvider } from '@/lib/gpu';
import { rateLimit } from '@/lib/rate-limit';
import { isArrival, notePrewarmDemand, touchStudioPresence } from '@/lib/services/studio-presence';

/**
 * POST /api/studio/presence — "I am on the studio with this model selected."
 *
 * Lets an idle machine for that model wait a little before shutting down (see
 * studio-presence.ts), and — when a customer who can afford an order has just
 * arrived — lets the queue start a machine before they press the button. The
 * studio sends it for whatever model is selected and the answer is always the
 * same, so the endpoint does not reveal which models run on rented hardware.
 */

interface ModelInfo {
  /** Catalogue key; null when the model is not self-hosted. */
  key: string | null;
  readiness: string;
  creditsPerUnit: number;
}

/** modelId → what presence needs of it, cached briefly. */
const store = globalThis as unknown as { __presenceModels?: Map<number, ModelInfo & { at: number }> };
const models = (store.__presenceModels ??= new Map());
const MODEL_CACHE_MS = 60_000;

async function modelInfo(modelId: number): Promise<ModelInfo> {
  const hit = models.get(modelId);
  if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit;

  const model = await prisma.aiModel.findUnique({
    where: { id: modelId },
    select: {
      modelId: true,
      isActive: true,
      readiness: true,
      creditsPerUnit: true,
      provider: { select: { slug: true } },
    },
  });
  const info: ModelInfo = {
    key: model?.isActive && getGpuProvider(model.provider.slug) ? model.modelId : null,
    readiness: model?.readiness ?? 'disabled',
    creditsPerUnit: model?.creditsPerUnit ?? 0,
  };
  if (models.size > 500) models.clear();
  models.set(modelId, { ...info, at: Date.now() });
  return info;
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // The studio pings every 30 s; this leaves room for a few tabs.
  if (!rateLimit(`studio-presence:${userId}`, 12, 60_000).ok) {
    return NextResponse.json({ ok: true });
  }

  const body = await request.json().catch(() => ({}));
  const modelId = Number((body as { modelId?: unknown }).modelId);
  if (!Number.isInteger(modelId) || modelId <= 0) {
    return NextResponse.json({ error: 'modelId ไม่ถูกต้อง' }, { status: 400 });
  }

  try {
    const model = await modelInfo(modelId);
    if (model.key) {
      await touchStudioPresence(model.key);
      // Only a customer who could order right now is worth a machine: the
      // model takes orders, and their credits cover at least its smallest one.
      // Anyone else arriving would have a machine booted for nothing.
      if (isArrival(userId, model.key) && model.readiness === 'ready' && model.creditsPerUnit > 0) {
        const credit = await prisma.aiUserCredit.findUnique({ where: { userId }, select: { balance: true } });
        if ((credit?.balance ?? 0) >= model.creditsPerUnit) await notePrewarmDemand(model.key);
      }
    }
  } catch (error) {
    // Best effort: a missed ping only means a machine may close on time.
    console.error('[presence] failed to record:', (error as Error).message);
  }
  return NextResponse.json({ ok: true });
}
