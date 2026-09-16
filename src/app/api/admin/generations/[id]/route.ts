import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId, prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

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
