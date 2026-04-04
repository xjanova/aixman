import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalGenerations,
    generationsToday,
    totalCreditsUsed,
    activeUsers,
    activeAccounts,
    errorLogs,
  ] = await Promise.all([
    prisma.aiGeneration.count(),
    prisma.aiGeneration.count({ where: { createdAt: { gte: today } } }),
    prisma.aiCreditTransaction.aggregate({
      _sum: { amount: true },
      where: { type: 'usage' },
    }),
    prisma.aiUserCredit.count({ where: { balance: { gt: 0 } } }),
    prisma.aiAccountPool.count({ where: { isActive: true } }),
    prisma.aiUsageLog.count({ where: { status: 'error', createdAt: { gte: today } } }),
  ]);

  const totalLogsToday = await prisma.aiUsageLog.count({ where: { createdAt: { gte: today } } });

  return NextResponse.json({
    totalGenerations,
    generationsToday,
    totalCreditsUsed: Math.abs(totalCreditsUsed._sum.amount || 0),
    activeUsers,
    totalRevenue: 0, // TODO: Calculate from ai_credit_transactions with type=purchase
    revenueToday: 0,
    providerCosts: 0, // TODO: Sum from ai_usage_logs
    activeAccounts,
    errorRate: totalLogsToday > 0 ? Math.round((errorLogs / totalLogsToday) * 100) : 0,
  });
}
