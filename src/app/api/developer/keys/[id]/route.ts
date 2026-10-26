import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { parseLimit } from '@/lib/llm/key-limits';

export const dynamic = 'force-dynamic';

/** Revoke one of the caller's own keys. It stops working at once. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'ไม่พบคีย์' }, { status: 404 });
  const { count } = await prisma.aiApiKey.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) return NextResponse.json({ error: 'ไม่พบคีย์' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Rename a key or set its caps (credits per Bangkok day / month; empty = none). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'ไม่พบคีย์' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { name?: string; dailyLimitCredits?: number | null; monthlyLimitCredits?: number | null } = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 100);
  if ('dailyLimitCredits' in body) data.dailyLimitCredits = parseLimit(body.dailyLimitCredits);
  if ('monthlyLimitCredits' in body) data.monthlyLimitCredits = parseLimit(body.monthlyLimitCredits);
  const { count } = await prisma.aiApiKey.updateMany({ where: { id, userId, revokedAt: null }, data });
  if (count === 0) return NextResponse.json({ error: 'ไม่พบคีย์' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
