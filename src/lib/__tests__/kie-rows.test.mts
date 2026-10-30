/**
 * The KIE rows a boot adds by itself: only the ones that do not exist, always
 * `tuning`, and not one write to a row that does.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/kie-rows.test.mts)
 *
 * The database is an in-memory table. Reaching for anything but the three calls
 * the backfill is allowed (an update, an upsert, a delete) throws.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KIE_CATALOG, kiePriceTable } from '@/lib/providers/kie-catalog';
import { kieQuote, type KieBasis } from '@/lib/providers/kie-pricing';
import {
  addMissingKieRows,
  backfillKieRows,
  kieNewRowValues,
  kieRowValues,
  type KieBackfill,
  type KieRowsDb,
} from '@/lib/providers/kie-rows';

const BASIS: KieBasis = { usdToThb: 36, thbPerCredit: 0.5, markup: 2 };
const PROVIDER_ID = 7;

type Row = Record<string, unknown> & { providerId: number; modelId: string };

/** A method nobody allowed throws, naming itself. */
const only = <T extends object>(table: string, allowed: T): T =>
  new Proxy(allowed, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
      throw new Error(`${table}.${String(prop)} must never be called by the backfill`);
    },
  });

function fakeDb(rows: Row[], provider: { id: number } | null = { id: PROVIDER_ID }, onBeforeInsert?: () => void) {
  const inserts: Row[][] = [];
  const db: KieRowsDb = {
    aiProvider: only('aiProvider', {
      findUnique: async () => provider,
    }),
    aiModel: only('aiModel', {
      findMany: async ({ where }: { where: { providerId: number } }) =>
        rows.filter((r) => r.providerId === where.providerId).map((r) => ({ modelId: r.modelId })),
      createMany: async ({ data, skipDuplicates }: { data: unknown[]; skipDuplicates: true }) => {
        assert.equal(skipDuplicates, true);
        onBeforeInsert?.();
        const batch = data as Row[];
        inserts.push(batch);
        // ai_models is unique on (provider_id, model_id).
        const fresh = batch.filter((n) => !rows.some((r) => r.providerId === n.providerId && r.modelId === n.modelId));
        rows.push(...fresh);
        return { count: fresh.length };
      },
    }),
  };
  return { db, inserts };
}

/** A row as an admin left it: nothing here matches what the catalogue would write. */
const adminRow = (modelId: string, over: Partial<Row> = {}): Row => ({
  providerId: PROVIDER_ID,
  modelId,
  name: 'ชื่อที่แอดมินตั้ง',
  creditsPerUnit: 4321,
  costPerUnit: 9.87,
  defaultParams: { kie: { tiers: 'ราคาเก่า' }, maxReferenceImages: 2 },
  readiness: 'ready',
  readinessNote: null,
  isActive: true,
  isFeatured: true,
  sortOrder: 555,
  ...over,
});

const basisOf = async () => BASIS;
const sunoTools = KIE_CATALOG.filter((e) => e.suno);
const notSuno = KIE_CATALOG.filter((e) => !e.suno);

test('a deployed catalogue gets the rows it lacks, as production lacked the Suno tools', async () => {
  const rows = [...notSuno, sunoTools[0]].map((e) => adminRow(e.key));
  const { db } = fakeDb(rows);

  const result = await addMissingKieRows(db, basisOf);

  const lacking = sunoTools.slice(1).map((e) => e.key);
  assert.equal(lacking.length, 8);
  assert.equal(result.added, 8);
  assert.deepEqual(result.keys, lacking);
  assert.deepEqual(
    rows.slice(-8).map((r) => r.modelId),
    lacking
  );
});

test('rows that exist are left exactly as they were', async () => {
  const rows = notSuno.map((e) => adminRow(e.key));
  const before = structuredClone(rows);
  const { db } = fakeDb(rows);

  await addMissingKieRows(db, basisOf);

  assert.deepEqual(rows.slice(0, before.length), before);
});

test('a new row starts tuning and is never put on sale', async () => {
  const rows: Row[] = [];
  const { db } = fakeDb(rows);

  await addMissingKieRows(db, basisOf);

  assert.equal(rows.length, KIE_CATALOG.length);
  for (const row of rows) {
    assert.equal(row.readiness, 'tuning', row.modelId);
    assert.match(String(row.readinessNote), /รอทดสอบ/);
    assert.equal(row.providerId, PROVIDER_ID);
  }
});

test('a new row is priced and placed the way the admin sync would create it', async () => {
  const rows: Row[] = [];
  const { db } = fakeDb(rows);

  await addMissingKieRows(db, basisOf);

  for (const [index, entry] of KIE_CATALOG.entries()) {
    const row = rows[index];
    const table = kiePriceTable(entry, BASIS);
    assert.equal(row.modelId, entry.key);
    assert.deepEqual(row.defaultParams, { kie: table });
    assert.equal(row.creditsPerUnit, kieQuote(table, entry.perChars ? { chars: entry.perChars } : {}));
    assert.equal(row.sortOrder, -1000 + index * 10);
    assert.equal(row.isFeatured, entry.featured === true);
    assert.deepEqual({ ...row }, { providerId: PROVIDER_ID, ...kieRowValues(entry, BASIS), ...kieNewRowValues(entry, index, false) });
  }
});

