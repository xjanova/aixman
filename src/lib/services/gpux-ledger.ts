/**
 * GPUxMINE ledger — writing down what a community node earned for a job, and
 * reading back what it has earned and given away.
 *
 * `gpu_job_earnings` belongs to XMAN Studio (contract C2). AIXMAN writes one
 * row per community job it delivered, straight into the shared MySQL the way
 * wallet.ts already writes `wallet_transactions` (owner decision D1); XMAN
 * Studio holds it, clears it after the hold and pays it into the owner's XMAN
 * wallet (D2). The money decision itself is gpux-settlement.ts; this file only
 * gathers its inputs and records its answer.
 *
 * The write happens after the delivery transaction and never inside it: a
 * customer's render must not be lost because a ledger row could not be
 * written. It is idempotent — job_id = 'aix-gpu-job-' + ai_gpu_jobs.id is
 * unique, and the insert is `ON DUPLICATE KEY UPDATE id = id`, so a second
 * tick, an overlapping tick or the sweep can never write a job twice or
 * rewind a row XMAN Studio has already cleared, paid or voided. A write that
 * fails is picked up by `sweepMissingEarnings` for a week.
 *
 * Every amount is integer satang; the THB-per-credit rate is stored to six
 * decimals and the settlement is computed from that stored figure, so the row
 * replays to itself.
 */
import prisma from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { getCatalogEntry } from '@/lib/gpu/catalog';
import { COMMUNITY_PROVIDER_SLUGS, isCommunitySlug, readCommunityMeta, type CommunityMeta } from '@/lib/gpu/community-dispatch';
import { joinReviewReasons, judgeRenderTime } from '@/lib/gpu/community-plausibility';
import { raiseAlert, type AlertInput } from '@/lib/notify/alerts';
import { pricingBasis } from './gpu-stats';
import {
  cooperationScore,
  dispatchPriority,
  proBonusCeiling,
  settleJob,
  shouldFreeShare,
  type Settlement,
} from './gpux-settlement';

/** job_id of a job's earning row — the idempotency key (contract C2). */
export const EARNING_JOB_PREFIX = 'aix-gpu-job-';

export function earningJobId(aiGpuJobId: number): string {
  return `${EARNING_JOB_PREFIX}${aiGpuJobId}`;
}

/** Free share and cooperation look back this far. */
export const LEDGER_WINDOW_DAYS = 30;

/** The sweep looks for unwritten earnings this far back. */
export const SWEEP_WINDOW_DAYS = 7;
/** Left to the delivery path this long, so the sweep never races it. */
export const SWEEP_AFTER_MS = 2 * 60_000;
/** At most this many per tick. */
export const SWEEP_BATCH = 20;
/** One job is tried again at most this often, so one that cannot be written does not hold the batch. */
export const SWEEP_RETRY_EVERY_MS = 10 * 60_000;
/**
 * A job skipped for a reason that will not fix itself soon (no owner known, no
 * credit price) waits this long instead, so a pile of them — an admin's own
 * enlisted machine has no owner — cannot fill every batch and starve the jobs
 * behind them.
 */
export const SWEEP_RETRY_SKIPPED_MS = 6 * 3_600_000;

/** The ledger's reading of the 30-day sums is reused for this long — one read per tick. */
export const LEDGER_CACHE_MS = 60_000;

/** gpu_job_earnings.thb_per_credit is DECIMAL(12,6). */
export const THB_PER_CREDIT_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Deciding the row (pure)
// ---------------------------------------------------------------------------

/** The rate as the ledger stores it, and as the settlement is computed from. */
export function ledgerThbPerCredit(thbPerCredit: number): number {
  return Number.isFinite(thbPerCredit) && thbPerCredit > 0 ? Number(thbPerCredit.toFixed(THB_PER_CREDIT_DECIMALS)) : 0;
}

export type EarningKind = 'image' | 'audio' | 'video' | 'upscale' | 'embed';

