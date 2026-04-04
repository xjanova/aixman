import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  const styles = await prisma.aiStyle.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ styles });
}
