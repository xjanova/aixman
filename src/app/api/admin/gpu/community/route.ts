import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';
import { encrypt } from '@/lib/utils/encryption';
import { communityCatalogue, getCatalogEntry, inPool } from '@/lib/gpu/catalog';
import { readCommunityMeta } from '@/lib/gpu/community-dispatch';

/**
 * Enlist a GPUxMINE community node, or retire one.
 *
 * A rented worker is created by `GpuWorkerManager` at the moment it pays for a
 * machine. A community node is the opposite: the machine already exists and its
 * owner has already installed the agent, so enlisting is nothing more than
 * writing the row that lets `GpuQueue` see it.
 *
 * Everything downstream is unchanged. The queue claims jobs for a worker by
 * `modelKey` and `status`, submits over `endpoint` with `authToken`, and never
 * asks which vendor it came from — which is why a PC in somebody's bedroom can
 * join the same queue as a rented A100 without touching the dispatch path.
 *
 * Nodes normally arrive through XMAN Studio (POST /api/gpux/nodes). This route
 * is the operator's hand on them: a manual enlist for testing, a retirement
 * that a later push from XMAN Studio cannot undo (`metadata.adminRetired`),
 * and a restore that can.
 */

export const dynamic = 'force-dynamic';

const PROVIDER_SLUG = 'gpuxmine';

/**
 * Every community row, flattened for the admin screen. Retired rows are left
 * out unless `?terminated=1`: a retired node is exactly what an admin needs to
 * find when an owner asks why they stopped getting work.
 */
export async function GET(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const showTerminated = new URL(request.url).searchParams.get('terminated') === '1';
  const rows = await prisma.aiGpuWorker.findMany({
    where: { providerSlug: PROVIDER_SLUG, ...(showTerminated ? {} : { terminatedAt: null }) },
    orderBy: [{ terminatedAt: { sort: 'asc', nulls: 'first' } }, { rentedAt: 'desc' }],
    take: 500,
    select: {
      id: true,
      externalId: true,
      status: true,
      modelKey: true,
      endpoint: true,
      gpuModel: true,
      gpuMemoryMb: true,
      jobsCompleted: true,
      jobsFailed: true,
      lastJobAt: true,
      lastError: true,
      rentedAt: true,
      readyAt: true,
      terminatedAt: true,
      metadata: true,
    },
  });

  // The assessment lives in `metadata` because it belongs to the community
  // provider, not to every rented worker. Flattened here so the admin screen
  // does not have to know that — it asks for machines and gets machines.
  const workers = rows.map(({ metadata, ...worker }) => {
    const meta = readCommunityMeta(metadata);
    return {
      ...worker,
      label: meta.label ?? null,
      ownerUserId: meta.ownerUserId ?? null,
      score: meta.score ?? 0,
      tier: meta.tier ?? 'unrated',
      canRun: meta.canRun ?? [],
      // ไม่มีข้อมูล = เร็วเต็มที่ ซึ่งคือสิ่งที่ระบบสมมติมาตลอดก่อนมีฟิลด์นี้
      // และเป็นสภาพจริงของโหนดที่ยังไม่ได้อัปเดตไคลเอนต์
      lanes: meta.lanes ?? {},
      lane: meta.lane ?? 'full',
      provisional: meta.provisional ?? false,
      eligibility: meta.eligibility ?? 'unknown',
      note: meta.note ?? null,
      syncedAt: meta.syncedAt ?? null,
      freeSharePct: meta.freeSharePct ?? 0,
      pro: meta.pro ?? false,
      suspended: meta.suspended ?? false,
      adminRetired: meta.adminRetired ?? false,
      adminRetiredAt: meta.adminRetiredAt ?? null,
    };
  });

  return NextResponse.json({ workers });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim().replace(/\/+$/, '') : '';
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const modelKey = typeof body.modelKey === 'string' ? body.modelKey.trim() : '';

  if (!workerId || !endpoint || !token || !modelKey) {
    return NextResponse.json(
      { error: 'workerId, endpoint, token and modelKey are all required' },
      { status: 400 }
    );
  }

  // A worker whose model is not in the catalogue would be claimed for jobs that
  // no graph exists for, and fail every one of them. A rented-only model is no
  // better: the queue never gives its jobs to a community machine, and a home
  // PC has none of its weights.
  if (!inPool(getCatalogEntry(modelKey), 'community')) {
    return NextResponse.json(
      {
        error: `'${modelKey}' is not a community model. Community models: ${communityCatalogue()
          .map((m) => m.key)
          .join(', ')}`,
      },
      { status: 400 }
    );
  }

  // The bearer token opens the tunnel to somebody's PC. `ai_` tables must never
  // hold a plaintext secret, and this one is worse than most: it is a home
  // machine, not a container we can destroy.
  if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(endpoint)) {
    return NextResponse.json(
      { error: 'endpoint must be https:// (plain http is only allowed for localhost during development)' },
      { status: 400 }
    );
  }

  const existing = await prisma.aiGpuWorker.findUnique({
    where: { providerSlug_externalId: { providerSlug: PROVIDER_SLUG, externalId: workerId } },
    select: { metadata: true },
  });
  // An admin enlisting by hand is an explicit decision: it undoes an admin
  // retirement, and restarts the row's clock.
  const meta = readCommunityMeta(existing?.metadata);
  delete meta.adminRetired;
  delete meta.adminRetiredAt;
  delete meta.rejectedTokenHash;

  const worker = await prisma.aiGpuWorker.upsert({
    where: { providerSlug_externalId: { providerSlug: PROVIDER_SLUG, externalId: workerId } },
    create: {
      providerSlug: PROVIDER_SLUG,
      externalId: workerId,
      // `warming`, not `ready`: the health probe decides when it can take work,
      // exactly as it does for a rented machine. Declaring it ready here would
      // hand it a job before anyone checked the agent was even running.
      status: 'warming',
      modelKey,
      endpoint,
      authToken: encrypt(token),
      gpuModel: typeof body.gpuModel === 'string' ? body.gpuModel : null,
      gpuMemoryMb: typeof body.gpuMemoryMb === 'number' ? body.gpuMemoryMb : null,
      // Community capacity has no hourly price. Leaving this at 0 is what keeps
      // it out of every cost calculation built for rentals.
      pricePerHourUsd: 0,
      metadata: { source: 'community', enlistedAt: new Date().toISOString() },
    },
    update: {
      status: 'warming',
      modelKey,
      endpoint,
      authToken: encrypt(token),
      gpuModel: typeof body.gpuModel === 'string' ? body.gpuModel : undefined,
      gpuMemoryMb: typeof body.gpuMemoryMb === 'number' ? body.gpuMemoryMb : undefined,
      terminatedAt: null,
      rentedAt: new Date(),
      lastError: null,
      metadata: meta as Prisma.InputJsonValue,
    },
    select: { id: true, externalId: true, status: true, modelKey: true, endpoint: true },
  });

  return NextResponse.json({ worker });
}

