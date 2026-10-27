import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { LIMITS } from '@/lib/story/cinematic';
import { StoryError, loadOwnedProject, syncShots } from '@/lib/story/service';
import { editPatch, parseCharacters, projectSettings, serializeProject, storyErrorReply, text } from '@/lib/story/http';

/**
 * GET    /api/story/[id] — the project with its shots (rendering shots are
 *                          brought up to date with their orders first).
 * PATCH  /api/story/[id] — title, story/lyrics, look, mood, frame, characters,
 *                          and the edit's switches (`edit`, see edit.ts).
 * DELETE /api/story/[id] — the project and its storyboard. The rendered clips
 *                          stay in the gallery; they were ordinary orders.
 */

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  try {
    let project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    if (await syncShots(project)) {
      project = (await loadOwnedProject(userId, id))!;
      if (project.status === 'rendering' && !project.shots.some((s) => s.status === 'rendering')) {
        await prisma.aiStoryProject.updateMany({ where: { id, status: 'rendering' }, data: { status: 'draft' } });
      }
    }
    return NextResponse.json(await serializeProject(project, await isAdmin()));
  } catch (error) {
    return storyErrorReply(error, 'get');
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new StoryError('ข้อมูลไม่ถูกต้อง');

    const data: Record<string, unknown> = projectSettings(body);
    if (data.title === '') delete data.title;
    if (project.mode !== 'mv') delete data.mood;
    if (body.brief !== undefined) {
      const brief = text(body.brief, LIMITS.brief);
      if (!brief) throw new StoryError(project.mode === 'mv' ? 'เนื้อเพลงว่างไม่ได้' : 'เรื่องย่อว่างไม่ได้');
      data.brief = brief;
    }
    const characters = body.characters !== undefined ? parseCharacters(body.characters, userId) : null;
    if (body.edit !== undefined) data.scriptJson = editPatch(project, body.edit);

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) await tx.aiStoryProject.update({ where: { id: project.id }, data });
      if (!characters) return;
      // Characters keep their ids so the shots that name them still do; one
      // left out is removed (shots simply stop naming it).
      const keep = characters.filter((c) => c.id && project.characters.some((x) => x.id === c.id));
      await tx.aiStoryCharacter.deleteMany({
        where: { projectId: project.id, id: { notIn: keep.map((c) => c.id!) } },
      });
      for (const [k, c] of characters.entries()) {
        const fields = { name: c.name, description: c.description, referenceUrl: c.referenceUrl, sortOrder: k };
        if (c.id && keep.includes(c)) await tx.aiStoryCharacter.update({ where: { id: c.id }, data: fields });
        else await tx.aiStoryCharacter.create({ data: { ...fields, projectId: project.id, origin: 'uploaded' } });
      }
    });
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, await isAdmin()));
  } catch (error) {
    return storyErrorReply(error, 'patch');
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
  // Characters and shots go with it (ON DELETE CASCADE).
  const r = await prisma.aiStoryProject.deleteMany({ where: { id, userId } });
  if (r.count === 0) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
