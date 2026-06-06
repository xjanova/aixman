import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId, pick, prismaErrorResponse, normalizeFeatures } from '@/lib/utils/admin';
import prisma from '@/lib/db';

const EDITABLE = ['name', 'slug', 'credits', 'priceThb', 'priceUsd', 'bonusCredits', 'badge', 'features', 'isActive', 'isFeatured', 'sortOrder'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const pkgId = parseId(id);
    if (!pkgId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const data = pick(body, EDITABLE);
    for (const f of ['credits', 'bonusCredits', 'sortOrder']) {
      if (data[f] !== undefined && data[f] !== null) data[f] = parseInt(String(data[f]), 10);
    }
    if (data.features !== undefined) data.features = normalizeFeatures(data.features) ?? [];

    const pkg = await prisma.aiCreditPackage.update({
      where: { id: pkgId },
      data,
    });

    return NextResponse.json({ package: pkg });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to update package:', error);
    return NextResponse.json({ error: 'Failed to update package' }, { status: 500 });
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
    const pkgId = parseId(id);
    if (!pkgId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    await prisma.aiCreditPackage.delete({ where: { id: pkgId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to delete package:', error);
    return NextResponse.json({ error: 'Failed to delete package' }, { status: 500 });
  }
}
