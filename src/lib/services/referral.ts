import { prisma } from "@/lib/db";

const DEFAULT_COMMISSION_RATE = 10; // 10% of purchased credits
const REFERRER_BONUS = 50; // bonus credits for referrer when someone signs up
const REFERRED_BONUS = 20; // bonus credits for new referred user

export class ReferralService {
  /**
   * Get or create a referral code for a user
   */
  async getOrCreateCode(userId: number): Promise<string> {
    // Check if user already has a referral entry
    const existing = await prisma.aiReferral.findFirst({
      where: { referrerId: userId, referredId: null },
    });

    if (existing) return existing.referralCode;

    // Generate unique code
    const code = await this.generateUniqueCode();

    await prisma.aiReferral.create({
      data: {
        referrerId: userId,
        referralCode: code,
        status: "active",
      },
    });

    return code;
  }

  /**
   * Apply a referral code for a new user
   */
  async applyCode(userId: number, code: string): Promise<{ success: boolean; error?: string }> {
    const referral = await prisma.aiReferral.findUnique({
      where: { referralCode: code },
    });

    if (!referral) return { success: false, error: "รหัสชวนเพื่อนไม่ถูกต้อง" };
    if (referral.referrerId === userId) return { success: false, error: "ไม่สามารถใช้รหัสของตัวเองได้" };

    // Check if user already has a referral
    const alreadyReferred = await prisma.aiReferral.findFirst({
      where: { referredId: userId },
    });
    if (alreadyReferred) return { success: false, error: "บัญชีนี้ถูกชวนแล้ว" };

    // Create new referral link
    await prisma.aiReferral.create({
      data: {
        referrerId: referral.referrerId,
        referredId: userId,
        referralCode: await this.generateUniqueCode(),
        status: "used",
        bonusCredits: REFERRER_BONUS,
      },
    });

    // Give bonus credits to both users
    await this.addBonusCredits(referral.referrerId, REFERRER_BONUS, `โบนัสชวนเพื่อน (รหัส: ${code})`);
    await this.addBonusCredits(userId, REFERRED_BONUS, `โบนัสจากรหัสชวนเพื่อน: ${code}`);

    return { success: true };
  }

  /**
   * Process commission when a referred user makes a purchase
   */
  async processCommission(transactionId: number): Promise<void> {
    const transaction = await prisma.aiCreditTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction || transaction.type !== "purchase" || transaction.amount <= 0) return;

    // Find if this user was referred
    const referral = await prisma.aiReferral.findFirst({
      where: { referredId: transaction.userId, status: "used" },
    });

    if (!referral) return;

    const commissionCredits = Math.floor(transaction.amount * DEFAULT_COMMISSION_RATE / 100);
    if (commissionCredits <= 0) return;

    // Create commission record
    await prisma.aiReferralCommission.create({
      data: {
        referralId: referral.id,
        transactionId: transaction.id,
        commissionRate: DEFAULT_COMMISSION_RATE,
        creditAmount: commissionCredits,
        status: "credited",
        creditedAt: new Date(),
      },
    });

    // Add commission credits to referrer
    await this.addBonusCredits(
      referral.referrerId,
      commissionCredits,
      `ค่าคอมมิชชั่น ${DEFAULT_COMMISSION_RATE}% จากการซื้อของเพื่อนที่ชวน`
    );
  }

  /**
   * Get referral stats for a user
   */
  async getStats(userId: number) {
    const code = await this.getOrCreateCode(userId);

    const referrals = await prisma.aiReferral.findMany({
      where: { referrerId: userId, referredId: { not: null } },
      include: {
        referred: { select: { name: true, email: true, createdAt: true } },
        commissions: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const totalReferred = referrals.length;
    const totalCommission = referrals.reduce(
      (sum, r) => sum + r.commissions.reduce((s, c) => s + c.creditAmount, 0),
      0
    );
    const pendingCommission = referrals.reduce(
      (sum, r) => sum + r.commissions.filter((c) => c.status === "pending").reduce((s, c) => s + c.creditAmount, 0),
      0
    );

    return {
      referralCode: code,
      totalReferred,
      totalCommission,
      pendingCommission,
      commissionRate: DEFAULT_COMMISSION_RATE,
      referrals: referrals.map((r) => ({
        id: r.id,
        referredName: r.referred?.name || "ผู้ใช้",
        referredEmail: r.referred?.email || "",
        joinedAt: r.createdAt,
        totalCommission: r.commissions.reduce((s, c) => s + c.creditAmount, 0),
        bonusCredits: r.bonusCredits,
      })),
    };
  }

  private async addBonusCredits(userId: number, amount: number, description: string) {
    await prisma.$executeRaw`
      INSERT INTO ai_user_credits (user_id, balance, total_bonus, created_at, updated_at)
      VALUES (${userId}, ${amount}, ${amount}, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        balance = balance + ${amount},
        total_bonus = total_bonus + ${amount},
        updated_at = NOW()
    `;

    const credit = await prisma.aiUserCredit.findUnique({ where: { userId } });

    await prisma.aiCreditTransaction.create({
      data: {
        userId,
        type: "bonus",
        amount,
        balanceAfter: credit?.balance || amount,
        description,
      },
    });
  }

  private async generateUniqueCode(): Promise<string> {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    let exists: boolean;
    do {
      code = "";
      for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const found = await prisma.aiReferral.findUnique({ where: { referralCode: code } });
      exists = !!found;
    } while (exists);
    return code;
  }
}
