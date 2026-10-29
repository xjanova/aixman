import { NextResponse } from 'next/server';
import { outputLabels } from '@/lib/output-labels';
import { songLyrics } from '@/lib/output-lyrics';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { GpuQueue } from '@/lib/services/gpu-queue';
import { RetentionService, daysUntil } from '@/lib/services/retention';
import { GpuEta, formatEta } from '@/lib/services/gpu-eta';
import { GpuProgress, estimatedFraction, type RenderPhase } from '@/lib/services/gpu-progress';
import { GpuBalance, INSUFFICIENT_BALANCE_GRACE_MS } from '@/lib/services/gpu-balance';
import { getGpuConfig } from '@/lib/gpu/config';
import { publicErrorMessage, publicModelName, publicProvider } from '@/lib/public-provider';
import { startupPlaces } from '@/lib/queue-progress';
import { apiQueueBlock } from '@/lib/api-queue';
import { ApiProgress, paramDuration } from '@/lib/services/api-progress';
import { pick, requestLocale, type Locale, type Msg } from '@/lib/i18n/locale';

/**
 * What the customer sees while an in-house job waits: a queue.
 *
 * How the work is run — renting a machine, booting it, loading weights — is a
 * trade secret, so none of it is named here. A machine that is still starting
 * is shown as places in the queue instead (startupPlaces), which count down
 * steadily as it boots. The ETA beside it stays the real estimate, so the wait
 * itself is never misstated.
 */

const QUEUE_LABELS = {
  queued: { th: 'อยู่ในคิว', en: 'In the queue' },
  next: { th: 'ใกล้ถึงคิวของคุณแล้ว', en: 'You’re almost next' },
  starting: { th: 'ถึงคิวของคุณแล้ว กำลังเริ่มสร้าง', en: 'It’s your turn — starting to create' },
  rendering: { th: 'กำลังสร้างผลงานของคุณ', en: 'Creating your work' },
} satisfies Record<string, Msg>;

/** What each measured stage of a render is called — never how it is run. */
const PHASE_LABELS: Record<RenderPhase, Msg> = {
  waiting: QUEUE_LABELS.starting,
  loading: { th: 'ถึงคิวของคุณแล้ว กำลังเตรียมการสร้าง', en: 'It’s your turn — getting ready to create' },
  sampling: QUEUE_LABELS.rendering,
  finishing: { th: 'ใกล้เสร็จแล้ว กำลังเก็บรายละเอียดสุดท้าย', en: 'Almost done — adding the final details' },
  saving: { th: 'สร้างเสร็จแล้ว กำลังบันทึกผลงาน', en: 'Done — saving your work' },
};

function pausedLabel(locale: Locale): string {
  const minutes = Math.round(INSUFFICIENT_BALANCE_GRACE_MS / 60_000);
  return locale === 'en'
    ? `Creating is paused for now. If it isn’t back within ${minutes} minutes, your credits are refunded automatically.`
    : `ระบบสร้างงานหยุดชั่วคราว ถ้ายังไม่กลับมาภายใน ${minutes} นาที จะคืนเครดิตให้อัตโนมัติ`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = requestLocale(request);
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
      // The worker is read server-side for render progress; none of it is
      // ever put in the response.
      gpuJob: { select: { status: true, modelKey: true, externalJobId: true, startedAt: true, worker: true } },
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
    /**
     * How far this render is, 0–0.99, once it is this customer's turn: step
     * counts from the renderer when it reports them, time served against the
     * estimate when it cannot. Null while queued.
     */
    progress?: number | null;
    /** Which measured stage the render is in; null when `progress` is an estimate. */
    phase?: RenderPhase | null;
    /** Rendering is stopped for now; added rather than a new stage, for app builds in the field. */
    paused?: boolean;
  } | null = null;

  if (generation.gpuJob && ['pending', 'processing'].includes(generation.status)) {
    const job = generation.gpuJob;
    const eta = await GpuEta.estimate(generation.id);

    if (job.status === 'running') {
      const measured = await GpuProgress.forRunningJob(job, job.worker);
      const elapsed = job.startedAt ? (Date.now() - job.startedAt.getTime()) / 1000 : 0;
      gpu = {
        stage: 'rendering',
        label: pick(measured?.phase ? PHASE_LABELS[measured.phase] : QUEUE_LABELS.rendering, locale),
        queuePosition: 0,
        etaSeconds: eta.seconds,
        etaLabel: formatEta(eta.seconds, locale),
        etaBasis: eta.basis,
        progress: measured?.fraction ?? estimatedFraction(elapsed, eta.seconds),
        phase: measured?.phase ?? null,
      };
    } else if (job.status === 'assigned') {
      gpu = { stage: 'starting', label: pick(QUEUE_LABELS.starting, locale), queuePosition: 0, etaSeconds: eta.seconds, etaLabel: formatEta(eta.seconds, locale), etaBasis: eta.basis, progress: 0, phase: null };
    } else if (await GpuBalance.pausesModel(await getGpuConfig(), job.modelKey)) {
      // Nothing will render until an admin tops up the vendor balance, so a
      // countdown would be a false promise. Say what happens instead.
      gpu = {
        stage: 'queued',
        label: pausedLabel(locale),
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
      const startup = startupPlaces(eta.warmupRemainingSeconds, eta.warmupSeconds);
      const position = real + startup;
      gpu = {
        stage: 'queued',
        label: pick(position <= 1 ? QUEUE_LABELS.next : QUEUE_LABELS.queued, locale),
        queuePosition: position,
        etaSeconds: eta.seconds,
        etaLabel: formatEta(eta.seconds, locale),
        // 'baseline' means no history yet — the UI softens the wording so a
        // first run's rough guess isn't presented as a firm promise.
        etaBasis: eta.basis,
      };
    }
  } else if (generation.status === 'processing' && generation.startedAt) {
    // An API order: the vendor's own queue, then the render — its percentage
    // timed from the moment the vendor starts on it (api-queue.ts).
    const eta = await ApiProgress.eta(generation.modelId, generation.type, paramDuration(generation.params));
    const elapsed = (Date.now() - generation.startedAt.getTime()) / 1000;
    const block = apiQueueBlock(ApiProgress.get(generation.id), elapsed, eta.seconds, Date.now());
    gpu = {
      stage: block.stage,
      label: pick(block.stage === 'queued' ? QUEUE_LABELS.queued : QUEUE_LABELS.rendering, locale),
      queuePosition: null,
      etaSeconds: block.etaSeconds,
      etaLabel: formatEta(block.etaSeconds, locale),
      etaBasis: eta.basis,
      progress: block.progress,
      phase: null,
    };
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
    // A stem split's file names ("เสียงร้อง", "กลอง" …), same order as resultUrls.
    resultLabels: outputLabels(generation.params, generation.resultUrls),
    // A song's words, same order as resultUrls (output-lyrics.ts).
    resultLyrics: generation.type === 'audio' ? songLyrics(generation.params, generation.resultUrls) : null,
    thumbnailUrl: generation.thumbnailUrl,
    creditsUsed: generation.creditsUsed,
    processingMs: generation.processingMs,
    errorMessage: publicErrorMessage(generation.errorMessage, locale),
    prompt: generation.prompt,
    model: {
      name: publicModelName(generation.model.modelId, generation.model.name, locale),
      provider: publicProvider(generation.model.provider).name,
    },
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
  });
}
