import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { StoryError, idList, loadOwnedProject, movieModels } from '@/lib/story/service';
import { serializeProject, shotPatch, storyErrorReply } from '@/lib/story/http';

/**
 * PATCH  /api/story/[id]/shots/[shotId] — edit one shot.
 * DELETE /api/story/[id]/shots/[shotId] — remove it; later shots move up.
 * Neither touches a shot while it renders: the order in flight owns it.
 */

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; shotId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const p = await params;
  const id = Number(p.id);
  const shotId = Number(p.shotId);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    const shot = project?.shots.find((s) => s.id === shotId);
    if (!project || !shot) return NextResponse.json({ error: 'ไม่พบช็อตนี้' }, { status: 404 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new StoryError('ข้อมูลไม่ถูกต้อง');
    const data = shotPatch(body, project, await movieModels(admin), {
      shotSize: shot.shotSize,
      camera: shot.camera,
      characterIds: idList(shot.characterIds),
    });
    if (Object.keys(data).length > 0) {
      const r = await prisma.aiStoryShot.updateMany({ where: { id: shot.id, status: { not: 'rendering' } }, data });
      if (r.count === 0) throw new StoryError('ช็อตนี้กำลังสร้างอยู่ แก้ไขได้เมื่อเสร็จแล้ว', 409);
    }
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin));
  } catch (error) {
    return storyErrorReply(error, 'patch-shot');
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const p = await params;
  const id = Number(p.id);
  const shotId = Number(p.shotId);
  try {
    const project = await loadOwnedProject(userId, id);
    const shot = project?.shots.find((s) => s.id === shotId);
    if (!project || !shot) return NextResponse.json({ error: 'ไม่พบช็อตนี้' }, { status: 404 });
    await prisma.$transaction(async (tx) => {
      const r = await tx.aiStoryShot.deleteMany({ where: { id: shot.id, status: { not: 'rendering' } } });
      if (r.count === 0) throw new StoryError('ช็อตนี้กำลังสร้างอยู่ ลบได้เมื่อเสร็จแล้ว', 409);
      await tx.aiStoryShot.updateMany({
        where: { projectId: project.id, shotNumber: { gt: shot.shotNumber } },
        data: { shotNumber: { decrement: 1 } },
      });
    });
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, await isAdmin()));
  } catch (error) {
    return storyErrorReply(error, 'delete-shot');
  }
}
