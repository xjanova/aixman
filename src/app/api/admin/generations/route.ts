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
    const visibility = sp.get('visibility');
    const userId = parseInt(sp.get('userId') || '', 10);

    const where: Prisma.AiGenerationWhereInput = {};
    if (status && ['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(status)) where.status = status;
    if (type && ['image', 'video', 'edit', 'audio'].includes(type)) where.type = type;
    if (Number.isInteger(userId) && userId > 0) where.userId = userId;
    if (search) where.prompt = { contains: search };
    // Moderation works both ways: find what is public to take down, and find
    // what was taken down to review it.
    if (visibility === 'public') where.isPublic = true;
    if (visibility === 'hidden') where.isPublic = false;

    const [data, total] = await Promise.all([
      prisma.aiGeneration.findMany({
        where,
        select: {
          id: true, type: true, status: true, prompt: true, resultUrl: true, thumbnailUrl: true,
          creditsUsed: true, errorMessage: true, isPublic: true, createdAt: true,
          // What an admin needs to judge a piece without opening the database:
          // what it really cost, how long it took, whether the credits went
          // back, and whether the file is still there at all.
          negativePrompt: true, costUsd: true, processingMs: true, creditsRefunded: true,
          providerJobId: true, expiresAt: true, mediaDeletedAt: true, completedAt: true,
          user: { select: { id: true, name: true, email: true } },
          model: { select: { name: true, provider: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiGeneration.count({ where }),
    ]);

    return NextResponse.json({
      // costUsd is a Prisma Decimal — it serialises as a string, which the
      // client would then have to guess at. Send a number.
      data: data.map((g) => ({ ...g, costUsd: Number(g.costUsd) })),
      total,
      pages: Math.ceil(total / limit),
      page,
    });
  } catch (error) {
    console.error('Failed to list generations:', error);
    return NextResponse.json({ error: 'Failed to list generations' }, { status: 500 });
  }
}
