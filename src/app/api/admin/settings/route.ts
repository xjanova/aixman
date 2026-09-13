import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { settingMeta, settingWriteBlock, validateSettingValue } from '@/lib/settings-catalog';

/**
 * Generic editor for `ai_settings`, behind the admin Settings page.
 *
 * It must not become a way around the pages that own a setting: an encrypted
 * value (the Telegram bot token) is never sent to the browser and cannot be
 * overwritten with plaintext here, values the system writes itself are
 * read-only, and the GPU caps go through /admin/gpu, which enforces their
 * bounds. See settings-catalog.ts.
 */

function redact<T extends { key: string; type: string; value: string | null }>(row: T): T & { redacted?: boolean } {
  const secret = row.type === 'encrypted' || settingMeta(row.key)?.secret;
  return secret ? { ...row, value: null, redacted: true } : row;
}

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Return flat array — frontend handles grouping
    const settings = await prisma.aiSetting.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    return NextResponse.json({ settings: settings.map(redact) });
  } catch (error) {
    console.error('Failed to list settings:', error);
    return NextResponse.json(
      { error: 'Failed to list settings' },
      { status: 500 }
    );
  }
}

/** The `type` column for a new row of a catalogued key ('text' is stored as 'string'). */
function storedType(key: string): string {
  const input = settingMeta(key)?.input;
  return !input || input === 'text' ? 'string' : input;
}

/** The first reason any of these writes is refused, or null. */
async function refuseWrites(entries: [string, string | null][]): Promise<string | null> {
  const rows = await prisma.aiSetting.findMany({
    where: { key: { in: entries.map(([k]) => k) } },
    select: { key: true, type: true },
  });
  const typeOf = new Map(rows.map((r) => [r.key, r.type]));
  for (const [key, value] of entries) {
    const block = settingWriteBlock(key, typeOf.get(key));
    if (block) return `${key}: ${block}`;
    const invalid = validateSettingValue(key, value);
    if (invalid) return invalid;
  }
  return null;
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
      const refused = await refuseWrites(entries);
      if (refused) return NextResponse.json({ error: refused }, { status: 400 });
      const results = await Promise.all(
        entries.map(([key, value]) =>
          prisma.aiSetting.upsert({
            where: { key },
            update: { value: value ?? null },
            create: { key, value: value ?? null, group: body.group, type: storedType(key) },
          })
        )
      );
      return NextResponse.json({ updated: results.length });
    }

    // Support: { settings: [{key, value}] } array format
    if (Array.isArray(body.settings)) {
      const items = body.settings as { key: string; value: string }[];
      const refused = await refuseWrites(items.map((i) => [i.key, i.value]));
      if (refused) return NextResponse.json({ error: refused }, { status: 400 });
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
    // A known key is created by its own feature, not typed in here — and an
    // "encrypted" type must never be given a plaintext value.
    const block = settingWriteBlock(key, type) ?? (type === 'encrypted' ? 'ค่าแบบเข้ารหัสสร้างจากหน้านี้ไม่ได้' : null);
    if (block) return NextResponse.json({ error: `${key}: ${block}` }, { status: 400 });
    const invalid = validateSettingValue(key, value ?? null);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

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
