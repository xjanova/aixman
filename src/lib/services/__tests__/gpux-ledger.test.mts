/**
 * The GPUxMINE earnings ledger: what is written for a delivered community job,
 * that it is written once, and what the 30-day sums then decide — the next
 * job's free share and a machine's place in the queue.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/services/__tests__/gpux-ledger.test.mts)
 *
 * The database is a stand-in object: these tests read what the writer asks
 * for and what it would send, never a real MySQL.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AlertInput } from '@/lib/notify/alerts';

// The Prisma client wants a URL at import time; nothing here connects.
process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';

const { Prisma } = await import('@/generated/prisma/client');
const ledger = await import('@/lib/services/gpux-ledger');
const { rankCommunityCandidates } = await import('@/lib/gpu/community-dispatch');
const { revenueFromCredits, shouldFreeShare } = await import('@/lib/services/gpux-settlement');
const {
  ledgerHealth,
  buildSnapshot,
  claimStampFor,
  communityPriority,
  earningJobId,
  earningKind,
  forgetLedgerSnapshot,
  insertEarningSql,
  ledgerSnapshot,
  ledgerThbPerCredit,
  nodeReliability,
  planEarning,
  recordCommunityEarning,
  recordEarningSafely,
  RENTED_CLAIM_STAMP,
  sqlUtc,
  sumsFor,
  sweepMissingEarnings,
} = ledger;

type Facts = Parameters<typeof planEarning>[0];
const noAlert = () => {};
type Sql = InstanceType<typeof Prisma.Sql>;

// ---------------------------------------------------------------------------
// A stand-in database
// ---------------------------------------------------------------------------

interface FakeJob {
  id: number;
  generationId: number;
  modelKey: string;
  status: string;
  externalJobId: string | null;
  gpuSeconds: number;
  completedAt: Date | null;
  freeShare: boolean;
  pro: boolean;
  ownerUserId: number | null;
  reviewReason: string | null;
  worker: { externalId: string; providerSlug: string; metadata: unknown } | null;
  generation: { creditsUsed: number; creditsRefunded: number } | null;
}

interface FakeNode {
  id: number;
  userId: number;
  referrerUserId: number | null;
  workerId: string;
  pairedAt: Date | null;
}

function fakeDb(init: {
  jobs?: FakeJob[];
  nodes?: FakeNode[];
  activeAffiliates?: number[];
  packages?: { credits: number; bonusCredits: number; priceThb: number; priceUsd: number }[];
  groups?: { userId: number | null; workerId: string; _sum: Record<string, number | null> }[];
  missing?: number[];
  failInsert?: boolean;
  failGroupBy?: boolean;
  /** XMAN Studio's 2026_09_25 migration has not run: the new columns are missing. */
  unmigrated?: boolean;
  missingCount?: number;
}) {
  const jobs = new Map((init.jobs ?? []).map((j) => [j.id, j]));
  const nodes = init.nodes ?? [];
  const earnings = new Map<string, unknown[]>();
  const calls = { inserts: [] as Sql[], queries: [] as Sql[], groupBy: 0, affiliateLookups: 0 };
  const db = {
    aiGpuJob: {
      findUnique: async ({ where }: { where: { id: number } }) => jobs.get(where.id) ?? null,
    },
    gpuJobEarning: {
      findUnique: async ({ where }: { where: { jobId: string } }) => (earnings.has(where.jobId) ? { id: 1 } : null),
      findFirst: async () => {
        if (init.unmigrated) throw new Error("Unknown column 'gpu_job_earnings.ai_gpu_job_id' in 'field list'");
        return null;
      },
      groupBy: async (args: { by: string[] }) => {
        calls.groupBy += 1;
        if (init.failGroupBy) throw new Error("Unknown column 'donated_value_satang'");
        if (args.by.length === 1 && args.by[0] === 'status') {
          return [
            { status: 'pending', _count: { _all: 4 }, _sum: { amountSatang: 1920 } },
            { status: 'review', _count: { _all: 1 }, _sum: { amountSatang: 480 } },
          ];
        }
        return init.groups ?? [];
      },
    },
    gpuNode: {
      findUnique: async ({ where }: { where: { workerId: string } }) => {
        const n = nodes.find((x) => x.workerId === where.workerId);
        return n ? { id: n.id, userId: n.userId, referrerUserId: n.referrerUserId } : null;
      },
      aggregate: async ({ where }: { where: { userId: number } }) => {
        const paired = nodes
          .filter((n) => n.userId === where.userId && n.pairedAt)
          .map((n) => n.pairedAt as Date)
          .sort((a, b) => a.getTime() - b.getTime());
        return { _min: { pairedAt: paired[0] ?? null } };
      },
    },
    aiCreditPackage: {
      findMany: async () => init.packages ?? [{ credits: 100, bonusCredits: 0, priceThb: 50, priceUsd: 1.5 }],
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Prisma.sql(strings, ...values);
      calls.queries.push(sql);
      if (/FROM affiliates/.test(sql.sql)) {
        calls.affiliateLookups += 1;
        return (init.activeAffiliates ?? []).includes(sql.values[0] as number) ? [{ one: 1 }] : [];
      }
      if (/SELECT COUNT\(\*\) AS n FROM ai_gpu_jobs j/.test(sql.sql)) return [{ n: BigInt(init.missingCount ?? 0) }];
      if (/FROM ai_gpu_jobs j/.test(sql.sql)) return (init.missing ?? []).map((id) => ({ id: BigInt(id) }));
      return [];
    },
    $executeRaw: async (sql: Sql) => {
      if (init.failInsert) throw new Error("Unknown column 'ai_gpu_job_id' in 'field list'");
      calls.inserts.push(sql);
      const jobId = sql.values[3] as string;
      // ON DUPLICATE KEY UPDATE id = id: an existing row is left as it is.
      if (!earnings.has(jobId)) earnings.set(jobId, sql.values);
      return 1;
    },
  };
  return { db: db as unknown as Parameters<typeof recordCommunityEarning>[1], calls, earnings };
}

