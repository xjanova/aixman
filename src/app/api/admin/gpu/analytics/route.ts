import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { getGpuConfig } from '@/lib/gpu/config';
import { GPU_PROVIDER_SLUGS, getGpuProvider } from '@/lib/gpu';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';
import { isStorageConfigured } from '@/lib/storage/r2';
import { getCatalogEntry } from '@/lib/gpu/catalog';
import { isStudioPresent } from '@/lib/services/studio-presence';

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

/** Where a rental's render estimate came from (offer-picker.ts RenderBasis; 'model median' before 2026-09-13). */
const RENDER_BASIS_TH: Record<string, string> = {
  history: ' จากประวัติการ์ดรุ่นนี้',
  blended: ' จากประวัติการ์ดรุ่นนี้ที่ยังมีน้อย ผสมค่าประมาณจากสเปค',
  prior: ' ประมาณจากสเปคการ์ด (ยังไม่เคยใช้การ์ดรุ่นนี้)',
  'model median': ' ค่ากลางของโมเดล',
};

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

  // ---- Every vendor: connected, rented from, balance -----------------
  // Best effort per vendor: the dashboard must still render if one is down.
  const vendors = await Promise.all(
    GPU_PROVIDER_SLUGS.map(async (slug) => {
      const provider = getGpuProvider(slug);
      let connected = false;
      let balanceUsd: number | null = null;
      let balanceUnknown = false;
      let error: string | null = null;
      if (provider) {
        try {
          const apiKey = await GpuWorkerManager.getApiKey(slug);
          connected = true;
          const bal = await Promise.race([
            provider.getBalance(apiKey),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
          ]);
          balanceUnknown = Boolean(bal.unknown);
          balanceUsd = Number.isFinite(bal.balanceUsd) ? bal.balanceUsd : null;
        } catch {
          if (connected) error = 'อ่านยอดเงินไม่ได้';
        }
      }
      return {
        slug,
        label: provider?.label ?? slug,
        credential: provider?.credential ?? 'api-key',
        connected,
        enabled: cfg.providers.includes(slug),
        balanceUsd,
        balanceUnknown,
        error,
        liveWorkers: liveWorkers.filter((w) => w.providerSlug === slug).length,
      };
    })
  );
  const connectedVendors = vendors.filter((v) => v.connected);
  const knownBalances = connectedVendors.filter((v) => v.balanceUsd !== null);
  // Kept for app builds that read the old single-vendor shape.
  const balance = knownBalances.length
    ? { balanceUsd: knownBalances.reduce((s, v) => s + (v.balanceUsd ?? 0), 0) }
    : null;
  const balanceError = connectedVendors.length === 0 ? 'ยังไม่ได้ตั้งค่า API key' : null;

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
    // Summed across vendors with a readable balance.
    balance: balance
      ? {
          balanceUsd: Number(balance.balanceUsd.toFixed(2)),
          availableRentalHours: null,
          // At the current burn, how long before the accounts are empty.
          hoursAtCurrentBurn:
            burnRateUsdPerHour > 0 ? Number((balance.balanceUsd / burnRateUsdPerHour).toFixed(1)) : null,
        }
      : null,
    balanceError,
    vendors: vendors.map((v) => ({ ...v, balanceUsd: v.balanceUsd === null ? null : Number(v.balanceUsd.toFixed(2)) })),
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
