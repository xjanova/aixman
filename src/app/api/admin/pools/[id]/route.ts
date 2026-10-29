import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { encrypt } from '@/lib/utils/encryption';
import { parseId, prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const poolId = parseId(id);
    if (!poolId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));

    // Whitelist updatable fields (no mass-assignment).
    const data: Record<string, unknown> = {};
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.label === 'string' && body.label.trim()) data.label = body.label.trim();
    if (['round_robin', 'balanced', 'quota_first'].includes(body.rotationMode)) data.rotationMode = body.rotationMode;
    // The edit form sends these as typed text; Prisma refuses a string for an Int.
    for (const f of ['priority', 'dailyQuota'] as const) {
      const n = parseInt(body[f], 10);
      if (Number.isFinite(n) && n >= 0) data[f] = n;
    }
    // Allow rotating the stored credentials (encrypted before storing). A new
    // key starts clean: the errors and cooldown belonged to the old one.
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
      data.apiKey = encrypt(body.apiKey.trim());
      Object.assign(data, { consecutiveErrors: 0, cooldownUntil: null, lastError: null });
    }
    if (typeof body.apiSecret === 'string') data.apiSecret = body.apiSecret ? encrypt(body.apiSecret) : null;

    const pool = await prisma.aiAccountPool.update({
      where: { id: poolId },
      data,
    });

    return NextResponse.json({ pool });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to update pool:', error);
    return NextResponse.json({ error: 'Failed to update pool' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const poolId = parseId(id);
    if (!poolId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    await prisma.aiAccountPool.delete({ where: { id: poolId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to delete pool:', error);
    return NextResponse.json({ error: 'Failed to delete pool' }, { status: 500 });
  }
}
