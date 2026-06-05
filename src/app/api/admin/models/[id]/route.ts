import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId, pick, prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

const EDITABLE = ['name', 'description', 'category', 'subcategory', 'thumbnail', 'creditsPerUnit', 'costPerUnit', 'unitType', 'maxWidth', 'maxHeight', 'maxDuration', 'isActive', 'isFeatured', 'sortOrder'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const modelId = parseId(id);
    if (!modelId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const data = pick(body, EDITABLE);
    // Coerce numeric fields when provided.
    for (const f of ['creditsPerUnit', 'maxWidth', 'maxHeight', 'maxDuration', 'sortOrder']) {
      if (data[f] !== undefined && data[f] !== null) data[f] = parseInt(String(data[f]), 10);
    }

    const model = await prisma.aiModel.update({
      where: { id: modelId },
      data,
    });

    return NextResponse.json({ model });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to update model:', error);
    return NextResponse.json({ error: 'Failed to update model' }, { status: 500 });
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
    const modelId = parseId(id);
    if (!modelId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    await prisma.aiModel.delete({ where: { id: modelId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to delete model:', error);
    return NextResponse.json({ error: 'Failed to delete model' }, { status: 500 });
  }
}
