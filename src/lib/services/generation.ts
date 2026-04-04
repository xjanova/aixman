import prisma from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { getProvider } from '@/lib/providers';
import { AccountPoolManager } from './account-pool';
import type { GenerationRequest, GenerationResult, ProviderSlug } from '@/types';

/**
 * Generation Service
 * Orchestrates AI generation requests across providers with account pool rotation
 */
export class GenerationService {
  /**
   * Submit a new generation request
   */
  static async generate(userId: number, request: GenerationRequest): Promise<GenerationResult> {
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
      await AccountPoolManager.recordSuccess(account.id, costUsd);

      await prisma.aiUsageLog.create({
        data: {
          accountPoolId: account.id,
          modelId: model.modelId,
          action: request.type,
          status: result.success ? 'success' : 'error',
          costUsd,
          responseMs: result.processingMs,
          errorMessage: result.error,
        },
      });

      if (result.success) {
        await prisma.aiGeneration.update({
          where: { id: generation.id },
          data: {
            status: 'completed',
            resultUrl: result.resultUrl,
            resultUrls: (result.resultUrls ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            thumbnailUrl: result.resultUrl, // Use first result as thumbnail
            providerJobId: result.jobId,
            costUsd,
            processingMs: result.processingMs,
            completedAt: new Date(),
          },
        });

        return {
          id: generation.id,
          status: 'completed',
          resultUrl: result.resultUrl,
          resultUrls: result.resultUrls,
          thumbnailUrl: result.resultUrl,
          processingMs: result.processingMs,
          creditsUsed: requiredCredits,
        };
      } else {
        // Refund credits on failure
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
      await AccountPoolManager.recordError(account.id, (error as Error).message);
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
   * Refund credits to user after failed generation
   */
  private static async refundCredits(userId: number, amount: number, generationId: number) {
    const userCredit = await prisma.aiUserCredit.findUnique({ where: { userId } });
    if (!userCredit) return;

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
