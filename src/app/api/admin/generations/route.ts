import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import type { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/db';

/** Admin generations list — moderation / oversight across all users. */
export async function GET(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(sp.get('limit') || '24', 10) || 24));
    const status = sp.get('status');
    const type = sp.get('type');
    const search = sp.get('search')?.trim();
    const userId = parseInt(sp.get('userId') || '', 10);

    const where: Prisma.AiGenerationWhereInput = {};
    if (status && ['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(status)) where.status = status;
    if (type && ['image', 'video', 'edit'].includes(type)) where.type = type;
    if (Number.isInteger(userId) && userId > 0) where.userId = userId;
    if (search) where.prompt = { contains: search };

    const [data, total] = await Promise.all([
      prisma.aiGeneration.findMany({
        where,
        select: {
          id: true, type: true, status: true, prompt: true, resultUrl: true, thumbnailUrl: true,
          creditsUsed: true, errorMessage: true, isPublic: true, createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          model: { select: { name: true, provider: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiGeneration.count({ where }),
    ]);

    return NextResponse.json({ data, total, pages: Math.ceil(total / limit), page });
  } catch (error) {
    console.error('Failed to list generations:', error);
    return NextResponse.json({ error: 'Failed to list generations' }, { status: 500 });
  }
}
