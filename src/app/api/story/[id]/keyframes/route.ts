import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { chooseModel, imageModels, orderKeyframe, pictureSettings } from '@/lib/story/keyframes';
import { StoryError, idList, loadOwnedProject } from '@/lib/story/service';
import { serializeProject, storyErrorReply } from '@/lib/story/http';

/**
 * POST /api/story/[id]/keyframes {shotIds} — order the shots' opening
 * pictures: each one composed from the shot's characters, props and place by
 * the project's picture model (reference-caps.ts says how many it takes).
 * Each is its own studio order, charged and refunded like one, run after the
 * response; the page polls. The first refusal stops the rest.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_PER_CALL = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const shotIds = [...new Set(idList(body.shotIds))].slice(0, MAX_PER_CALL);
    if (shotIds.length === 0) throw new StoryError('เลือกช็อตที่จะสร้างภาพเปิดก่อน');

    const model = chooseModel(await imageModels(admin), pictureSettings(project.scriptJson).keyframeModelId, true);
    if (!model) throw new StoryError('ยังไม่มีโมเดลภาพที่รับภาพอ้างอิงเปิดให้ใช้ตอนนี้', 409);
    let ordered = 0;
    let stoppedBy: string | null = null;
    let stoppedStatus = 0;
    for (const shotId of shotIds) {
      try {
        await orderKeyframe(userId, admin, project, shotId, model);
        ordered++;
      } catch (error) {
        const reply = storyErrorReply(error, 'keyframe');
        stoppedBy = ((await reply.json()) as { error: string }).error;
        stoppedStatus = reply.status;
        break;
      }
    }
    if (ordered === 0 && stoppedBy) return NextResponse.json({ error: stoppedBy }, { status: stoppedStatus });
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json({ ...(await serializeProject(fresh, admin)), ordered, stoppedBy });
  } catch (error) {
    return storyErrorReply(error, 'keyframes');
  }
}
