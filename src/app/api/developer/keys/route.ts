import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { generateApiKey } from '@/lib/llm/keys';

export const dynamic = 'force-dynamic';

/** A customer may hold this many live keys. */
const MAX_KEYS = 10;

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const keys = await prisma.aiApiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
  });
  return NextResponse.json({ keys });
}

/** Make a key. The key itself is in this response only. */
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : 'API key';
  const live = await prisma.aiApiKey.count({ where: { userId, revokedAt: null } });
  if (live >= MAX_KEYS) {
    return NextResponse.json({ error: `มีคีย์ได้สูงสุด ${MAX_KEYS} อัน — ลบอันที่ไม่ใช้ก่อน` }, { status: 400 });
  }
  const { key, prefix, hash } = generateApiKey();
  const row = await prisma.aiApiKey.create({
    data: { userId, name, keyPrefix: prefix, keyHash: hash },
    select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
  });
  return NextResponse.json({ key: row, secret: key }, { status: 201 });
}
