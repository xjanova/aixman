import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
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
    const body = await request.json();

    // Only allow specific fields to be updated
    const allowedFields: Record<string, unknown> = {};
    const permitted = ['isActive', 'priority', 'dailyQuota', 'rotationMode', 'label'];

    for (const field of permitted) {
      if (body[field] !== undefined) {
        allowedFields[field] = body[field];
      }
    }

    const pool = await prisma.aiAccountPool.update({
      where: { id: parseInt(id, 10) },
      data: allowedFields,
    });

    return NextResponse.json({ pool });
  } catch (error) {
    console.error('Failed to update pool:', error);
    return NextResponse.json(
      { error: 'Failed to update pool' },
      { status: 500 }
    );
  }
}
