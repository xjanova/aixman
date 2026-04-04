import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = Math.min(
    parseInt(searchParams.get('limit') || '20', 10),
    50
  );
  const type = searchParams.get('type');
  const search = searchParams.get('search');
  const favorites = searchParams.get('favorites') === 'true';
  const skip = (page - 1) * limit;

  // Build where clause
  const where: Prisma.AiGenerationWhereInput = { userId };

  if (type && ['image', 'video', 'edit'].includes(type)) {
    where.type = type;
  }

  if (search) {
    where.prompt = { contains: search };
  }

  if (favorites) {
    where.favorites = { some: { userId } };
  }

  // Only show completed/failed (not pending/processing in gallery)
  where.status = { in: ['completed', 'failed'] };

  const [generations, total] = await Promise.all([
    prisma.aiGeneration.findMany({
      where,
      include: {
        model: {
          include: {
            provider: { select: { name: true, slug: true, logo: true } },
          },
        },
        favorites: { where: { userId }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.aiGeneration.count({ where }),
  ]);

  return NextResponse.json({
    data: generations.map((g) => ({
      id: g.id,
      type: g.type,
      status: g.status,
      prompt: g.prompt,
      resultUrl: g.resultUrl,
      resultUrls: g.resultUrls,
      thumbnailUrl: g.thumbnailUrl,
      creditsUsed: g.creditsUsed,
      processingMs: g.processingMs,
      isPublic: g.isPublic,
      isFavorited: g.favorites.length > 0,
      model: {
        name: g.model.name,
        provider: g.model.provider.name,
        providerSlug: g.model.provider.slug,
      },
      createdAt: g.createdAt,
    })),
    total,
    pages: Math.ceil(total / limit),
    page,
  });
}
