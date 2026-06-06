import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

/** Public: active prompt templates for the studio quick-pick. */
export async function GET() {
  const templates = await prisma.aiTemplate.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, description: true, category: true,
      prompt: true, negativePrompt: true, thumbnail: true, isFeatured: true,
    },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
  });

  return NextResponse.json({ templates });
}
