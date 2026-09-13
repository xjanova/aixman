import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { getGpuConfig } from '@/lib/gpu/config';
import { isGpuProviderSlug } from '@/lib/gpu/types';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';
import { GpuQueue } from '@/lib/services/gpu-queue';
import { withTickLock } from '@/lib/services/gpu-lock';
import { GpuBalance } from '@/lib/services/gpu-balance';
import { saveTelegramConfig, sendTelegram } from '@/lib/notify/telegram';
import { raiseAlert } from '@/lib/notify/alerts';
import { ALERT_ICON, ALERT_LABEL, ALERT_TYPES, formatAlert } from '@/lib/notify/alert-types';
import { sendDailyReport } from '@/lib/services/gpu-report';

/**
 * Admin control surface for rented GPUs.
 *
 * GET  — live workers, queue depth, today's spend against budget.
 * POST — manual controls: terminate a worker, sweep orphans, force a tick.
 *
 * Every action here can cost or save real money, so all of them are admin-only
 * and none are exposed to end users.
 */

export const dynamic = 'force-dynamic';

/** Job failure reason for an emergency stop; `userFacingError` matches its prefix. */
const STOPPED_BY_ADMIN = 'Stopped by admin (emergency stop)';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cfg = await getGpuConfig();
  const now = new Date();

  const [workers, queueCounts, spentToday, recentJobs] = await Promise.all([
    prisma.aiGpuWorker.findMany({
      where: { status: { in: ['provisioning', 'warming', 'ready', 'busy', 'draining'] } },
      orderBy: { rentedAt: 'desc' },
    }),
    prisma.aiGpuJob.groupBy({ by: ['status'], _count: { _all: true } }),
    GpuWorkerManager.todaySpendUsd(),
    prisma.aiGpuJob.findMany({
      orderBy: { queuedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        generationId: true,
        modelKey: true,
        status: true,
        attempts: true,
        gpuSeconds: true,
        costUsd: true,
        errorMessage: true,
        queuedAt: true,
        completedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    config: cfg,
    budget: {
      spentTodayUsd: Number(spentToday.toFixed(4)),
      dailyBudgetUsd: cfg.dailyBudgetUsd,
      remainingUsd: Number(Math.max(0, cfg.dailyBudgetUsd - spentToday).toFixed(4)),
      // Current burn rate across every machine still running.
      burnRateUsdPerHour: Number(
        workers.reduce((sum, w) => sum + Number(w.pricePerHourUsd), 0).toFixed(4)
      ),
    },
    workers: workers.map((w) => ({
      id: w.id,
      providerSlug: w.providerSlug,
      externalId: w.externalId,
      supportId: w.supportId,
      status: w.status,
      modelKey: w.modelKey,
      gpuModel: w.gpuModel,
      gpuCount: w.gpuCount,
      pricePerHourUsd: Number(w.pricePerHourUsd),
      accruedCostUsd: Number(GpuWorkerManager.accruedCostUsd(w, now).toFixed(4)),
      uptimeMinutes: Math.round((now.getTime() - w.rentedAt.getTime()) / 60_000),
      jobsCompleted: w.jobsCompleted,
      jobsFailed: w.jobsFailed,
      lastError: w.lastError,
      rentedAt: w.rentedAt.toISOString(),
      readyAt: w.readyAt?.toISOString() ?? null,
      lastJobAt: w.lastJobAt?.toISOString() ?? null,
      // The endpoint is a live tunnel into a machine we control — not something
      // to publish in an admin payload.
      hasEndpoint: Boolean(w.endpoint),
    })),
    queue: Object.fromEntries(queueCounts.map((c) => [c.status, c._count._all])),
    recentJobs,
  });
}

/**
 * Editable budget caps, with the bounds enforced server-side.
 *
 * These are the guardrails that stop a rented GPU billing indefinitely, so a
 * typo must not be able to disable one. `min` is a hard floor: "unlimited" is
 * never an accepted value for a timeout.
 */
const EDITABLE_SETTINGS: Record<string, { key: string; min: number; max: number; integer?: boolean }> = {
  maxConcurrentWorkers: { key: 'gpu_max_concurrent_workers', min: 0, max: 8, integer: true },
  maxPricePerHourUsd: { key: 'gpu_max_price_per_hour_usd', min: 0.01, max: 20 },
  dailyBudgetUsd: { key: 'gpu_daily_budget_usd', min: 0, max: 10_000 },
  idleTimeoutMinutes: { key: 'gpu_idle_timeout_minutes', min: 1, max: 240, integer: true },
  presenceExtensionMinutes: { key: 'gpu_presence_extension_minutes', min: 0, max: 30, integer: true },
  prewarmCooldownMinutes: { key: 'gpu_prewarm_cooldown_minutes', min: 0, max: 1440, integer: true },
  maxWorkerLifetimeMinutes: { key: 'gpu_max_worker_lifetime_minutes', min: 10, max: 1440, integer: true },
  warmupTimeoutMinutes: { key: 'gpu_warmup_timeout_minutes', min: 5, max: 180, integer: true },
  jobTimeoutMinutes: { key: 'gpu_job_timeout_minutes', min: 2, max: 240, integer: true },
  waitValueUsdPerHour: { key: 'gpu_wait_value_usd_per_hour', min: 0, max: 100 },
};

async function saveConfig(config: unknown): Promise<string[]> {
  if (!config || typeof config !== 'object') throw new Error('ไม่มีข้อมูลการตั้งค่า');
  const input = config as Record<string, unknown>;
  const saved: string[] = [];

  for (const [field, spec] of Object.entries(EDITABLE_SETTINGS)) {
    if (!(field in input)) continue;
    const raw = Number(input[field]);
    if (!Number.isFinite(raw)) throw new Error(`ค่าของ ${field} ไม่ถูกต้อง`);

    const clamped = Math.min(spec.max, Math.max(spec.min, spec.integer ? Math.round(raw) : raw));
    await prisma.aiSetting.upsert({
      where: { key: spec.key },
      update: { value: String(clamped) },
      create: { key: spec.key, value: String(clamped), type: 'number', group: 'gpu' },
    });
    saved.push(spec.key);
  }

  if (typeof input.enabled === 'boolean') {
    await prisma.aiSetting.upsert({
      where: { key: 'gpu_enabled' },
      update: { value: input.enabled ? 'true' : 'false' },
      create: { key: 'gpu_enabled', value: input.enabled ? 'true' : 'false', type: 'boolean', group: 'gpu' },
    });
    saved.push('gpu_enabled');

    // Keep the model in step: an active model with rental switched off would
    // take credits for jobs that can never run.
    const provider = await prisma.aiProvider.findUnique({ where: { slug: 'simplepod' } });
    if (provider) {
      await prisma.aiModel.updateMany({
        where: { providerId: provider.id },
        data: { isActive: input.enabled },
      });
    }
  }

  return saved;
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');

  try {
    switch (action) {
      case 'terminate': {
        const workerId = parseInt(body.workerId, 10);
        if (!Number.isInteger(workerId) || workerId <= 0) {
          return NextResponse.json({ error: 'workerId ไม่ถูกต้อง' }, { status: 400 });
        }
        await GpuWorkerManager.terminate(workerId, 'Terminated manually by admin');
        return NextResponse.json({ success: true });
      }

      case 'worker-log': {
        const workerId = parseInt(body.workerId, 10);
        if (!Number.isInteger(workerId) || workerId <= 0) {
          return NextResponse.json({ error: 'workerId ไม่ถูกต้อง' }, { status: 400 });
        }
        return NextResponse.json({ success: true, logs: await GpuWorkerManager.fetchLogs(workerId) });
      }

      case 'terminate-all': {
        // An emergency stop has to stop. Shutting machines down alone did not:
        // the next tick re-queued the interrupted render and rented another
        // machine. So rental goes off first, then everything unfinished is
        // refunded, then the machines go.
        await saveConfig({ enabled: false });
        let refunded = await GpuQueue.cancelAllPending(STOPPED_BY_ADMIN);
        const workers = await prisma.aiGpuWorker.findMany({
          where: { status: { in: ['provisioning', 'warming', 'ready', 'busy', 'draining'] } },
          select: { id: true },
        });
        for (const w of workers) {
          await GpuWorkerManager.terminate(w.id, 'Emergency stop by admin');
        }
        // A tick that was mid-poll may have re-queued a job in between.
        refunded += await GpuQueue.cancelAllPending(STOPPED_BY_ADMIN);
        raiseAlert({
          type: 'emergency-stop',
          level: 'info',
          title: 'แอดมินกด "หยุดทั้งหมด"',
          lines: [
            `ปิดเครื่อง ${workers.length} เครื่อง · ยกเลิกและคืนเครดิต ${refunded} งาน`,
            'ปิดการเช่าเครื่องแล้ว — เปิดคืนได้ที่หน้า GPU',
          ],
          cooldownMs: 0,
        });
        return NextResponse.json({ success: true, terminated: workers.length, refunded, rentalEnabled: false });
      }

      case 'sweep-orphans': {
        const cfg = await getGpuConfig();
        const result = await GpuWorkerManager.sweepOrphans(cfg);
        return NextResponse.json({ success: true, ...result });
      }

      case 'tick': {
        const report = await withTickLock(() => GpuQueue.tick());
        return NextResponse.json(report ?? { skipped: true, reason: 'Another tick is already running' });
      }

      case 'test-vendor': {
        // Read-only: balance and which machines each model would get.
        if (!isGpuProviderSlug(body.provider)) {
          return NextResponse.json({ error: 'ไม่รู้จักผู้ให้เช่านี้' }, { status: 400 });
        }
        return NextResponse.json({ success: true, ...(await GpuWorkerManager.testVendor(body.provider)) });
      }

      case 'rent-test': {
        // Spends real money: the page asks the admin to confirm first.
        if (!isGpuProviderSlug(body.provider) || typeof body.modelKey !== 'string') {
          return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
        }
        // Under the tick's lock: a tick renting at the same moment could
        // otherwise take the concurrency cap past its limit.
        const provider = body.provider;
        const modelKey = body.modelKey;
        const worker = await withTickLock(() => GpuWorkerManager.rentTestMachine(provider, modelKey));
        if (!worker) {
          return NextResponse.json({ error: 'ระบบกำลังรันคิวอยู่ ลองกดใหม่อีกครั้งในไม่กี่วินาที' }, { status: 409 });
        }
        return NextResponse.json({ success: true, workerId: worker.id, gpuModel: worker.gpuModel });
      }

      case 'set-providers': {
        // Which vendors the picker may rent from. A vendor taken off keeps its
        // key, so its machines are still watched and reaped.
        const requested = Array.isArray(body.providers) ? (body.providers as unknown[]) : [];
        const providers = [...new Set(requested.filter(isGpuProviderSlug))];
        await prisma.aiSetting.upsert({
          where: { key: 'gpu_providers' },
          update: { value: providers.join(',') },
          create: { key: 'gpu_providers', value: providers.join(','), type: 'string', group: 'gpu' },
        });
        // Which vendors count decides whether orders are paused — re-read now.
        await GpuBalance.check(await getGpuConfig(), 0).catch(() => undefined);
        return NextResponse.json({ success: true, providers });
      }

      case 'refresh-balance': {
        // After a top-up: read it now instead of waiting for the next tick, so
        // orders reopen and the recovery alert goes out straight away.
        const reading = await GpuBalance.check(await getGpuConfig(), 0);
        return NextResponse.json({ success: true, balance: reading });
      }

      case 'save-telegram': {
        const telegram = await saveTelegramConfig({ botToken: body.botToken, chatId: body.chatId });
        return NextResponse.json({ success: true, telegram });
      }

      case 'test-telegram': {
        // In the alerts' own format, so the admin sees what one looks like.
        const result = await sendTelegram(
          formatAlert('resolved', 'ทดสอบการแจ้งเตือน', [
            'ถ้าเห็นข้อความนี้ แปลว่าบอทส่งถึงแล้ว',
            `เรื่องที่บอทจะแจ้งมี ${ALERT_TYPES.length} แบบ แยกระดับด้วยสี: ${(['critical', 'warning', 'info', 'resolved'] as const)
              .map((l) => `${ALERT_ICON[l]} ${ALERT_LABEL[l]}`)
              .join(' · ')}`,
          ])
        );
        if (!result.ok) {
          // Telegram's own reason ("chat not found", "Unauthorized") is what the
          // admin needs to fix it; the token is already scrubbed out of it.
          return NextResponse.json({ error: `ส่งไม่สำเร็จ: ${result.error}` }, { status: 400 });
        }
        return NextResponse.json({ success: true });
      }

      case 'send-report': {
        const result = await sendDailyReport(await getGpuConfig());
        if (!result.ok) return NextResponse.json({ error: `ส่งไม่สำเร็จ: ${result.error}` }, { status: 400 });
        return NextResponse.json({ success: true });
      }

      case 'save-config': {
        const saved = await saveConfig(body.config);
        const enabled = (body.config as { enabled?: unknown } | undefined)?.enabled;
        return NextResponse.json({
          success: true,
          saved,
          ...(typeof enabled === 'boolean' ? { rentalEnabled: enabled } : {}),
        });
      }

      default:
        return NextResponse.json({ error: 'ไม่รู้จักคำสั่งนี้' }, { status: 400 });
    }
  } catch (error) {
    console.error('[gpu] admin action failed:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
