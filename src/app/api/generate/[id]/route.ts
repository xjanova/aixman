import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { GpuQueue } from '@/lib/services/gpu-queue';

/** Thai progress copy for GPU-backed jobs, keyed by worker state. */
const GPU_STAGE_LABELS: Record<string, string> = {
  queued: 'อยู่ในคิว รอเครื่อง GPU ว่าง',
  provisioning: 'กำลังเช่าเครื่อง GPU',
  warming: 'กำลังโหลดโมเดลเข้าเครื่อง (ครั้งแรกใช้เวลาสักพัก)',
  ready: 'เครื่องพร้อมแล้ว กำลังเริ่มเรนเดอร์',
  rendering: 'กำลังเรนเดอร์วิดีโอ',
};

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
      gpuJob: { include: { worker: { select: { status: true, gpuModel: true } } } },
    },
  });

  if (!generation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // GPU-backed jobs rent a machine on demand, so a first render can legitimately
  // take 10-25 minutes. Reporting progress lets the client wait it out instead
  // of declaring a timeout and pushing the user to pay for a second attempt.
  let gpu: {
    stage: string;
    label: string;
    queuePosition: number | null;
    gpuModel: string | null;
  } | null = null;

  if (generation.gpuJob && ['pending', 'processing'].includes(generation.status)) {
    const job = generation.gpuJob;
    const stage =
      job.status === 'running'
        ? 'rendering'
        : job.worker?.status === 'ready'
          ? 'ready'
          : job.worker?.status === 'warming'
            ? 'warming'
            : job.worker?.status === 'provisioning'
              ? 'provisioning'
              : 'queued';

    gpu = {
      stage,
      label: GPU_STAGE_LABELS[stage] ?? GPU_STAGE_LABELS.queued,
      queuePosition: await GpuQueue.getQueuePosition(generation.id),
      gpuModel: job.worker?.gpuModel ?? null,
    };
  }

  return NextResponse.json({
    gpu,
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
      provider: generation.model.provider.name,
    },
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
  });
}
