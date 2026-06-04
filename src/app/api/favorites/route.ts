import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const favorites = await prisma.aiFavorite.findMany({
    where: { userId },
    select: { generationId: true },
  });

  return NextResponse.json({
    favoriteIds: favorites.map((f) => f.generationId),
  });
}

function parseGenerationId(raw: unknown): number | null {
  const id = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const generationId = parseGenerationId(body.generationId);
  if (!generationId) {
    return NextResponse.json({ error: 'Valid generationId required' }, { status: 400 });
  }

  // Ownership check — a user may only favorite their own generation.
  const generation = await prisma.aiGeneration.findFirst({
    where: { id: generationId, userId },
    select: { id: true },
  });
  if (!generation) {
    return NextResponse.json({ error: 'Generation not found' }, { status: 404 });
  }

  try {
    await prisma.aiFavorite.create({
      data: { userId, generationId },
    });
  } catch (error) {
    // P2002 = unique constraint (already favorited) — treat as success (idempotent).
    if ((error as { code?: string }).code !== 'P2002') {
      console.error('Favorite create error:', error);
      return NextResponse.json({ error: 'Failed to add favorite' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const generationId = parseGenerationId(body.generationId);
  if (!generationId) {
    return NextResponse.json({ error: 'Valid generationId required' }, { status: 400 });
  }

  await prisma.aiFavorite.deleteMany({
    where: { userId, generationId },
  });

  return NextResponse.json({ success: true });
}
