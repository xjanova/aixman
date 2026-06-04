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

  // Revenue (THB) — sum the price of the package behind each purchase transaction.
  const [purchaseTxns, purchaseTxnsToday, costAll, costToday] = await Promise.all([
    prisma.aiCreditTransaction.findMany({
      where: { type: 'purchase', packageId: { not: null } },
      select: { package: { select: { priceThb: true } } },
    }),
    prisma.aiCreditTransaction.findMany({
      where: { type: 'purchase', packageId: { not: null }, createdAt: { gte: today } },
      select: { package: { select: { priceThb: true } } },
    }),
    prisma.aiUsageLog.aggregate({ _sum: { costUsd: true } }),
    prisma.aiUsageLog.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: today } } }),
  ]);

  const sumPrice = (rows: { package: { priceThb: unknown } | null }[]) =>
    rows.reduce((sum, r) => sum + Number(r.package?.priceThb || 0), 0);

  return NextResponse.json({
    totalGenerations,
    generationsToday,
    totalCreditsUsed: Math.abs(totalCreditsUsed._sum.amount || 0),
    activeUsers,
    totalRevenue: Math.round(sumPrice(purchaseTxns)),
    revenueToday: Math.round(sumPrice(purchaseTxnsToday)),
    providerCosts: Number(costAll._sum.costUsd || 0),
    providerCostsToday: Number(costToday._sum.costUsd || 0),
    activeAccounts,
    errorRate: totalLogsToday > 0 ? Math.round((errorLogs / totalLogsToday) * 100) : 0,
  });
}
