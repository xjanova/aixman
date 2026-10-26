import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { getGpuConfig } from '@/lib/gpu/config';
import { LLM_CATALOG, LLM_KEY_PREFIX, getLlmEntry } from '@/lib/gpu/llm-catalog';
import { getFleetConfig, getPolicies, DEFAULT_LLM_POLICY, parseFleet, parsePolicy, saveFleetConfig, savePolicy } from '@/lib/gpu/llm-policy';
import { LLM_CATEGORY, parseLlmConfig } from '@/lib/llm/pricing';
import { salePrice } from '@/lib/llm/presets';
import { pricingBasis } from '@/lib/services/gpu-stats';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';

export const dynamic = 'force-dynamic';

/** Rented-GPU models live on this provider row, whichever vendor rents the machine (CLAUDE.md). */
const GPU_PROVIDER_SLUG = 'simplepod';

/**
 * A starting cost per million tokens for a self-hosted model, for the margin
 * column only: the real cost is machine hours (shown beside it).
 */
const ESTIMATED_USD = { input: 0.2, output: 0.8 };

/** Self-hosted language models: what is on sale, each one's uptime policy, its machines, the API budget. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const [cfg, fleet, policies, rows, workers, spent, provider] = await Promise.all([
    getGpuConfig(),
    getFleetConfig(),
    getPolicies(),
    prisma.aiModel.findMany({ where: { category: LLM_CATEGORY }, select: { id: true, modelId: true, isActive: true, defaultParams: true } }),
    prisma.aiGpuWorker.findMany({
      where: { modelKey: { startsWith: LLM_KEY_PREFIX }, terminatedAt: null },
      orderBy: { rentedAt: 'asc' },
      select: { id: true, modelKey: true, status: true, gpuModel: true, providerSlug: true, pricePerHourUsd: true, rentedAt: true, readyAt: true, lastJobAt: true, lastError: true },
    }),
    GpuWorkerManager.todaySpendUsd('llm'),
    prisma.aiProvider.findUnique({ where: { slug: GPU_PROVIDER_SLUG }, select: { id: true } }),
  ]);
  return NextResponse.json({
    rentalEnabled: cfg.enabled,
    gpuProviderReady: Boolean(provider),
    fleet,
    spentTodayUsd: spent,
    models: LLM_CATALOG.map((e) => {
      const row = rows.find((r) => {
        const c = parseLlmConfig(r.defaultParams);
        return c.backend === 'gpu' && c.upstreamModel === e.key;
      });
      return {
        key: e.key,
        name: e.name,
        description: e.description,
        repo: e.repo,
        weightsGb: Math.round(e.bytes / 1e8) / 10,
        minVramGb: Math.round(e.hardware.minVramMb / 1000),
        licence: e.licence,
        policy: policies[e.key] ?? DEFAULT_LLM_POLICY,
        sale: row ? { id: row.id, modelId: row.modelId, isActive: row.isActive } : null,
        workers: workers
          .filter((w) => w.modelKey === e.key)
          .map((w) => ({ ...w, pricePerHourUsd: Number(w.pricePerHourUsd) })),
      };
    }),
  });
}

/**
 * `{ fleet }` saves the API budget and caps; `{ key, policy }` a model's
 * uptime; `{ key, sell: true }` creates its `text` row (priced at twice an
 * estimated cost — edit it in the list above).
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { fleet?: unknown; key?: unknown; policy?: unknown; sell?: unknown };

  if (body.fleet !== undefined) {
    await saveFleetConfig(parseFleet(body.fleet));
    return NextResponse.json({ ok: true, fleet: await getFleetConfig() });
  }

  const entry = typeof body.key === 'string' ? getLlmEntry(body.key) : undefined;
  if (!entry) return NextResponse.json({ error: 'ไม่รู้จักโมเดลนี้' }, { status: 400 });

  if (body.policy !== undefined) {
    const policy = parsePolicy(body.policy);
    await savePolicy(entry.key, policy);
    return NextResponse.json({ ok: true, policy });
  }

  if (body.sell === true) {
    const provider = await prisma.aiProvider.findUnique({ where: { slug: GPU_PROVIDER_SLUG } });
    if (!provider) {
      return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า GPU ที่เช่า — ไปที่ Admin → GPU ที่เช่า ก่อน' }, { status: 400 });
    }
    const modelId = entry.key.slice(LLM_KEY_PREFIX.length);
    const exists = await prisma.aiModel.findUnique({ where: { providerId_modelId: { providerId: provider.id, modelId } } });
    if (exists) return NextResponse.json({ error: 'มีโมเดลนี้ในรายการขายแล้ว' }, { status: 400 });
    const packages = await prisma.aiCreditPackage.findMany({
      where: { isActive: true },
      select: { credits: true, bonusCredits: true, priceThb: true, priceUsd: true },
    });
    const pb = pricingBasis(packages);
    const cfg = {
      backend: 'gpu' as const,
      upstreamModel: entry.key,
      inputUsdPerMTok: ESTIMATED_USD.input,
      outputUsdPerMTok: ESTIMATED_USD.output,
      inputCreditsPerMTok: salePrice(ESTIMATED_USD.input, pb.usdToThb, pb.thbPerCredit),
      outputCreditsPerMTok: salePrice(ESTIMATED_USD.output, pb.usdToThb, pb.thbPerCredit),
      contextLength: entry.contextLength,
      maxOutputTokens: entry.maxOutputTokens,
    };
    const row = await prisma.aiModel.create({
      data: {
        providerId: provider.id,
        modelId,
        name: entry.name,
        description: entry.description,
        category: LLM_CATEGORY,
        subcategory: 'chat',
        unitType: 'per_mtok',
        costPerUnit: cfg.outputUsdPerMTok,
        creditsPerUnit: Math.ceil(cfg.outputCreditsPerMTok),
        defaultParams: cfg,
        isActive: true,
        readiness: 'ready',
      },
    });
    return NextResponse.json({ ok: true, id: row.id });
  }

  return NextResponse.json({ error: 'ไม่มีอะไรให้บันทึก' }, { status: 400 });
}
