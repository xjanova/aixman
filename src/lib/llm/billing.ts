import prisma from '@/lib/db';
import { settle } from './pricing';

/**
 * Credits for the LLM API: hold before, settle after.
 *
 * A request's worst case (its prompt's token ceiling plus its whole output
 * budget) is taken from the balance before it runs, with the same conditional
 * update an image order uses, so parallel requests can never spend more than
 * the customer has. When it ends, the real cost joins the key's carry, whole
 * credits become one `api-usage` transaction, and the rest of the hold goes
 * back. The hold itself writes no transaction: a customer's history shows what
 * they paid, not what was briefly set aside.
 */

/** Same reasoning as GenerationService's SLOW_DB_TX: a slow moment must not lose a settlement. */
const SETTLE_TX = { maxWait: 10_000, timeout: 20_000 };

/** Take `credits` from the balance if it is there. */
export async function holdCredits(userId: number, credits: number): Promise<boolean> {
  const updated = await prisma.$executeRawUnsafe(
    'UPDATE ai_user_credits SET balance = balance - ? WHERE user_id = ? AND balance >= ?',
    credits,
    userId,
    credits
  );
  return updated > 0;
}

export interface RequestOutcome {
  userId: number;
  apiKeyId: number;
  /** ai_models.modelId as the customer named it. */
  model: string;
  /** Display name, for the credit history line. */
  modelName: string;
  backend: string;
  held: number;
  promptTokens: number;
  completionTokens: number;
  millicredits: number;
  costUsd: number;
  status: 'ok' | 'error' | 'aborted';
  error?: string;
  latencyMs: number;
}

/** Close a request: charge it, return the rest of the hold, record it. Never throws. */
export async function settleRequest(o: RequestOutcome): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ carry: number }[]>(
        'SELECT carry_millicredits AS carry FROM ai_api_keys WHERE id = ? FOR UPDATE',
        o.apiKeyId
      );
      const s = settle(o.held, Number(rows[0]?.carry ?? 0), o.millicredits);

      let charged = s.charge;
      if (s.refund > 0) {
        await tx.$executeRawUnsafe('UPDATE ai_user_credits SET balance = balance + ? WHERE user_id = ?', s.refund, o.userId);
      } else if (s.refund < 0) {
        // Cost more than was held (an upstream that counted beyond our
        // ceiling). Take what is there; never push a balance below zero.
        const owed = -s.refund;
        const bal = await tx.$queryRawUnsafe<{ balance: number }[]>(
          'SELECT balance FROM ai_user_credits WHERE user_id = ? FOR UPDATE',
          o.userId
        );
        const taken = Math.min(owed, Math.max(0, Number(bal[0]?.balance ?? 0)));
        if (taken > 0) {
          await tx.$executeRawUnsafe('UPDATE ai_user_credits SET balance = balance - ? WHERE user_id = ?', taken, o.userId);
        }
        charged = o.held + taken;
      }

      await tx.aiApiKey.update({
        where: { id: o.apiKeyId },
        data: { carryMillicredits: s.carry, lastUsedAt: new Date() },
      });

      if (charged > 0) {
        const credit = await tx.aiUserCredit.update({
          where: { userId: o.userId },
          data: { totalUsed: { increment: charged } },
        });
        await tx.aiCreditTransaction.create({
          data: {
            userId: o.userId,
            type: 'api-usage',
            amount: -charged,
            balanceAfter: credit.balance,
            description: `API ${o.modelName}`.slice(0, 500),
            metadata: { apiKeyId: o.apiKeyId, promptTokens: o.promptTokens, completionTokens: o.completionTokens },
          },
        });
      }

      await tx.aiApiUsage.create({
        data: {
          userId: o.userId,
          apiKeyId: o.apiKeyId,
          model: o.model,
          backend: o.backend,
          promptTokens: o.promptTokens,
          completionTokens: o.completionTokens,
          millicredits: o.millicredits,
          costUsd: o.costUsd,
          status: o.status,
          error: o.error?.slice(0, 500) ?? null,
          latencyMs: o.latencyMs,
        },
      });
    }, SETTLE_TX);
  } catch (error) {
    // The hold stays taken: better a customer short by one request's worst
    // case (visible in the log below) than a free request.
    console.error('[llm] settlement failed', { apiKeyId: o.apiKeyId, held: o.held, millicredits: o.millicredits }, error);
  }
}
