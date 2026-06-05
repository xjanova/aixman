import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const styles = await prisma.aiStyle.findMany({ orderBy: { sortOrder: 'asc' } });
    return NextResponse.json({ styles });
  } catch (error) {
    console.error('Failed to list styles:', error);
    return NextResponse.json({ error: 'Failed to list styles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    if (!body.name || !body.slug) {
      return NextResponse.json({ error: 'ต้องระบุชื่อและ slug' }, { status: 400 });
    }

    const style = await prisma.aiStyle.create({
      data: {
        name: body.name,
        slug: body.slug,
        description: body.description ?? null,
        promptSuffix: body.promptSuffix ?? null,
        thumbnail: body.thumbnail ?? null,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ? parseInt(body.sortOrder, 10) : 0,
      },
    });

    return NextResponse.json({ style }, { status: 201 });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to create style:', error);
    return NextResponse.json({ error: 'Failed to create style' }, { status: 500 });
  }
}
