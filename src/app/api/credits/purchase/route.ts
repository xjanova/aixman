import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { WalletService } from '@/lib/services/wallet';
import { ReferralService } from '@/lib/services/referral';
import { requestLocale, translator } from '@/lib/i18n/locale';

/**
 * POST /api/credits/purchase
 * Buy an AI credit package using the user's shared xmanstudio wallet balance.
 * The deduction happens here and is written back to the shared wallet tables.
 *
 * Body: { packageSlug: string, idempotencyKey: string }
 */
export async function POST(request: NextRequest) {
  const t = translator(requestLocale(request));
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const packageSlug = typeof body.packageSlug === 'string' ? body.packageSlug.trim() : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';

    if (!packageSlug) {
      return NextResponse.json({ error: 'packageSlug is required' }, { status: 400 });
    }
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });
    }

    const result = await WalletService.purchasePackageWithWallet(userId, packageSlug, idempotencyKey);

    if (result.duplicate) {
      return NextResponse.json({ success: true, duplicate: true, message: t('รายการนี้ถูกดำเนินการแล้ว', 'This purchase has already gone through.') });
    }

    // Referral commission — credit the referrer if this buyer was referred
    if (result.transactionId) {
      try {
        await new ReferralService().processCommission(result.transactionId);
      } catch (err) {
        console.error('Referral commission error:', err);
      }
    }

    return NextResponse.json({
      success: true,
      walletBalance: result.walletBalance,
      credits: result.credits,
    });
  } catch (error) {
    const message = (error as Error).message;

    switch (message) {
      case 'PACKAGE_NOT_FOUND':
        return NextResponse.json({ error: t('ไม่พบแพ็กเกจนี้ หรือไม่สามารถซื้อด้วยกระเป๋าเงินได้', "This package wasn't found or can't be bought with Wallet.") }, { status: 404 });
      case 'NO_WALLET':
        return NextResponse.json({ error: t('คุณยังไม่มีกระเป๋าเงิน กรุณาเติมเงินที่ XMAN Studio ก่อน', "You don't have a Wallet yet. Please top up at XMAN Studio first.") }, { status: 400 });
      case 'WALLET_INACTIVE':
        return NextResponse.json({ error: t('กระเป๋าเงินถูกระงับการใช้งาน', 'Your Wallet is suspended.') }, { status: 403 });
      case 'INSUFFICIENT_WALLET':
        return NextResponse.json({ error: t('ยอดเงินในกระเป๋าไม่เพียงพอ กรุณาเติมเงินที่ XMAN Studio', 'Your Wallet balance is too low. Please top up at XMAN Studio.') }, { status: 402 });
      default:
        console.error('Wallet purchase error:', error);
        return NextResponse.json({ error: t('ไม่สามารถดำเนินการได้ กรุณาลองใหม่', "We couldn't complete the purchase. Please try again.") }, { status: 500 });
    }
  }
}
