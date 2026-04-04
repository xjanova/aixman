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

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { generationId } = await request.json();
  if (!generationId) {
    return NextResponse.json(
      { error: 'generationId required' },
      { status: 400 }
    );
  }

  try {
    await prisma.aiFavorite.create({
      data: { userId, generationId },
    });
    return NextResponse.json({ success: true });
  } catch {
    // Already favorited (unique constraint violation)
    return NextResponse.json({ success: true });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { generationId } = await request.json();
  if (!generationId) {
    return NextResponse.json(
      { error: 'generationId required' },
      { status: 400 }
    );
  }

  await prisma.aiFavorite.deleteMany({
    where: { userId, generationId },
  });

  return NextResponse.json({ success: true });
}