/**
 * `{ workerId, action: 'restore' }` — undo an admin retirement. The row goes
 * back to `warming` and the reconciler asks the node before it gets work.
 */
export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
  if (!workerId || body.action !== 'restore') {
    return NextResponse.json({ error: "workerId and action: 'restore' are required" }, { status: 400 });
  }

  const row = await prisma.aiGpuWorker.findUnique({
    where: { providerSlug_externalId: { providerSlug: PROVIDER_SLUG, externalId: workerId } },
  });
  if (!row) return NextResponse.json({ error: 'ไม่พบเครื่องนี้' }, { status: 404 });

  const meta = readCommunityMeta(row.metadata);
  // A suspension belongs to XMAN Studio; lifting it here would be overwritten
  // by the next push anyway.
  if (meta.suspended) {
    return NextResponse.json({ error: 'เครื่องนี้ถูกระงับจาก XMAN Studio — ต้องยกเลิกการระงับที่นั่น' }, { status: 409 });
  }
  delete meta.adminRetired;
  delete meta.adminRetiredAt;
  // A restore is an admin saying "try this node again": a token refused
  // before must not turn the next ordinary suspend-and-resume push into
  // "relay refused this token". A dead token is refused again on the next
  // probe (401) and remembered again then.
  delete meta.rejectedTokenHash;

  // Guarded on the row as read, so a double click restores once.
  const { count } = await prisma.aiGpuWorker.updateMany({
    where: { id: row.id, status: row.status },
    data: {
      metadata: meta as Prisma.InputJsonValue,
      ...(row.terminatedAt || row.status === 'terminated'
        ? { status: 'warming', terminatedAt: null, rentedAt: new Date(), readyAt: null, lastError: null }
        : {}),
    },
  });

  return NextResponse.json({ restored: count });
}

/**
 * Retire a node: no more work, and XMAN Studio's periodic push will not bring
 * it back (`metadata.adminRetired`). Reversible with PATCH restore.
 */
export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const workerId = new URL(request.url).searchParams.get('workerId');
  if (!workerId) {
    return NextResponse.json({ error: 'workerId is required' }, { status: 400 });
  }

  const row = await prisma.aiGpuWorker.findUnique({
    where: { providerSlug_externalId: { providerSlug: PROVIDER_SLUG, externalId: workerId } },
  });
  if (!row) return NextResponse.json({ retired: 0 });

  // Retiring a community node stops us sending it work. It does not stop the
  // machine — that is its owner's to decide, and the agent will simply sit
  // connected with nothing to do. A job it is rendering now is retried on
  // another machine by the queue.
  const meta = { ...readCommunityMeta(row.metadata), adminRetired: true, adminRetiredAt: new Date().toISOString() };
  const alreadyRetired = row.terminatedAt !== null || row.status === 'terminated';
  const { count } = await prisma.aiGpuWorker.updateMany({
    where: { id: row.id, status: row.status },
    data: {
      metadata: meta as Prisma.InputJsonValue,
      ...(alreadyRetired
        ? {}
        : { status: 'terminated', terminatedAt: new Date(), lastError: 'ผู้ดูแลระบบปลดเครื่องนี้ออกจากการรับงาน' }),
    },
  });

  return NextResponse.json({ retired: count });
}