const COMPLETED = new Date('2026-09-20T10:00:00.000Z');

function communityJob(over: Partial<FakeJob> = {}, meta: Record<string, unknown> = {}): FakeJob {
  return {
    id: 77,
    generationId: 501,
    modelKey: 'sdxl-community',
    status: 'completed',
    externalJobId: 'prompt-abc',
    gpuSeconds: 42,
    completedAt: COMPLETED,
    freeShare: false,
    pro: false,
    ownerUserId: 5,
    reviewReason: null,
    worker: { externalId: 'w-home-1', providerSlug: 'gpuxmine', metadata: { ownerUserId: 5, lane: 'full', ...meta } },
    generation: { creditsUsed: 12, creditsRefunded: 0 },
    ...over,
  };
}

const homeNode = (over: Partial<FakeNode> = {}): FakeNode => ({
  id: 31,
  userId: 5,
  referrerUserId: 9,
  workerId: 'w-home-1',
  pairedAt: new Date('2026-06-01T00:00:00.000Z'),
  ...over,
});

/** The insert's values by column, from the order insertEarningSql writes them in. */
const COLUMNS = [
  'gpu_node_id', 'user_id', 'worker_id', 'job_id', 'ai_gpu_job_id', 'generation_id', 'prompt_id',
  'kind', 'model_key', 'lane', 'seconds', 'amount_satang',
  'credits_charged', 'thb_per_credit', 'revenue_satang', 'platform_fee_rate', 'platform_fee_satang',
  'referral_satang', 'referral_user_id', 'donated_value_satang', 'free_share', 'pro',
  'status', 'review_reason', 'completed_at', 'created_at', 'updated_at',
] as const;
const columns = (sql: Sql): Record<(typeof COLUMNS)[number], unknown> =>
  Object.fromEntries(COLUMNS.map((c, i) => [c, sql.values[i]])) as Record<(typeof COLUMNS)[number], unknown>;

beforeEach(() => forgetLedgerSnapshot());

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

