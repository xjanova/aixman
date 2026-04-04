import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const providers = await prisma.aiProvider.findMany({
      include: {
        _count: {
          select: {
            accounts: true,
            models: true,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ providers });
  } catch (error) {
    console.error('Failed to list providers:', error);
    return NextResponse.json(
      { error: 'Failed to list providers' },
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

    const provider = await prisma.aiProvider.create({
      data: {
        name: body.name,
        slug: body.slug,
        description: body.description ?? null,
        baseUrl: body.baseUrl ?? null,
        authType: body.authType ?? 'bearer',
        supportsImage: body.supportsImage ?? false,
        supportsVideo: body.supportsVideo ?? false,
        supportsEdit: body.supportsEdit ?? false,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    return NextResponse.json({ provider }, { status: 201 });
  } catch (error) {
    console.error('Failed to create provider:', error);
    return NextResponse.json(
      { error: 'Failed to create provider' },
      { status: 500 }
    );
  }
}
