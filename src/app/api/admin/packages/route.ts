import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const packages = await prisma.aiCreditPackage.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ packages });
  } catch (error) {
    console.error('Failed to list packages:', error);
    return NextResponse.json(
      { error: 'Failed to list packages' },
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

    const pkg = await prisma.aiCreditPackage.create({
      data: {
        name: body.name,
        slug: body.slug,
        credits: parseInt(body.credits, 10),
        priceThb: body.priceThb,
        priceUsd: body.priceUsd,
        bonusCredits: body.bonusCredits ? parseInt(body.bonusCredits, 10) : 0,
        badge: body.badge ?? null,
        features: body.features ?? null,
        sortOrder: body.sortOrder ? parseInt(body.sortOrder, 10) : 0,
      },
    });

    return NextResponse.json({ package: pkg }, { status: 201 });
  } catch (error) {
    console.error('Failed to create package:', error);
    return NextResponse.json(
      { error: 'Failed to create package' },
      { status: 500 }
    );
  }
}