test('a paid job is written once, pending, with the whole settlement on the row', async () => {
  const { db, calls } = fakeDb({ jobs: [communityJob()], nodes: [homeNode()], activeAffiliates: [9] });

  const first = await recordCommunityEarning(77, db);
  assert.equal(first.status, 'written');
  assert.equal(calls.inserts.length, 1);

  const sql = calls.inserts[0];
  assert.match(sql.sql, /INSERT INTO gpu_job_earnings/);
  assert.match(sql.sql, /ON DUPLICATE KEY UPDATE id = id\s*$/);
  assert.equal(sql.values.length, COLUMNS.length);

  const row = columns(sql);
  // 12 credits x ฿0.50 = 600 satang; 20% fee = 120; pool 480; 5% referral = 24.
  assert.equal(row.job_id, 'aix-gpu-job-77');
  assert.equal(row.ai_gpu_job_id, 77);
  assert.equal(row.generation_id, 501);
  assert.equal(row.prompt_id, 'prompt-abc', 'the node’s prompt_id has its own column, not the key');
  assert.equal(row.gpu_node_id, 31);
  assert.equal(row.user_id, 5);
  assert.equal(row.worker_id, 'w-home-1');
  assert.equal(row.kind, 'image');
  assert.equal(row.lane, 'full');
  assert.equal(row.seconds, 42);
  assert.equal(row.credits_charged, 12);
  assert.equal(row.thb_per_credit, '0.500000');
  assert.equal(row.revenue_satang, 600);
  assert.equal(row.platform_fee_rate, '0.2000');
  assert.equal(row.platform_fee_satang, 120);
  assert.equal(row.referral_satang, 24);
  assert.equal(row.referral_user_id, 9);
  assert.equal(row.amount_satang, 456, 'amount = what the owner receives, after the referral');
  assert.equal(row.donated_value_satang, 0);
  assert.equal(row.free_share, 0);
  assert.equal(row.pro, 0);
  assert.equal(row.status, 'pending');
  assert.equal(row.review_reason, null);
  assert.equal(row.completed_at, '2026-09-20 10:00:00', 'UTC wall clock, as Laravel writes it');

  // Nothing created or destroyed.
  assert.equal(
    (row.platform_fee_satang as number) + (row.referral_satang as number) + (row.amount_satang as number),
    row.revenue_satang
  );

  // A second tick, an overlapping tick, the sweep: nothing more is written.
  const second = await recordCommunityEarning(77, db);
  assert.deepEqual(second, { status: 'exists' });
  assert.equal(calls.inserts.length, 1);
});

test('two writers racing past the existence check still leave one row (the database decides)', async () => {
  const { db, calls, earnings } = fakeDb({ jobs: [communityJob()], nodes: [homeNode({ referrerUserId: null })] });
  const [a, b] = await Promise.all([recordCommunityEarning(77, db), recordCommunityEarning(77, db)]);
  assert.equal(a.status, 'written');
  assert.equal(b.status, 'written');
  assert.equal(calls.inserts.length, 2, 'both sent the insert…');
  assert.equal(earnings.size, 1, '…and ON DUPLICATE KEY kept the first');
});

test('a free-share job pays its owner 0, pays no referral, and records what it gave (D6)', async () => {
  const { db, calls } = fakeDb({ jobs: [communityJob({ freeShare: true })], nodes: [homeNode()], activeAffiliates: [9] });
  await recordCommunityEarning(77, db);
  const row = columns(calls.inserts[0]);
  assert.equal(row.free_share, 1);
  assert.equal(row.amount_satang, 0);
  assert.equal(row.referral_satang, 0);
  assert.equal(row.referral_user_id, null);
  assert.equal(row.donated_value_satang, 480, 'the pool — what the node would have been paid');
  // The platform keeps the revenue: its fee, and the pool that was given away.
  assert.equal((row.platform_fee_satang as number) + (row.donated_value_satang as number), row.revenue_satang);
});

test('Pro, stamped at claim, lowers the fee on the row', async () => {
  const { db, calls } = fakeDb({ jobs: [communityJob({ pro: true })], nodes: [homeNode({ referrerUserId: null })] });
  await recordCommunityEarning(77, db);
  const row = columns(calls.inserts[0]);
  assert.equal(row.pro, 1);
  assert.equal(row.platform_fee_rate, '0.1200');
  assert.equal(row.amount_satang, 528);
});

