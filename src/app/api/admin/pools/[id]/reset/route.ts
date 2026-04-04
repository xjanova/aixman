import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    const pool = await prisma.aiAccountPool.update({
      where: { id: parseInt(id, 10) },
      data: {
        consecutiveErrors: 0,
        errorCount: 0,
        cooldownUntil: null,
        lastError: null,
      },
    });

    return NextResponse.json({ pool });
  } catch (error) {
    console.error('Failed to reset pool errors:', error);
    return NextResponse.json(
      { error: 'Failed to reset pool errors' },
      { status: 500 }
    );
  }
}