test('running again adds nothing, however many restarts there are', async () => {
  const rows = notSuno.map((e) => adminRow(e.key));
  const { db, inserts } = fakeDb(rows);

  assert.equal((await addMissingKieRows(db, basisOf)).added, sunoTools.length);
  const after = structuredClone(rows);
  let basisReads = 0;
  for (let restart = 0; restart < 5; restart += 1) {
    const result = await addMissingKieRows(db, async () => {
      basisReads += 1;
      return BASIS;
    });
    assert.deepEqual(result, { added: 0, keys: [] });
  }

  assert.equal(inserts.length, 1);
  assert.equal(basisReads, 0, 'a boot with nothing to add reads no prices');
  assert.deepEqual(rows, after);
});

test('a row an admin switched off is not missing', async () => {
  const off = adminRow(KIE_CATALOG[0].key, { isActive: false, readiness: 'disabled' });
  const rows = [off, ...KIE_CATALOG.slice(1).map((e) => adminRow(e.key))];
  const { db, inserts } = fakeDb(rows);

  assert.equal((await addMissingKieRows(db, basisOf)).added, 0);
  assert.equal(inserts.length, 0);
  assert.equal(rows.length, KIE_CATALOG.length);
  assert.equal(rows[0].isActive, false);
});

test('another provider sharing a model id does not count as having the row', async () => {
  const rows = KIE_CATALOG.map((e) => adminRow(e.key, { providerId: PROVIDER_ID + 1 }));
  const { db } = fakeDb(rows);

  assert.equal((await addMissingKieRows(db, basisOf)).added, KIE_CATALOG.length);
});

test('KIE never set up here: nothing is created, not even the provider', async () => {
  const rows: Row[] = [];
  const { db, inserts } = fakeDb(rows, null);

  assert.deepEqual(await addMissingKieRows(db, basisOf), { added: 0, keys: [] });
  assert.equal(inserts.length, 0);
  assert.equal(rows.length, 0);
});

test('a row the admin sync wrote a moment earlier stays the admin sync’s', async () => {
  const entry = sunoTools[1];
  const rows = notSuno.map((e) => adminRow(e.key));
  const racer = adminRow(entry.key, { creditsPerUnit: 777, readiness: 'ready' });
  const { db } = fakeDb(rows, undefined, () => rows.push(racer));

  const result = await addMissingKieRows(db, basisOf);

  assert.equal(result.added, sunoTools.length - 1);
  const stored = rows.filter((r) => r.modelId === entry.key);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0], racer);
});

test('no price to go by: nothing is inserted', async () => {
  const rows: Row[] = [];
  const { db, inserts } = fakeDb(rows);

  await assert.rejects(addMissingKieRows(db, async () => Promise.reject(new Error('db stalled'))));
  assert.equal(inserts.length, 0);
});

test('the sync’s shared values keep an admin’s own keys and replace the price table', () => {
  const entry = KIE_CATALOG[0];
  const values = kieRowValues(entry, BASIS, { kie: { old: true }, maxReferenceImages: 2 });

  assert.deepEqual(values.defaultParams, { maxReferenceImages: 2, kie: kiePriceTable(entry, BASIS) });
  assert.deepEqual(kieRowValues(entry, BASIS, ['not', 'an', 'object']).defaultParams, { kie: kiePriceTable(entry, BASIS) });
});

test('only the admin’s "open now" makes a new row ready', () => {
  const entry = KIE_CATALOG[0];

  assert.equal(kieNewRowValues(entry, 0, false).readiness, 'tuning');
  assert.deepEqual(
    { readiness: kieNewRowValues(entry, 0, true).readiness, note: kieNewRowValues(entry, 0, true).readinessNote },
    { readiness: 'ready', note: null }
  );
});

const until = async (done: () => boolean) => {
  const deadline = Date.now() + 2_000;
  while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2));
};

test('a boot that finds the database stalled tries again, then gives up quietly', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  let tries = 0;

  backfillKieRows(async () => {
    tries += 1;
    throw new Error('connect ETIMEDOUT');
  }, 1);

  await until(() => errors.mock.callCount() === 3);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(tries, 3);
  assert.equal(errors.mock.callCount(), 3);
});

test('the retry stops at the first success, and says what it added', async (t) => {
  t.mock.method(console, 'error', () => {});
  const logs = t.mock.method(console, 'log', () => {});
  let tries = 0;

  backfillKieRows(async (): Promise<KieBackfill> => {
    tries += 1;
    if (tries === 1) throw new Error('connect ETIMEDOUT');
    return { added: 2, keys: ['kie/a', 'kie/b'] };
  }, 1);

  await until(() => logs.mock.callCount() === 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(tries, 2);
  assert.match(String(logs.mock.calls[0].arguments[0]), /added 2 model rows.*kie\/a, kie\/b/);
});

test('a boot with nothing to add logs nothing', async (t) => {
  const logs = t.mock.method(console, 'log', () => {});
  let tries = 0;

  backfillKieRows(async () => {
    tries += 1;
    return { added: 0, keys: [] };
  }, 1);

  await until(() => tries === 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(logs.mock.callCount(), 0);
});

test('the boot runs the backfill, and neither it nor the deploy runs the price-rewriting sync', () => {
  const boot = readFileSync(new URL('../../instrumentation.ts', import.meta.url), 'utf8');
  const deploy = readFileSync(new URL('../../../.github/workflows/auto-deploy.yml', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../providers/kie-sync.ts', import.meta.url), 'utf8');

  assert.match(boot, /startKieRowBackfill\(\)/);
  assert.doesNotMatch(boot, /syncKieModels/);
  assert.doesNotMatch(deploy, /syncKieModels|providers\/kie/);
  assert.match(sync, /backfillKieRows\(\(\) => addMissingKieRows\(prisma, kieBasis\)\)/);
});
