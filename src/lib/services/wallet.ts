import { createHash } from 'crypto';
import prisma from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { CreditService } from './credits';

/**
 * Wallet Service
 *
 * The `wallets` / `wallet_transactions` tables are owned by xmanstudio (Laravel).
 * Top-up happens on xmanstudio; here a user SPENDS their shared wallet balance to
 * buy AI credits. The deduction happens on this site and is written back to the
 * shared tables so xmanstudio sees the updated balance + history.
 *
 * Safety:
 *  - Balance is debited with a conditional atomic UPDATE (WHERE balance >= ?) so it
 *    can never overdraw and never races with Laravel's own decrement.
 *  - The wallet_transactions row mirrors Laravel's Wallet::pay() format exactly
 *    (type=payment, negative amount, balance_before/after, status=completed, TXN id).
 *  - Idempotency: transaction_id is derived deterministically from the client's
 *    idempotencyKey, and that column is UNIQUE — a retried/duplicate purchase hits
 *    the unique constraint and the whole transaction rolls back (no double charge).
 *  - Wallet debit + credit grant share ONE interactive transaction, so a user can
 *    never lose wallet money without receiving credits (or vice-versa).
 */
export class WalletService {
  static async getWallet(userId: number) {
    return prisma.wallet.findUnique({ where: { userId } });
  }

  /** Deterministic, <=50 char, unique-per-(user,package,key) wallet transaction id. */
  private static deriveTxnId(seed: string): string {
    const hash = createHash('sha256').update(seed).digest('hex').slice(0, 24).toUpperCase();
    return `AIX${hash}`; // 'AIX' + 24 hex = 27 chars (fits varchar(50), Laravel-compatible prefix style)
  }

  /**
   * Buy a credit package using the user's wallet balance.
   * @returns { duplicate?, walletBalance, credits, transactionId } — walletBalance/credits are numbers.
   * @throws Error('PACKAGE_NOT_FOUND' | 'NO_WALLET' | 'WALLET_INACTIVE' | 'INSUFFICIENT_WALLET')
   */
  static async purchasePackageWithWallet(userId: number, packageSlug: string, idempotencyKey: string) {
    const pkg = await prisma.aiCreditPackage.findUnique({ where: { slug: packageSlug } });
    if (!pkg || !pkg.isActive) throw new Error('PACKAGE_NOT_FOUND');

    const price = Number(pkg.priceThb);
    if (!(price > 0)) throw new Error('PACKAGE_NOT_FOUND'); // free packages aren't bought with wallet

    const txnId = this.deriveTxnId(`${userId}:${packageSlug}:${idempotencyKey}`);

    try {
      const out = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new Error('NO_WALLET');
        if (!wallet.isActive) throw new Error('WALLET_INACTIVE');

        // Atomic, race-safe debit. Mirrors Laravel: decrement balance + increment total_spent.
        const rows = await tx.$executeRawUnsafe(
          'UPDATE wallets SET balance = balance - ?, total_spent = total_spent + ?, updated_at = NOW() WHERE user_id = ? AND is_active = 1 AND balance >= ?',
          price, price, userId, price
        );
        if (rows === 0) throw new Error('INSUFFICIENT_WALLET');

        // Re-read for the exact post-debit balance (own-write visible inside tx).
        const after = await tx.wallet.findUnique({ where: { userId }, select: { balance: true } });
        const balanceAfter = after!.balance; // Prisma.Decimal
        const balanceBefore = balanceAfter.add(price);

        // Write the wallet payment row in xmanstudio's format. Unique txnId = idempotency guard.
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId,
            transactionId: txnId,
            type: 'payment',
            amount: new Prisma.Decimal(price).negated(),
            balanceBefore,
            balanceAfter,
            referenceType: 'ai_credit_purchase',
            description: `ซื้อเครดิต AI · ${pkg.name} (${pkg.credits} เครดิต)`,
            status: 'completed',
            metadata: {
              source: 'aixman',
              packageSlug,
              credits: pkg.credits,
              bonusCredits: pkg.bonusCredits,
            },
          },
        });

        // Grant the AI credits (+ bonus) in the SAME transaction.
        const grant = await CreditService.grantWithinTx(tx, userId, pkg.credits, {
          type: 'purchase',
          bonus: pkg.bonusCredits,
          packageId: pkg.id,
          description: `ซื้อเครดิต ${pkg.credits} จากกระเป๋า Wallet (${pkg.name})`,
          bonusDescription: `โบนัส ${pkg.bonusCredits} เครดิต`,
        });

        return {
          walletBalance: Number(balanceAfter),
          credits: grant.balance,
          transactionId: grant.transactionId,
        };
      });

      return { duplicate: false as const, ...out };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Duplicate purchase (same idempotencyKey) — already processed, nothing charged twice.
        return { duplicate: true as const };
      }
      throw error;
    }
  }
}
