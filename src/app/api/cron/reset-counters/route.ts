import { NextRequest, NextResponse } from 'next/server';
import { AccountPoolManager } from '@/lib/services/account-pool';
import { hasValidCronSecret } from '@/lib/utils/cron-auth';
import { isAdmin } from '@/lib/auth';

/**
 * Cron endpoint — resets account-pool usage counters.
 *
 * AccountPoolManager.resetDailyCounters / resetMonthlyCounters were never wired
 * to anything; without this, usageToday/usageThisMonth grow forever and pools
 * eventually hit their quota permanently.
 *
 * Schedule it daily (self-hosted: system crontab / PM2 cron) e.g.
 *   0 0 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *               https://ai.xman4289.com/api/cron/reset-counters
 * Monthly reset runs automatically on the 1st, or force with ?monthly=1.
 * An authenticated admin may also trigger it manually from the dashboard.
 */
async function handle(req: NextRequest) {
  const authorized = hasValidCronSecret(req) || (await isAdmin());
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const forceMonthly = req.nextUrl.searchParams.get('monthly') === '1';
  const isFirstOfMonth = new Date().getDate() === 1;
  const monthly = forceMonthly || isFirstOfMonth;

  await AccountPoolManager.resetDailyCounters();
  if (monthly) await AccountPoolManager.resetMonthlyCounters();

  return NextResponse.json({ success: true, dailyReset: true, monthlyReset: monthly });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
