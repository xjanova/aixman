import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { getGpuConfig } from '@/lib/gpu/config';
import { getGpuProvider } from '@/lib/gpu';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';

/**
 * Profit and usage analytics for rented GPUs.
 *
 * The number that matters here is *true* cost, not per-job cost. A rented
 * machine bills for its whole life: warmup (tens of minutes while ~42 GB of
 * weights download) and idle time between jobs are real spend that never
 * appears on any single job. Reporting only `ai_gpu_jobs.cost_usd` would
 * flatter the margin badly — sometimes by more than the render itself costs.
 *
 * So two costs are reported side by side:
 *   renderCostUsd  — GPU seconds a job actually held the card
 *   totalCostUsd   — every second the machine existed  ← use this for profit
 *   overheadPct    — how much of the spend produced nothing
 */

export const dynamic = 'force-dynamic';

const DAYS = 30;
const FALLBACK_USD_THB = 36;

interface DayBucket {
  date: string;
  spendUsd: number;
  renderCostUsd: number;
  jobs: number;
  failed: number;
  revenueThb: number;
  credits: number;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1));

  const [cfg, packages, workers, jobs, liveWorkers] = await Promise.all([
    getGpuConfig(),
    prisma.aiCreditPackage.findMany({
      where: { isActive: true },
      select: { credits: true, bonusCredits: true, priceThb: true, priceUsd: true },
    }),
    // Any worker whose life overlaps the window.
    prisma.aiGpuWorker.findMany({
      where: { OR: [{ terminatedAt: null }, { terminatedAt: { gte: since } }] },
      orderBy: { rentedAt: 'desc' },
    }),
    prisma.aiGpuJob.findMany({
      where: { queuedAt: { gte: since } },
      include: {
        generation: { select: { creditsUsed: true, userId: true, status: true } },
      },
      orderBy: { queuedAt: 'desc' },
    }),
    prisma.aiGpuWorker.findMany({
      where: { status: { in: ['provisioning', 'warming', 'ready', 'busy', 'draining'] } },
      orderBy: { rentedAt: 'desc' },
    }),
  ]);

  // ---- Pricing basis -------------------------------------------------
  // Blended rate across active packages: what a credit is actually worth to
  // the business, including bonus credits given away.
  const totalCredits = packages.reduce((s, p) => s + p.credits + p.bonusCredits, 0);
  const totalThb = packages.reduce((s, p) => s + Number(p.priceThb), 0);
  const totalUsd = packages.reduce((s, p) => s + Number(p.priceUsd), 0);
  const thbPerCredit = totalCredits > 0 ? totalThb / totalCredits : 0;
  const usdToThb = totalUsd > 0 ? totalThb / totalUsd : FALLBACK_USD_THB;

  // ---- Daily buckets -------------------------------------------------
  const buckets = new Map<string, DayBucket>();
  for (let i = 0; i < DAYS; i++) {
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

  // Spread each worker's uptime cost across the days it was actually alive,
  // rather than dumping it all on the day it was rented.
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

  const daily = [...buckets.values()];

  // ---- Totals --------------------------------------------------------
  const completed = jobs.filter((j) => j.status === 'completed');
  const failed = jobs.filter((j) => j.status === 'failed');

  const totalSpendUsd = daily.reduce((s, d) => s + d.spendUsd, 0);
  const renderCostUsd = daily.reduce((s, d) => s + d.renderCostUsd, 0);
  const revenueThb = daily.reduce((s, d) => s + d.revenueThb, 0);
  const creditsEarned = daily.reduce((s, d) => s + d.credits, 0);

  const costThb = totalSpendUsd * usdToThb;
  const profitThb = revenueThb - costThb;

  // Utilisation: of every second we rented, how many were spent rendering?
  // The rest is warmup and idle — the lever the idle timeout controls.
  const rentedSeconds = workers.reduce((s, w) => {
    const end = w.terminatedAt && w.terminatedAt < now ? w.terminatedAt : now;
    return s + Math.max(0, (end.getTime() - w.rentedAt.getTime()) / 1000);
  }, 0);
  const renderSeconds = completed.reduce((s, j) => s + j.gpuSeconds, 0);

  // ---- Live provider balance ----------------------------------------
  // Best effort: the dashboard must still render if the marketplace is down.
  let balance: { balanceUsd: number; availableRentalHours?: number } | null = null;
  let balanceError: string | null = null;
  try {
    const provider = getGpuProvider(cfg.providerSlug);
    if (provider) {
      const apiKey = await GpuWorkerManager.getApiKey(cfg.providerSlug);
      balance = await provider.getBalance(apiKey);
    }
  } catch (error) {
    balanceError = (error as Error).message.includes('No active API key')
      ? 'ยังไม่ได้ตั้งค่า API key'
      : 'อ่านยอดเงินจาก provider ไม่ได้';
  }

  const spentToday = await GpuWorkerManager.todaySpendUsd();
  const burnRateUsdPerHour = liveWorkers.reduce((s, w) => s + Number(w.pricePerHourUsd), 0);

  return NextResponse.json({
    config: cfg,
    pricing: {
      thbPerCredit: Number(thbPerCredit.toFixed(4)),
      usdToThb: Number(usdToThb.toFixed(2)),
    },
    balance: balance
      ? {
          balanceUsd: Number(balance.balanceUsd.toFixed(2)),
          availableRentalHours: balance.availableRentalHours ?? null,
          // At the current burn, how long before the account is empty.
          hoursAtCurrentBurn:
            burnRateUsdPerHour > 0 ? Number((balance.balanceUsd / burnRateUsdPerHour).toFixed(1)) : null,
        }
      : null,
    balanceError,
    budget: {
      spentTodayUsd: Number(spentToday.toFixed(4)),
      dailyBudgetUsd: cfg.dailyBudgetUsd,
      remainingUsd: Number(Math.max(0, cfg.dailyBudgetUsd - spentToday).toFixed(4)),
      usedPct: cfg.dailyBudgetUsd > 0 ? Math.min(100, (spentToday / cfg.dailyBudgetUsd) * 100) : 0,
      burnRateUsdPerHour: Number(burnRateUsdPerHour.toFixed(4)),
      liveWorkers: liveWorkers.length,
      maxConcurrentWorkers: cfg.maxConcurrentWorkers,
    },
    profit: {
      windowDays: DAYS,
      revenueThb: Number(revenueThb.toFixed(2)),
      costThb: Number(costThb.toFixed(2)),
      profitThb: Number(profitThb.toFixed(2)),
      marginPct: revenueThb > 0 ? Number(((profitThb / revenueThb) * 100).toFixed(1)) : null,
      totalSpendUsd: Number(totalSpendUsd.toFixed(4)),
      renderCostUsd: Number(renderCostUsd.toFixed(4)),
      // Share of spend that produced no video. High values mean workers are
      // waiting around — shorten the idle timeout or batch work.
      overheadPct:
        totalSpendUsd > 0
          ? Number((((totalSpendUsd - renderCostUsd) / totalSpendUsd) * 100).toFixed(1))
          : null,
      creditsEarned,
      completedJobs: completed.length,
      failedJobs: failed.length,
      costPerClipUsd: completed.length > 0 ? Number((totalSpendUsd / completed.length).toFixed(4)) : null,
      revenuePerClipThb: completed.length > 0 ? Number((revenueThb / completed.length).toFixed(2)) : null,
    },
    utilisation: {
      rentedHours: Number((rentedSeconds / 3600).toFixed(2)),
      renderHours: Number((renderSeconds / 3600).toFixed(2)),
      pct: rentedSeconds > 0 ? Number(((renderSeconds / rentedSeconds) * 100).toFixed(1)) : null,
    },
    daily: daily.map((d) => ({
      ...d,
      spendUsd: Number(d.spendUsd.toFixed(4)),
      renderCostUsd: Number(d.renderCostUsd.toFixed(4)),
      revenueThb: Number(d.revenueThb.toFixed(2)),
      profitThb: Number((d.revenueThb - d.spendUsd * usdToThb).toFixed(2)),
    })),
    workers: liveWorkers.map((w) => ({
      id: w.id,
      status: w.status,
      modelKey: w.modelKey,
      gpuModel: w.gpuModel,
      gpuCount: w.gpuCount,
      supportId: w.supportId,
      pricePerHourUsd: Number(w.pricePerHourUsd),
      accruedCostUsd: Number(GpuWorkerManager.accruedCostUsd(w, now).toFixed(4)),
      uptimeMinutes: Math.round((now.getTime() - w.rentedAt.getTime()) / 60_000),
      jobsCompleted: w.jobsCompleted,
      jobsFailed: w.jobsFailed,
      lastError: w.lastError,
      rentedAt: w.rentedAt.toISOString(),
      readyAt: w.readyAt?.toISOString() ?? null,
    })),
    recentJobs: jobs.slice(0, 25).map((j) => ({
      id: j.id,
      generationId: j.generationId,
      status: j.status,
      attempts: j.attempts,
      gpuSeconds: j.gpuSeconds,
      costUsd: Number(j.costUsd),
      credits: j.generation?.creditsUsed ?? 0,
      errorMessage: j.errorMessage,
      queuedAt: j.queuedAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
    })),
    queue: {
      queued: jobs.filter((j) => j.status === 'queued').length,
      running: jobs.filter((j) => ['assigned', 'running'].includes(j.status)).length,
    },
  });
}
