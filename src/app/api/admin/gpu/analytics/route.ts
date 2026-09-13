import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { getGpuConfig } from '@/lib/gpu/config';
import { GPU_PROVIDER_SLUGS, getGpuProvider } from '@/lib/gpu';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';
import { GpuBalance, type BalanceReading } from '@/lib/services/gpu-balance';
import { getTelegramStatus } from '@/lib/notify/telegram';
import { isStorageConfigured } from '@/lib/storage/r2';
import { getCatalogEntry } from '@/lib/gpu/catalog';
import { isStudioPresent } from '@/lib/services/studio-presence';
import { buildDailyBuckets, pricingBasis } from '@/lib/services/gpu-stats';

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
/** The page polls every 15 s; the vendor needs asking about once a minute. */
const ADMIN_BALANCE_MAX_AGE_MS = 60_000;

/** Where a rental's render estimate came from (offer-picker.ts RenderBasis; 'model median' before 2026-09-13). */
const RENDER_BASIS_TH: Record<string, string> = {
  history: ' จากประวัติการ์ดรุ่นนี้',
  blended: ' จากประวัติการ์ดรุ่นนี้ที่ยังมีน้อย ผสมค่าประมาณจากสเปค',
  prior: ' ประมาณจากสเปคการ์ด (ยังไม่เคยใช้การ์ดรุ่นนี้)',
  'model median': ' ค่ากลางของโมเดล',
};

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

  // ---- Pricing basis + daily buckets (gpu-stats.ts, shared with the
  // Telegram daily report so the two never disagree) ------------------
  const { thbPerCredit, usdToThb } = pricingBasis(packages);
  const daily = buildDailyBuckets(workers, jobs, since, DAYS, now, thbPerCredit);

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

  // ---- Provider balance -------------------------------------------------
  // Through GpuBalance so the page's 15 s poll costs at most one vendor call a
  // minute, and a reading taken here also triggers the low-balance alert.
  // Best effort: the dashboard must still render if the marketplace is down.
  let balanceReading: BalanceReading | null = null;
  let balanceError: string | null = null;
  try {
    balanceReading = await GpuBalance.check(cfg, ADMIN_BALANCE_MAX_AGE_MS);
  } catch (error) {
    balanceError = (error as Error).message.includes('No active API key')
      ? 'ยังไม่ได้ตั้งค่า API key'
      : 'อ่านยอดเงินจาก provider ไม่ได้';
    // The last stored reading is still worth showing, marked by its time.
    const stored = await GpuBalance.read(cfg);
    if (stored.usd != null) balanceReading = stored;
  }
  const balance = balanceReading?.usd != null ? balanceReading : null;

  // ---- Every vendor: key held, rented from, last balance read -------
  // Balances come from the reading above (one vendor round a minute at
  // most), not a live call per vendor on every 15 s poll.
  const keyed = await GpuWorkerManager.keyedProviders();
  const vendors = GPU_PROVIDER_SLUGS.map((slug) => {
    const provider = getGpuProvider(slug);
    const read = balanceReading?.vendors.find((v) => v.slug === slug);
    return {
      slug,
      label: provider?.label ?? slug,
      credential: provider?.credential ?? 'api-key',
      connected: keyed.has(slug),
      enabled: cfg.providers.includes(slug),
      balanceUsd: read?.usd != null ? Number(read.usd.toFixed(2)) : null,
      balanceUnknown: Boolean(read?.unknown),
      error: read?.error ? 'อ่านยอดเงินไม่ได้' : null,
      liveWorkers: liveWorkers.filter((w) => w.providerSlug === slug).length,
    };
  });

  const spentToday = await GpuWorkerManager.todaySpendUsd();
  const burnRateUsdPerHour = liveWorkers.reduce((s, w) => s + Number(w.pricePerHourUsd), 0);

  // ---- Per-machine detail -------------------------------------------
  const minutes = (ms: number) => Number((ms / 60_000).toFixed(1));
  const modelName = (key: string) => getCatalogEntry(key)?.name ?? key;
  const bootMinutes = (w: { rentedAt: Date; readyAt: Date | null }) =>
    w.readyAt ? minutes(w.readyAt.getTime() - w.rentedAt.getTime()) : null;
  // Which generation each machine is rendering right now.
  const renderingOn = new Map<number, number>();
  for (const j of jobs) {
    if (j.workerId && (j.status === 'assigned' || j.status === 'running')) renderingOn.set(j.workerId, j.generationId);
  }
  const booted = workers.filter((w) => w.readyAt);
  // Whether a customer is on the studio with each live machine's model selected.
  const present = new Map<string, boolean>();
  for (const key of new Set(liveWorkers.map((w) => w.modelKey))) {
    present.set(key, await isStudioPresent(key, now.getTime()));
  }
  // The reaper gives that grace only to the most recently used ready machine
  // of the model (GpuWorkerManager.isWarmestIdle); mirror it so the countdown
  // for an extra machine does not promise a wait it will not get.
  const warmest = new Map<string, number>();
  for (const w of liveWorkers) {
    if (w.status !== 'ready') continue;
    const best = liveWorkers.find((x) => x.id === warmest.get(w.modelKey));
    if (!best || (w.lastJobAt?.getTime() ?? 0) > (best.lastJobAt?.getTime() ?? 0)) warmest.set(w.modelKey, w.id);
  }
  const graced = (w: { id: number; modelKey: string }) =>
    (present.get(w.modelKey) ?? false) && warmest.get(w.modelKey) === w.id;
  /** Why the offer behind a rental was chosen, from what rentWorker recorded. */
  const pickNote = (metadata: unknown): string | null => {
    const p = (metadata as { pick?: Record<string, unknown> } | null)?.pick;
    if (!p || typeof p.costUsd !== 'number') return null;
    return (
      `เลือกจาก ${p.candidates} ข้อเสนอ • ต้นทุนงานโดยประมาณ $${p.costUsd.toFixed(3)} ` +
      `(บูต ~${p.bootSeconds} วิ + เรนเดอร์ ~${p.renderSeconds} วิ${RENDER_BASIS_TH[String(p.renderBasis)] ?? ' ค่ากลางของโมเดล'})`
    );
  };

  return NextResponse.json({
    config: cfg,
    pricing: {
      thbPerCredit: Number(thbPerCredit.toFixed(4)),
      usdToThb: Number(usdToThb.toFixed(2)),
    },
    // The best-funded vendor's balance — what one rental can draw on
    // (gpu-balance.ts); each vendor's own is in `vendors`.
    balance: balance
      ? {
          balanceUsd: Number((balance.usd ?? 0).toFixed(2)),
          availableRentalHours: balance.availableRentalHours ?? null,
          // At the current burn, how long before that account is empty.
          hoursAtCurrentBurn:
            burnRateUsdPerHour > 0 ? Number(((balance.usd ?? 0) / burnRateUsdPerHour).toFixed(1)) : null,
          state: balance.state,
          lowBelowUsd: balance.lowBelowUsd,
          insufficientAtOrBelowUsd: balance.insufficientAtOrBelowUsd,
          checkedAt: balance.checkedAt,
        }
      : null,
    balanceError,
    vendors,
    telegram: await getTelegramStatus(),
    // Without R2 the queue refuses to rent (a render would be lost with the
    // machine), so the admin needs to see why nothing is happening.
    storageConfigured: isStorageConfigured(),
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
      modelName: modelName(w.modelKey),
      currentGenerationId: renderingOn.get(w.id) ?? null,
      bootMinutes: bootMinutes(w),
      lastJobAt: w.lastJobAt?.toISOString() ?? null,
      // When the idle reaper will shut it down — the same rule as
      // GpuWorkerManager.reconcile (including the grace for a customer still
      // on the studio), so the countdown matches what happens.
      customerPresent: graced(w),
      idleOffInMinutes:
        w.status === 'ready' && !renderingOn.has(w.id)
          ? Math.max(
              0,
              Math.ceil(
                ((cfg.idleTimeoutMinutes + (graced(w) ? cfg.presenceExtensionMinutes : 0)) * 60_000 -
                  (now.getTime() - (w.lastJobAt ?? w.readyAt ?? w.rentedAt).getTime())) /
                  60_000
              )
            )
          : null,
      // The absolute kill switch, whatever the machine is doing.
      lifetimeLeftMinutes: Math.max(
        0,
        Math.round(cfg.maxWorkerLifetimeMinutes - (now.getTime() - w.rentedAt.getTime()) / 60_000)
      ),
      gpuModel: w.gpuModel,
      gpuCount: w.gpuCount,
      vendor: getGpuProvider(w.providerSlug)?.label ?? w.providerSlug,
      supportId: w.supportId,
      pricePerHourUsd: Number(w.pricePerHourUsd),
      accruedCostUsd: Number(GpuWorkerManager.accruedCostUsd(w, now).toFixed(4)),
      uptimeMinutes: Math.round((now.getTime() - w.rentedAt.getTime()) / 60_000),
      jobsCompleted: w.jobsCompleted,
      jobsFailed: w.jobsFailed,
      lastError: w.lastError,
      rentedAt: w.rentedAt.toISOString(),
      readyAt: w.readyAt?.toISOString() ?? null,
      // Whether the proxy is reachable yet (gates the log button). The URL
      // itself is a live tunnel into the machine and stays server-side.
      hasEndpoint: Boolean(w.endpoint),
    })),
    // Every rental in the window, live ones included: when it was opened, how
    // long it took to boot, when and why it was closed, and what it cost.
    rentals: workers.slice(0, 50).map((w) => {
      const end = w.terminatedAt && w.terminatedAt < now ? w.terminatedAt : now;
      return {
        id: w.id,
        status: w.status,
        modelKey: w.modelKey,
        modelName: modelName(w.modelKey),
        gpuModel: w.gpuModel,
        gpuCount: w.gpuCount,
        vendor: getGpuProvider(w.providerSlug)?.label ?? w.providerSlug,
        supportId: w.supportId,
        pricePerHourUsd: Number(w.pricePerHourUsd),
        rentedAt: w.rentedAt.toISOString(),
        readyAt: w.readyAt?.toISOString() ?? null,
        terminatedAt: w.terminatedAt?.toISOString() ?? null,
        bootMinutes: bootMinutes(w),
        uptimeMinutes: minutes(end.getTime() - w.rentedAt.getTime()),
        costUsd: Number(GpuWorkerManager.accruedCostUsd(w, now).toFixed(4)),
        jobsCompleted: w.jobsCompleted,
        jobsFailed: w.jobsFailed,
        // lastError doubles as the close reason once a worker is terminated.
        endReason: w.terminatedAt ? w.lastError : null,
        pickNote: pickNote(w.metadata),
      };
    }),
    rentalSummary: {
      count: workers.length,
      hours: Number((rentedSeconds / 3600).toFixed(2)),
      costUsd: Number(totalSpendUsd.toFixed(4)),
      avgBootMinutes:
        booted.length > 0
          ? Number((booted.reduce((s, w) => s + (bootMinutes(w) ?? 0), 0) / booted.length).toFixed(1))
          : null,
      // Closed before ever serving: failed boots, warmup timeouts, stops.
      neverReady: workers.filter((w) => !w.readyAt && w.terminatedAt).length,
    },
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
