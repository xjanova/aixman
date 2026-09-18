import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { pricingBasis } from '@/lib/services/gpu-stats';

/**
 * Numbers behind /admin/analytics.
 *
 * The shape here is the page's contract. It drifted once already — the route
 * answered `creditsSummary` + `revenueEstimate` while the page read
 * `creditSummary` and `topModels[].creditsUsed`, and the missing field threw
 * inside the render, so a working API produced a blank "เกิดข้อผิดพลาด" page.
 * Both sides now name the same things, and the page defaults every field it
 * reads so the next mismatch degrades a number instead of the whole screen.
 */

interface DailyCount {
  date: string;
  count: bigint;
}

interface TopModelRow {
  model_id: number;
  name: string;
  count: bigint;
  credits_used: bigint | null;
}

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [dailyGenerations, topModels, creditTotals, revenueRows, costRows, packages] =
      await Promise.all([
        // Last 7 days generation count per day
        prisma.$queryRawUnsafe<DailyCount[]>(
          `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM ai_generations
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
           GROUP BY DATE(created_at)
           ORDER BY date ASC`
        ),

        // Top 5 models by generation count, with the credits they earned —
        // a model that runs often and one that earns is not the same model.
        prisma.$queryRawUnsafe<TopModelRow[]>(
          `SELECT g.model_id, m.name, COUNT(*) as count, SUM(g.credits_used) as credits_used
           FROM ai_generations g
           JOIN ai_models m ON g.model_id = m.id
           GROUP BY g.model_id, m.name
           ORDER BY count DESC
           LIMIT 5`
        ),

        prisma.aiUserCredit.aggregate({
          _sum: { totalBought: true, totalUsed: true, totalBonus: true },
        }),

        // Revenue estimate from credit transactions with type='purchase'
        prisma.$queryRawUnsafe<{ total: string | null }[]>(
          `SELECT SUM(cp.price_thb) as total
           FROM ai_credit_transactions ct
           JOIN ai_credit_packages cp ON ct.package_id = cp.id
           WHERE ct.type = 'purchase'`
        ),

        // What those generations cost us, in USD. Every provider writes it to
        // the generation row, so one sum covers rented GPUs and paid APIs alike.
        prisma.$queryRawUnsafe<{ total: string | null }[]>(
          `SELECT SUM(cost_usd) as total FROM ai_generations WHERE status = 'completed'`
        ),

        prisma.aiCreditPackage.findMany({
          where: { isActive: true },
          select: { credits: true, bonusCredits: true, priceThb: true, priceUsd: true },
        }),
      ]);

    const revenue = parseFloat(revenueRows[0]?.total ?? '0') || 0;
    const cost = parseFloat(costRows[0]?.total ?? '0') || 0;
    // The same blended rate the GPU dashboard prices with, rather than a second
    // constant that can disagree with it.
    const { usdToThb } = pricingBasis(packages);

    const creditSummary = {
      totalPurchased: creditTotals._sum.totalBought ?? 0,
      totalUsed: creditTotals._sum.totalUsed ?? 0,
      totalBonus: creditTotals._sum.totalBonus ?? 0,
      revenue,
      cost,
      profit: revenue - cost * usdToThb,
      usdToThb,
    };

    return NextResponse.json({
      dailyGenerations: dailyGenerations.map((row) => ({
        date: row.date,
        count: Number(row.count),
      })),
      topModels: topModels.map((row) => ({
        modelId: Number(row.model_id),
        name: row.name,
        count: Number(row.count),
        creditsUsed: Number(row.credits_used ?? 0),
      })),
      creditSummary,
    });
  } catch (error) {
    console.error('Failed to fetch analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
