import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { CreditService } from '@/lib/services/credits';
import { ReferralService } from '@/lib/services/referral';
import prisma from '@/lib/db';

/**
 * Webhook endpoint called by xmanstudio after successful credit package purchase
 * xmanstudio sends: userId, packageId, orderId, amount (credits)
 */
export async function POST(request: NextRequest) {
  // Verify webhook secret (constant-time comparison)
  const authHeader = request.headers.get('x-webhook-secret') || '';
  const webhookSecret = process.env.XMAN_WEBHOOK_SECRET || '';

  if (!webhookSecret || authHeader.length !== webhookSecret.length ||
      !timingSafeEqual(Buffer.from(authHeader), Buffer.from(webhookSecret))) {
    return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { userId, packageId, orderId, credits, bonusCredits } = body;

    if (!userId || !credits || typeof userId !== 'number' || typeof credits !== 'number') {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 });
    }

    // Idempotency check — prevent duplicate credit addition if webhook is retried
    if (orderId) {
      const existing = await prisma.aiCreditTransaction.findFirst({
        where: { xmanOrderId: orderId, type: 'purchase' },
      });
      if (existing) {
        return NextResponse.json({ success: true, message: 'Already processed', balance: null });
      }
    }

    // Add purchased credits
    const result = await CreditService.addCredits(
      userId,
      credits,
      packageId,
      orderId,
      `ซื้อเครดิต ${credits} จาก XMAN Studio`
    );

    // Add bonus credits if any
    if (bonusCredits && typeof bonusCredits === 'number' && bonusCredits > 0) {
      await CreditService.addBonus(
        userId,
        bonusCredits,
        `โบนัสเครดิต ${bonusCredits} จากการซื้อแพ็กเกจ`
      );
    }

    // Process referral commission — if this user was referred, credit the referrer
    if (result.transactionId) {
      try {
        const referralService = new ReferralService();
        await referralService.processCommission(result.transactionId);
      } catch (err) {
        // Don't fail the webhook if referral processing fails
        console.error('Referral commission error:', err);
      }
    }

    return NextResponse.json({ success: true, balance: result.balance });
  } catch (error) {
    console.error('Webhook credit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