/** gpu_job_earnings.kind for a catalogue entry (a lip-sync clip is video). */
export function earningKind(entry: { kind?: string; outputKind?: string } | null | undefined): EarningKind {
  const kind = entry?.kind === 'lipsync' ? 'video' : (entry?.kind ?? entry?.outputKind);
  return kind === 'audio' || kind === 'video' || kind === 'upscale' || kind === 'embed' ? kind : 'image';
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

function validDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** The gpu_nodes facts the row needs (read by worker_id, soft-deleted rows included). */
export interface NodeRecord {
  id: number;
  userId: number;
  referrerUserId: number | null;
}

/**
 * Who owns the machine that did the job. XMAN Studio's gpu_nodes row is the
 * authority; the owner stamped on the job at claim time, then the one XMAN
 * Studio pushed into the worker's metadata, stand in when the row is gone
 * (re-enrolment gives the node a new worker_id).
 */
export function resolveOwner(node: NodeRecord | null, jobOwnerUserId: number | null | undefined, meta: CommunityMeta): number | null {
  return positiveInt(node?.userId) ?? positiveInt(jobOwnerUserId) ?? positiveInt(meta.ownerUserId);
}

/**
 * Who referred the owner, if anyone (owner decision D8): captured once by XMAN
 * Studio at pairing into gpu_nodes.referrer_user_id. The metadata copy is used
 * only when the gpu_nodes row cannot be found. Never the owner themselves.
 */
export function referrerCandidate(node: NodeRecord | null, meta: CommunityMeta, ownerUserId: number): number | null {
  const referrer = node ? positiveInt(node.referrerUserId) : positiveInt(meta.referrerUserId);
  return referrer !== null && referrer !== ownerUserId ? referrer : null;
}

export interface EarningFacts {
  job: {
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
  };
  worker: { externalId: string; providerSlug: string; metadata: unknown };
  generation: { creditsUsed: number; creditsRefunded: number } | null;
  node: NodeRecord | null;
  /** Referrer from referrerCandidate, and whether XMAN Studio has them as an active affiliate. */
  referrer: { userId: number; active: boolean } | null;
  /** The owner's first gpu_nodes.paired_at — when the 12 referral months began. */
  ownerFirstPairedAt: Date | null;
  /** From pricingBasis(), before rounding. */
  thbPerCredit: number;
  catalogue: { kind?: string; outputKind?: string; baselineSecondsPerUnit?: number } | null;
}

export interface EarningRow {
  gpuNodeId: number | null;
  userId: number;
  workerId: string;
  jobId: string;
  aiGpuJobId: number;
  generationId: number;
  promptId: string | null;
  kind: EarningKind;
  modelKey: string;
  lane: 'full' | 'slow';
  seconds: number;
  amountSatang: number;
  creditsCharged: number;
  /** DECIMAL(12,6), as text so no float ever reaches the column. */
  thbPerCredit: string;
  revenueSatang: number;
  /** DECIMAL(5,4), as text. */
  platformFeeRate: string;
  platformFeeSatang: number;
  referralSatang: number;
  referralUserId: number | null;
  donatedValueSatang: number;
  freeShare: boolean;
  pro: boolean;
  status: 'pending' | 'review';
  reviewReason: string | null;
  completedAt: Date;
}

export type EarningPlan =
  | { write: true; row: EarningRow; settlement: Settlement }
  /** `alert`: an admin should hear of it (money that should be recorded is not). */
  | { write: false; reason: string; alert: boolean };

/**
 * The ledger row for one delivered community job, or why there is none.
 *
 * The customer's charge is what the job is worth: credits used less credits
 * refunded, which already includes a quality mode's multiplier and any
 * duration pricing — re-deriving it from the catalogue would settle on a
 * different figure than the customer paid. Jobs paid with free or bonus
 * credits pay the node like any other (owner decision D7).
 */
export function planEarning(f: EarningFacts): EarningPlan {
  if (f.job.status !== 'completed' || !f.job.completedAt) {
    return { write: false, reason: `job ${f.job.id} is not completed`, alert: false };
  }
  if (!isCommunitySlug(f.worker.providerSlug)) {
    return { write: false, reason: `job ${f.job.id} did not run on a community machine`, alert: false };
  }
  if (!f.generation) return { write: false, reason: `job ${f.job.id} has no generation row`, alert: true };

  const meta = readCommunityMeta(f.worker.metadata);
  const owner = resolveOwner(f.node, f.job.ownerUserId, meta);
  if (owner === null) {
    return { write: false, reason: `no owner is known for worker ${f.worker.externalId}`, alert: true };
  }

  const thbPerCredit = ledgerThbPerCredit(f.thbPerCredit);
  if (thbPerCredit <= 0) {
    // Recording 0 would be permanent: the row is never rewritten. Waiting for
    // a price is not.
    return { write: false, reason: 'no active credit package to value a credit at', alert: true };
  }

  const credits = Math.max(0, Math.floor(f.generation.creditsUsed) - Math.floor(f.generation.creditsRefunded));

  const joinedAt = f.ownerFirstPairedAt ?? validDate(meta.firstPairedAt);
  const referrer =
    f.referrer && f.referrer.active && joinedAt ? { userId: f.referrer.userId, joinedAt } : null;

  const settlement = settleJob({
    creditsPerUnit: credits,
    durationCurve: null,
    units: 1,
    thbPerCredit,
    freeShare: f.job.freeShare,
    pro: f.job.pro,
    referrer,
    // The job's own completion, not the clock: replayed tomorrow it settles
    // the same, including which side of the referral's twelve months it fell.
    now: f.job.completedAt,
  });

  const lane: 'full' | 'slow' = meta.lane === 'slow' ? 'slow' : 'full';
  const reviewReason = joinReviewReasons([
    f.job.reviewReason,
    judgeRenderTime({
      observedSeconds: f.job.gpuSeconds,
      baselineSecondsPerUnit: f.catalogue?.baselineSecondsPerUnit,
      lane,
    }),
  ]);

  return {
    write: true,
    settlement,
    row: {
      gpuNodeId: f.node?.id ?? null,
      userId: owner,
      workerId: f.worker.externalId.slice(0, 64),
      jobId: earningJobId(f.job.id),
      aiGpuJobId: f.job.id,
      generationId: f.job.generationId,
      promptId: f.job.externalJobId ? f.job.externalJobId.slice(0, 255) : null,
      kind: earningKind(f.catalogue),
      modelKey: f.job.modelKey.slice(0, 64),
      lane,
      seconds: Math.max(0, Math.round(f.job.gpuSeconds)),
      amountSatang: settlement.nodePayoutSatang,
      creditsCharged: credits,
      thbPerCredit: thbPerCredit.toFixed(THB_PER_CREDIT_DECIMALS),
      revenueSatang: settlement.revenueSatang,
      platformFeeRate: settlement.platformFeeRate.toFixed(4),
      platformFeeSatang: settlement.platformFeeSatang,
      referralSatang: settlement.referralSatang,
      referralUserId: settlement.referralUserId,
      donatedValueSatang: settlement.donatedValueSatang,
      freeShare: f.job.freeShare,
      pro: f.job.pro,
      status: reviewReason ? 'review' : 'pending',
      reviewReason,
      completedAt: f.job.completedAt,
    },
  };
}

/**
 * A MySQL DATETIME/TIMESTAMP literal in UTC — what Laravel (app timezone UTC)
 * and Prisma both write. Built here rather than left to NOW(), whose value
 * depends on the session's time zone.
 */
export function sqlUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The insert. `ON DUPLICATE KEY UPDATE id = id`: a row that already exists for
 * this job (job_id or ai_gpu_job_id) is left exactly as it is — XMAN Studio may
 * have cleared, paid or voided it since.
 */
export function insertEarningSql(row: EarningRow, now: Date = new Date()): Prisma.Sql {
  const at = sqlUtc(now);
  return Prisma.sql`INSERT INTO gpu_job_earnings
    (gpu_node_id, user_id, worker_id, job_id, ai_gpu_job_id, generation_id, prompt_id,
     kind, model_key, lane, seconds, amount_satang,
     credits_charged, thb_per_credit, revenue_satang, platform_fee_rate, platform_fee_satang,
     referral_satang, referral_user_id, donated_value_satang, free_share, pro,
     status, review_reason, completed_at, created_at, updated_at)
    VALUES
    (${row.gpuNodeId}, ${row.userId}, ${row.workerId}, ${row.jobId}, ${row.aiGpuJobId}, ${row.generationId}, ${row.promptId},
     ${row.kind}, ${row.modelKey}, ${row.lane}, ${row.seconds}, ${row.amountSatang},
     ${row.creditsCharged}, ${row.thbPerCredit}, ${row.revenueSatang}, ${row.platformFeeRate}, ${row.platformFeeSatang},
     ${row.referralSatang}, ${row.referralUserId}, ${row.donatedValueSatang}, ${row.freeShare ? 1 : 0}, ${row.pro ? 1 : 0},
     ${row.status}, ${row.reviewReason}, ${sqlUtc(row.completedAt)}, ${at}, ${at})
    ON DUPLICATE KEY UPDATE id = id`;
}

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------

/** The database this file talks to — prisma, or a stand-in in tests. */
export type LedgerDb = typeof prisma;

/** What the never-throwing entry points use; tests swap both. */
export interface LedgerDeps {
  db?: LedgerDb;
  alert?: (alert: AlertInput) => void;
}

export type EarningOutcome =
  | { status: 'written'; row: EarningRow }
  | { status: 'exists' }
  | { status: 'skipped'; reason: string; alert: boolean };

/** Whether XMAN Studio has this user as an affiliate in good standing (D8). */
async function isActiveAffiliate(db: LedgerDb, userId: number): Promise<boolean> {
  const rows = await db.$queryRaw<{ one: number | bigint }[]>`
    SELECT 1 AS one FROM affiliates WHERE user_id = ${userId} AND status = 'active' LIMIT 1`;
  return rows.length > 0;
}

/** THB a credit is worth today, from the active packages (gpu-stats.ts). */
async function currentThbPerCredit(db: LedgerDb): Promise<number> {
  const packages = await db.aiCreditPackage.findMany({
    where: { isActive: true },
    select: { credits: true, bonusCredits: true, priceThb: true, priceUsd: true },
  });
  return pricingBasis(packages).thbPerCredit;
}

/**
 * Write the earning of one delivered job. Returns what happened; throws only
 * on a database error (the caller, `recordEarningSafely`, turns that into an
 * alert and the sweep tries again).
 */
export async function recordCommunityEarning(jobId: number, db: LedgerDb = prisma): Promise<EarningOutcome> {
  const job = await db.aiGpuJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      generationId: true,
      modelKey: true,
      status: true,
      externalJobId: true,
      gpuSeconds: true,
      completedAt: true,
      freeShare: true,
      pro: true,
      ownerUserId: true,
      reviewReason: true,
      worker: { select: { externalId: true, providerSlug: true, metadata: true } },
      generation: { select: { creditsUsed: true, creditsRefunded: true } },
    },
  });
  if (!job) return { status: 'skipped', reason: `job ${jobId} does not exist`, alert: false };
  if (!job.worker || !isCommunitySlug(job.worker.providerSlug)) {
    return { status: 'skipped', reason: `job ${jobId} did not run on a community machine`, alert: false };
  }

  const existing = await db.gpuJobEarning.findUnique({ where: { jobId: earningJobId(jobId) }, select: { id: true } });
  if (existing) return { status: 'exists' };

  const meta = readCommunityMeta(job.worker.metadata);
  const node = await db.gpuNode.findUnique({
    where: { workerId: job.worker.externalId },
    select: { id: true, userId: true, referrerUserId: true },
  });
  const owner = resolveOwner(node, job.ownerUserId, meta);

  let referrer: EarningFacts['referrer'] = null;
  let ownerFirstPairedAt: Date | null = null;
  if (owner !== null) {
    const candidate = referrerCandidate(node, meta, owner);
    if (candidate !== null) {
      const [active, first] = await Promise.all([
        isActiveAffiliate(db, candidate),
        db.gpuNode.aggregate({ where: { userId: owner }, _min: { pairedAt: true } }),
      ]);
      referrer = { userId: candidate, active };
      ownerFirstPairedAt = first._min.pairedAt ?? null;
    }
  }

  const plan = planEarning({
    job,
    worker: job.worker,
    generation: job.generation,
    node,
    referrer,
    ownerFirstPairedAt,
    thbPerCredit: await currentThbPerCredit(db),
    catalogue: getCatalogEntry(job.modelKey) ?? null,
  });
  if (!plan.write) return { status: 'skipped', reason: plan.reason, alert: plan.alert };

  await db.$executeRaw(insertEarningSql(plan.row));
  noteWrittenEarning(plan.row);
  return { status: 'written', row: plan.row };
}

