import { prisma } from "@/lib/db";
import { translator, type Locale, type Msg } from "@/lib/i18n/locale";

const DEFAULT_COMMISSION_RATE = 10; // 10% of purchased credits
const REFERRER_BONUS = 50; // bonus credits for referrer when someone signs up
const REFERRED_BONUS = 20; // bonus credits for new referred user
const REFERRAL_ELIGIBLE_DAYS = 30; // only accounts newer than this may redeem a code

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
  async applyCode(userId: number, code: string): Promise<{ success: true } | { success: false; error: Msg }> {
    const referral = await prisma.aiReferral.findUnique({
      where: { referralCode: code },
    });

    if (!referral) return { success: false, error: { th: "รหัสชวนเพื่อนไม่ถูกต้อง", en: "This referral code is not valid." } };
    if (referral.referrerId === userId) {
      return { success: false, error: { th: "ไม่สามารถใช้รหัสของตัวเองได้", en: "You can't use your own code." } };
    }

    // Anti-abuse: only genuinely new accounts may redeem a code.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    if (!user) return { success: false, error: { th: "ไม่พบบัญชีผู้ใช้", en: "Account not found." } };
    const accountAgeMs = Date.now() - new Date(user.createdAt).getTime();
    if (accountAgeMs > REFERRAL_ELIGIBLE_DAYS * 24 * 60 * 60 * 1000) {
      return {
        success: false,
        error: {
          th: `เฉพาะสมาชิกใหม่ (ภายใน ${REFERRAL_ELIGIBLE_DAYS} วัน) เท่านั้นที่ใช้รหัสชวนเพื่อนได้`,
          en: `Only new members (within ${REFERRAL_ELIGIBLE_DAYS} days of joining) can use a referral code.`,
        },
      };
    }

    // Must not have purchased before (prevents established users farming bonuses)
    const hasPurchase = await prisma.aiCreditTransaction.findFirst({
      where: { userId, type: "purchase" },
    });
    if (hasPurchase) {
      return {
        success: false,
        error: {
          th: "บัญชีนี้มีประวัติการซื้อแล้ว ไม่สามารถใช้รหัสชวนเพื่อนได้",
          en: "This account has already made a purchase, so it can't use a referral code.",
        },
      };
    }

    // Check if user already has a referral
    const alreadyReferred = await prisma.aiReferral.findFirst({
      where: { referredId: userId },
    });
    if (alreadyReferred) {
      return { success: false, error: { th: "บัญชีนี้ถูกชวนแล้ว", en: "This account has already used a referral code." } };
    }

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
    // Credit-history lines stay Thai in the table; src/lib/i18n/credit-text.ts reads these shapes in English
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

    // Idempotency — never pay commission twice for the same purchase transaction
    const existingCommission = await prisma.aiReferralCommission.findFirst({
      where: { transactionId: transaction.id },
    });
    if (existingCommission) return;

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
  async getStats(userId: number, locale: Locale = "th") {
    const t = translator(locale);
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
        referredName: r.referred?.name || t("ผู้ใช้", "User"),
        referredEmail: r.referred?.email || "",
        joinedAt: r.createdAt,
        totalCommission: r.commissions.reduce((s, c) => s + c.creditAmount, 0),
        bonusCredits: r.bonusCredits,
      })),
    };
  }

  private async addBonusCredits(userId: number, amount: number, description: string) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO ai_user_credits (user_id, balance, total_bonus, created_at, updated_at)
        VALUES (${userId}, ${amount}, ${amount}, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          balance = balance + ${amount},
          total_bonus = total_bonus + ${amount},
          updated_at = NOW()
      `;

      const credit = await tx.aiUserCredit.findUnique({ where: { userId } });

      await tx.aiCreditTransaction.create({
        data: {
          userId,
          type: "bonus",
          amount,
          balanceAfter: credit?.balance ?? amount,
          description,
        },
      });
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
