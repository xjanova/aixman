import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { encrypt } from '@/lib/utils/encryption';
import { assessCommunityNode } from '@/lib/gpu/community-eligibility';
import { MODEL_CATALOG } from '@/lib/gpu/catalog';

/**
 * Where a community GPU joins the pool.
 *
 * XMAN Studio is the only caller. It owns the relationship — who the machine
 * belongs to, which wallet its earnings go to, and the relay token, which the
 * relay itself keeps only as a hash. This endpoint receives none of that
 * context and does not want it: all aixman needs is an endpoint, a credential,
 * and an honest statement of what the machine can do.
 *
 * The one judgement made here is eligibility, and it is made against the
 * catalogue rather than against the node's own opinion of itself. A node says
 * "I can do video"; the catalogue says what a video job on this platform
 * actually needs. Only the overlap is dispatchable.
 */

export const dynamic = 'force-dynamic';

const PROVIDER_SLUG = 'gpuxmine';

/** Same secret, same header, same comparison as the credit webhook from XMAN Studio. */
function isXmanStudio(request: NextRequest): boolean {
  const presented = request.headers.get('x-webhook-secret') || '';
  const secret = process.env.XMAN_WEBHOOK_SECRET || '';

  if (!secret || presented.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(presented), Buffer.from(secret));
  } catch {
    return false;
  }
}

interface NodePayload {
  workerId: string;
  endpoint: string;
  token: string;
  label?: string;
  online?: boolean;
  assessed?: boolean;
  gpuName?: string | null;
  vramTotalMb?: number;
  score?: number;
  tier?: string;
  canRun?: string[];
  /** Per-kind speed: `full` for work somebody waits on, `slow` for queued work. */
  lanes?: Record<string, string>;
  /** Kinds whose lane is still the node's opening assumption rather than a measured fact. */
  provisional?: string[];
  ownerUserId?: number;
}

export async function POST(request: NextRequest) {
  if (!isXmanStudio(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const node = (await request.json().catch(() => null)) as NodePayload | null;

  if (!node?.workerId || !node.endpoint || !node.token) {
    return NextResponse.json(
      { error: 'workerId, endpoint and token are all required' },
      { status: 400 }
    );
  }

  const verdict = assessCommunityNode(node, MODEL_CATALOG);

  // A node that cannot be given work still gets a row. The alternative is a
  // machine that is online, assessed and invisible — and an owner asking why,
  // with nothing on this side to answer from.
  const worker = await prisma.aiGpuWorker.upsert({
    where: { providerSlug_externalId: { providerSlug: PROVIDER_SLUG, externalId: node.workerId } },
    create: {
      providerSlug: PROVIDER_SLUG,
      externalId: node.workerId,
      // Never `ready` from a webhook. The health probe decides that, exactly as
      // it does for a rented machine — this call only says the node exists and
      // what it claims to be.
      status: verdict.status === 'eligible' ? 'warming' : 'draining',
      modelKey: verdict.modelKey ?? 'unassigned',
      endpoint: node.endpoint.replace(/\/+$/, ''),
      authToken: encrypt(node.token),
      gpuModel: node.gpuName ?? null,
      gpuMemoryMb: node.vramTotalMb || null,
      // Community capacity has no hourly price, and a zero here is what keeps
      // it out of every cost and margin calculation built for rentals.
      pricePerHourUsd: 0,
      metadata: {
        source: 'community',
        ownerUserId: node.ownerUserId ?? null,
        label: node.label ?? null,
        score: node.score ?? 0,
        tier: node.tier ?? 'unrated',
        canRun: node.canRun ?? [],
        lanes: node.lanes ?? {},
        // What the dispatcher filters on: `slow` is capacity for work nobody is
        // waiting on, and handing it an impatient customer is the one mistake
        // this whole field exists to prevent.
        lane: verdict.lane,
        provisional: verdict.provisional,
        eligibility: verdict.status,
        note: verdict.note,
        syncedAt: new Date().toISOString(),
      },
    },
    update: {
      status: verdict.status === 'eligible' ? 'warming' : 'draining',
      modelKey: verdict.modelKey ?? 'unassigned',
      endpoint: node.endpoint.replace(/\/+$/, ''),
      authToken: encrypt(node.token),
      gpuModel: node.gpuName ?? undefined,
      gpuMemoryMb: node.vramTotalMb || undefined,
      terminatedAt: null,
      metadata: {
        source: 'community',
        ownerUserId: node.ownerUserId ?? null,
        label: node.label ?? null,
        score: node.score ?? 0,
        tier: node.tier ?? 'unrated',
        canRun: node.canRun ?? [],
        lanes: node.lanes ?? {},
        // What the dispatcher filters on: `slow` is capacity for work nobody is
        // waiting on, and handing it an impatient customer is the one mistake
        // this whole field exists to prevent.
        lane: verdict.lane,
        provisional: verdict.provisional,
        eligibility: verdict.status,
        note: verdict.note,
        syncedAt: new Date().toISOString(),
      },
    },
    select: { id: true, externalId: true, status: true, modelKey: true },
  });

  return NextResponse.json({
    status: verdict.status,
    note: verdict.note,
    modelKey: verdict.modelKey,
    worker,
  });
}

export async function DELETE(request: NextRequest) {
  if (!isXmanStudio(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { workerId?: string };
  const workerId =
    body.workerId || new URL(request.url).searchParams.get('workerId') || '';

  if (!workerId) {
    return NextResponse.json({ error: 'workerId is required' }, { status: 400 });
  }

  // Retiring stops us sending work. It does not stop the machine — that is its
  // owner's to decide, and the agent simply sits connected with nothing to do.
  const { count } = await prisma.aiGpuWorker.updateMany({
    where: { providerSlug: PROVIDER_SLUG, externalId: workerId, terminatedAt: null },
    data: { status: 'terminated', terminatedAt: new Date() },
  });

  return NextResponse.json({ retired: count });
}
