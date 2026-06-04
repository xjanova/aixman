import prisma from '@/lib/db';

/**
 * Credit Service
 * Manages user AI credits — separate from xmanstudio wallet
 * Users can top-up credits using their xmanstudio wallet
 */
export class CreditService {
  /**
   * Get or create user credit record.
   * On first creation, grant the configured signup free credits
   * (ai_settings `new_user_free_credits`) — the platform advertises a free tier.
   */
  static async getUserCredits(userId: number) {
    const existing = await prisma.aiUserCredit.findUnique({ where: { userId } });
    if (existing) return existing;

    const setting = await prisma.aiSetting.findUnique({ where: { key: 'new_user_free_credits' } });
    const freeCredits = Math.max(0, parseInt(setting?.value || '0', 10) || 0);

    try {
      const created = await prisma.aiUserCredit.create({
        data: { userId, balance: freeCredits, totalBonus: freeCredits },
      });
      if (freeCredits > 0) {
        await prisma.aiCreditTransaction.create({
          data: {
            userId,
            type: 'bonus',
            amount: freeCredits,
            balanceAfter: freeCredits,
            description: 'เครดิตฟรีต้อนรับสมาชิกใหม่',
          },
        });
      }
      return created;
    } catch (error) {
      // Race: another concurrent request created the row first.
      if ((error as { code?: string }).code === 'P2002') {
        const row = await prisma.aiUserCredit.findUnique({ where: { userId } });
        if (row) return row;
      }
      throw error;
    }
  }

  /**
   * Add credits after purchase (called from xmanstudio webhook)
   */
  static async addCredits(
    userId: number,
    amount: number,
    packageId?: number,
    xmanOrderId?: number,
    description?: string
  ) {
    await this.getUserCredits(userId); // ensure the row exists

    const { transaction, balance } = await prisma.$transaction(async (tx) => {
      const updated = await tx.aiUserCredit.update({
        where: { userId },
        data: {
          balance: { increment: amount },
          totalBought: { increment: amount },
        },
      });

      const txn = await tx.aiCreditTransaction.create({
        data: {
          userId,
          type: 'purchase',
          amount,
          balanceAfter: updated.balance,
          description: description || `Purchased ${amount} credits`,
          packageId,
          xmanOrderId,
        },
      });

      return { transaction: txn, balance: updated.balance };
    });

    return { balance, transactionId: transaction.id };
  }

  /**
   * Add bonus credits
   */
  static async addBonus(userId: number, amount: number, description: string) {
    await this.getUserCredits(userId); // ensure the row exists

    const balance = await prisma.$transaction(async (tx) => {
      const updated = await tx.aiUserCredit.update({
        where: { userId },
        data: {
          balance: { increment: amount },
          totalBonus: { increment: amount },
        },
      });
      await tx.aiCreditTransaction.create({
        data: {
          userId,
          type: 'bonus',
          amount,
          balanceAfter: updated.balance,
          description,
        },
      });
      return updated.balance;
    });

    return { balance };
  }

  /**
   * Admin adjust credits
   */
  static async adminAdjust(userId: number, amount: number, description: string) {
    await this.getUserCredits(userId); // ensure the row exists

    const balance = await prisma.$transaction(async (tx) => {
      const updated = await tx.aiUserCredit.update({
        where: { userId },
        data: {
          balance: { increment: amount },
        },
      });
      await tx.aiCreditTransaction.create({
        data: {
          userId,
          type: 'admin_adjust',
          amount,
          balanceAfter: updated.balance,
          description,
        },
      });
      return updated.balance;
    });

    return { balance };
  }

  /**
   * Get transaction history
   */
  static async getTransactions(userId: number, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      prisma.aiCreditTransaction.findMany({
        where: { userId },
        include: { package: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.aiCreditTransaction.count({ where: { userId } }),
    ]);

    return { data: transactions, total, pages: Math.ceil(total / limit), page };
  }

  /**
   * Get all active credit packages
   */
  static async getPackages() {
    return prisma.aiCreditPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
