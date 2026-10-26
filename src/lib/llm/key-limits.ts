import prisma from '@/lib/db';

/**
 * A customer's own spending cap per API key, per Bangkok day and month.
 *
 * Agent tools (Cline, Cursor) can call a model thousands of times overnight;
 * the cap is what a customer sets so a loop cannot empty their balance. A
 * request is refused when what the key spent in the period, plus the holds of
 * its requests still running, plus this request's own worst case, would pass
 * the cap. Check and hold are not one transaction, so two requests racing can
 * overshoot by at most one request's worst case.
 */

/** Bangkok is UTC+7 all year. */
const BKK_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** Start of the current Bangkok day and month, as instants. */
export function periodStarts(now: number): { day: Date; month: Date } {
  const local = new Date(now + BKK_MS);
  return {
    day: new Date(Math.floor((now + BKK_MS) / DAY_MS) * DAY_MS - BKK_MS),
    month: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - BKK_MS),
  };
}

export interface KeyLimits {
  dailyLimitCredits: number | null;
  monthlyLimitCredits: number | null;
}

export interface LimitBreach {
  period: 'day' | 'month';
  limit: number;
  /** Credits already spent in the period (settled requests only). */
  spent: number;
}

/** The first cap this request would break, or null. Amounts in credits. */
export function breachedLimit(
  limits: KeyLimits,
  spent: { day: number; month: number },
  inflight: number,
  worstCase: number
): LimitBreach | null {
  if (limits.dailyLimitCredits !== null && spent.day + inflight + worstCase > limits.dailyLimitCredits) {
    return { period: 'day', limit: limits.dailyLimitCredits, spent: spent.day };
  }
  if (limits.monthlyLimitCredits !== null && spent.month + inflight + worstCase > limits.monthlyLimitCredits) {
    return { period: 'month', limit: limits.monthlyLimitCredits, spent: spent.month };
  }
  return null;
}

/** A stored cap: a whole number of credits, or none. */
export function parseLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100_000_000) : null;
}

/** Credits a key spent since each period start (settled requests). */
export async function spentByKey(apiKeyId: number, now: number): Promise<{ day: number; month: number }> {
  const starts = periodStarts(now);
  const [day, month] = await Promise.all([
    prisma.aiApiUsage.aggregate({ where: { apiKeyId, createdAt: { gte: starts.day } }, _sum: { millicredits: true } }),
    prisma.aiApiUsage.aggregate({ where: { apiKeyId, createdAt: { gte: starts.month } }, _sum: { millicredits: true } }),
  ]);
  return { day: (day._sum.millicredits ?? 0) / 1000, month: (month._sum.millicredits ?? 0) / 1000 };
}
