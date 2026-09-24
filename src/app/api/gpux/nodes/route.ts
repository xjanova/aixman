import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import type { AiGpuWorker } from '@/generated/prisma/client';
import { encrypt } from '@/lib/utils/encryption';
import { assessCommunityNode } from '@/lib/gpu/community-eligibility';
import { communityCatalogue } from '@/lib/gpu/catalog';
import {
  PUSH_OUTCOME_NOTE,
  endpointProblem,
  metaFromPush,
  planNodePush,
  type NodePayload,
  type PushOutcome,
} from '@/lib/gpu/community-push';

/**
 * Where a community GPU joins the pool (contract C1).
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
 * actually needs. Only the overlap is dispatchable, and only entries built for
 * home machines (catalogue `pools`) are in the running at all.
 *
 * XMAN Studio pushes on every change and again every few minutes regardless,
 * so this must be safe to call repeatedly — community-push.ts says what a push
 * may and may not do to a row. Readiness itself is not decided here: the
 * reconciler asks the node (gpu-worker.ts reconcileCommunity).
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

const WORKER_SELECT = { id: true, externalId: true, status: true, modelKey: true, lastError: true } as const;

export async function POST(request: NextRequest) {
  if (!isXmanStudio(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const node = (await request.json().catch(() => null)) as NodePayload | null;

  if (
    !node ||
    typeof node.workerId !== 'string' ||
    typeof node.endpoint !== 'string' ||
    typeof node.token !== 'string' ||
    !node.workerId.trim() ||
    !node.endpoint.trim() ||
    !node.token.trim()
  ) {
    return NextResponse.json(
      { error: 'workerId, endpoint and token are all required' },
      { status: 400 }
    );
  }
  node.workerId = node.workerId.trim();
  node.endpoint = node.endpoint.trim().replace(/\/+$/, '');
  if (node.workerId.length > 100) {
    return NextResponse.json({ error: 'workerId is too long (100 characters at most)' }, { status: 400 });
  }
  const problem = endpointProblem(node.endpoint);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const verdict = assessCommunityNode(node, communityCatalogue());
  const tokenHash = createHash('sha256').update(node.token).digest('hex');
  const where = { providerSlug_externalId: { providerSlug: PROVIDER_SLUG, externalId: node.workerId } };
  const now = new Date();
  // Written on every push: XMAN Studio is the source of truth for where the
  // node is and which token opens it (a rotated tunnel token lands here).
  const reach = {
    endpoint: node.endpoint,
    authToken: encrypt(node.token),
    ...(typeof node.gpuName === 'string' ? { gpuModel: node.gpuName.slice(0, 100) } : {}),
    ...(node.vramTotalMb ? { gpuMemoryMb: Math.round(node.vramTotalMb) } : {}),
  };

  // Guarded read-decide-write: the reconciler and the queue move this row's
  // status concurrently, and a write decided on a status that has since
  // changed could hand a busy node a second model or pull it mid-job.
  let outcome: PushOutcome = null;
  let worker: Pick<AiGpuWorker, 'id' | 'externalId' | 'status' | 'modelKey' | 'lastError'> | null = null;
  for (let attempt = 0; attempt < 3 && !worker; attempt++) {
    const row = await prisma.aiGpuWorker.findUnique({ where });

    if (!row) {
      try {
        // A node that cannot be given work still gets a row. The alternative is
        // a machine that is online, assessed and invisible — and an owner
        // asking why, with nothing on this side to answer from.
        worker = await prisma.aiGpuWorker.create({
          data: {
            providerSlug: PROVIDER_SLUG,
            externalId: node.workerId,
            // Never `ready` from a webhook: the reconciler asks the node itself.
            status: node.suspended === true ? 'terminated' : 'warming',
            terminatedAt: node.suspended === true ? now : null,
            modelKey: verdict.modelKey ?? 'unassigned',
            ...reach,
            // Community capacity has no hourly price, and a zero here is what
            // keeps it out of every cost and margin calculation built for rentals.
            pricePerHourUsd: 0,
            metadata: metaFromPush(node, verdict, now) as Prisma.InputJsonValue,
          },
          select: WORKER_SELECT,
        });
        outcome = node.suspended === true ? 'suspended' : null;
      } catch (error) {
        // Two pushes for a brand-new node raced; the other one created it.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
      break;
    }

    const plan = planNodePush(row, node, verdict, tokenHash, now);
    const { metadata, ...change } = plan.change;
    const { count } = await prisma.aiGpuWorker.updateMany({
      where: { id: row.id, status: row.status },
      data: { ...reach, ...change, metadata: metadata as Prisma.InputJsonValue },
    });
    if (count === 0) continue; // the status moved under us — decide again on what it is now
    outcome = plan.outcome;
    worker = await prisma.aiGpuWorker.findUnique({ where: { id: row.id }, select: WORKER_SELECT });
  }

  if (!worker) {
    return NextResponse.json({ error: 'The node changed state repeatedly while it was being saved; retry' }, { status: 409 });
  }

  return NextResponse.json({
    status: outcome ?? verdict.status,
    note: outcome ? PUSH_OUTCOME_NOTE[outcome] : verdict.note,
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
