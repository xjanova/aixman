import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId, pick, prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

const EDITABLE = ['name', 'slug', 'description', 'promptSuffix', 'thumbnail', 'isActive', 'sortOrder'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const styleId = parseId(id);
    if (!styleId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const data = pick(body, EDITABLE);
    if (data.sortOrder !== undefined && data.sortOrder !== null) data.sortOrder = parseInt(String(data.sortOrder), 10);

    const style = await prisma.aiStyle.update({ where: { id: styleId }, data });
    return NextResponse.json({ style });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to update style:', error);
    return NextResponse.json({ error: 'Failed to update style' }, { status: 500 });
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
    const styleId = parseId(id);
    if (!styleId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    await prisma.aiStyle.delete({ where: { id: styleId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to delete style:', error);
    return NextResponse.json({ error: 'Failed to delete style' }, { status: 500 });
  }
}
