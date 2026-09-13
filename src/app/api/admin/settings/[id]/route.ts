import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { settingWriteBlock } from '@/lib/settings-catalog';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const settingId = parseInt(id, 10);

    if (isNaN(settingId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    // Deleting a secret switches its feature off, and deleting a managed or
    // system value silently resets it to a default — both belong to the page
    // that owns the setting, not to a generic row delete.
    const row = await prisma.aiSetting.findUnique({ where: { id: settingId }, select: { key: true, type: true } });
    if (!row) return NextResponse.json({ error: 'ไม่พบการตั้งค่านี้' }, { status: 404 });
    const block = settingWriteBlock(row.key, row.type);
    if (block) return NextResponse.json({ error: `${row.key}: ${block}` }, { status: 400 });

    await prisma.aiSetting.delete({ where: { id: settingId } });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Failed to delete setting:', error);
    return NextResponse.json(
      { error: 'Failed to delete setting' },
      { status: 500 }
    );
  }
}
