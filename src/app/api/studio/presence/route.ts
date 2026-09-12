import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { getGpuProvider } from '@/lib/gpu';
import { rateLimit } from '@/lib/rate-limit';
import { touchStudioPresence } from '@/lib/services/studio-presence';

/**
 * POST /api/studio/presence — "I am on the studio with this model selected."
 *
 * Lets an idle machine for that model wait a little before shutting down (see
 * studio-presence.ts). The studio sends it for whatever model is selected and
 * the answer is always the same, so the endpoint does not reveal which models
 * run on rented hardware.
 */

/** modelId → catalogue key (null when not self-hosted), cached briefly. */
const store = globalThis as unknown as { __presenceModels?: Map<number, { key: string | null; at: number }> };
const models = (store.__presenceModels ??= new Map());
const MODEL_CACHE_MS = 60_000;

async function selfHostedKey(modelId: number): Promise<string | null> {
  const hit = models.get(modelId);
  if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit.key;

  const model = await prisma.aiModel.findUnique({
    where: { id: modelId },
    select: { modelId: true, isActive: true, provider: { select: { slug: true } } },
  });
  const key = model?.isActive && getGpuProvider(model.provider.slug) ? model.modelId : null;
  if (models.size > 500) models.clear();
  models.set(modelId, { key, at: Date.now() });
  return key;
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
    const key = await selfHostedKey(modelId);
    if (key) await touchStudioPresence(key);
  } catch (error) {
    // Best effort: a missed ping only means a machine may close on time.
    console.error('[presence] failed to record:', (error as Error).message);
  }
  return NextResponse.json({ ok: true });
}
