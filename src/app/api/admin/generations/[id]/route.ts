import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId, prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

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
