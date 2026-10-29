import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { LIMITS } from '@/lib/story/cinematic';
import { StoryError, loadOwnedProject, movieModels } from '@/lib/story/service';
import { STORY_REPLY, serializeProject, shotPatch, storyErrorReply, storyReply } from '@/lib/story/http';
import { requestLocale } from '@/lib/i18n/locale';

/**
 * POST /api/story/[id]/shots — add a shot by hand: after the last one, or
 * with {sceneId} after that scene's last shot (later shots move down one).
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    const max = project.mode === 'mv' ? LIMITS.shotsMv : LIMITS.shotsFilm;
    if (project.shots.length >= max) throw new StoryError({ th: `ช็อตได้สูงสุด ${max} ช็อต`, en: `You can have up to ${max} shots.` }, 409);

    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const models = await movieModels(admin);
    const last = project.shots.at(-1);
    const sceneId = body.sceneId === undefined || body.sceneId === null ? null : Number(body.sceneId);
    const scene = sceneId === null ? undefined : project.scenes.find((sc) => sc.id === sceneId);
    if (sceneId !== null && !scene) throw new StoryError({ th: 'ไม่พบฉากนี้', en: 'Scene not found.' }, 404);
    // After the scene's last shot; an empty scene's first one follows the scenes before it.
    const sceneNumberOf = (sh: (typeof project.shots)[number]) => project.scenes.find((x) => x.id === sh.sceneId)?.sceneNumber ?? 0;
    const before = scene ? project.shots.filter((sh) => sh.sceneId === scene.id || (sh.sceneId !== null && sceneNumberOf(sh) < scene.sceneNumber)) : project.shots;
    const at = (before.at(-1)?.shotNumber ?? 0) + 1;
    const data = shotPatch(
      { visual: 'Describe what this shot shows.', durationSec: 5, ...body },
      project,
      models,
      { shotSize: 'medium', camera: 'static', characterIds: [] }
    );
    await prisma.$transaction(async (tx) => {
      for (const sh of [...project.shots].reverse()) {
        if (sh.shotNumber >= at) await tx.aiStoryShot.update({ where: { id: sh.id }, data: { shotNumber: sh.shotNumber + 1 } });
      }
      await tx.aiStoryShot.create({
        data: {
          projectId: project.id,
          sceneId: scene?.id ?? null,
          shotNumber: at,
          visualPrompt: data.visualPrompt as string,
          durationSec: data.durationSec as number,
          characterIds: (data.characterIds as number[] | undefined) ?? [],
          ...(data.propIds !== undefined ? { propIds: data.propIds as number[] } : {}),
          modelId: (data.modelId as number | undefined) ?? last?.modelId ?? models.find((m) => m.orderable)?.id ?? null,
          ...(data.narration !== undefined ? { narration: data.narration as string | null } : {}),
          ...(data.sound !== undefined ? { sound: data.sound as string | null } : {}),
          ...(data.speakerId !== undefined ? { speakerId: data.speakerId as number | null } : {}),
          ...(data.shotSize !== undefined ? { shotSize: data.shotSize as string } : {}),
          ...(data.camera !== undefined ? { camera: data.camera as string } : {}),
          ...(data.startSec !== undefined ? { startSec: data.startSec as number | null } : {}),
        },
      });
    });
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin, locale), { status: 201 });
  } catch (error) {
    return storyErrorReply(error, 'add-shot', locale);
  }
}
