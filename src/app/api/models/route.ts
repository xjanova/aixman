import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  const models = await prisma.aiModel.findMany({
    where: { isActive: true },
    include: { provider: { select: { name: true, slug: true, logo: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json({ models });
}