/**
 * `recordCommunityEarning` for callers that must not fail: the delivery path
 * and the sweep. Never throws. Anything that leaves money unrecorded is an
 * alert; the sweep tries a failed job again for SWEEP_WINDOW_DAYS.
 */
export async function recordEarningSafely(
  jobId: number,
  source: 'delivery' | 'sweep',
  { db = prisma, alert = raiseAlert }: LedgerDeps = {}
): Promise<EarningOutcome | null> {
  try {
    const outcome = await recordCommunityEarning(jobId, db);
    if (outcome.status === 'written') {
      const r = outcome.row;
      console.log(
        `[gpux] job ${jobId}: earning ${r.status} — node ${r.amountSatang} satang` +
          (r.freeShare ? ` (free share, donated ${r.donatedValueSatang})` : '') +
          (r.referralSatang > 0 ? `, referral ${r.referralSatang}` : '') +
          (r.reviewReason ? ` · review: ${r.reviewReason}` : '') +
          ` [${source}]`
      );
    } else if (outcome.status === 'skipped' && outcome.alert) {
      console.warn(`[gpux] job ${jobId}: earning not written — ${outcome.reason}`);
      alert({
        type: 'gpux-earning',
        key: outcome.reason.replace(/\d+/g, '#').slice(0, 80),
        level: 'warning',
        title: 'บันทึกรายได้ของเครื่องชุมชนไม่ได้ — ระบบจะลองใหม่เองภายใน 7 วัน',
        lines: [`งาน GPU #${jobId}: ${outcome.reason}`, 'เจ้าของเครื่องยังไม่ได้รับรายได้ของงานนี้จนกว่าจะแก้สาเหตุ'],
      });
    }
    return outcome;
  } catch (error) {
    const message = (error as Error).message;
    console.error(`[gpux] job ${jobId}: writing its earning failed [${source}]:`, message);
    alert({
      type: 'gpux-earning',
      key: 'write-failed',
      level: 'warning',
      title: 'บันทึกรายได้ของเครื่องชุมชนไม่ได้ — ระบบจะลองใหม่เองภายใน 7 วัน',
      lines: [
        `งาน GPU #${jobId}: ${message.slice(0, 200)}`,
        'ถ้าเป็นเพราะคอลัมน์ไม่ครบ: ต้องรัน migration ของ XMAN Studio (gpu_job_earnings 2026_09_25_*) ก่อน',
      ],
    });
    return null;
  }
}

