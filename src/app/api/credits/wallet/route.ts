import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { WalletService } from '@/lib/services/wallet';
import { CreditService } from '@/lib/services/credits';

/**
 * GET /api/credits/wallet
 * Returns the current user's shared wallet balance + AI credit balance, used by
 * the pricing page to offer "buy with wallet".
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ loggedIn: false, wallet: null, credits: 0 }, { status: 401 });
  }

  const [wallet, credits] = await Promise.all([
    WalletService.getWallet(userId),
    CreditService.getUserCredits(userId),
  ]);

  return NextResponse.json({
    loggedIn: true,
    wallet: wallet ? { balance: Number(wallet.balance), isActive: wallet.isActive } : null,
    credits: credits.balance,
  });
}