test('referral only for an active affiliate, never for yourself, and only inside twelve months (D8)', async () => {
  // Not an active affiliate (pending, suspended or no row at all).
  let t = fakeDb({ jobs: [communityJob()], nodes: [homeNode()], activeAffiliates: [] });
  await recordCommunityEarning(77, t.db);
  assert.equal(columns(t.calls.inserts[0]).referral_satang, 0);
  assert.equal(columns(t.calls.inserts[0]).amount_satang, 480);

  // The owner's own id in referrer_user_id: never paid to themselves, not even looked up.
  t = fakeDb({ jobs: [communityJob()], nodes: [homeNode({ referrerUserId: 5 })], activeAffiliates: [5] });
  await recordCommunityEarning(77, t.db);
  assert.equal(columns(t.calls.inserts[0]).referral_satang, 0);
  assert.equal(t.calls.affiliateLookups, 0);

  // Twelve months counted from the owner's FIRST pairing, on any of their machines.
  t = fakeDb({
    jobs: [communityJob()],
    nodes: [
      homeNode({ pairedAt: new Date('2026-08-01T00:00:00Z') }),
      homeNode({ id: 12, workerId: 'w-old', pairedAt: new Date('2025-08-01T00:00:00Z'), referrerUserId: 9 }),
    ],
    activeAffiliates: [9],
  });
  await recordCommunityEarning(77, t.db);
  assert.equal(columns(t.calls.inserts[0]).referral_satang, 0, 'first paired 2025-08: the window closed 2026-08');
});

test('a machine XMAN Studio no longer lists is still paid to the owner it was dispatched for', async () => {
  // Re-enrolled: gpu_nodes no longer has this worker_id. The claim-time owner
  // and the pushed referrer/first-pairing stand in.
  const job = communityJob({ ownerUserId: 5 }, { referrerUserId: 9, firstPairedAt: '2026-06-01T00:00:00Z' });
  const { db, calls } = fakeDb({ jobs: [job], nodes: [], activeAffiliates: [9] });
  const outcome = await recordCommunityEarning(77, db);
  assert.equal(outcome.status, 'written');
  const row = columns(calls.inserts[0]);
  assert.equal(row.user_id, 5);
  assert.equal(row.gpu_node_id, null);
  assert.equal(row.referral_satang, 24);
});

test('no owner anywhere: nothing is written, and an admin is told', async () => {
  const job = communityJob({ ownerUserId: null }, { ownerUserId: null });
  const { db, calls } = fakeDb({ jobs: [job], nodes: [] });
  const outcome = await recordCommunityEarning(77, db);
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.status === 'skipped' && outcome.alert, true);
  assert.equal(calls.inserts.length, 0);

  const alerts: AlertInput[] = [];
  await recordEarningSafely(77, 'delivery', { db, alert: (a) => alerts.push(a) });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'gpux-earning');
  assert.match(alerts[0].lines?.join(' ') ?? '', /no owner/);
});

test('a rented job is none of the ledger’s business', async () => {
  const job = communityJob({ worker: { externalId: 'pod-1', providerSlug: 'simplepod', metadata: {} } });
  const { db, calls } = fakeDb({ jobs: [job] });
  const outcome = await recordCommunityEarning(77, db);
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.status === 'skipped' && outcome.alert, false);
  assert.equal(calls.inserts.length, 0);
});

test('the customer’s actual charge is the job’s value — quality multiplier in, refunds out', async () => {
  // A "high quality" order: 1 credit x 3 = 3 credits charged; 1 of them later refunded.
  const job = communityJob({ generation: { creditsUsed: 3, creditsRefunded: 1 } });
  const { db, calls } = fakeDb({ jobs: [job], nodes: [homeNode({ referrerUserId: null })] });
  await recordCommunityEarning(77, db);
  const row = columns(calls.inserts[0]);
  assert.equal(row.credits_charged, 2);
  assert.equal(row.revenue_satang, 100);
});

test('the rate is stored to six decimals and the money is computed from exactly that (replayable)', async () => {
  // 10,000 credits for ฿1,025 → ฿0.1025 a credit; 10 credits = 102.5 satang →
  // 103 (binary floating point says 102.4999… → 102).
  const job = communityJob({ generation: { creditsUsed: 10, creditsRefunded: 0 } });
  const { db, calls } = fakeDb({
    jobs: [job],
    nodes: [homeNode({ referrerUserId: null })],
    packages: [{ credits: 10_000, bonusCredits: 0, priceThb: 1025, priceUsd: 30 }],
  });
  await recordCommunityEarning(77, db);
  const row = columns(calls.inserts[0]);
  assert.equal(row.thb_per_credit, '0.102500');
  assert.equal(row.revenue_satang, 103);
  assert.equal(revenueFromCredits(row.credits_charged as number, Number(row.thb_per_credit)), row.revenue_satang);

  // A rate with more decimals than the column holds is rounded before it is used.
  assert.equal(ledgerThbPerCredit(335 / 1100), 0.304545);
  assert.equal(ledgerThbPerCredit(0), 0);
  assert.equal(ledgerThbPerCredit(Number.NaN), 0);
});

