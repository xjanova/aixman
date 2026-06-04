import prisma from '@/lib/db';
import { decrypt } from '@/lib/utils/encryption';
import type { ProviderAccount, PoolRotationMode } from '@/types';

/**
 * Account Pool Manager
 * Manages rotation of API accounts across providers with 3 modes:
 * - round_robin: Cycle through accounts sequentially
 * - balanced: Distribute evenly across all accounts
 * - quota_first: Prefer accounts with the most remaining quota
 */
export class AccountPoolManager {
  /**
   * Select the best available account for a provider
   */
  static async selectAccount(
    providerId: number,
    rotationMode?: PoolRotationMode
  ): Promise<ProviderAccount | null> {
    const now = new Date();

    // Get all active accounts for this provider that aren't in cooldown
    const accounts = await prisma.aiAccountPool.findMany({
      where: {
        providerId,
        isActive: true,
        OR: [
          { cooldownUntil: null },
          { cooldownUntil: { lt: now } },
        ],
      },
      orderBy: { priority: 'desc' },
    });

    if (accounts.length === 0) return null;

    // Filter accounts with remaining quota
    const available = accounts.filter((acc) => {
      if (acc.dailyQuota > 0 && acc.usageToday >= acc.dailyQuota) return false;
      if (acc.monthlyQuota > 0 && acc.usageThisMonth >= acc.monthlyQuota) return false;
      if (acc.consecutiveErrors >= 5) return false; // Auto-disable after 5 consecutive errors
      return true;
    });

    if (available.length === 0) return null;

    // Determine rotation mode - use account-level setting or fall back to parameter
    const mode = rotationMode || (available[0].rotationMode as PoolRotationMode) || 'round_robin';

    let selected;
    switch (mode) {
      case 'round_robin':
        selected = this.selectRoundRobin(available);
        break;
      case 'balanced':
        selected = this.selectBalanced(available);
        break;
      case 'quota_first':
        selected = this.selectQuotaFirst(available);
        break;
      default:
        selected = this.selectRoundRobin(available);
    }

    return {
      id: selected.id,
      providerId: selected.providerId,
      label: selected.label,
      apiKey: decrypt(selected.apiKey),
      apiSecret: selected.apiSecret ? decrypt(selected.apiSecret) : undefined,
      apiEndpoint: selected.apiEndpoint || undefined,
      isActive: selected.isActive,
      priority: selected.priority,
      rateLimitPerMinute: selected.rateLimitPerMinute,
      dailyQuota: selected.dailyQuota,
      monthlyQuota: selected.monthlyQuota,
      usageToday: selected.usageToday,
      usageThisMonth: selected.usageThisMonth,
      totalUsage: selected.totalUsage,
      cooldownUntil: selected.cooldownUntil || undefined,
      consecutiveErrors: selected.consecutiveErrors,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static selectRoundRobin(accounts: any[]) {
    // Least-recently-used. A never-used account (lastUsedAt = null) counts as
    // the oldest possible, so fresh accounts are picked up first.
    return accounts.reduce((oldest, current) => {
      const oldestTime = oldest.lastUsedAt ? new Date(oldest.lastUsedAt).getTime() : 0;
      const currentTime = current.lastUsedAt ? new Date(current.lastUsedAt).getTime() : 0;
      return currentTime < oldestTime ? current : oldest;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static selectBalanced(accounts: any[]) {
    return accounts.reduce((least, current) =>
      current.usageToday < least.usageToday ? current : least
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static selectQuotaFirst(accounts: any[]) {
    return accounts.reduce((best, current) => {
      const bestRemaining = best.dailyQuota > 0
        ? best.dailyQuota - best.usageToday
        : best.monthlyQuota > 0 ? best.monthlyQuota - best.usageThisMonth : Infinity;
      const currentRemaining = current.dailyQuota > 0
        ? current.dailyQuota - current.usageToday
        : current.monthlyQuota > 0 ? current.monthlyQuota - current.usageThisMonth : Infinity;
      return currentRemaining > bestRemaining ? current : best;
    });
  }

  /**
   * Record successful usage of an account
   */
  static async recordSuccess(accountId: number, costUsd: number = 0) {
    await prisma.aiAccountPool.update({
      where: { id: accountId },
      data: {
        usageToday: { increment: 1 },
        usageThisMonth: { increment: 1 },
        totalUsage: { increment: 1 },
        totalCost: { increment: costUsd },
        lastUsedAt: new Date(),
        consecutiveErrors: 0, // Reset on success
      },
    });
  }

  /**
   * Record an error for an account
   */
  static async recordError(accountId: number, error: string, isRateLimit: boolean = false) {
    const cooldownMinutes = isRateLimit ? 5 : 1;
    const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000);

    await prisma.aiAccountPool.update({
      where: { id: accountId },
      data: {
        lastErrorAt: new Date(),
        lastError: error.substring(0, 1000),
        errorCount: { increment: 1 },
        consecutiveErrors: { increment: 1 },
        cooldownUntil,
      },
    });
  }

  /**
   * Reset daily usage counters (should be called via cron at midnight)
   */
  static async resetDailyCounters() {
    // Also clear consecutiveErrors so accounts auto-disabled by a bad day can
    // recover on the next cycle (otherwise they'd stay excluded until a manual
    // admin reset, since nothing else clears the counter).
    await prisma.aiAccountPool.updateMany({
      data: {
        usageToday: 0,
        consecutiveErrors: 0,
      },
    });
  }

  /**
   * Reset monthly usage counters (should be called via cron on 1st of month)
   */
  static async resetMonthlyCounters() {
    await prisma.aiAccountPool.updateMany({
      data: {
        usageThisMonth: 0,
      },
    });
  }

  /**
   * Get pool status for admin dashboard
   */
  static async getPoolStatus(providerId?: number) {
    const where = providerId ? { providerId } : {};
    const accounts = await prisma.aiAccountPool.findMany({
      where,
      include: { provider: { select: { name: true, slug: true } } },
      orderBy: [{ providerId: 'asc' }, { priority: 'desc' }],
    });

    return accounts.map((acc) => ({
      id: acc.id,
      label: acc.label,
      provider: acc.provider.name,
      providerSlug: acc.provider.slug,
      isActive: acc.isActive,
      priority: acc.priority,
      rotationMode: acc.rotationMode,
      usageToday: acc.usageToday,
      dailyQuota: acc.dailyQuota,
      monthlyQuota: acc.monthlyQuota,
      usageThisMonth: acc.usageThisMonth,
      totalUsage: acc.totalUsage,
      consecutiveErrors: acc.consecutiveErrors,
      errorCount: acc.errorCount,
      cooldownUntil: acc.cooldownUntil?.toISOString(),
      lastUsedAt: acc.lastUsedAt?.toISOString(),
      lastErrorAt: acc.lastErrorAt?.toISOString(),
      lastError: acc.lastError,
    }));
  }
}
