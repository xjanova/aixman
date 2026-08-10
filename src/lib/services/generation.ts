import { after } from 'next/server';
import prisma from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { getProvider } from '@/lib/providers';
import { getGpuProvider } from '@/lib/gpu';
import { AccountPoolManager } from './account-pool';
import { ModelReadiness, TUNING_MESSAGE } from './model-readiness';
import { persistAssetSafe, isStorageConfigured } from '@/lib/storage/r2';
import type { GenerationRequest, GenerationResult, ProviderSlug } from '@/types';

/**
 * Generation Service
 * Orchestrates AI generation requests across providers with account pool rotation
 */
export class GenerationService {
  /**
   * Submit a new generation request
   */
  static async generate(
    userId: number,
    request: GenerationRequest,
    options: { isAdmin?: boolean } = {}
  ): Promise<GenerationResult> {
    // 1. Get the model and provider info
    const model = await prisma.aiModel.findUnique({
      where: { id: request.modelId },
      include: { provider: true },
    });

    if (!model || !model.isActive) {
      throw new Error('Model not found or inactive');
    }

    if (!model.provider.isActive) {
      throw new Error('Provider is currently unavailable');
    }

    // Checked before any credit is deducted: an unproven model must not be able
    // to take payment for a render it cannot deliver. Admins are exempt because
    // running it is exactly how a model gets proven and promoted.
    if (!ModelReadiness.canOrder(model.readiness, options.isAdmin === true)) {
      throw new Error(TUNING_MESSAGE);
    }

    const numOutputs = request.params?.numOutputs || 1;
    const requiredCredits = model.creditsPerUnit * numOutputs;

    // 2. Select an account from the pool
    const account = await AccountPoolManager.selectAccount(model.providerId);
    if (!account) {
      throw new Error('No available API accounts for this provider. Please try again later.');
    }

    // 3. Atomically check & deduct credits + create generation in one transaction
    const { generation } = await prisma.$transaction(async (tx) => {
      // Atomic conditional update — prevents double-spend race condition
      const updated = await tx.$executeRawUnsafe(
        'UPDATE ai_user_credits SET balance = balance - ?, total_used = total_used + ? WHERE user_id = ? AND balance >= ?',
        requiredCredits, requiredCredits, userId, requiredCredits
      );

      if (updated === 0) {
        const credit = await tx.aiUserCredit.findUnique({ where: { userId } });
        throw new Error(`Insufficient credits. Need ${requiredCredits}, have ${credit?.balance || 0}`);
      }

      const credit = await tx.aiUserCredit.findUnique({ where: { userId } });

      const gen = await tx.aiGeneration.create({
        data: {
          userId,
          modelId: model.id,
          type: request.type,
          status: 'pending',
          prompt: request.prompt,
          negativePrompt: request.negativePrompt,
          params: (request.params ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          inputImage: request.inputImage,
          creditsUsed: requiredCredits,
          accountPoolId: account.id,
        },
      });

      await tx.aiCreditTransaction.create({
        data: {
          userId,
          type: 'usage',
          amount: -requiredCredits,
          balanceAfter: credit?.balance ?? 0,
          description: `${model.name} - ${request.type} generation`,
          generationId: gen.id,
        },
      });

      return { generation: gen };
    });

    // 5b. GPU-backed providers have no inference API to call — they rent a
    // machine and run the model on it. Queue the job and return immediately;
    // GpuQueue rents, dispatches, and settles the generation asynchronously.
    if (getGpuProvider(model.provider.slug)) {
      const styleSuffix = request.styleId ? await this.getStyleSuffix(request.styleId) : '';
      // Imported lazily: GpuQueue imports this class back for refunds, and a
      // static cycle would leave one of the two undefined at module init.
      const { GpuQueue } = await import('./gpu-queue');

      await GpuQueue.enqueue({
        generationId: generation.id,
        modelKey: model.modelId,
        payload: {
          prompt: request.prompt + styleSuffix,
          negativePrompt: request.negativePrompt,
          width: request.params?.width || model.maxWidth || 768,
          height: request.params?.height || model.maxHeight || 768,
          duration: request.params?.duration || model.maxDuration || 5,
          fps: request.params?.fps || 24,
          seed: request.params?.seed ?? Math.floor(Math.random() * 2_147_483_647),
          inputImage: request.inputImage,
          extra: (request.params ?? {}) as Record<string, unknown>,
        },
      });

      // Kick the queue right away so the GPU starts warming while the response
      // is still in flight. Cron remains the reliable driver — this is a
      // latency optimisation, so its failure must not fail the request.
      try {
        after(async () => {
          const { withTickLock } = await import('./gpu-lock');
          await withTickLock(() => GpuQueue.tick()).catch((err) =>
            console.error('[gpu] post-enqueue tick failed:', err)
          );
        });
      } catch {
        // Not in a request scope (script/worker context) — cron will pick it up.
      }

      return {
        id: generation.id,
        status: 'pending',
        creditsUsed: requiredCredits,
      };
    }

    // 6. Execute generation via provider
    try {
      await prisma.aiGeneration.update({
        where: { id: generation.id },
        data: { status: 'processing', startedAt: new Date() },
      });

      const provider = getProvider(model.provider.slug as ProviderSlug);
      if (!provider) {
        throw new Error(`Provider adapter not found: ${model.provider.slug}`);
      }

      const providerParams = {
        modelId: model.modelId,
        prompt: request.prompt + (request.styleId ? await this.getStyleSuffix(request.styleId) : ''),
        negativePrompt: request.negativePrompt,
        width: request.params?.width || model.maxWidth || 1024,
        height: request.params?.height || model.maxHeight || 1024,
        steps: request.params?.steps,
        cfgScale: request.params?.cfgScale,
        seed: request.params?.seed,
        duration: request.params?.duration || model.maxDuration || undefined,
        fps: request.params?.fps,
        aspectRatio: request.params?.aspectRatio,
        numOutputs: request.params?.numOutputs || 1,
        inputImage: request.inputImage,
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
        apiEndpoint: account.apiEndpoint,
        extraParams: request.params as Record<string, unknown>,
      };

      let result;
      switch (request.type) {
        case 'image':
          result = await provider.generateImage(providerParams);
          break;
        case 'video':
          result = await provider.generateVideo(providerParams);
          break;
        case 'edit':
          if (provider.editImage) {
            result = await provider.editImage(providerParams);
          } else {
            throw new Error('This model does not support image editing');
          }
          break;
        default:
          throw new Error(`Unknown generation type: ${request.type}`);
      }

      // 7. Record result
      const costUsd = Number(model.costPerUnit);

      await prisma.aiUsageLog.create({
        data: {
          accountPoolId: account.id,
          modelId: model.modelId,
          action: request.type,
          status: result.success ? 'success' : 'error',
          costUsd: result.success ? costUsd : 0,
          responseMs: result.processingMs,
          errorMessage: result.error,
        },
      });

      if (result.success) {
        await AccountPoolManager.recordSuccess(account.id, costUsd);

        // Persist provider output to durable R2 storage. Provider URLs expire and
        // base64 results shouldn't live in the DB long-term. persistAssetSafe is a
        // no-op (returns the source unchanged) when R2 isn't configured.
        let finalUrl = result.resultUrl;
        let finalUrls = result.resultUrls;
        if (isStorageConfigured()) {
          const prefix = `generations/${userId}/${generation.id}`;
          if (finalUrls && finalUrls.length > 0) {
            finalUrls = await Promise.all(finalUrls.map((u) => persistAssetSafe(u, prefix)));
            finalUrl = finalUrls[0];
          } else if (finalUrl) {
            finalUrl = await persistAssetSafe(finalUrl, prefix);
          }
        }

        await prisma.aiGeneration.update({
          where: { id: generation.id },
          data: {
            status: 'completed',
            resultUrl: finalUrl,
            resultUrls: (finalUrls ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            thumbnailUrl: finalUrl, // Use first result as thumbnail
            providerJobId: result.jobId,
            costUsd,
            processingMs: result.processingMs,
            completedAt: new Date(),
          },
        });

        // Fix the retention window at the moment the customer received the
        // file, so a later settings change cannot shorten what they were
        // already promised.
        const { RetentionService, daysUntil } = await import('./retention');
        await RetentionService.stampExpiry(generation.id);
        // A model that just delivered is proven, whatever we believed before.
        await ModelReadiness.recordSuccess(model.id);
        const stamped = await prisma.aiGeneration.findUnique({
          where: { id: generation.id },
          select: { expiresAt: true },
        });

        return {
          id: generation.id,
          status: 'completed',
          resultUrl: finalUrl,
          resultUrls: finalUrls,
          thumbnailUrl: finalUrl,
          processingMs: result.processingMs,
          creditsUsed: requiredCredits,
          expiresAt: stamped?.expiresAt?.toISOString(),
          daysLeft: daysUntil(stamped?.expiresAt),
        };
      } else {
        // Provider returned a failure — record it against the account (with
        // rate-limit-aware cooldown) so the pool can rotate/auto-disable, then
        // refund the user.
        await AccountPoolManager.recordError(
          account.id,
          result.error || 'Generation failed',
          this.isRateLimitError(result.error)
        );
        await this.refundCredits(userId, requiredCredits, generation.id);

        await prisma.aiGeneration.update({
          where: { id: generation.id },
          data: {
            status: 'failed',
            errorMessage: result.error,
            completedAt: new Date(),
          },
        });

        return {
          id: generation.id,
          status: 'failed',
          creditsUsed: 0,
          error: result.error,
        };
      }
    } catch (error) {
      // Record error and refund
      const message = (error as Error).message;
      await AccountPoolManager.recordError(account.id, message, this.isRateLimitError(message));
      await this.refundCredits(userId, requiredCredits, generation.id);

      await prisma.aiGeneration.update({
        where: { id: generation.id },
        data: {
          status: 'failed',
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });

      return {
        id: generation.id,
        status: 'failed',
        creditsUsed: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Detect whether a provider error message indicates rate limiting / quota,
   * so the account pool can apply the longer cooldown.
   */
  private static isRateLimitError(msg?: string): boolean {
    if (!msg) return false;
    return /rate.?limit|429|too many requests|quota/i.test(msg);
  }

  /**
   * Refund credits to user after failed generation.
   * Public because GPU-backed generations settle asynchronously in GpuQueue,
   * long after this class has returned to the caller.
   */
  static async refundCredits(userId: number, amount: number, generationId: number) {
    const userCredit = await prisma.aiUserCredit.findUnique({ where: { userId } });
    if (!userCredit) return;

    // Idempotency — never refund the same generation twice (the failure and
    // exception paths can otherwise both fire).
    const existingRefund = await prisma.aiCreditTransaction.findFirst({
      where: { generationId, type: 'refund' },
    });
    if (existingRefund) return;

    await prisma.$transaction([
      prisma.aiUserCredit.update({
        where: { userId },
        data: {
          balance: { increment: amount },
          totalUsed: { decrement: amount },
        },
      }),
      prisma.aiCreditTransaction.create({
        data: {
          userId,
          type: 'refund',
          amount,
          balanceAfter: userCredit.balance + amount,
          description: 'Auto-refund: generation failed',
          generationId,
        },
      }),
      // Recorded on the generation too, so the gallery can say "คืนเครดิตแล้ว"
      // without joining the transaction log on every read.
      prisma.aiGeneration.update({
        where: { id: generationId },
        data: { creditsRefunded: amount },
      }),
    ]);
  }

  /**
   * Get style prompt suffix
   */
  private static async getStyleSuffix(styleId: number): Promise<string> {
    const style = await prisma.aiStyle.findUnique({ where: { id: styleId } });
    return style?.promptSuffix ? `, ${style.promptSuffix}` : '';
  }

  /**
   * Get user's generation history
   */
  static async getUserHistory(userId: number, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [generations, total] = await Promise.all([
      prisma.aiGeneration.findMany({
        where: { userId },
        include: {
          model: { include: { provider: { select: { name: true, slug: true, logo: true } } } },
          favorites: { where: { userId } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.aiGeneration.count({ where: { userId } }),
    ]);

    return {
      data: generations.map((g) => ({
        ...g,
        params: g.params ?? null,
        resultUrls: g.resultUrls ?? null,
        isFavorited: g.favorites.length > 0,
      })),
      total,
      pages: Math.ceil(total / limit),
      page,
    };
  }
}