test('no price to value a credit at: nothing is written (a 0 row would be forever), and an admin is told', async () => {
  const { db, calls } = fakeDb({ jobs: [communityJob()], nodes: [homeNode()], packages: [] });
  const outcome = await recordCommunityEarning(77, db);
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.status === 'skipped' && outcome.alert, true);
  assert.equal(calls.inserts.length, 0);
});

test('a render judged odd at delivery, or one too fast for its lane, is written as review', async () => {
  let t = fakeDb({
    jobs: [communityJob({ reviewReason: 'ภาพผลงานเป็นสีเดียวทั้งภาพ (1024×1024)' })],
    nodes: [homeNode({ referrerUserId: null })],
  });
  await recordCommunityEarning(77, t.db);
  let row = columns(t.calls.inserts[0]);
  assert.equal(row.status, 'review');
  assert.match(row.review_reason as string, /สีเดียว/);
  assert.equal(row.amount_satang, 480, 'the amount is still recorded; XMAN Studio holds it for an admin');

  // SDXL on a slow-lane card cannot finish claim-to-delivery in 3 s.
  t = fakeDb({
    jobs: [communityJob({ gpuSeconds: 3 }, { lane: 'slow' })],
    nodes: [homeNode({ referrerUserId: null })],
  });
  await recordCommunityEarning(77, t.db);
  row = columns(t.calls.inserts[0]);
  assert.equal(row.lane, 'slow');
  assert.equal(row.status, 'review');
  assert.match(row.review_reason as string, /เร็วผิดปกติ/);
});

test('a database error never escapes the safe writer, and says what to do', async () => {
  const { db } = fakeDb({ jobs: [communityJob()], nodes: [homeNode()], failInsert: true });
  await assert.rejects(recordCommunityEarning(77, db), /Unknown column/);
  const alerts: AlertInput[] = [];
  assert.equal(await recordEarningSafely(77, 'delivery', { db, alert: (a) => alerts.push(a) }), null);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, 'write-failed');
  assert.match(alerts[0].lines?.join(' ') ?? '', /migration/);
});

test('planEarning refuses a job that is not finished', () => {
  const base = communityJob();
  const facts: Facts = {
    job: { ...base, status: 'running', completedAt: null },
    worker: base.worker!,
    generation: base.generation,
    node: null,
    referrer: null,
    ownerFirstPairedAt: null,
    thbPerCredit: 0.5,
    catalogue: null,
  };
  const plan = planEarning(facts);
  assert.equal(plan.write, false);
});

test('insertEarningSql never lets a float or NOW() near a column', () => {
  const base = communityJob();
  const plan = planEarning({
    job: base,
    worker: base.worker!,
    generation: base.generation,
    node: null,
    referrer: null,
    ownerFirstPairedAt: null,
    thbPerCredit: 0.5,
    catalogue: { kind: 'image', outputKind: 'image', baselineSecondsPerUnit: 60 },
  });
  assert.ok(plan.write);
  const sql = insertEarningSql(plan.row, new Date('2026-09-20T10:05:00.123Z'));
  assert.doesNotMatch(sql.sql, /NOW\(\)/i);
  const row = columns(sql);
  assert.equal(row.created_at, '2026-09-20 10:05:00');
  for (const [name, value] of Object.entries(row)) {
    if (typeof value === 'number') assert.ok(Number.isInteger(value), `${name} = ${value} must be an integer`);
  }
  assert.equal(sqlUtc(new Date('2026-01-02T03:04:05.999Z')), '2026-01-02 03:04:05');
  assert.equal(earningJobId(12), 'aix-gpu-job-12');
  assert.equal(earningKind({ kind: 'lipsync', outputKind: 'video' }), 'video');
  assert.equal(earningKind({ kind: 'audio' }), 'audio');
  assert.equal(earningKind(null), 'image');
});

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

