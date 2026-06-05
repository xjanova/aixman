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
    for (const f of ['isActive', 'priority', 'dailyQuota', 'rotationMode', 'label'] as const) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    // Allow rotating the stored credentials (encrypted before storing).
    if (typeof body.apiKey === 'string' && body.apiKey.length > 0) data.apiKey = encrypt(body.apiKey);
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
