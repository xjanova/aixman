import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { encrypt } from '@/lib/utils/encryption';
import { MODEL_CATALOG, getCatalogEntry } from '@/lib/gpu/catalog';

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
 * M1 stand-in: the operator runs this by hand after enrolling the node on the
 * relay. The self-service flow (XMAN ID, benchmark, automatic enlistment) lands
 * with M2/M5 and will call the same write.
 */

export const dynamic = 'force-dynamic';

const PROVIDER_SLUG = 'gpuxmine';

/** What XMAN Studio wrote into `metadata` when it last pushed this node across. */
interface CommunityMeta {
  source?: string;
  ownerUserId?: number | null;
  label?: string | null;
  score?: number;
  tier?: string;
  canRun?: string[];
  eligibility?: string;
  note?: string;
  syncedAt?: string;
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await prisma.aiGpuWorker.findMany({
    where: { providerSlug: PROVIDER_SLUG, terminatedAt: null },
    orderBy: { rentedAt: 'desc' },
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
      metadata: true,
    },
  });

  // The assessment lives in `metadata` because it belongs to the community
  // provider, not to every rented worker. Flattened here so the admin screen
  // does not have to know that — it asks for machines and gets machines.
  const workers = rows.map(({ metadata, ...worker }) => {
    const meta = (metadata ?? {}) as CommunityMeta;
    return {
      ...worker,
      label: meta.label ?? null,
      ownerUserId: meta.ownerUserId ?? null,
      score: meta.score ?? 0,
      tier: meta.tier ?? 'unrated',
      canRun: meta.canRun ?? [],
      eligibility: meta.eligibility ?? 'unknown',
      note: meta.note ?? null,
      syncedAt: meta.syncedAt ?? null,
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
  // no graph exists for, and fail every one of them.
  if (!getCatalogEntry(modelKey)) {
    return NextResponse.json(
      { error: `Unknown modelKey '${modelKey}'. Known: ${MODEL_CATALOG.map((m) => m.key).join(', ')}` },
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
      lastError: null,
    },
    select: { id: true, externalId: true, status: true, modelKey: true, endpoint: true },
  });

  return NextResponse.json({ worker });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const workerId = new URL(request.url).searchParams.get('workerId');
  if (!workerId) {
    return NextResponse.json({ error: 'workerId is required' }, { status: 400 });
  }

  // Retiring a community node stops us sending it work. It does not stop the
  // machine — that is its owner's to decide, and the agent will simply sit
  // connected with nothing to do.
  const { count } = await prisma.aiGpuWorker.updateMany({
    where: { providerSlug: PROVIDER_SLUG, externalId: workerId, terminatedAt: null },
    data: { status: 'terminated', terminatedAt: new Date() },
  });

  return NextResponse.json({ retired: count });
}