test('the sweep writes what the delivery path could not, and does not retry the same job every tick', async () => {
  const jobs = [communityJob({ id: 901 }), communityJob({ id: 902 })];
  const now = Date.parse('2026-09-21T00:00:00Z');
  const t = fakeDb({ jobs, nodes: [homeNode({ referrerUserId: null })], missing: [901, 902] });

  assert.equal(await sweepMissingEarnings(now, { db: t.db, alert: noAlert }), 2);
  const first = t.calls.queries.find((q) => /FROM ai_gpu_jobs j/.test(q.sql))!;
  assert.match(first.sql, /LEFT JOIN gpu_job_earnings e1 ON e1\.ai_gpu_job_id = j\.id/);
  assert.match(first.sql, /e1\.id IS NULL AND e2\.id IS NULL/);
  assert.match(first.sql, /LIMIT 20/);
  assert.ok(first.values.includes('2026-09-14 00:00:00'), 'a week back');
  assert.ok(first.values.includes('2026-09-20 23:58:00'), 'not the last two minutes: delivery is still writing those');

  // One minute later: both were just tried, so they are excluded.
  t.calls.queries.length = 0;
  await sweepMissingEarnings(now + 60_000, { db: t.db, alert: noAlert });
  const second = t.calls.queries.find((q) => /FROM ai_gpu_jobs j/.test(q.sql))!;
  assert.match(second.sql, /NOT IN/);
  assert.ok(second.values.includes(901) && second.values.includes(902));
});

test('a job the sweep cannot write for a lasting reason steps aside for hours, a failed one for minutes', async () => {
  const now = Date.parse('2026-09-22T00:00:00Z');
  const ownerless = communityJob({ id: 911, ownerUserId: null }, { ownerUserId: null });
  const t = fakeDb({ jobs: [ownerless, communityJob({ id: 912 })], nodes: [], missing: [911, 912], failInsert: true });
  await sweepMissingEarnings(now, { db: t.db, alert: noAlert });

  const excluded = async (at: number) => {
    t.calls.queries.length = 0;
    await sweepMissingEarnings(at, { db: t.db, alert: noAlert });
    const q = t.calls.queries.find((x) => /FROM ai_gpu_jobs j/.test(x.sql))!;
    return [911, 912].filter((id) => q.values.includes(id));
  };
  // 911 has no owner (skipped); 912 hit a database error (failed).
  assert.deepEqual(await excluded(now + 11 * 60_000), [911], 'the failed one is back after ten minutes');
  assert.deepEqual(await excluded(now + 7 * 3_600_000), [], 'the ownerless one after six hours');
});

// ---------------------------------------------------------------------------
// 30-day sums, free share, priority
// ---------------------------------------------------------------------------

test('the ledger is read once a minute, per node and per owner, and a fresh write is added to it', async () => {
  const now = Date.parse('2026-09-21T00:00:00Z');
  const t = fakeDb({
    jobs: [communityJob({ id: 88, completedAt: new Date(now - 1000) })],
    nodes: [homeNode({ referrerUserId: null })],
    groups: [
      { userId: 5, workerId: 'w-home-1', _sum: { donatedValueSatang: 3000, amountSatang: 6500, referralSatang: 500 } },
      { userId: 5, workerId: 'w-home-2', _sum: { donatedValueSatang: 0, amountSatang: 1000, referralSatang: null } },
      { userId: null, workerId: 'w-orphan', _sum: { donatedValueSatang: 10, amountSatang: 10, referralSatang: 0 } },
    ],
  });

  const snap = await ledgerSnapshot(now, t.db);
  assert.equal(snap.ok, true);
  assert.deepEqual(sumsFor(snap.byWorker, 'w-home-1'), { donatedSatang: 3000, earnedSatang: 7000 });
  assert.deepEqual(sumsFor(snap.byOwner, 5), { donatedSatang: 3000, earnedSatang: 8000 });
  assert.deepEqual(sumsFor(snap.byOwner, 404), { donatedSatang: 0, earnedSatang: 0 });

  await ledgerSnapshot(now + 30_000, t.db);
  assert.equal(t.calls.groupBy, 1, 'the fast lane between ticks shares the read');

  await recordCommunityEarning(88, t.db);
  const after = await ledgerSnapshot(now + 31_000, t.db);
  assert.deepEqual(sumsFor(after.byWorker, 'w-home-1'), { donatedSatang: 3000, earnedSatang: 7480 });

  await ledgerSnapshot(now + 61_000, t.db);
  assert.equal(t.calls.groupBy, 2);
});

