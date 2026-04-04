import prisma from '@/lib/db';

/**
 * Credit Service
 * Manages user AI credits — separate from xmanstudio wallet
 * Users can top-up credits using their xmanstudio wallet
 */
export class CreditService {
  /**
   * Get or create user credit record
   */
  static async getUserCredits(userId: number) {
    return prisma.aiUserCredit.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
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
    const credit = await this.getUserCredits(userId);

    const { transaction } = await prisma.$transaction(async (tx) => {
      await tx.aiUserCredit.update({
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
          balanceAfter: credit.balance + amount,
          description: description || `Purchased ${amount} credits`,
          packageId,
          xmanOrderId,
        },
      });

      return { transaction: txn };
    });

    return { balance: credit.balance + amount, transactionId: transaction.id };
  }

  /**
   * Add bonus credits
   */
  static async addBonus(userId: number, amount: number, description: string) {
    const credit = await this.getUserCredits(userId);

    await prisma.$transaction([
      prisma.aiUserCredit.update({
        where: { userId },
        data: {
          balance: { increment: amount },
          totalBonus: { increment: amount },
        },
      }),
      prisma.aiCreditTransaction.create({
        data: {
          userId,
          type: 'bonus',
          amount,
          balanceAfter: credit.balance + amount,
          description,
        },
      }),
    ]);

    return { balance: credit.balance + amount };
  }

  /**
   * Admin adjust credits
   */
  static async adminAdjust(userId: number, amount: number, description: string) {
    const credit = await this.getUserCredits(userId);

    await prisma.$transaction([
      prisma.aiUserCredit.update({
        where: { userId },
        data: {
          balance: { increment: amount },
        },
      }),
      prisma.aiCreditTransaction.create({
        data: {
          userId,
          type: 'admin_adjust',
          amount,
          balanceAfter: credit.balance + amount,
          description,
        },
      }),
    ]);

    return { balance: credit.balance + amount };
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
