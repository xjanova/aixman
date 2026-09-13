import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { GpuQueue } from '@/lib/services/gpu-queue';
import { RetentionService, daysUntil } from '@/lib/services/retention';
import { GpuEta, formatEta } from '@/lib/services/gpu-eta';
import { GpuBalance, INSUFFICIENT_BALANCE_GRACE_MS } from '@/lib/services/gpu-balance';
import { getGpuConfig } from '@/lib/gpu/config';
import { publicProvider } from '@/lib/public-provider';

/**
 * What the customer sees while an in-house job waits: a queue.
 *
 * How the work is run — renting a machine, booting it, loading weights — is a
 * trade secret, so none of it is named here. A machine that is still starting
 * is shown as places in the queue instead, one place per this many seconds of
 * start-up left, which count down as it boots. The ETA beside it stays the
 * real estimate, so the wait itself is never misstated.
 */
const STARTUP_SECONDS_PER_PLACE = 30;
/** A slow boot must not show an absurd queue; the ETA carries the rest. */
const MAX_STARTUP_PLACES = 8;

const QUEUE_LABELS = {
  queued: 'อยู่ในคิว',
  next: 'ใกล้ถึงคิวของคุณแล้ว',
  starting: 'ถึงคิวของคุณแล้ว กำลังเริ่มสร้าง',
  rendering: 'กำลังสร้างผลงานของคุณ',
  paused: 'ระบบสร้างงานหยุดชั่วคราว',
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const generationId = parseInt(id, 10);
  if (isNaN(generationId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const generation = await prisma.aiGeneration.findFirst({
    where: { id: generationId, userId },
    include: {
      model: {
        include: { provider: { select: { name: true, slug: true } } },
      },
      gpuJob: { select: { status: true, modelKey: true } },
    },
  });

  if (!generation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const retentionDays = await RetentionService.getRetentionDays();

  // In-house jobs wait in a queue that can take minutes. Reporting progress
  // lets the client wait it out instead of declaring a timeout and pushing the
  // user to pay for a second attempt. (The key stays `gpu` for app builds
  // already in the field; nothing inside it names hardware.)
  let gpu: {
    stage: 'queued' | 'starting' | 'rendering';
    label: string;
    queuePosition: number | null;
    etaSeconds: number | null;
    etaLabel: string | null;
    etaBasis: string;
    /** Rendering is stopped for now; added rather than a new stage, for app builds in the field. */
    paused?: boolean;
  } | null = null;

  if (generation.gpuJob && ['pending', 'processing'].includes(generation.status)) {
    const job = generation.gpuJob;
    const eta = await GpuEta.estimate(generation.id);

    if (job.status === 'running') {
      gpu = { stage: 'rendering', label: QUEUE_LABELS.rendering, queuePosition: 0, etaSeconds: eta.seconds, etaLabel: formatEta(eta.seconds), etaBasis: eta.basis };
    } else if (job.status === 'assigned') {
      gpu = { stage: 'starting', label: QUEUE_LABELS.starting, queuePosition: 0, etaSeconds: eta.seconds, etaLabel: formatEta(eta.seconds), etaBasis: eta.basis };
    } else if (await GpuBalance.pausesModel(await getGpuConfig(), job.modelKey)) {
      // Nothing will render until an admin tops up the vendor balance, so a
      // countdown would be a false promise. Say what happens instead.
      gpu = {
        stage: 'queued',
        label: `${QUEUE_LABELS.paused} ถ้ายังไม่กลับมาภายใน ${Math.round(INSUFFICIENT_BALANCE_GRACE_MS / 60_000)} นาที จะคืนเครดิตให้อัตโนมัติ`,
        queuePosition: null,
        etaSeconds: null,
        etaLabel: null,
        etaBasis: eta.basis,
        paused: true,
      };
    } else {
      // The ETA's count includes jobs already rendering ahead, which is what
      // "people in front of you" means to a customer.
      const real = eta.queuePosition ?? (await GpuQueue.getQueuePosition(generation.id)) ?? 1;
      const startup = Math.min(MAX_STARTUP_PLACES, Math.ceil(eta.warmupRemainingSeconds / STARTUP_SECONDS_PER_PLACE));
      const position = real + startup;
      gpu = {
        stage: 'queued',
        label: position <= 1 ? QUEUE_LABELS.next : QUEUE_LABELS.queued,
        queuePosition: position,
        etaSeconds: eta.seconds,
        etaLabel: formatEta(eta.seconds),
        // 'baseline' means no history yet — the UI softens the wording so a
        // first run's rough guess isn't presented as a firm promise.
        etaBasis: eta.basis,
      };
    }
  }

  return NextResponse.json({
    gpu,
    // Retention, stated on every read so the customer is never surprised.
    expiresAt: generation.expiresAt,
    daysLeft: daysUntil(generation.expiresAt),
    mediaDeleted: Boolean(generation.mediaDeletedAt),
    creditsRefunded: generation.creditsRefunded,
    retentionDays,
    id: generation.id,
    status: generation.status,
    type: generation.type,
    resultUrl: generation.resultUrl,
    resultUrls: generation.resultUrls,
    thumbnailUrl: generation.thumbnailUrl,
    creditsUsed: generation.creditsUsed,
    processingMs: generation.processingMs,
    errorMessage: generation.errorMessage,
    prompt: generation.prompt,
    model: {
      name: generation.model.name,
      provider: publicProvider(generation.model.provider).name,
    },
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
  });
}
