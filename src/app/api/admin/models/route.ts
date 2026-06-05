import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { prismaErrorResponse } from '@/lib/utils/admin';
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

    const body = await request.json().catch(() => ({}));

    const providerId = parseInt(body.providerId, 10);
    const creditsPerUnit = parseInt(body.creditsPerUnit, 10);
    if (!Number.isInteger(providerId) || providerId <= 0) {
      return NextResponse.json({ error: 'providerId ไม่ถูกต้อง' }, { status: 400 });
    }
    if (!body.modelId || !body.name || !body.category) {
      return NextResponse.json({ error: 'ต้องระบุ modelId, name และ category' }, { status: 400 });
    }
    if (!Number.isInteger(creditsPerUnit) || creditsPerUnit < 0) {
      return NextResponse.json({ error: 'creditsPerUnit ไม่ถูกต้อง' }, { status: 400 });
    }
    if (body.costPerUnit == null || isNaN(Number(body.costPerUnit))) {
      return NextResponse.json({ error: 'costPerUnit ไม่ถูกต้อง' }, { status: 400 });
    }

    const model = await prisma.aiModel.create({
      data: {
        providerId,
        modelId: body.modelId,
        name: body.name,
        description: body.description ?? null,
        category: body.category,
        subcategory: body.subcategory ?? null,
        creditsPerUnit,
        costPerUnit: body.costPerUnit,
        unitType: body.unitType ?? 'per_image',
        maxWidth: body.maxWidth ? parseInt(body.maxWidth, 10) : null,
        maxHeight: body.maxHeight ? parseInt(body.maxHeight, 10) : null,
        maxDuration: body.maxDuration ? parseInt(body.maxDuration, 10) : null,
      },
    });

    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to create model:', error);
    return NextResponse.json(
      { error: 'Failed to create model' },
      { status: 500 }
    );
  }
}
