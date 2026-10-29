import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId, prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';
import { GenerationService } from '@/lib/services/generation';

/**
 * Take a piece off the public showcase, or put it back (moderation).
 *
 * Deleting is final and takes the user's work with it, so an admin who only
 * needs it out of sight has this instead.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const genId = parseId(id);
    if (!genId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { isPublic?: unknown } | null;
    if (typeof body?.isPublic !== 'boolean') {
      return NextResponse.json({ error: 'ต้องส่ง isPublic เป็น true หรือ false' }, { status: 400 });
    }

    const updated = await prisma.aiGeneration.update({
      where: { id: genId },
      data: { isPublic: body.isPublic },
      select: { id: true, isPublic: true },
    });
    return NextResponse.json({ success: true, ...updated });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to update generation:', error);
    return NextResponse.json({ error: 'Failed to update generation' }, { status: 500 });
  }
}

/**
 * Recover a KIE order that was failed while KIE went on and rendered it — a
 * restart cut the wait off before its task id was stored (as order #325 on
 * 2026-10-29). The admin finds the task id in KIE's logs; the clip is fetched
 * and the order completed in the customer's gallery. The refund stands: the
 * customer gets the work without being charged again.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const genId = parseId(id);
    if (!genId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { kieTaskId?: unknown } | null;
    const taskId = typeof body?.kieTaskId === 'string' ? body.kieTaskId.trim() : '';
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(taskId)) {
      return NextResponse.json({ error: 'ต้องส่ง kieTaskId (Task ID จากหน้า Logs ของ KIE)' }, { status: 400 });
    }

    const order = await prisma.aiGeneration.findUnique({
      where: { id: genId },
      select: { status: true, accountPoolId: true, gpuJob: { select: { id: true } }, model: { select: { providerId: true, provider: { select: { slug: true } } } } },
    });
    if (!order) return NextResponse.json({ error: 'ไม่พบงานนี้' }, { status: 404 });
    if (order.model.provider.slug !== 'kie' || order.gpuJob) {
      return NextResponse.json({ error: 'กู้ได้เฉพาะงานของโมเดล KIE' }, { status: 422 });
    }
    // Only a failed order: a running one is still collected on its own.
    if (order.status !== 'failed') {
      return NextResponse.json({ error: `งานนี้สถานะ ${order.status} — กู้ได้เฉพาะงานที่ล้มแล้ว` }, { status: 409 });
    }
    const pool =
      (order.accountPoolId
        ? await prisma.aiAccountPool.findFirst({ where: { id: order.accountPoolId, providerId: order.model.providerId } })
        : null) ?? (await prisma.aiAccountPool.findFirst({ where: { providerId: order.model.providerId, isActive: true } }));
    if (!pool) return NextResponse.json({ error: 'ไม่มีคีย์ KIE ให้ใช้อ่านงาน' }, { status: 503 });

    const claimed = await prisma.aiGeneration.updateMany({
      where: { id: genId, status: 'failed' },
      data: { status: 'processing', providerJobId: taskId, accountPoolId: pool.id, errorMessage: null, completedAt: null },
    });
    if (claimed.count === 0) return NextResponse.json({ error: 'งานนี้กำลังถูกกู้อยู่แล้ว' }, { status: 409 });

    const outcome = await GenerationService.resumeKieOrder(genId);
    if (outcome === 'completed') {
      // Its time ran from the original order to now: not a render time to learn ETAs from.
      await prisma.aiGeneration.update({ where: { id: genId }, data: { processingMs: null } });
    }
    const after = await prisma.aiGeneration.findUnique({
      where: { id: genId },
      select: { id: true, status: true, resultUrl: true, errorMessage: true },
    });
    return NextResponse.json({ success: outcome === 'completed', outcome, ...after });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to recover generation:', error);
    return NextResponse.json({ error: 'Failed to recover generation' }, { status: 500 });
  }
}

/** Delete a generation (moderation). Favorites cascade on delete. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const genId = parseId(id);
    if (!genId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    await prisma.aiGeneration.delete({ where: { id: genId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to delete generation:', error);
    return NextResponse.json({ error: 'Failed to delete generation' }, { status: 500 });
  }
}
