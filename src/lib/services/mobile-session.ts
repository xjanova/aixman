import prisma from '@/lib/db';
import { CreditService } from '@/lib/services/credits';

/**
 * The payload the mobile app needs to render its top bar and profile screen.
 *
 * Returned by login, refresh and `GET /api/mobile/me` so a cold app start is a
 * single round trip rather than three. Deliberately excludes `password`,
 * `rememberToken` and `stripeCustomerId` — the app never needs them and they
 * must not travel.
 */
export interface MobileSession {
  user: {
    id: number;
    name: string;
    email: string;
    avatar: string | null;
    role: string;
  };
  credits: {
    balance: number;
    totalBought: number;
    totalUsed: number;
    totalBonus: number;
  };
}

export async function buildMobileSession(userId: number): Promise<MobileSession | null> {
  const [user, credits] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, avatar: true, role: true, isActive: true },
    }),
    // Creates the row (and grants the signup free credits) on first sight, which
    // is what the web app does too — a mobile-first signup must not miss out.
    CreditService.getUserCredits(userId),
  ]);

  if (!user || !user.isActive) return null;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
    },
    credits: {
      balance: credits.balance,
      totalBought: credits.totalBought,
      totalUsed: credits.totalUsed,
      totalBonus: credits.totalBonus,
    },
  };
}
