import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { communityCatalogue } from '@/lib/gpu/catalog';
import { communityQueueGraceMs, readCommunityMeta } from '@/lib/gpu/community-dispatch';
import { relayBaseUrl, relayHealth } from '@/lib/gpu/gpuxmine';
import { isStorageConfigured } from '@/lib/storage/r2';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';
import { ledgerHealth } from '@/lib/services/gpux-ledger';

/**
 * GPUxMINE go-live check: everything aixman's side of the community pool
 * needs, in one place. Each missing piece used to fail silently — nodes
 * registered fine and simply never received a job, or customers could not
 * order — so this says which, in Thai, for the admin who has to fix it.
 *
 * Read-only. The relay is asked for `/healthz` (no key needed) and, when a
 * relay admin key happens to be stored, for its worker list.
 */

export const dynamic = 'force-dynamic';

const PROVIDER_SLUG = 'gpuxmine';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const problems: string[] = [];
  const warnings: string[] = [];
  const relayUrl = relayBaseUrl();
  const communityKeys = communityCatalogue().map((e) => e.key);

  const config = {
    relayUrl,
    relayUrlFromEnv: Boolean(process.env.GPUXMINE_RELAY_URL),
    webhookSecretSet: Boolean(process.env.XMAN_WEBHOOK_SECRET),
    r2Configured: isStorageConfigured(),
    // GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN: a community-only job no node takes is refunded after this.
    communityQueueGraceMinutes: communityQueueGraceMs() / 60_000,
  };
  if (!config.webhookSecretSet) {
    problems.push('ยังไม่ได้ตั้ง XMAN_WEBHOOK_SECRET — XMAN Studio ส่งเครื่องเข้ามาไม่ได้ (ต้องตรงกับ AIXMAN_WEBHOOK_SECRET ฝั่ง XMAN Studio)');
  }
  if (!config.r2Configured) {
    problems.push('ยังไม่ได้ตั้งค่า R2 (R2_*) — งาน GPU ทุกงานจะถูกปฏิเสธ เพราะเก็บผลงานไม่ได้');
  }
  if (!config.relayUrlFromEnv) {
    warnings.push(`ยังไม่ได้ตั้ง GPUXMINE_RELAY_URL — ใช้ค่าเริ่มต้น ${relayUrl} (ใช้แค่หน้าแอดมินและหน้านี้ ไม่กระทบการส่งงาน)`);
  }

  const [relay, models, rows, queued] = await Promise.all([
    relayHealth(),
    prisma.aiModel.findMany({
      where: { modelId: { in: communityKeys } },
      select: { modelId: true, name: true, isActive: true, readiness: true, readinessNote: true },
    }),
    prisma.aiGpuWorker.findMany({
      where: { providerSlug: PROVIDER_SLUG, terminatedAt: null },
      orderBy: { rentedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        externalId: true,
        status: true,
        modelKey: true,
        endpoint: true,
        lastError: true,
        lastJobAt: true,
        readyAt: true,
        jobsCompleted: true,
        jobsFailed: true,
        metadata: true,
      },
    }),
    prisma.aiGpuJob.groupBy({
      by: ['modelKey'],
      where: { status: 'queued', modelKey: { in: communityKeys } },
      _count: { _all: true },
      _min: { queuedAt: true },
    }),
  ]);

  if (!relay.reachable) problems.push(`ติดต่อ relay ที่ ${relayUrl} ไม่ได้ (${relay.detail ?? 'ไม่ทราบสาเหตุ'})`);

  for (const key of communityKeys) {
    const model = models.find((m) => m.modelId === key);
    if (!model) {
      problems.push(`ยังไม่มีโมเดล ${key} ใน ai_models — เปิดหน้า GPU แล้วซิงก์แคตตาล็อก`);
    } else if (!model.isActive) {
      problems.push(`โมเดล ${key} ถูกปิดอยู่ (is_active = 0)`);
    } else if (model.readiness !== 'ready') {
      problems.push(
        `โมเดล ${key} ยังอยู่ในสถานะ ${model.readiness} — แอดมินต้องสั่งงานทดสอบให้สำเร็จหนึ่งครั้ง ลูกค้าถึงสั่งได้` +
          (model.readinessNote ? ` (${model.readinessNote})` : '')
      );
    }
  }

  // The relay's own list, only when an admin key happens to be stored. The
  // pool never needs it; it only tells us which nodes the relay knows about.
  let relayWorkers: { known: number; online: number } | null = null;
  const relayKnown = new Map<string, boolean>();
  try {
    const vendor = (await GpuWorkerManager.keyedProviders()).get(PROVIDER_SLUG);
    if (vendor) {
      const listed = await vendor.provider.listInstances(vendor.apiKey);
      for (const w of listed) relayKnown.set(w.id, w.status === 'running');
      relayWorkers = { known: listed.length, online: listed.filter((w) => w.status === 'running').length };
    }
  } catch (error) {
    warnings.push(`อ่านรายชื่อเครื่องจาก relay ไม่ได้: ${(error as Error).message.slice(0, 160)}`);
  }

  const byStatus: Record<string, number> = {};
  const workers = rows.map(({ metadata, ...row }) => {
    const meta = readCommunityMeta(metadata);
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    return {
      ...row,
      label: meta.label ?? null,
      eligibility: meta.eligibility ?? 'unknown',
      lane: meta.lane ?? 'full',
      suspended: meta.suspended ?? false,
      // XMAN Studio builds the endpoint from its own GPUXMINE_RELAY_URL; a
      // different base here means the two .env files disagree.
      endpointOnRelay: Boolean(row.endpoint?.startsWith(`${relayUrl}/w/`)),
      relayOnline: relayWorkers ? (relayKnown.get(row.externalId) ?? null) : null,
    };
  });

  const serving = (byStatus.ready ?? 0) + (byStatus.busy ?? 0);
  if (rows.length === 0) {
    warnings.push('ยังไม่มีเครื่องชุมชนในระบบ — เครื่องเข้ามาเมื่อเจ้าของจับคู่ที่หน้า GPUxMINE บน XMAN Studio');
  } else if (serving === 0) {
    problems.push(`มีเครื่องชุมชน ${rows.length} เครื่อง แต่ไม่มีเครื่องไหนพร้อมรับงาน — ดูคอลัมน์ lastError ของแต่ละเครื่อง`);
  }
  // The privacy page promises a delivered job is deleted from the node. One
  // the node has not confirmed is asked again while it is up (GpuQueue).
  const unpurged = await prisma.aiGpuJob.count({
    where: {
      status: 'completed',
      nodePurgedAt: null,
      externalJobId: { not: null },
      completedAt: { gte: new Date(Date.now() - 24 * 3_600_000) },
      worker: { providerSlug: PROVIDER_SLUG },
    },
  });
  if (unpurged > 0) {
    warnings.push(`งานที่ส่งมอบแล้ว ${unpurged} งานใน 24 ชม. ยังไม่ได้รับการยืนยันว่าลบออกจากเครื่องชุมชน — ระบบสั่งลบซ้ำเองเมื่อเครื่องออนไลน์`);
  }
  const offRelay = workers.filter((w) => w.endpoint && !w.endpointOnRelay).length;
  if (offRelay > 0) {
    warnings.push(`${offRelay} เครื่องมี endpoint ที่ไม่ได้ขึ้นต้นด้วย ${relayUrl}/w/ — GPUXMINE_RELAY_URL ของ aixman กับ XMAN Studio อาจไม่ตรงกัน`);
  }
  for (const q of queued) {
    if (q._count._all > 0 && serving === 0) {
      problems.push(`มีงาน ${q.modelKey} รอคิว ${q._count._all} งาน แต่ไม่มีเครื่องชุมชนพร้อมรับ`);
    }
  }

  // Owners are paid from gpu_job_earnings (XMAN Studio's table): aixman writes
  // a row per delivered community job, XMAN Studio clears and pays it.
  const ledger = await ledgerHealth();
  if (!ledger.writable) {
    problems.push(
      `บันทึกรายได้เครื่องชุมชนลง gpu_job_earnings ไม่ได้ — ต้องรัน migration ของ XMAN Studio (2026_09_25_*) ก่อน (${ledger.detail ?? ''})`
    );
  } else if ((ledger.missing7d ?? 0) > 0) {
    warnings.push(`งานเครื่องชุมชนที่ส่งมอบแล้ว ${ledger.missing7d} งานใน 7 วันยังไม่มีแถวรายได้ — ระบบบันทึกซ้ำเองทุก 5 นาที`);
  }
  const review = ledger.byStatus30d.review;
  if (review && review.rows > 0) {
    warnings.push(`รายได้ ${review.rows} งานใน 30 วันติดสถานะรอตรวจ (review) — แอดมิน XMAN Studio ต้องอนุมัติหรือยกเลิก`);
  }

  return NextResponse.json({
    ok: problems.length === 0,
    checkedAt: new Date().toISOString(),
    problems,
    warnings,
    config,
    relay: { ...relay, workers: relayWorkers },
    models,
    queue: queued.map((q) => ({ modelKey: q.modelKey, queued: q._count._all, oldestQueuedAt: q._min.queuedAt })),
    workers: { total: rows.length, byStatus, rows: workers },
    privacy: { unpurgedDelivered24h: unpurged },
    ledger,
  });
}
