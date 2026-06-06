import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const templates = await prisma.aiTemplate.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
    });
    return NextResponse.json({ templates });
  } catch (error) {
    console.error('Failed to list templates:', error);
    return NextResponse.json({ error: 'Failed to list templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    if (!body.name || !body.category || !body.prompt) {
      return NextResponse.json({ error: 'ต้องระบุชื่อ หมวดหมู่ และ prompt' }, { status: 400 });
    }

    const template = await prisma.aiTemplate.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        category: body.category,
        prompt: body.prompt,
        negativePrompt: body.negativePrompt ?? null,
        thumbnail: body.thumbnail ?? null,
        isActive: body.isActive ?? true,
        isFeatured: body.isFeatured ?? false,
        sortOrder: body.sortOrder ? parseInt(body.sortOrder, 10) : 0,
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to create template:', error);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}