test('a ledger that cannot be read counts as empty, and is not re-read every call', async () => {
  const t = fakeDb({ failGroupBy: true });
  const snap = await ledgerSnapshot(1_000_000, t.db);
  assert.equal(snap.ok, false);
  assert.equal(snap.byWorker.size, 0);
  await ledgerSnapshot(1_010_000, t.db);
  assert.equal(t.calls.groupBy, 1);
});

test('the claim decides free share from the node’s own 30 days, never the node', () => {
  // Asked for 50%, gave ฿30 of ฿100 → behind, so this job is the free one.
  const behind = claimStampFor({ freeSharePct: 50, ownerUserId: 5 }, { donatedSatang: 3000, earnedSatang: 7000 });
  assert.deepEqual(behind, { freeShare: true, pro: false, ownerUserId: 5 });

  const ahead = claimStampFor({ freeSharePct: 50, ownerUserId: 5, pro: true }, { donatedSatang: 7000, earnedSatang: 3000 });
  assert.deepEqual(ahead, { freeShare: false, pro: true, ownerUserId: 5 });

  // Nothing asked, nothing given; out-of-range values are clamped, junk is 0.
  assert.equal(claimStampFor({}, { donatedSatang: 0, earnedSatang: 0 }).freeShare, false);
  assert.equal(claimStampFor({ freeSharePct: 250 }, { donatedSatang: 99_999, earnedSatang: 0 }).freeShare, true);
  assert.equal(claimStampFor({ freeSharePct: Number.NaN }, { donatedSatang: 0, earnedSatang: 9_000 }).freeShare, false);
  assert.equal(claimStampFor({ freeSharePct: -5 }, { donatedSatang: 0, earnedSatang: 9_000 }).freeShare, false);

  // Same answer as the rule itself.
  assert.equal(
    claimStampFor({ freeSharePct: 30 }, { donatedSatang: 100, earnedSatang: 900 }).freeShare,
    shouldFreeShare({ targetPercent: 30, donatedSatang: 100, earnedSatang: 900 })
  );

  assert.deepEqual(RENTED_CLAIM_STAMP, { freeShare: false, pro: false, ownerUserId: null });
});

test('over a run of claims, a node lands on the share its owner asked for', () => {
  let donated = 0;
  let earned = 0;
  for (let i = 0; i < 200; i++) {
    const stamp = claimStampFor({ freeSharePct: 25 }, { donatedSatang: donated, earnedSatang: earned });
    // Every job is worth the same pool of 480 satang here.
    if (stamp.freeShare) donated += 480;
    else earned += 480;
  }
  const share = donated / (donated + earned);
  assert.ok(Math.abs(share - 0.25) < 0.01, `gave away ${(share * 100).toFixed(1)}%`);
});

test('an owner who gives ranks ahead of one who does not; a proven node ahead of a new one', () => {
  const donor = communityPriority({
    ownerSums: { donatedSatang: 20_000, earnedSatang: 20_000 },
    pro: false,
    jobsCompleted: 10,
    jobsFailed: 0,
    lane: 'full',
  });
  const keeper = communityPriority({
    ownerSums: { donatedSatang: 0, earnedSatang: 40_000 },
    pro: false,
    jobsCompleted: 10,
    jobsFailed: 0,
    lane: 'full',
  });
  assert.ok(donor > keeper, `donor ${donor} vs keeper ${keeper}`);

  const proven = communityPriority({ ownerSums: { donatedSatang: 0, earnedSatang: 0 }, pro: false, jobsCompleted: 60, jobsFailed: 0, lane: 'full' });
  const fresh = communityPriority({ ownerSums: { donatedSatang: 0, earnedSatang: 0 }, pro: false, jobsCompleted: 0, jobsFailed: 0, lane: 'full' });
  const flaky = communityPriority({ ownerSums: { donatedSatang: 0, earnedSatang: 0 }, pro: false, jobsCompleted: 5, jobsFailed: 20, lane: 'full' });
  assert.ok(proven > fresh && fresh > flaky, `${proven} > ${fresh} > ${flaky}`);

  assert.equal(nodeReliability(0, 0), 0.5);
  assert.ok(nodeReliability(99, 0) > 0.98);
});

