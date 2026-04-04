import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const generationId = parseInt(id, 10);
  if (isNaN(generationId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const generation = await prisma.aiGeneration.findFirst({
    where: { id: generationId, userId },
    include: {
      model: {
        include: { provider: { select: { name: true, slug: true } } },
      },
    },
  });

  if (!generation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: generation.id,
    status: generation.status,
    type: generation.type,
    resultUrl: generation.resultUrl,
    resultUrls: generation.resultUrls,
    thumbnailUrl: generation.thumbnailUrl,
    creditsUsed: generation.creditsUsed,
    processingMs: generation.processingMs,
    errorMessage: generation.errorMessage,
    prompt: generation.prompt,
    model: {
      name: generation.model.name,
      provider: generation.model.provider.name,
    },
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
  });
}
