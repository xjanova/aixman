import prisma from '@/lib/db';

/**
 * Readiness of a model on *this* deployment.
 *
 * A self-hosted model is a claim until it has actually produced something here:
 * the weight files have to exist at the paths the template expects, the ComfyUI
 * version has to provide every node, and the rented card has to hold it all. No
 * amount of code review proves that — only a completed render does.
 *
 * So a new self-hosted model starts in `tuning`: shown to customers with a
 * "กำลังปรับแต่ง" notice and not orderable, while an admin can still run it to
 * prove it out. The first success promotes it; a run of failures demotes it
 * back, so a model that breaks after a ComfyUI update stops taking orders
 * instead of quietly burning customers' credits.
 */

export type Readiness = 'tuning' | 'ready' | 'disabled';

/** Consecutive failures before a proven model is pulled back for tuning. */
const DEMOTE_AFTER_FAILURES = 3;

export const TUNING_MESSAGE =
  'โมเดลนี้กำลังปรับแต่งอยู่ ยังใช้งานไม่ได้ กรุณาลองใหม่ภายหลัง';

export class ModelReadiness {
  /**
   * Promote to `ready` after a successful generation and clear the streak.
   *
   * Deliberately unconditional on the previous state (except `disabled`, which
   * is an explicit admin decision): a model that just worked is ready, whatever
   * we believed a moment ago.
   */
  static async recordSuccess(modelId: number): Promise<void> {
    await prisma.aiModel.updateMany({
      where: { id: modelId, readiness: { not: 'disabled' } },
      data: { readiness: 'ready', readinessNote: null, failureStreak: 0 },
    });
  }

  /**
   * Count a failure and demote once the streak crosses the threshold.
   *
   * One failure is not evidence of a broken model — a spot instance can vanish
   * mid-render — so a single bad run does not pull it from sale.
   */
  static async recordFailure(modelId: number, reason: string): Promise<void> {
    const model = await prisma.aiModel.findUnique({
      where: { id: modelId },
      select: { failureStreak: true, readiness: true },
    });
    if (!model || model.readiness === 'disabled') return;

    const streak = model.failureStreak + 1;
    const demote = streak >= DEMOTE_AFTER_FAILURES;

    await prisma.aiModel.update({
      where: { id: modelId },
      data: {
        failureStreak: streak,
        ...(demote
          ? {
              readiness: 'tuning',
              readinessNote: `ล้มเหลวติดกัน ${streak} ครั้ง — ${reason}`.slice(0, 500),
            }
          : {}),
      },
    });
  }

  /**
   * Whether this user may order this model right now.
   *
   * Admins can run a `tuning` model — that is how it gets proven and promoted.
   * Everyone else gets the notice instead of spending credits on it.
   */
  static canOrder(readiness: string, isAdmin: boolean): boolean {
    if (readiness === 'ready') return true;
    if (readiness === 'tuning') return isAdmin;
    return false;
  }
}
