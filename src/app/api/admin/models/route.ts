import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const models = await prisma.aiModel.findMany({
      include: {
        provider: {
          select: { name: true, slug: true },
        },
      },
      orderBy: [
        { provider: { name: 'asc' } },
        { sortOrder: 'asc' },
      ],
    });

    return NextResponse.json({ models });
  } catch (error) {
    console.error('Failed to list models:', error);
    return NextResponse.json(
      { error: 'Failed to list models' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();

    const model = await prisma.aiModel.create({
      data: {
        providerId: parseInt(body.providerId, 10),
        modelId: body.modelId,
        name: body.name,
        description: body.description ?? null,
        category: body.category,
        creditsPerUnit: parseInt(body.creditsPerUnit, 10),
        costPerUnit: body.costPerUnit,
        unitType: body.unitType ?? 'per_image',
        maxWidth: body.maxWidth ? parseInt(body.maxWidth, 10) : null,
        maxHeight: body.maxHeight ? parseInt(body.maxHeight, 10) : null,
      },
    });

    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    console.error('Failed to create model:', error);
    return NextResponse.json(
      { error: 'Failed to create model' },
      { status: 500 }
    );
  }
}
