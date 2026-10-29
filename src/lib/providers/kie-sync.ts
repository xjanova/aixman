import prisma from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { pricingBasis } from '@/lib/services/gpu-stats';
import { KIE_CATALOG, RETIRED_KIE_KEYS, kiePriceTable } from './kie-catalog';
import { DEFAULT_KIE_BASIS, kieQuote, pickKieTier, type KieBasis } from './kie-pricing';

/**
 * Write the KIE catalogue into `ai_models` — the provider row first, then one
 * model row per entry with its credits table.
 *
 * Run by Admin → ผู้ให้บริการ → KIE ("ซิงก์โมเดล") and by the admin seed.
 * Idempotent: names, copy, limits and prices follow the catalogue; whether a
 * model is featured, its place in the list and its readiness are the admin's
 * after the first run — except that `openNow` puts every row still `tuning`
 * on sale, for an owner who does not want to test thirty models one by one.
 */

/** KIE rows sort before every other provider's (whose rows sit at 0 and up). */
const SORT_BASE = -1000;

export const KIE_PROVIDER = {
  slug: 'kie',
  name: 'KIE.ai',
  description: 'คีย์เดียวใช้ได้เกือบทุกโมเดล — Google Veo/Nano Banana, GPT Image, Kling, Seedance, Suno และอื่น ๆ',
  baseUrl: 'https://api.kie.ai',
  website: 'https://kie.ai',
  authType: 'bearer',
  supportsImage: true,
  supportsVideo: true,
  supportsEdit: true,
  // Lowest of all: the owner made KIE the primary provider (2026-10-29).
  sortOrder: -1,
} as const;

/** The provider row, created when missing. Never switches off one an admin turned off. */
export async function ensureKieProvider(): Promise<{ id: number; isActive: boolean }> {
  const { slug, ...data } = KIE_PROVIDER;
  return prisma.aiProvider.upsert({
    where: { slug },
    create: { slug, ...data, isActive: true },
    update: { name: data.name, description: data.description, baseUrl: data.baseUrl, website: data.website },
    select: { id: true, isActive: true },
  });
}

/**
 * What a credit is worth: the cheapest rate a customer can buy one at (bonus
 * credits included — they are spent like any other), and the dollar rate the
 * packages imply. Falls back to the seed's numbers when no package is priced.
 */
export async function kieBasis(markup = DEFAULT_KIE_BASIS.markup): Promise<KieBasis> {
  const packages = await prisma.aiCreditPackage.findMany({
    where: { isActive: true },
    select: { credits: true, bonusCredits: true, priceThb: true, priceUsd: true },
  });
  const rates = packages
    .filter((p) => Number(p.priceThb) > 0 && p.credits + p.bonusCredits > 0)
    .map((p) => Number(p.priceThb) / (p.credits + p.bonusCredits));
  const priced = packages.filter((p) => Number(p.priceThb) > 0);
  return {
    usdToThb: priced.length > 0 ? pricingBasis(priced).usdToThb : DEFAULT_KIE_BASIS.usdToThb,
    thbPerCredit: rates.length > 0 ? Math.min(...rates) : DEFAULT_KIE_BASIS.thbPerCredit,
    markup: Number.isFinite(markup) && markup >= 1 ? markup : DEFAULT_KIE_BASIS.markup,
  };
}

export interface KieSyncResult {
  providerId: number;
  created: number;
  updated: number;
  retired: number;
  opened: number;
  basis: KieBasis;
}

export async function syncKieModels(opts: { openNow?: boolean; markup?: number } = {}): Promise<KieSyncResult> {
  const provider = await ensureKieProvider();
  const basis = await kieBasis(opts.markup);
  const existing = new Map(
    (
      await prisma.aiModel.findMany({
        where: { providerId: provider.id },
        select: { modelId: true, defaultParams: true },
      })
    ).map((m) => [m.modelId, m.defaultParams])
  );

  let created = 0;
  let updated = 0;
  for (const [index, entry] of KIE_CATALOG.entries()) {
    const table = kiePriceTable(entry, basis);
    const tier = pickKieTier(table, undefined);
    // The row's own price: the default tier at the shortest length (per
    // second for a voice- or clip-length model) — what the list shows "from".
    const creditsPerUnit = kieQuote(table, {});
    const costPerUnit = Math.round(entry.usd(tier.id, entry.durations?.[0] ?? 1) * 1e6) / 1e6;
    // An admin's own keys in defaultParams (e.g. a lower maxReferenceImages) stay.
    const prior = existing.get(entry.key);
    const kept = prior && typeof prior === 'object' && !Array.isArray(prior) ? { ...(prior as Record<string, unknown>) } : {};
    delete kept.kie;
    const defaultParams = { ...kept, kie: table } as unknown as Prisma.InputJsonValue;
    const shared = {
      name: entry.name,
      description: entry.description,
      category: entry.category,
      subcategory: entry.subcategory,
      unitType: entry.perSecond || entry.durations?.length ? 'per_second' : entry.category === 'image' || entry.category === 'edit' ? 'per_image' : 'per_request',
      costPerUnit,
      creditsPerUnit,
      maxWidth: entry.category === 'image' || entry.category === 'edit' ? 4096 : null,
      maxHeight: entry.category === 'image' || entry.category === 'edit' ? 4096 : null,
      maxDuration: entry.maxDuration ?? null,
      defaultParams,
      isActive: true,
    };
    await prisma.aiModel.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: entry.key } },
      create: {
        providerId: provider.id,
        modelId: entry.key,
        ...shared,
        isFeatured: entry.featured === true,
        sortOrder: SORT_BASE + index * 10,
        readiness: opts.openNow ? 'ready' : 'tuning',
        readinessNote: opts.openNow ? null : 'ยังไม่เคยสร้างงานสำเร็จบนระบบนี้ — รอทดสอบ',
      },
      update: shared,
    });
    if (existing.has(entry.key)) updated += 1;
    else created += 1;
  }

  // A removed entry's row would stay on sale with nothing to build its task.
  const retired = RETIRED_KIE_KEYS.length
    ? (
        await prisma.aiModel.updateMany({
          where: { providerId: provider.id, modelId: { in: RETIRED_KIE_KEYS }, isActive: true },
          data: { isActive: false },
        })
      ).count
    : 0;

  const opened = opts.openNow
    ? (
        await prisma.aiModel.updateMany({
          where: { providerId: provider.id, readiness: 'tuning', modelId: { in: KIE_CATALOG.map((e) => e.key) } },
          data: { readiness: 'ready', readinessNote: null, failureStreak: 0 },
        })
      ).count
    : 0;

  return { providerId: provider.id, created, updated, retired, opened, basis };
}
