import type { Prisma } from '@/generated/prisma/client';
import { KIE_CATALOG, kiePriceTable, type KieEntry } from './kie-catalog';
import { kieQuote, pickKieTier, type KieBasis } from './kie-pricing';

/**
 * What a catalogue entry becomes in `ai_models`, and the one write the app
 * makes to those rows by itself.
 *
 * A new entry used to stay out of the studio until someone pressed "ซิงก์โมเดล":
 * eight Suno tools were deployed with no rows, so their tabs never appeared.
 * That button cannot run on its own, because it rewrites every row's price. So
 * each boot adds the rows that do not exist yet and writes nothing else: a
 * price, a readiness, a switch or a place in the list is never touched here,
 * and every new row starts `tuning`. Opening one stays the admin's decision.
 *
 * No database import: kie-sync.ts passes the client in, and the tests a fake.
 */

/** KIE rows sort before every other provider's (whose rows sit at 0 and up). */
const SORT_BASE = -1000;

/** Tries at one boot, for a shared MySQL that stalls; the next boot tries again. */
const BACKFILL_ATTEMPTS = 3;
const BACKFILL_RETRY_MS = 60_000;

/** The columns the sync rewrites on every run: copy, limits and prices. */
export function kieRowValues(entry: KieEntry, basis: KieBasis, priorDefaults?: unknown) {
  const table = kiePriceTable(entry, basis);
  const tier = pickKieTier(table, undefined);
  // The row's own price: the default tier at the shortest length (per
  // second for a voice- or clip-length model, per thousand characters for
  // speech) — what the list shows "from".
  const creditsPerUnit = kieQuote(table, entry.perChars ? { chars: entry.perChars } : {});
  const costPerUnit = Math.round(entry.usd(tier.id, entry.perChars ?? entry.durations?.[0] ?? 1) * 1e6) / 1e6;
  // An admin's own keys in defaultParams (e.g. a lower maxReferenceImages) stay.
  const kept = priorDefaults && typeof priorDefaults === 'object' && !Array.isArray(priorDefaults) ? { ...(priorDefaults as Record<string, unknown>) } : {};
  delete kept.kie;
  const defaultParams = { ...kept, kie: table } as unknown as Prisma.InputJsonValue;
  return {
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
}

/** The columns only a new row gets; after that they are the admin's. */
export function kieNewRowValues(entry: KieEntry, index: number, openNow: boolean) {
  return {
    modelId: entry.key,
    isFeatured: entry.featured === true,
    sortOrder: SORT_BASE + index * 10,
    readiness: openNow ? 'ready' : 'tuning',
    readinessNote: openNow ? null : 'ยังไม่เคยสร้างงานสำเร็จบนระบบนี้ — รอทดสอบ',
  };
}

/** All `addMissingKieRows` may do to the database. */
export interface KieRowsDb {
  aiProvider: {
    findUnique(args: { where: { slug: string }; select: { id: true } }): PromiseLike<{ id: number } | null>;
  };
  aiModel: {
    findMany(args: { where: { providerId: number }; select: { modelId: true } }): PromiseLike<{ modelId: string }[]>;
    createMany(args: { data: Prisma.AiModelCreateManyInput[]; skipDuplicates: true }): PromiseLike<{ count: number }>;
  };
}

export interface KieBackfill {
  added: number;
  keys: string[];
}

/**
 * Insert the catalogue entries that have no row, as one all-or-nothing batch.
 * Running it again changes nothing. Runs that overlap can deadlock on the
 * unique key (MySQL 1213, seen in a test with four at once): the loser throws
 * with no rows written, and a later run adds whatever is still missing.
 */
export async function addMissingKieRows(db: KieRowsDb, basisOf: () => Promise<KieBasis>): Promise<KieBackfill> {
  // No provider means KIE was never set up here: pasting its key syncs everything.
  const provider = await db.aiProvider.findUnique({ where: { slug: 'kie' }, select: { id: true } });
  if (!provider) return { added: 0, keys: [] };

  // Every row counts, switched off or not: one an admin retired is not missing.
  const existing = new Set(
    (await db.aiModel.findMany({ where: { providerId: provider.id }, select: { modelId: true } })).map((m) => m.modelId)
  );
  const missing = [...KIE_CATALOG.entries()].filter(([, entry]) => !existing.has(entry.key));
  if (missing.length === 0) return { added: 0, keys: [] };

  const basis = await basisOf();
  // skipDuplicates: a row the admin's sync created a moment ago is left as it is.
  const { count } = await db.aiModel.createMany({
    data: missing.map(([index, entry]) => ({
      providerId: provider.id,
      ...kieRowValues(entry, basis),
      ...kieNewRowValues(entry, index, false),
    })),
    skipDuplicates: true,
  });
  return { added: count, keys: missing.map(([, entry]) => entry.key) };
}

/**
 * Run a backfill in the background. Next holds requests until `register()`
 * returns, so a slow database must not be waited on from there; and a failure
 * here must never reach the process, because the rows can always wait.
 */
export function backfillKieRows(add: () => Promise<KieBackfill>, retryMs = BACKFILL_RETRY_MS): void {
  const attempt = async (left: number) => {
    try {
      const { added, keys } = await add();
      if (added > 0) console.log(`[kie] added ${added} model rows, tuning until tested: ${keys.join(', ')}`);
    } catch (error) {
      console.error(`[kie] could not add missing model rows (${left - 1} tries left):`, (error as Error).message);
      if (left > 1) setTimeout(() => void attempt(left - 1), retryMs).unref?.();
    }
  };
  void attempt(BACKFILL_ATTEMPTS);
}
