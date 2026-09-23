import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { daysUntil } from '@/lib/services/retention';
import { publicProvider } from '@/lib/public-provider';
import type { Prisma } from '@/generated/prisma/client';

/**
 * The settings an order was placed with, for the studio's "use these settings
 * again". Whitelisted: `params` also holds the customer's uploads (audio,
 * video, end frame), and those are not settings — they are files the
 * retention sweep deletes on its own schedule.
 */
function remixParams(params: unknown): Record<string, unknown> | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const p = params as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['aspectRatio', 'resolution', 'quality'] as const) {
    if (typeof p[key] === 'string' && (p[key] as string).length <= 40) out[key] = p[key];
  }
  for (const key of ['width', 'height', 'duration', 'numOutputs', 'steps', 'cfgScale', 'strength'] as const) {
    if (typeof p[key] === 'number' && Number.isFinite(p[key])) out[key] = p[key];
  }
  if (typeof p.lyrics === 'string') out.lyrics = p.lyrics.slice(0, 3000);
  // Already sanitised to known ids when the order was stored (music-style.ts).
  if (p.music && typeof p.music === 'object' && !Array.isArray(p.music)) out.music = p.music;
  return Object.keys(out).length > 0 ? out : null;
}

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20),
    50
  );
  const type = searchParams.get('type');
  const search = searchParams.get('search');
  const favorites = searchParams.get('favorites') === 'true';
  const sort = searchParams.get('sort') || 'newest';
  const status = searchParams.get('status');
  const skip = (page - 1) * limit;

  // Build where clause
  const where: Prisma.AiGenerationWhereInput = { userId };

  if (type && ['image', 'video', 'edit', 'audio'].includes(type)) {
    where.type = type;
  }

  if (search) {
    where.prompt = { contains: search };
  }

  if (favorites) {
    where.favorites = { some: { userId } };
  }

  // Status filter: default to completed+failed; explicit completed-only or all
  if (status === 'completed') {
    where.status = 'completed';
  } else if (status === 'failed') {
    where.status = 'failed';
  } else {
    where.status = { in: ['completed', 'failed'] };
  }

  // Sort: newest (createdAt desc), trending (favorites count desc within 7d),
  //   top (favorites count desc all-time)
  let orderBy: Prisma.AiGenerationOrderByWithRelationInput | Prisma.AiGenerationOrderByWithRelationInput[];
  if (sort === 'trending') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    where.createdAt = { gte: sevenDaysAgo };
    orderBy = [{ favorites: { _count: 'desc' } }, { createdAt: 'desc' }];
  } else if (sort === 'top') {
    orderBy = [{ favorites: { _count: 'desc' } }, { creditsUsed: 'desc' }, { createdAt: 'desc' }];
  } else {
    orderBy = { createdAt: 'desc' };
  }

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
        _count: { select: { favorites: true } },
      },
      orderBy,
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
      negativePrompt: g.negativePrompt,
      // The model row and the settings, so the studio can put the whole order
      // back ("ใช้การตั้งค่านี้อีกครั้ง") rather than only its prompt.
      modelDbId: g.modelId,
      remix: remixParams(g.params),
      resultUrl: g.resultUrl,
      resultUrls: g.resultUrls,
      thumbnailUrl: g.thumbnailUrl,
      creditsUsed: g.creditsUsed,
      // Stated plainly so a failed item reads as "credits returned" rather than
      // leaving the customer to work out whether they were charged.
      creditsRefunded: g.creditsRefunded,
      processingMs: g.processingMs,
      errorMessage: g.errorMessage,
      // Retention: how long this file will still be here, and whether it has
      // already gone. Surfaced on every item so nobody discovers the policy by
      // losing something.
      expiresAt: g.expiresAt,
      daysLeft: daysUntil(g.expiresAt),
      mediaDeleted: Boolean(g.mediaDeletedAt),
      isPublic: g.isPublic,
      isFavorited: g.favorites.length > 0,
      favoritesCount: g._count.favorites,
      model: {
        name: g.model.name,
        // In-house models show our brand, not the rented hardware behind them.
        provider: publicProvider(g.model.provider).name,
        providerSlug: publicProvider(g.model.provider).slug,
      },
      createdAt: g.createdAt,
    })),
    total,
    pages: Math.ceil(total / limit),
    page,
  });
}
