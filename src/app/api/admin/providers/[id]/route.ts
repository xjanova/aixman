import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId, pick, prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

const EDITABLE = ['name', 'slug', 'description', 'baseUrl', 'logo', 'authType', 'supportsImage', 'supportsVideo', 'supportsEdit', 'isActive', 'sortOrder'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const providerId = parseId(id);
    if (!providerId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const provider = await prisma.aiProvider.update({
      where: { id: providerId },
      data: pick(body, EDITABLE),
    });

    return NextResponse.json({ provider });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to update provider:', error);
    return NextResponse.json({ error: 'Failed to update provider' }, { status: 500 });
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
    const providerId = parseId(id);
    if (!providerId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    await prisma.aiProvider.delete({ where: { id: providerId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to delete provider:', error);
    return NextResponse.json({ error: 'Failed to delete provider' }, { status: 500 });
  }
}
