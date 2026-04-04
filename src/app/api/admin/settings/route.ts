import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Return flat array — frontend handles grouping
    const settings = await prisma.aiSetting.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Failed to list settings:', error);
    return NextResponse.json(
      { error: 'Failed to list settings' },
      { status: 500 }
    );
  }
}

// Save/update settings for a group
export async function POST(request: NextRequest) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();

    // Support: { group, settings: { key: value, ... } } from the frontend
    if (body.group && body.settings && !Array.isArray(body.settings)) {
      const entries = Object.entries(body.settings as Record<string, string | null>);
      const results = await Promise.all(
        entries.map(([key, value]) =>
          prisma.aiSetting.upsert({
            where: { key },
            update: { value: value ?? null },
            create: { key, value: value ?? null, group: body.group, type: 'string' },
          })
        )
      );
      return NextResponse.json({ updated: results.length });
    }

    // Support: { settings: [{key, value}] } array format
    if (Array.isArray(body.settings)) {
      const results = await Promise.all(
        body.settings.map((item: { key: string; value: string }) =>
          prisma.aiSetting.upsert({
            where: { key: item.key },
            update: { value: item.value },
            create: { key: item.key, value: item.value },
          })
        )
      );
      return NextResponse.json({ updated: results.length });
    }

    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Failed to update settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}

// Add a new setting
export async function PUT(request: NextRequest) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { key, value, type, group } = body;

    if (!key) {
      return NextResponse.json({ error: 'Key is required' }, { status: 400 });
    }

    const setting = await prisma.aiSetting.create({
      data: {
        key,
        value: value ?? null,
        type: type || 'string',
        group: group || 'general',
      },
    });

    return NextResponse.json({ setting });
  } catch (error) {
    console.error('Failed to create setting:', error);
    return NextResponse.json(
      { error: 'Failed to create setting' },
      { status: 500 }
    );
  }
}
