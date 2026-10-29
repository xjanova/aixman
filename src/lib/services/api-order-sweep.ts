/**
 * Settles API orders nothing is waiting on any more.
 *
 * An inference-API order is charged, then its provider call runs inside the
 * request — or, for a slow video lip-sync, after the response
 * (GenerationService.runApiOrder). A deploy or a crash in that window ends
 * the call with the order still `pending`/`processing`: nobody will ever
 * store a result or refund it, and the studio shows it spinning forever.
 *
 * Rented-GPU orders are not touched: they carry an `ai_gpu_jobs` row and the
 * GPU queue settles them. Anything else unfinished past STALL_MINUTES — longer
 * than any provider wait (lipsync-rules.ts allows 30 minutes) — is failed and
 * refunded, with a status write conditioned on it still being unfinished so a
 * run that does come back cannot be settled twice.
 */

import prisma from '@/lib/db';
import { GenerationService } from './generation';
import { packMsg, registerStoredMsgs } from '@/lib/i18n/messages';
import type { Msg } from '@/lib/i18n/locale';

/** Past every provider's own wait, with room for the result to be stored. */
const STALL_MINUTES = 60;
const SWEEP_INTERVAL_MS = 5 * 60_000;
const STARTUP_DELAY_MS = 120_000;
const BATCH = 50;

export const STALLED_MSG: Msg = {
  th: 'ไม่ได้รับผลจากผู้ให้บริการภายในเวลาที่กำหนด ระบบคืนเครดิตให้แล้ว กรุณาลองใหม่อีกครั้ง',
  en: 'The result didn’t arrive in time. Your credits have been refunded — please try again.',
};
// Rows failed before messages were stored in both languages hold the Thai alone.
registerStoredMsgs(STALLED_MSG);

export const ApiOrderSweep = {
  async sweep(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - STALL_MINUTES * 60_000);
    const stalled = await prisma.aiGeneration.findMany({
      where: {
        status: { in: ['pending', 'processing'] },
        createdAt: { lt: cutoff },
        gpuJob: { is: null },
      },
      select: { id: true, userId: true, creditsUsed: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });

    let settled = 0;
    for (const order of stalled) {
      const claimed = await prisma.aiGeneration.updateMany({
        where: { id: order.id, status: { in: ['pending', 'processing'] } },
        data: { status: 'failed', errorMessage: packMsg(STALLED_MSG), completedAt: now },
      });
      if (claimed.count === 0) continue;
      // Idempotent per generation: a refund already written is not repeated.
      if (order.creditsUsed > 0) await GenerationService.refundCredits(order.userId, order.creditsUsed, order.id);
      settled += 1;
    }
    return settled;
  },
};

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Every few minutes, on the app's own schedule (started by instrumentation.ts). */
export function startApiOrderSweep(): void {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const settled = await ApiOrderSweep.sweep();
      if (settled > 0) console.log(`[api-orders] failed and refunded ${settled} orders left unfinished`);
    } catch (error) {
      console.error('[api-orders] sweep failed:', (error as Error).message);
    } finally {
      running = false;
    }
  };
  const begin = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), SWEEP_INTERVAL_MS);
    timer.unref?.();
  }, STARTUP_DELAY_MS);
  begin.unref?.();
}
