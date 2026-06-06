import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import type { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/db';

const TYPES = ['purchase', 'usage', 'refund', 'bonus', 'admin_adjust'];

/** Admin credit-transaction audit log across all users. */
export async function GET(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '30', 10) || 30));
    const type = sp.get('type');
    const userId = parseInt(sp.get('userId') || '', 10);

    const where: Prisma.AiCreditTransactionWhereInput = {};
    if (type && TYPES.includes(type)) where.type = type;
    if (Number.isInteger(userId) && userId > 0) where.userId = userId;

    const [data, total, totals] = await Promise.all([
      prisma.aiCreditTransaction.findMany({
        where,
        select: {
          id: true, userId: true, type: true, amount: true, balanceAfter: true,
          description: true, createdAt: true,
          user: { select: { name: true, email: true } },
          package: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiCreditTransaction.count({ where }),
      prisma.aiCreditTransaction.groupBy({ by: ['type'], _sum: { amount: true } }),
    ]);

    return NextResponse.json({
      data,
      total,
      pages: Math.ceil(total / limit),
      page,
      summary: totals.map((t) => ({ type: t.type, amount: t._sum.amount || 0 })),
    });
  } catch (error) {
    console.error('Failed to list transactions:', error);
    return NextResponse.json({ error: 'Failed to list transactions' }, { status: 500 });
  }
}
