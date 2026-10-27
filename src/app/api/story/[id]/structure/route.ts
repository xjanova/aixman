import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { STRUCTURE_LIMITS, TIMES_OF_DAY } from '@/lib/story/library';
import { StoryError, isBusyShot, loadOwnedProject } from '@/lib/story/service';
import { serializeProject, storyErrorReply, text } from '@/lib/story/http';

/**
 * POST /api/story/[id]/structure — acts and scenes, edited by hand.
 *   {action:'add-act', title?}                 a new act at the end
 *   {action:'update-act', actId, title?, summary?}
 *   {action:'delete-act', actId}              its scenes stay, in no act
 *   {action:'add-scene', actId?, title?}      a new scene at the end of the act (or the film)
 *   {action:'update-scene', sceneId, title?, summary?, locationId?, timeOfDay?, actId?}
 *   {action:'delete-scene', sceneId, withShots?}   its shots go too when asked,
 *                                             else they stay, in no scene
 *
 * Re-planning a scene's or an act's shots is POST /plan {sceneIds}.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const act = project.acts.find((a) => a.id === Number(body.actId));
    const scene = project.scenes.find((sc) => sc.id === Number(body.sceneId));
    const locations = new Set(project.characters.filter((c) => c.kind === 'location').map((c) => c.id));

    switch (body.action) {
      case 'add-act': {
        if (project.acts.length >= STRUCTURE_LIMITS.acts) throw new StoryError(`องก์ได้สูงสุด ${STRUCTURE_LIMITS.acts} องก์`);
        const number = project.acts.length + 1;
        await prisma.aiStoryAct.create({ data: { projectId: project.id, actNumber: number, title: text(body.title, STRUCTURE_LIMITS.title) || `องก์ ${number}` } });
        break;
      }
      case 'update-act': {
        if (!act) throw new StoryError('ไม่พบองก์นี้', 404);
        const data: Record<string, unknown> = {};
        if (body.title !== undefined) data.title = text(body.title, STRUCTURE_LIMITS.title) || act.title;
        if (body.summary !== undefined) data.summary = text(body.summary, STRUCTURE_LIMITS.summary) || null;
        await prisma.aiStoryAct.updateMany({ where: { id: act.id, projectId: project.id }, data });
        break;
      }
      case 'delete-act': {
        if (!act) throw new StoryError('ไม่พบองก์นี้', 404);
        await prisma.$transaction(async (tx) => {
          await tx.aiStoryAct.deleteMany({ where: { id: act.id, projectId: project.id } });
          const rest = project.acts.filter((a) => a.id !== act.id);
          for (const [k, a] of rest.entries()) if (a.actNumber !== k + 1) await tx.aiStoryAct.update({ where: { id: a.id }, data: { actNumber: k + 1 } });
        });
        break;
      }
      case 'add-scene': {
        if (project.scenes.length >= STRUCTURE_LIMITS.scenes) throw new StoryError(`ฉากได้สูงสุด ${STRUCTURE_LIMITS.scenes} ฉาก`);
        if (body.actId !== undefined && body.actId !== null && !act) throw new StoryError('ไม่พบองก์นี้', 404);
        await prisma.$transaction(async (tx) => {
          // After the act's last scene, or at the end of the film; later scenes move down one.
          const ofAct = act ? project.scenes.filter((sc) => sc.actId === act.id) : [];
          const at = ofAct.length ? ofAct[ofAct.length - 1].sceneNumber + 1 : act ? nextSceneNumberForAct(project, act.actNumber) : project.scenes.length + 1;
          for (const sc of [...project.scenes].reverse()) {
            if (sc.sceneNumber >= at) await tx.aiStoryScene.update({ where: { id: sc.id }, data: { sceneNumber: sc.sceneNumber + 1 } });
          }
          await tx.aiStoryScene.create({
            data: { projectId: project.id, actId: act?.id ?? null, sceneNumber: at, title: text(body.title, STRUCTURE_LIMITS.title) || `ฉากใหม่` },
          });
        });
        break;
      }
      case 'update-scene': {
        if (!scene) throw new StoryError('ไม่พบฉากนี้', 404);
        const data: Record<string, unknown> = {};
        if (body.title !== undefined) data.title = text(body.title, STRUCTURE_LIMITS.title) || scene.title;
        if (body.summary !== undefined) data.summary = text(body.summary, STRUCTURE_LIMITS.summary) || null;
        if (body.locationId !== undefined) {
          const loc = Number(body.locationId);
          data.locationId = body.locationId !== null && locations.has(loc) ? loc : null;
        }
        if (body.timeOfDay !== undefined) data.timeOfDay = typeof body.timeOfDay === 'string' && body.timeOfDay in TIMES_OF_DAY ? body.timeOfDay : null;
        if (body.actId !== undefined) {
          if (body.actId !== null && !act) throw new StoryError('ไม่พบองก์นี้', 404);
          data.actId = act?.id ?? null;
        }
        await prisma.aiStoryScene.updateMany({ where: { id: scene.id, projectId: project.id }, data });
        break;
      }
      case 'delete-scene': {
        if (!scene) throw new StoryError('ไม่พบฉากนี้', 404);
        const own = project.shots.filter((sh) => sh.sceneId === scene.id);
        if (body.withShots === true && own.some(isBusyShot)) {
          throw new StoryError('มีช็อตหรือภาพเปิดช็อตในฉากนี้กำลังสร้างอยู่ รอให้เสร็จก่อน', 409);
        }
        await prisma.$transaction(async (tx) => {
          if (body.withShots === true) {
            // keyframeStatus is nullable: `not` alone would skip the NULL rows.
            await tx.aiStoryShot.deleteMany({
              where: { projectId: project.id, sceneId: scene.id, status: { not: 'rendering' }, OR: [{ keyframeStatus: null }, { keyframeStatus: { not: 'rendering' } }] },
            });
            const left = await tx.aiStoryShot.findMany({ where: { projectId: project.id }, orderBy: { shotNumber: 'asc' }, select: { id: true, shotNumber: true } });
            for (const [k, sh] of left.entries()) if (sh.shotNumber !== k + 1) await tx.aiStoryShot.update({ where: { id: sh.id }, data: { shotNumber: k + 1 } });
          }
          await tx.aiStoryScene.deleteMany({ where: { id: scene.id, projectId: project.id } });
          for (const sc of project.scenes) if (sc.sceneNumber > scene.sceneNumber) await tx.aiStoryScene.update({ where: { id: sc.id }, data: { sceneNumber: sc.sceneNumber - 1 } });
        });
        break;
      }
      default:
        throw new StoryError('คำสั่งไม่ถูกต้อง');
    }
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, await isAdmin()));
  } catch (error) {
    return storyErrorReply(error, 'structure');
  }
}

/** Where an empty act's first scene goes: after the scenes of the acts before it. */
function nextSceneNumberForAct(project: { acts: { id: number; actNumber: number }[]; scenes: { actId: number | null; sceneNumber: number }[] }, actNumber: number): number {
  const before = new Set(project.acts.filter((a) => a.actNumber < actNumber).map((a) => a.id));
  const last = project.scenes.filter((sc) => sc.actId !== null && before.has(sc.actId)).reduce((n, sc) => Math.max(n, sc.sceneNumber), 0);
  return last + 1;
}
