import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { chooseModel, imageModels, orderKeyframe, pictureSettings } from '@/lib/story/keyframes';
import { StoryError, idList, loadOwnedProject } from '@/lib/story/service';
import { STORY_REPLY, serializeProject, storyErrorReply, storyReply } from '@/lib/story/http';
import { requestLocale } from '@/lib/i18n/locale';

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
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const shotIds = [...new Set(idList(body.shotIds))].slice(0, MAX_PER_CALL);
    if (shotIds.length === 0) throw new StoryError({ th: 'เลือกช็อตที่จะสร้างภาพเปิดก่อน', en: 'Pick the shots to make opening pictures for first.' });

    const model = chooseModel(await imageModels(admin), pictureSettings(project.scriptJson).keyframeModelId, true);
    if (!model) throw new StoryError({ th: 'ยังไม่มีโมเดลภาพที่รับภาพอ้างอิงเปิดให้ใช้ตอนนี้', en: 'No image model that takes reference pictures is available right now.' }, 409);
    let ordered = 0;
    let stoppedBy: string | null = null;
    let stoppedStatus = 0;
    for (const shotId of shotIds) {
      try {
        await orderKeyframe(userId, admin, project, shotId, model);
        ordered++;
      } catch (error) {
        const reply = storyErrorReply(error, 'keyframe', locale);
        stoppedBy = ((await reply.json()) as { error: string }).error;
        stoppedStatus = reply.status;
        break;
      }
    }
    if (ordered === 0 && stoppedBy) return NextResponse.json({ error: stoppedBy }, { status: stoppedStatus });
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json({ ...(await serializeProject(fresh, admin, locale)), ordered, stoppedBy });
  } catch (error) {
    return storyErrorReply(error, 'keyframes', locale);
  }
}
