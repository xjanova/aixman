import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { LLM_CATEGORY, parseLlmConfig } from '@/lib/llm/pricing';
import { DEEPSEEK_PRESETS, DEEPSEEK_PROVIDER, salePrice } from '@/lib/llm/presets';
import { pricingBasis } from '@/lib/services/gpu-stats';

export const dynamic = 'force-dynamic';

const DAYS = 30;

async function basis() {
  const packages = await prisma.aiCreditPackage.findMany({
    where: { isActive: true },
    select: { credits: true, bonusCredits: true, priceThb: true, priceUsd: true },
  });
  return pricingBasis(packages);
}

/** Language models on sale, their prices, and the last 30 days of API use. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const [models, providers, usage, keys, rate, pb] = await Promise.all([
    prisma.aiModel.findMany({
      where: { category: LLM_CATEGORY },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { provider: { select: { id: true, slug: true, name: true, isActive: true, _count: { select: { accounts: true } } } } },
    }),
    prisma.aiProvider.findMany({ select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.aiApiUsage.groupBy({
      by: ['model'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, millicredits: true, costUsd: true },
    }),
    prisma.aiApiKey.count({ where: { revokedAt: null } }),
    prisma.aiSetting.findUnique({ where: { key: 'llm_api_rate_per_minute' } }),
    basis(),
  ]);
  const errors = await prisma.aiApiUsage.groupBy({
    by: ['model'],
    where: { createdAt: { gte: since }, status: 'error' },
    _count: { _all: true },
  });
  return NextResponse.json({
    days: DAYS,
    thbPerCredit: pb.thbPerCredit,
    usdToThb: pb.usdToThb,
    activeKeys: keys,
    ratePerMinute: Number(rate?.value) > 0 ? Number(rate?.value) : 60,
    providers,
    models: models.map((m) => ({
      id: m.id,
      modelId: m.modelId,
      name: m.name,
      description: m.description,
      isActive: m.isActive,
      readiness: m.readiness,
      sortOrder: m.sortOrder,
      provider: { id: m.provider.id, slug: m.provider.slug, name: m.provider.name, isActive: m.provider.isActive, accounts: m.provider._count.accounts },
      config: parseLlmConfig(m.defaultParams),
    })),
    usage: usage.map((u) => ({
      model: u.model,
      requests: u._count._all,
      errors: errors.find((e) => e.model === u.model)?._count._all ?? 0,
      promptTokens: u._sum.promptTokens ?? 0,
      completionTokens: u._sum.completionTokens ?? 0,
      credits: (u._sum.millicredits ?? 0) / 1000,
      costUsd: Number(u._sum.costUsd ?? 0),
    })),
  });
}

/**
 * `{ preset: 'deepseek' }` adds the DeepSeek provider and its models (priced at
 * twice cost), skipping any that exist. `{ ratePerMinute }` sets the per-key limit.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { preset?: unknown; ratePerMinute?: unknown };

  if (body.ratePerMinute !== undefined) {
    const n = Math.round(Number(body.ratePerMinute));
    if (!Number.isFinite(n) || n < 1 || n > 10_000) return NextResponse.json({ error: 'ต้องเป็น 1–10000' }, { status: 400 });
    await prisma.aiSetting.upsert({
      where: { key: 'llm_api_rate_per_minute' },
      create: { key: 'llm_api_rate_per_minute', value: String(n), group: 'llm', type: 'number' },
      update: { value: String(n) },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.preset !== 'deepseek') return NextResponse.json({ error: 'ไม่รู้จัก preset นี้' }, { status: 400 });
  const pb = await basis();
  const provider = await prisma.aiProvider.upsert({
    where: { slug: DEEPSEEK_PROVIDER.slug },
    create: { ...DEEPSEEK_PROVIDER, authType: 'bearer', isActive: true },
    update: {},
  });
  let created = 0;
  for (const p of DEEPSEEK_PRESETS) {
    const exists = await prisma.aiModel.findUnique({ where: { providerId_modelId: { providerId: provider.id, modelId: p.modelId } } });
    if (exists) continue;
    const cfg = {
      ...p.cfg,
      inputCreditsPerMTok: salePrice(p.cfg.inputUsdPerMTok, pb.usdToThb, pb.thbPerCredit),
      outputCreditsPerMTok: salePrice(p.cfg.outputUsdPerMTok, pb.usdToThb, pb.thbPerCredit),
    };
    await prisma.aiModel.create({
      data: {
        providerId: provider.id,
        modelId: p.modelId,
        name: p.name,
        description: p.description,
        category: LLM_CATEGORY,
        subcategory: 'chat',
        unitType: 'per_mtok',
        costPerUnit: cfg.outputUsdPerMTok,
        creditsPerUnit: Math.ceil(cfg.outputCreditsPerMTok),
        defaultParams: cfg,
        isActive: true,
        // An upstream API has nothing to prove on our machines.
        readiness: 'ready',
      },
    });
    created += 1;
  }
  return NextResponse.json({ ok: true, created, providerId: provider.id });
}
