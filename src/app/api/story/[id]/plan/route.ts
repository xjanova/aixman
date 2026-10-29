import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { claimPlan, finishPlan } from '@/lib/story/plan-jobs';
import { BUSY_MESSAGE, StoryError, idList, isBusyShot, loadOwnedProject, movieModels, planProject, planScenes } from '@/lib/story/service';
import { STORY_REPLY, hourlyLimitReply, serializeProject, storyErrorReply, storyReply } from '@/lib/story/http';
import { requestLocale } from '@/lib/i18n/locale';
import { packMsg } from '@/lib/i18n/messages';

/**
 * POST /api/story/[id]/plan — "✨ ให้ AI แตกช็อต": write (or rewrite) the
 * storyboard from the story or the lyrics — a film as acts, scenes and shots.
 * With {sceneIds} only those scenes' shots are re-planned (a scene, or every
 * scene of an act). Free, so limited per hour; a model that cannot be
 * reached falls back to the rule-based planner.
 *
 * Planned after the response — 202 with `planning` — and the page polls: a
 * film takes a structure call and then its scenes' calls, longer than the
 * proxy in front of us waits for one request.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PLANS_PER_HOUR = 20;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    if (!admin) {
      const limit = rateLimit(`story-plan:${userId}`, PLANS_PER_HOUR, 60 * 60_000);
      if (!limit.ok) return hourlyLimitReply({ th: 'ให้ AI วางช็อต', en: 'had AI plan shots' }, PLANS_PER_HOUR, limit.retryAfter, locale);
    }
    const models = await movieModels(admin);
    const fallback = models.find((m) => m.orderable) ?? models[0];
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const sceneIds = idList(body.sceneIds).filter((sid) => project.scenes.some((sc) => sc.id === sid));
    if (body.sceneIds !== undefined && sceneIds.length === 0) throw new StoryError({ th: 'ไม่พบฉากที่จะวางใหม่', en: "Couldn't find the scenes to re-plan." }, 404);
    const scoped = sceneIds.length > 0;
    const busy = project.shots.some((s) => isBusyShot(s) && (!scoped || (s.sceneId !== null && sceneIds.includes(s.sceneId))));
    if (busy) throw new StoryError(BUSY_MESSAGE, 409);
    if (!claimPlan(project.id)) throw new StoryError({ th: 'AI กำลังวางช็อตของโปรเจกต์นี้อยู่ รอสักครู่', en: 'AI is already planning this project. Please wait a moment.' }, 409);
    after(async () => {
      try {
        const result = scoped ? await planScenes(project, sceneIds, fallback?.id ?? null) : await planProject(project, fallback?.id ?? null, locale);
        if (result.fallbackReason) console.warn(`[story] plan ${project.id} fell back in part: ${result.fallbackReason}`);
        finishPlan(project.id, { shots: result.shots, rules: result.engine === 'rules' });
      } catch (error) {
        if (!(error instanceof StoryError)) console.error(`[story] plan ${project.id}:`, error);
        // Stored as a pair: the page reads it later, in whichever language it has then.
        finishPlan(project.id, { error: packMsg(error instanceof StoryError ? error.msg : { th: 'วางช็อตไม่สำเร็จ ลองใหม่อีกครั้ง', en: "Couldn't plan the shots. Please try again." }) });
      }
    });
    return NextResponse.json({ ...(await serializeProject(project, admin, locale)), planner: 'ai' }, { status: 202 });
  } catch (error) {
    return storyErrorReply(error, 'plan', locale);
  }
}
