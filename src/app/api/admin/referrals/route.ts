import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

/** Admin referral oversight — successful referrals + commission payouts. */
export async function GET(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(sp.get('limit') || '20', 10) || 20));

    // Only "used" referral links (an actual referred user) are meaningful here.
    const where = { referredId: { not: null }, status: 'used' };

    const [referrals, totalReferred, commissionAgg, bonusAgg] = await Promise.all([
      prisma.aiReferral.findMany({
        where,
        select: {
          id: true, referralCode: true, bonusCredits: true, createdAt: true,
          referrer: { select: { id: true, name: true, email: true } },
          referred: { select: { id: true, name: true, email: true } },
          commissions: { select: { creditAmount: true, status: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiReferral.count({ where }),
      prisma.aiReferralCommission.aggregate({ _sum: { creditAmount: true } }),
      prisma.aiReferral.aggregate({ _sum: { bonusCredits: true }, where }),
    ]);

    const data = referrals.map((r) => ({
      id: r.id,
      code: r.referralCode,
      bonusCredits: r.bonusCredits,
      joinedAt: r.createdAt,
      referrer: r.referrer,
      referred: r.referred,
      commissionTotal: r.commissions.reduce((s, c) => s + c.creditAmount, 0),
      commissionCount: r.commissions.length,
    }));

    return NextResponse.json({
      data,
      total: totalReferred,
      pages: Math.ceil(totalReferred / limit),
      page,
      summary: {
        totalReferred,
        totalCommissionCredits: commissionAgg._sum.creditAmount || 0,
        totalSignupBonusCredits: bonusAgg._sum.bonusCredits || 0,
      },
    });
  } catch (error) {
    console.error('Failed to list referrals:', error);
    return NextResponse.json({ error: 'Failed to list referrals' }, { status: 500 });
  }
}
