import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { StoryError, idList, loadOwnedProject, movieModels } from '@/lib/story/service';
import { STORY_REPLY, serializeProject, shotPatch, storyErrorReply, storyReply } from '@/lib/story/http';
import { requestLocale } from '@/lib/i18n/locale';

/**
 * PATCH  /api/story/[id]/shots/[shotId] — edit one shot.
 * DELETE /api/story/[id]/shots/[shotId] — remove it; later shots move up.
 * Neither touches a shot while it renders: the order in flight owns it.
 */

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; shotId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const p = await params;
  const id = Number(p.id);
  const shotId = Number(p.shotId);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    const shot = project?.shots.find((s) => s.id === shotId);
    if (!project || !shot) return storyReply(STORY_REPLY.shotNotFound, locale, 404);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new StoryError(STORY_REPLY.badRequest);
    const data = shotPatch(body, project, await movieModels(admin), {
      shotSize: shot.shotSize,
      camera: shot.camera,
      characterIds: idList(shot.characterIds),
    });
    if (Object.keys(data).length > 0) {
      const r = await prisma.aiStoryShot.updateMany({ where: { id: shot.id, status: { not: 'rendering' } }, data });
      if (r.count === 0) throw new StoryError({ th: 'ช็อตนี้กำลังสร้างอยู่ แก้ไขได้เมื่อเสร็จแล้ว', en: "This shot is being made. You can edit it once it's done." }, 409);
    }
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin, locale));
  } catch (error) {
    return storyErrorReply(error, 'patch-shot', locale);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const p = await params;
  const id = Number(p.id);
  const shotId = Number(p.shotId);
  try {
    const project = await loadOwnedProject(userId, id);
    const shot = project?.shots.find((s) => s.id === shotId);
    if (!project || !shot) return storyReply(STORY_REPLY.shotNotFound, locale, 404);
    await prisma.$transaction(async (tx) => {
      // keyframeStatus is nullable: `not` alone would skip the NULL rows.
      const r = await tx.aiStoryShot.deleteMany({
        where: { id: shot.id, status: { not: 'rendering' }, OR: [{ keyframeStatus: null }, { keyframeStatus: { not: 'rendering' } }] },
      });
      if (r.count === 0) {
        throw new StoryError({ th: 'ช็อตนี้หรือภาพเปิดของช็อตกำลังสร้างอยู่ ลบได้เมื่อเสร็จแล้ว', en: "This shot or its opening picture is being made. You can delete it once it's done." }, 409);
      }
      await tx.aiStoryShot.updateMany({
        where: { projectId: project.id, shotNumber: { gt: shot.shotNumber } },
        data: { shotNumber: { decrement: 1 } },
      });
    });
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, await isAdmin(), locale));
  } catch (error) {
    return storyErrorReply(error, 'delete-shot', locale);
  }
}
