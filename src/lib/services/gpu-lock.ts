import prisma from '@/lib/db';

/**
 * Cross-process lease lock, stored in `ai_settings`.
 *
 * The GPU tick can be triggered by cron *and* opportunistically after a user
 * enqueues a job, across several PM2 workers. Two ticks running concurrently
 * would each see "no worker available" and each rent one — doubling the bill.
 *
 * MySQL's GET_LOCK() is session-scoped and Prisma's pool hands out arbitrary
 * connections, so a lease row with an atomic compare-and-set UPDATE is used
 * instead. The lease self-expires, so a process that dies mid-tick cannot
 * deadlock the queue forever.
 */

const LOCK_KEY = 'gpu_tick_lock';

/** Long enough to cover a rent() call (up to ~90s) plus health checks. */
const DEFAULT_LEASE_MS = 150_000;

async function ensureLockRow(): Promise<void> {
  await prisma.aiSetting.upsert({
    where: { key: LOCK_KEY },
    update: {},
    create: { key: LOCK_KEY, value: '0', type: 'string', group: 'gpu' },
  });
}

/**
 * Runs `fn` if the lease can be acquired, otherwise returns `null` immediately.
 * Never blocks — a skipped tick is harmless because the next one follows shortly.
 */
export async function withTickLock<T>(
  fn: () => Promise<T>,
  leaseMs: number = DEFAULT_LEASE_MS
): Promise<T | null> {
  await ensureLockRow();

  const now = Date.now();
  const expiresAt = now + leaseMs;

  // Single atomic statement: claim only when the current lease is empty or has
  // already expired. affectedRows tells us whether we won.
  const claimed = await prisma.$executeRawUnsafe(
    `UPDATE ai_settings
        SET value = ?
      WHERE \`key\` = ?
        AND (value IS NULL OR value = '' OR CAST(value AS UNSIGNED) < ?)`,
    String(expiresAt),
    LOCK_KEY,
    now
  );

  if (claimed === 0) return null;

  try {
    return await fn();
  } finally {
    // Release by expiring the lease, but only if we still hold it — a tick that
    // overran its lease must not clobber the lock a newer tick already took.
    await prisma
      .$executeRawUnsafe(
        `UPDATE ai_settings SET value = '0' WHERE \`key\` = ? AND value = ?`,
        LOCK_KEY,
        String(expiresAt)
      )
      .catch(() => undefined);
  }
}
