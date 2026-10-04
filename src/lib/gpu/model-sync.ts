import prisma from '@/lib/db';
import { MODEL_CATALOG, type CatalogEntry } from './catalog';

/**
 * Write the catalogue into `ai_models`.
 *
 * The GPU setup route has always done this while connecting a vendor, which is
 * right for the first run and wrong for every one after it: adding a model to
 * the catalogue then required an admin to re-paste an API key before customers
 * could see it. The loop lives here so both callers share it.
 *
 * Idempotent, and deliberately conservative on update: names, copy, limits and
 * prices follow the catalogue, but `readiness` is never reset — a model that
 * has already rendered successfully on this deployment stays proven.
 */
/**
 * The row's subcategory. A lip-sync entry is a 'video' row like any clip, and
 * this is what tells the studio to give it the lip-sync tab — `lipsync-portrait`
 * asks for a still to make speak, `lipsync` for a clip to re-dub.
 */
export function catalogSubcategory(entry: Pick<CatalogEntry, 'kind' | 'needs'>): string {
  if (entry.kind === 'lipsync') return entry.needs?.image ? 'lipsync-portrait' : 'lipsync';
  return 'self-hosted';
}

export async function syncCatalogModels(providerId: number): Promise<{ created: number; updated: number }> {
  const existing = new Set(
    (
      await prisma.aiModel.findMany({
        where: { providerId },
        select: { modelId: true },
      })
    ).map((m) => m.modelId)
  );

  let created = 0;
  let updated = 0;
  for (const entry of MODEL_CATALOG) {
    const isNew = !existing.has(entry.key);
    await prisma.aiModel.upsert({
      where: { providerId_modelId: { providerId, modelId: entry.key } },
      create: {
        providerId,
        modelId: entry.key,
        name: entry.name,
        description: entry.description,
        category: entry.outputKind,
        subcategory: catalogSubcategory(entry),
        costPerUnit: entry.pricing.costPerUnit,
        creditsPerUnit: entry.pricing.creditsPerUnit,
        maxWidth: entry.limits?.maxWidth ?? null,
        maxHeight: entry.limits?.maxHeight ?? null,
        maxDuration: entry.limits?.maxDuration ?? null,
        isActive: true,
        // Unproven until it renders here — listed, marked, not orderable.
        readiness: 'tuning',
        readinessNote: 'ยังไม่เคยสร้างงานสำเร็จบนระบบนี้ — รอทดสอบ',
      },
      update: {
        name: entry.name,
        description: entry.description,
        category: entry.outputKind,
        subcategory: catalogSubcategory(entry),
        costPerUnit: entry.pricing.costPerUnit,
        creditsPerUnit: entry.pricing.creditsPerUnit,
        maxWidth: entry.limits?.maxWidth ?? null,
        maxHeight: entry.limits?.maxHeight ?? null,
        maxDuration: entry.limits?.maxDuration ?? null,
        isActive: true,
      },
    });
    if (isNew) created += 1;
    else updated += 1;
  }
  return { created, updated };
}