/**
 * FROM … WHERE for completed community jobs of the sweep window that have no
 * earning row, by either key (ai_gpu_job_id, or job_id for a row some other
 * writer made without it).
 */
function missingEarningsFrom(now: number): Prisma.Sql {
  const from = sqlUtc(new Date(now - SWEEP_WINDOW_DAYS * 86_400_000));
  const to = sqlUtc(new Date(now - SWEEP_AFTER_MS));
  return Prisma.sql`FROM ai_gpu_jobs j
    JOIN ai_gpu_workers w ON w.id = j.worker_id
    LEFT JOIN gpu_job_earnings e1 ON e1.ai_gpu_job_id = j.id
    LEFT JOIN gpu_job_earnings e2 ON e2.job_id = CONCAT(${EARNING_JOB_PREFIX}, j.id)
    WHERE j.status = 'completed'
      AND j.completed_at >= ${from} AND j.completed_at <= ${to}
      AND w.provider_slug IN (${Prisma.join([...COMMUNITY_PROVIDER_SLUGS])})
      AND e1.id IS NULL AND e2.id IS NULL`;
}

export interface LedgerHealth {
  /** Every column the writer inserts exists (XMAN Studio's 2026_09_25 migration ran). */
  writable: boolean;
  detail?: string;
  /** Completed community jobs of the last 7 days with no earning row yet. */
  missing7d: number | null;
  /** Last 30 days of rows by status: how many, and the owners' amount in satang. */
  byStatus30d: Record<string, { rows: number; amountSatang: number }>;
}

