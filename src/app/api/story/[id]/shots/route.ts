import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { LIMITS } from '@/lib/story/cinematic';
import { StoryError, loadOwnedProject, movieModels } from '@/lib/story/service';
import { serializeProject, shotPatch, storyErrorReply } from '@/lib/story/http';

/** POST /api/story/[id]/shots — add a shot by hand after the last one. */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    const max = project.mode === 'mv' ? LIMITS.shotsMv : LIMITS.shotsFilm;
    if (project.shots.length >= max) throw new StoryError(`ช็อตได้สูงสุด ${max} ช็อต`, 409);

    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const models = await movieModels(admin);
    const last = project.shots.at(-1);
    const data = shotPatch(
      { visual: 'Describe what this shot shows.', durationSec: 5, ...body },
      project,
      models,
      { shotSize: 'medium', camera: 'static', characterIds: [] }
    );
    await prisma.aiStoryShot.create({
      data: {
        projectId: project.id,
        shotNumber: (last?.shotNumber ?? 0) + 1,
        visualPrompt: data.visualPrompt as string,
        durationSec: data.durationSec as number,
        characterIds: (data.characterIds as number[] | undefined) ?? [],
        modelId: (data.modelId as number | undefined) ?? last?.modelId ?? models.find((m) => m.orderable)?.id ?? null,
        ...(data.narration !== undefined ? { narration: data.narration as string | null } : {}),
        ...(data.sound !== undefined ? { sound: data.sound as string | null } : {}),
        ...(data.speakerId !== undefined ? { speakerId: data.speakerId as number | null } : {}),
        ...(data.shotSize !== undefined ? { shotSize: data.shotSize as string } : {}),
        ...(data.camera !== undefined ? { camera: data.camera as string } : {}),
        ...(data.startSec !== undefined ? { startSec: data.startSec as number | null } : {}),
      },
    });
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin), { status: 201 });
  } catch (error) {
    return storyErrorReply(error, 'add-shot');
  }
}