test('Pro buys a place near the front, never ahead of an honest sharer', () => {
  const pro = communityPriority({ ownerSums: { donatedSatang: 0, earnedSatang: 100_000 }, pro: true, jobsCompleted: 20, jobsFailed: 0, lane: 'full' });
  const sharer = communityPriority({ ownerSums: { donatedSatang: 40_000, earnedSatang: 60_000 }, pro: false, jobsCompleted: 20, jobsFailed: 0, lane: 'full' });
  const plain = communityPriority({ ownerSums: { donatedSatang: 0, earnedSatang: 100_000 }, pro: false, jobsCompleted: 20, jobsFailed: 0, lane: 'full' });
  assert.ok(pro >= plain);
  assert.ok(pro <= sharer, `pro ${pro} must not pass the sharer ${sharer}`);
});

test('ranking with the ledger: priority orders a lane, near-equals share by least recent, lanes never cross', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 8, 20, 10, m));
  const band = (donated: number, earned: number, done = 20) =>
    communityPriority({ ownerSums: { donatedSatang: donated, earnedSatang: earned }, pro: false, jobsCompleted: done, jobsFailed: 0, lane: 'full' });

  const rows = [
    { id: 1, lane: 'full', lastJobAt: at(1), priority: band(0, 50_000) }, // keeps everything
    { id: 2, lane: 'full', lastJobAt: at(9), priority: band(30_000, 30_000) }, // gives half
    { id: 3, lane: 'slow', lastJobAt: null, priority: band(90_000, 0) }, // gives all, but slow
    { id: 4, lane: 'full', lastJobAt: at(2), priority: band(30_000, 30_000, 21) }, // same band as 2, used earlier
  ];
  assert.equal(rows[1].priority, rows[3].priority, 'one job more is not a different band');
  assert.deepEqual(
    rankCommunityCandidates(rows).map((r) => r.id),
    [4, 2, 1, 3]
  );
});

test('a lottery pass shuffles each lane and keeps the lanes in order', () => {
  const rows = [
    { id: 1, lane: 'full', lastJobAt: null, priority: 19 },
    { id: 2, lane: 'full', lastJobAt: null, priority: 0 },
    { id: 3, lane: 'full', lastJobAt: null, priority: 0 },
    { id: 4, lane: 'slow', lastJobAt: null, priority: 19 },
    { id: 5, lane: 'slow', lastJobAt: null, priority: 0 },
  ];
  // random() = 0 always swaps each position with the first: a fixed permutation.
  const lottery = rankCommunityCandidates(rows, { lottery: true, random: () => 0 }).map((r) => r.id);
  assert.deepEqual(lottery, [2, 3, 1, 5, 4]);
  assert.deepEqual(lottery.slice(3).sort(), [4, 5], 'slow machines stay behind full ones');

  // Over many passes every full machine gets to go first, the newcomer included.
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const firsts = new Set<number>();
  for (let i = 0; i < 200; i++) firsts.add(rankCommunityCandidates(rows, { lottery: true, random })[0].id);
  assert.deepEqual([...firsts].sort(), [1, 2, 3]);

  // Not a lottery pass: priority wins.
  assert.equal(rankCommunityCandidates(rows)[0].id, 1);
});

test('buildSnapshot never trusts a negative or fractional sum', () => {
  const snap = buildSnapshot([{ userId: 1, workerId: 'w', donated: -50, payout: 10.6, referral: Number.NaN }], 0);
  assert.deepEqual(sumsFor(snap.byWorker, 'w'), { donatedSatang: 0, earnedSatang: 11 });
});

test('the go-live check says whether the ledger can be written, and what is missing or held', async () => {
  const before = await ledgerHealth(Date.now(), fakeDb({ unmigrated: true }).db);
  assert.equal(before.writable, false);
  assert.match(before.detail ?? '', /Unknown column/);

  const after = await ledgerHealth(Date.now(), fakeDb({ missingCount: 3 }).db);
  assert.equal(after.writable, true);
  assert.equal(after.missing7d, 3);
  assert.deepEqual(after.byStatus30d.review, { rows: 1, amountSatang: 480 });
  assert.deepEqual(after.byStatus30d.pending, { rows: 4, amountSatang: 1920 });
});
