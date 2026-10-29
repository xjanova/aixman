import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { generateApiKey } from '@/lib/llm/keys';
import { spentByKey } from '@/lib/llm/key-limits';
import { requestLocale, translator } from '@/lib/i18n/locale';

export const dynamic = 'force-dynamic';

/** What a customer sees of their keys; the hash never leaves the server. */
const KEY_FIELDS = {
  id: true,
  name: true,
  keyPrefix: true,
  lastUsedAt: true,
  createdAt: true,
  dailyLimitCredits: true,
  monthlyLimitCredits: true,
} as const;

/** A customer may hold this many live keys. */
const MAX_KEYS = 10;

export async function GET(request: NextRequest) {
  const t = translator(requestLocale(request));
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: t('กรุณาเข้าสู่ระบบ', 'Please sign in') }, { status: 401 });
  const keys = await prisma.aiApiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: KEY_FIELDS,
  });
  const now = Date.now();
  const spent = await Promise.all(keys.map((k) => spentByKey(k.id, now)));
  return NextResponse.json({ keys: keys.map((k, i) => ({ ...k, spentToday: spent[i].day, spentThisMonth: spent[i].month })) });
}

/** Make a key. The key itself is in this response only. */
export async function POST(request: NextRequest) {
  const t = translator(requestLocale(request));
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: t('กรุณาเข้าสู่ระบบ', 'Please sign in') }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : 'API key';
  const live = await prisma.aiApiKey.count({ where: { userId, revokedAt: null } });
  if (live >= MAX_KEYS) {
    return NextResponse.json(
      { error: t(`มีคีย์ได้สูงสุด ${MAX_KEYS} อัน — ลบอันที่ไม่ใช้ก่อน`, `You can have up to ${MAX_KEYS} keys — delete one you no longer use first.`) },
      { status: 400 }
    );
  }
  const { key, prefix, hash } = generateApiKey();
  const row = await prisma.aiApiKey.create({
    data: { userId, name, keyPrefix: prefix, keyHash: hash },
    select: KEY_FIELDS,
  });
  return NextResponse.json({ key: row, secret: key }, { status: 201 });
}
