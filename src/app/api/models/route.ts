import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { ModelReadiness, TUNING_MESSAGE } from '@/lib/services/model-readiness';
import { accountBlock, type AccountBlock } from '@/lib/services/account-pool';
import { getCatalogEntry } from '@/lib/gpu/catalog';
import { getGpuConfig } from '@/lib/gpu/config';
import { isStorageConfigured } from '@/lib/storage/r2';
import { isInHouse, publicProvider } from '@/lib/public-provider';

/**
 * Public model list for the studio and the mobile app.
 *
 * Fields are listed explicitly. This used to spread the whole row, which sent
 * `costPerUnit` (our cost price), `readinessNote` (raw failure text) and
 * `failureStreak` to anyone — the route has no auth.
 *
 * Every model also carries whether it can be ordered *right now* and, if not,
 * a customer-safe reason, so the studio can grey it out instead of letting a
 * customer type a prompt for a model whose provider is not connected, whose
 * keys are all failing, or whose rental is switched off.
 */

export const dynamic = 'force-dynamic';

type Availability = 'ok' | 'not-connected' | 'busy' | 'maintenance';

const UNAVAILABLE_TEXT: Record<Exclude<Availability, 'ok'>, string> = {
  'not-connected': 'ยังไม่เปิดให้บริการ',
  busy: 'มีผู้ใช้งานหนาแน่น ลองใหม่ในอีกสักครู่',
  maintenance: 'ปิดปรับปรุงชั่วคราว',
};

/** From the provider's keys: can any of them take a request right now? */
function fromAccounts(blocks: (AccountBlock | null)[]): Availability {
  if (blocks.some((b) => b === null)) return 'ok';
  if (blocks.length === 0 || blocks.every((b) => b === 'inactive')) return 'not-connected';
  // Cooldowns lift within minutes; errors and quotas need someone to act.
  if (blocks.includes('cooldown')) return 'busy';
  return 'maintenance';
}

export async function GET() {
  const now = new Date();
  const [models, admin, accounts, gpuCfg] = await Promise.all([
    prisma.aiModel.findMany({
      where: { isActive: true },
      include: { provider: { select: { id: true, name: true, slug: true, logo: true, isActive: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    isAdmin(),
    prisma.aiAccountPool.findMany({
      select: {
        providerId: true,
        isActive: true,
        cooldownUntil: true,
        dailyQuota: true,
        usageToday: true,
        monthlyQuota: true,
        usageThisMonth: true,
        consecutiveErrors: true,
      },
    }),
    getGpuConfig(),
  ]);

  const byProvider = new Map<number, Availability>();
  const availability = (provider: { id: number; slug: string; isActive: boolean }): Availability => {
    const cached = byProvider.get(provider.id);
    if (cached) return cached;
    let result: Availability;
    if (!provider.isActive) {
      result = 'not-connected';
    } else if (isInHouse(provider.slug) && (!gpuCfg.enabled || !isStorageConfigured())) {
      // Rental switched off or nowhere to keep renders — the order path
      // refuses these, so the studio must not offer them.
      result = 'maintenance';
    } else {
      result = fromAccounts(accounts.filter((a) => a.providerId === provider.id).map((a) => accountBlock(a, now)));
    }
    byProvider.set(provider.id, result);
    return result;
  };

  return NextResponse.json({
    models: models.map((m) => {
      const inHouse = isInHouse(m.provider.slug);
      const avail = availability(m.provider);
      const readinessOk = ModelReadiness.canOrder(m.readiness, admin);
      const status = avail !== 'ok' ? 'unavailable' : m.readiness === 'tuning' ? 'tuning' : readinessOk ? 'ready' : 'unavailable';
      const reason =
        avail !== 'ok'
          ? UNAVAILABLE_TEXT[avail]
          : m.readiness === 'tuning'
            ? TUNING_MESSAGE
            : readinessOk
              ? null
              : UNAVAILABLE_TEXT.maintenance;
      return {
        id: m.id,
        modelId: m.modelId,
        name: m.name,
        description: m.description,
        category: m.category,
        subcategory: m.subcategory,
        thumbnail: m.thumbnail,
        isFeatured: m.isFeatured,
        creditsPerUnit: m.creditsPerUnit,
        unitType: m.unitType,
        maxWidth: m.maxWidth,
        maxHeight: m.maxHeight,
        maxDuration: m.maxDuration,
        supportedParams: m.supportedParams,
        defaultParams: m.defaultParams,
        sortOrder: m.sortOrder,
        readiness: m.readiness,
        provider: publicProvider(m.provider),
        // What GenerationService will charge, so the studio shows the same
        // number: an in-house job renders one output and may price by length.
        maxOutputs: inHouse ? 1 : null,
        durationCurve: inHouse ? getCatalogEntry(m.modelId)?.pricing.durationCurve ?? null : null,
        // 'tuning' stays orderable for admins — running it is how it gets
        // proven. 'unavailable' is not orderable by anyone: it would fail.
        status,
        canOrder: avail === 'ok' && readinessOk,
        unavailableReason: avail === 'ok' && readinessOk ? null : reason,
        // Kept for older app builds, which read this name.
        tuningMessage: avail === 'ok' && readinessOk ? null : reason,
      };
    }),
  });
}
