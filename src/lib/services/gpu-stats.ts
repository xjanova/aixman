import prisma from '@/lib/db';

/**
 * Day-by-day money and output of the rented GPUs — shared by the admin
 * dashboard (analytics route) and the Telegram daily report, so the two can
 * never disagree about what a day cost or earned.
 */

/** When no package states a USD price to derive the rate from. */
export const FALLBACK_USD_THB = 36;

export interface DayBucket {
  date: string;
  spendUsd: number;
  renderCostUsd: number;
  jobs: number;
  failed: number;
  revenueThb: number;
  credits: number;
}

/** Server-local calendar day, the key the dashboard's charts are drawn on. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Blended rate across active packages: what a credit is actually worth to the
 * business, including bonus credits given away.
 */
export function pricingBasis(
  packages: { credits: number; bonusCredits: number; priceThb: unknown; priceUsd: unknown }[]
): { thbPerCredit: number; usdToThb: number } {
  const totalCredits = packages.reduce((s, p) => s + p.credits + p.bonusCredits, 0);
  const totalThb = packages.reduce((s, p) => s + Number(p.priceThb), 0);
  const totalUsd = packages.reduce((s, p) => s + Number(p.priceUsd), 0);
  return {
    thbPerCredit: totalCredits > 0 ? totalThb / totalCredits : 0,
    usdToThb: totalUsd > 0 ? totalThb / totalUsd : FALLBACK_USD_THB,
  };
}

interface WorkerSpan {
  pricePerHourUsd: unknown;
  rentedAt: Date;
  terminatedAt: Date | null;
}

interface JobOutcome {
  status: string;
  queuedAt: Date;
  costUsd: unknown;
  generation?: { creditsUsed: number } | null;
}

/**
 * One bucket per day from `since`, `days` long. Each worker's uptime cost is
 * spread across the days it was actually alive rather than dumped on the day
 * it was rented; jobs count on the day they were queued.
 */
export function buildDailyBuckets(
  workers: WorkerSpan[],
  jobs: JobOutcome[],
  since: Date,
  days: number,
  now: Date,
  thbPerCredit: number
): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getFullYear(), since.getMonth(), since.getDate() + i);
    buckets.set(dayKey(d), {
      date: dayKey(d),
      spendUsd: 0,
      renderCostUsd: 0,
      jobs: 0,
      failed: 0,
      revenueThb: 0,
      credits: 0,
    });
  }

  for (const w of workers) {
    const rate = Number(w.pricePerHourUsd);
    if (rate <= 0) continue;
    const end = w.terminatedAt && w.terminatedAt < now ? w.terminatedAt : now;

    for (const [key, bucket] of buckets) {
      const dayStart = new Date(`${key}T00:00:00`);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const from = w.rentedAt > dayStart ? w.rentedAt : dayStart;
      const to = end < dayEnd ? end : dayEnd;
      const ms = to.getTime() - from.getTime();
      if (ms > 0) bucket.spendUsd += (ms / 3_600_000) * rate;
    }
  }

  for (const job of jobs) {
    const bucket = buckets.get(dayKey(job.queuedAt));
    if (!bucket) continue;
    if (job.status === 'completed') {
      bucket.jobs += 1;
      bucket.renderCostUsd += Number(job.costUsd);
      const credits = job.generation?.creditsUsed ?? 0;
      bucket.credits += credits;
      bucket.revenueThb += credits * thbPerCredit;
    } else if (job.status === 'failed') {
      bucket.failed += 1;
    }
  }

  return [...buckets.values()];
}

/** The last `days` days (today included), with the pricing they were valued at. */
export async function loadRecentDaily(
  days: number,
  now: Date = new Date()
): Promise<{ daily: DayBucket[]; thbPerCredit: number; usdToThb: number }> {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const [packages, workers, jobs] = await Promise.all([
    prisma.aiCreditPackage.findMany({
      where: { isActive: true },
      select: { credits: true, bonusCredits: true, priceThb: true, priceUsd: true },
    }),
    prisma.aiGpuWorker.findMany({
      where: { OR: [{ terminatedAt: null }, { terminatedAt: { gte: since } }] },
      select: { pricePerHourUsd: true, rentedAt: true, terminatedAt: true },
    }),
    prisma.aiGpuJob.findMany({
      where: { queuedAt: { gte: since } },
      select: { status: true, queuedAt: true, costUsd: true, generation: { select: { creditsUsed: true } } },
    }),
  ]);
  const { thbPerCredit, usdToThb } = pricingBasis(packages);
  return { daily: buildDailyBuckets(workers, jobs, since, days, now, thbPerCredit), thbPerCredit, usdToThb };
}
