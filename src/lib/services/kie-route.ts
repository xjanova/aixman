import prisma from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';
import { AccountPoolManager, accountBlock } from './account-pool';
import { kieBasis } from '@/lib/providers/kie-sync';
import type { KieBasis } from '@/lib/providers/kie-pricing';
import {
  FALLBACK_ENABLED_KEY,
  FALLBACK_MAP_KEY,
  fallbackLoss,
  fallbackRefsFor,
  kieUnavailableReason,
  parseFallbackRef,
  readFallbackEnabled,
  readFallbackMap,
  whyNotFallback,
  type FallbackOrder,
  type FallbackRow,
} from '@/lib/providers/kie-fallback';

/**
 * The database side of KIE's fallback (kie-fallback.ts has the rules): the
 * admin's switch and map from `ai_settings`, and the first fallback row that
 * can take an order and has a usable key.
 */

export type ModelWithProvider = Prisma.AiModelGetPayload<{ include: { provider: true } }>;
export type PoolAccount = NonNullable<Awaited<ReturnType<typeof AccountPoolManager.selectAccount>>>;

export interface FallbackSettings {
  enabled: boolean;
  map: Record<string, string[]>;
}

/** Read fresh on every order: a switch flipped on /admin/kie applies to the next one. */
export async function loadFallbackSettings(): Promise<FallbackSettings> {
  const rows = await prisma.aiSetting.findMany({
    where: { key: { in: [FALLBACK_ENABLED_KEY, FALLBACK_MAP_KEY] } },
    select: { key: true, value: true },
  });
  const value = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  return { enabled: readFallbackEnabled(value(FALLBACK_ENABLED_KEY)), map: readFallbackMap(value(FALLBACK_MAP_KEY)) };
}

export function fallbackRowOf(row: ModelWithProvider): FallbackRow {
  return {
    providerSlug: row.provider.slug,
    providerActive: row.provider.isActive,
    modelId: row.modelId,
    category: row.category,
    subcategory: row.subcategory,
    isActive: row.isActive,
    readiness: row.readiness,
    maxDuration: row.maxDuration,
    costPerUnit: Number(row.costPerUnit),
    defaultParams: row.defaultParams,
  };
}

/**
 * The first row of the model's fallback list that can do this order, serves
 * it without a loss on the `paidCredits` the customer was charged, and has a
 * key free now. Each row passed over is noted in `skipped` (ref + Thai
 * reason) for the alert and the admin.
 */
export async function pickFallback(
  kieKey: string,
  order: FallbackOrder,
  map: Record<string, string[]>,
  paidCredits: number,
  skipped: string[] = []
): Promise<{ model: ModelWithProvider; account: PoolAccount } | null> {
  // Read only when some row can do the job: what a credit sells for now.
  let basis: KieBasis | null = null;
  for (const ref of fallbackRefsFor(kieKey, map)) {
    const parsed = parseFallbackRef(ref);
    if (!parsed) continue;
    const row = await prisma.aiModel.findFirst({
      where: { modelId: parsed.modelId, provider: { slug: parsed.provider } },
      include: { provider: true },
    });
    if (!row) {
      skipped.push(`${ref}: ไม่มีโมเดลนี้ในระบบ`);
      continue;
    }
    const fallback = fallbackRowOf(row);
    let why = whyNotFallback(order, fallback);
    if (why === null) {
      // Unreadable prices are no licence to guess: the row is passed over.
      basis ??= await kieBasis().catch(() => null);
      why = basis ? fallbackLoss(fallback, order, paidCredits, basis) : 'อ่านราคาเครดิตไม่ได้ — ไม่เสี่ยงขาดทุน';
    }
    if (why !== null) {
      skipped.push(`${ref}: ${why}`);
      continue;
    }
    const account = await AccountPoolManager.selectAccount(row.providerId);
    if (account) return { model: row, account };
    skipped.push(`${ref}: ไม่มีคีย์ที่ใช้ได้ตอนนี้`);
  }
  return null;
}

/** Why none of KIE's keys can take an order now, for the order's route and the admin page. */
export async function kieUnavailable(providerId: number): Promise<string> {
  const keys = await prisma.aiAccountPool.findMany({ where: { providerId } });
  const now = new Date();
  return kieUnavailableReason(keys.map((k) => accountBlock(k, now)));
}
