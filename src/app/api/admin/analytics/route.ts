import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

interface DailyCount {
  date: string;
  count: bigint;
}

interface TopModel {
  model_id: number;
  name: string;
  count: bigint;
}

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [dailyGenerations, topModels, creditsSummary, revenueEstimate] =
      await Promise.all([
        // Last 7 days generation count per day
        prisma.$queryRawUnsafe<DailyCount[]>(
          `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM ai_generations
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
           GROUP BY DATE(created_at)
           ORDER BY date ASC`
        ),

        // Top 5 models by generation count
        prisma.$queryRawUnsafe<TopModel[]>(
          `SELECT g.model_id, m.name, COUNT(*) as count
           FROM ai_generations g
           JOIN ai_models m ON g.model_id = m.id
           GROUP BY g.model_id, m.name
           ORDER BY count DESC
           LIMIT 5`
        ),

        // Credits summary from ai_user_credits
        prisma.aiUserCredit.aggregate({
          _sum: {
            totalBought: true,
            totalUsed: true,
            totalBonus: true,
          },
        }),

        // Revenue estimate from credit transactions with type='purchase'
        prisma.$queryRawUnsafe<{ total: string | null }[]>(
          `SELECT SUM(cp.price_thb) as total
           FROM ai_credit_transactions ct
           JOIN ai_credit_packages cp ON ct.package_id = cp.id
           WHERE ct.type = 'purchase'`
        ),
      ]);

    // Convert BigInt values to numbers for JSON serialization
    const serializedDaily = dailyGenerations.map((row) => ({
      date: row.date,
      count: Number(row.count),
    }));

    const serializedTopModels = topModels.map((row) => ({
      modelId: Number(row.model_id),
      name: row.name,
      count: Number(row.count),
    }));

    return NextResponse.json({
      dailyGenerations: serializedDaily,
      topModels: serializedTopModels,
      creditsSummary: {
        totalBought: creditsSummary._sum.totalBought ?? 0,
        totalUsed: creditsSummary._sum.totalUsed ?? 0,
        totalBonus: creditsSummary._sum.totalBonus ?? 0,
      },
      revenueEstimate: parseFloat(revenueEstimate[0]?.total ?? '0'),
    });
  } catch (error) {
    console.error('Failed to fetch analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
