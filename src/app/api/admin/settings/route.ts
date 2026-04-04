import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const settings = await prisma.aiSetting.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    // Group settings by their group field
    const grouped: Record<string, typeof settings> = {};
    for (const setting of settings) {
      if (!grouped[setting.group]) {
        grouped[setting.group] = [];
      }
      grouped[setting.group].push(setting);
    }

    return NextResponse.json({ settings: grouped });
  } catch (error) {
    console.error('Failed to list settings:', error);
    return NextResponse.json(
      { error: 'Failed to list settings' },
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
    const items: { key: string; value: string }[] = body.settings;

    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: 'settings must be an array of {key, value}' },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      items.map((item) =>
        prisma.aiSetting.upsert({
          where: { key: item.key },
          update: { value: item.value },
          create: { key: item.key, value: item.value },
        })
      )
    );

    return NextResponse.json({ updated: results.length });
  } catch (error) {
    console.error('Failed to update settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
