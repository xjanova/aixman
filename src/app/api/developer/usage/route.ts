import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { listModels } from '@/lib/llm/gateway';

export const dynamic = 'force-dynamic';

const DAYS = 30;

/** The caller's last 30 days of API use, per model, plus the price list. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const [byModel, recent, models, credit] = await Promise.all([
    prisma.aiApiUsage.groupBy({
      by: ['model'],
      where: { userId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, millicredits: true },
    }),
    prisma.aiApiUsage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, model: true, promptTokens: true, completionTokens: true, millicredits: true, status: true, latencyMs: true, createdAt: true },
    }),
    listModels(),
    prisma.aiUserCredit.findUnique({ where: { userId }, select: { balance: true } }),
  ]);
  return NextResponse.json({
    days: DAYS,
    balance: credit?.balance ?? 0,
    byModel: byModel.map((m) => ({
      model: m.model,
      requests: m._count._all,
      promptTokens: m._sum.promptTokens ?? 0,
      completionTokens: m._sum.completionTokens ?? 0,
      credits: (m._sum.millicredits ?? 0) / 1000,
    })),
    recent: recent.map((r) => ({ ...r, credits: r.millicredits / 1000 })),
    models,
  });
}