/** For the admin go-live check. Never throws. */
export async function ledgerHealth(now: number = Date.now(), db: LedgerDb = prisma): Promise<LedgerHealth> {
  try {
    // Selecting what the writer inserts proves the columns are there.
    await db.gpuJobEarning.findFirst({
      select: {
        id: true,
        aiGpuJobId: true,
        generationId: true,
        promptId: true,
        creditsCharged: true,
        thbPerCredit: true,
        revenueSatang: true,
        platformFeeRate: true,
        platformFeeSatang: true,
        referralSatang: true,
        referralUserId: true,
        donatedValueSatang: true,
        freeShare: true,
        pro: true,
        reviewReason: true,
      },
    });
  } catch (error) {
    return { writable: false, detail: (error as Error).message.slice(0, 300), missing7d: null, byStatus30d: {} };
  }
  const health: LedgerHealth = { writable: true, missing7d: null, byStatus30d: {} };
  try {
    const [counted] = await db.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(*) AS n ${missingEarningsFrom(now)}`;
    health.missing7d = Number(counted?.n ?? 0);
    const groups = await db.gpuJobEarning.groupBy({
      by: ['status'],
      where: { completedAt: { gte: new Date(now - LEDGER_WINDOW_DAYS * 86_400_000) } },
      _count: { _all: true },
      _sum: { amountSatang: true },
    });
    for (const g of groups) {
      health.byStatus30d[g.status] = { rows: g._count._all, amountSatang: Number(g._sum.amountSatang ?? 0) };
    }
  } catch (error) {
    health.detail = (error as Error).message.slice(0, 300);
  }
  return health;
}

/** When this process may try each job the sweep found again (job id → ms). */
const sweepNextAt = new Map<number, number>();

/**
 * Community jobs delivered in the last week that have no earning row — the
 * write after delivery failed, the process died in between, or XMAN Studio's
 * migration had not run yet. A handful per tick, oldest first; a failed job is
 * tried again after SWEEP_RETRY_EVERY_MS, a skipped one after
 * SWEEP_RETRY_SKIPPED_MS. Returns how many were written.
 */
export async function sweepMissingEarnings(now: number = Date.now(), deps: LedgerDeps = {}): Promise<number> {
  const db = deps.db ?? prisma;
  const recent: number[] = [];
  for (const [id, at] of sweepNextAt) {
    if (now >= at) sweepNextAt.delete(id);
    else recent.push(id);
  }
  const missing = await db.$queryRaw<{ id: number | bigint }[]>`
    SELECT j.id ${missingEarningsFrom(now)}
      ${recent.length > 0 ? Prisma.sql`AND j.id NOT IN (${Prisma.join(recent)})` : Prisma.empty}
    ORDER BY j.completed_at ASC
    LIMIT ${Prisma.raw(String(SWEEP_BATCH))}`;

  let written = 0;
  for (const { id } of missing) {
    const jobId = Number(id);
    sweepNextAt.set(jobId, now + SWEEP_RETRY_EVERY_MS);
    const outcome = await recordEarningSafely(jobId, 'sweep', deps);
    if (outcome?.status === 'written') written += 1;
    if (outcome?.status === 'skipped') sweepNextAt.set(jobId, now + SWEEP_RETRY_SKIPPED_MS);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Reading it back: 30-day sums, free share, dispatch priority
// ---------------------------------------------------------------------------

export interface LedgerSums {
  /** Value of free-shared work (the pool it would have paid). */
  donatedSatang: number;
  /** Value of paid work to the node: its payout plus the referral taken out of it. */
  earnedSatang: number;
}

export interface LedgerSnapshot {
  byWorker: Map<string, LedgerSums>;
  byOwner: Map<number, LedgerSums>;
  /** False when the ledger could not be read; every sum then reads as zero. */
  ok: boolean;
  at: number;
}

const EMPTY_SUMS: LedgerSums = { donatedSatang: 0, earnedSatang: 0 };

export function sumsFor<K>(map: Map<K, LedgerSums>, key: K | null | undefined): LedgerSums {
  return (key !== null && key !== undefined && map.get(key)) || EMPTY_SUMS;
}

export interface LedgerGroupRow {
  userId: number | null;
  workerId: string;
  donated: number;
  payout: number;
  referral: number;
}

/** Folds the grouped rows into per-node and per-owner sums. */
export function buildSnapshot(rows: readonly LedgerGroupRow[], at: number, ok = true): LedgerSnapshot {
  const byWorker = new Map<string, LedgerSums>();
  const byOwner = new Map<number, LedgerSums>();
  const add = <K>(map: Map<K, LedgerSums>, key: K, donated: number, earned: number) => {
    const prev = map.get(key) ?? { donatedSatang: 0, earnedSatang: 0 };
    map.set(key, { donatedSatang: prev.donatedSatang + donated, earnedSatang: prev.earnedSatang + earned });
  };
  for (const r of rows) {
    const donated = Math.max(0, Math.round(Number(r.donated) || 0));
    const earned = Math.max(0, Math.round((Number(r.payout) || 0) + (Number(r.referral) || 0)));
    add(byWorker, r.workerId, donated, earned);
    if (r.userId !== null) add(byOwner, r.userId, donated, earned);
  }
  return { byWorker, byOwner, ok, at };
}

let cached: LedgerSnapshot | null = null;
let loading: Promise<LedgerSnapshot> | null = null;

/**
 * The last LEDGER_WINDOW_DAYS of gpu_job_earnings, summed per node and per
 * owner, read at most once per LEDGER_CACHE_MS — a tick and the fast lane
 * between ticks share one read. Void rows are left out. A ledger that cannot
 * be read (XMAN Studio's migration not applied yet) reads as empty: no node
 * gains or loses priority, and free share falls back to its no-history rule.
 */
export async function ledgerSnapshot(now: number = Date.now(), db: LedgerDb = prisma): Promise<LedgerSnapshot> {
  if (cached && now - cached.at < LEDGER_CACHE_MS) return cached;
  if (loading) return loading;
  loading = (async () => {
    try {
      const groups = await db.gpuJobEarning.groupBy({
        by: ['userId', 'workerId'],
        where: { completedAt: { gte: new Date(now - LEDGER_WINDOW_DAYS * 86_400_000) }, status: { not: 'void' } },
        _sum: { donatedValueSatang: true, amountSatang: true, referralSatang: true },
      });
      cached = buildSnapshot(
        groups.map((g) => ({
          userId: g.userId,
          workerId: g.workerId,
          donated: Number(g._sum.donatedValueSatang ?? 0),
          payout: Number(g._sum.amountSatang ?? 0),
          referral: Number(g._sum.referralSatang ?? 0),
        })),
        now
      );
    } catch (error) {
      console.warn('[gpux] could not read the earnings ledger; treating it as empty:', (error as Error).message);
      cached = buildSnapshot([], now, false);
    }
    return cached;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Forget the cached sums — for tests, and after an admin changes a row by hand. */
export function forgetLedgerSnapshot(): void {
  cached = null;
}

/**
 * Add a row this process just wrote to the cached sums, so a fast node's next
 * claim inside the same minute decides its free share on the job it just
 * finished too, rather than on a snapshot one job behind.
 */
function noteWrittenEarning(row: EarningRow): void {
  if (!cached) return;
  const donated = row.donatedValueSatang;
  const earned = row.amountSatang + row.referralSatang;
  const bump = <K>(map: Map<K, LedgerSums>, key: K) => {
    const prev = map.get(key) ?? EMPTY_SUMS;
    map.set(key, { donatedSatang: prev.donatedSatang + donated, earnedSatang: prev.earnedSatang + earned });
  };
  bump(cached.byWorker, row.workerId);
  bump(cached.byOwner, row.userId);
}

/** What a community claim stamps on the job (ai_gpu_jobs.free_share / pro / owner_user_id). */
export interface ClaimStamp {
  freeShare: boolean;
  pro: boolean;
  ownerUserId: number | null;
}

export const RENTED_CLAIM_STAMP: ClaimStamp = { freeShare: false, pro: false, ownerUserId: null };

/**
 * Whether this node's next job is its free share, and the rest of the claim
 * stamp. Decided here from what the node has actually given and been paid in
 * the last 30 days against the share its owner chose (freeSharePct, pushed by
 * XMAN Studio) — never by the node. The node's own sums, not its owner's: the
 * share is set per machine.
 */
export function claimStampFor(meta: CommunityMeta, nodeSums: LedgerSums): ClaimStamp {
  const pct = Number(meta.freeSharePct);
  const targetPercent = Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0;
  return {
    freeShare: shouldFreeShare({ targetPercent, donatedSatang: nodeSums.donatedSatang, earnedSatang: nodeSums.earnedSatang }),
    pro: meta.pro === true,
    ownerUserId: positiveInt(meta.ownerUserId),
  };
}

/**
 * Priorities are compared in bands this wide (1/20 of the 0-1 scale). Inside a
 * band, the least recently used machine goes first — without the bands a
 * difference in the sixth decimal would hand one machine every job.
 */
export const PRIORITY_BANDS = 20;

/** Laplace-smoothed success rate: a new node starts at 0.5, not at 0 or 1. */
export function nodeReliability(jobsCompleted: number, jobsFailed: number): number {
  const done = Math.max(0, jobsCompleted || 0);
  const failed = Math.max(0, jobsFailed || 0);
  return (done + 1) / (done + failed + 2);
}

/** How well a node matched to this model can do it: eligibility already said it can; the lane says how fast. */
export const FIT_BY_LANE: Record<'full' | 'slow', number> = { full: 1, slow: 0.6 };

/**
 * The priority band of one idle community machine (higher goes first within
 * its lane): gpux-settlement's dispatchPriority over the owner's cooperation
 * (30-day donated vs earned, Pro capped at what an honest 40% sharer reaches),
 * the machine's success rate and its lane. Latency is not measured yet and is
 * the same for everyone. -1 for a machine dispatchPriority rules out — last,
 * not never.
 */
export function communityPriority(input: {
  ownerSums: LedgerSums;
  pro: boolean;
  jobsCompleted: number;
  jobsFailed: number;
  lane: 'full' | 'slow';
}): number {
  const cooperation = cooperationScore({
    donatedSatang: input.ownerSums.donatedSatang,
    earnedSatang: input.ownerSums.earnedSatang,
    proBonus: input.pro ? proBonusCeiling(0.4) : 0,
  });
  const priority = dispatchPriority({
    cooperation,
    reliability: nodeReliability(input.jobsCompleted, input.jobsFailed),
    fit: FIT_BY_LANE[input.lane],
    latency: 0.5,
  });
  if (priority === null) return -1;
  return Math.min(PRIORITY_BANDS - 1, Math.floor(priority * PRIORITY_BANDS));
}
