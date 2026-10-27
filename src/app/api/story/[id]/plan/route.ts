import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { filmPartCount, filmTarget } from '@/lib/story/cinematic';
import { claimPlan, finishPlan } from '@/lib/story/plan-jobs';
import { StoryError, loadOwnedProject, movieModels, planProject } from '@/lib/story/service';
import { serializeProject, storyErrorReply } from '@/lib/story/http';

/**
 * POST /api/story/[id]/plan — "✨ ให้ AI แตกช็อต": write (or rewrite) the
 * storyboard from the story or the lyrics. Free, so limited per hour; a model
 * that cannot be reached falls back to the rule-based planner, never fails.
 *
 * A long film (a length past one part, cinematic.ts FILM_PART_SECONDS) is
 * planned after the response — 202 with `planning` — and the page polls.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PLANS_PER_HOUR = 20;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    if (!admin) {
      const limit = rateLimit(`story-plan:${userId}`, PLANS_PER_HOUR, 60 * 60_000);
      if (!limit.ok) {
        return NextResponse.json(
          { error: `ให้ AI วางช็อตครบ ${PLANS_PER_HOUR} ครั้งในชั่วโมงนี้แล้ว ลองใหม่ในอีก ${Math.ceil(limit.retryAfter / 60)} นาที` },
          { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
        );
      }
    }
    const models = await movieModels(admin);
    const fallback = models.find((m) => m.orderable) ?? models[0];
    if (project.mode === 'film' && filmPartCount(filmTarget(project.scriptJson)) > 0) {
      if (project.shots.some((s) => s.status === 'rendering')) {
        throw new StoryError('มีช็อตกำลังสร้างอยู่ รอให้เสร็จก่อนแล้วค่อยให้ AI วางช็อตใหม่', 409);
      }
      if (!claimPlan(project.id)) throw new StoryError('AI กำลังวางช็อตของโปรเจกต์นี้อยู่ รอสักครู่', 409);
      after(async () => {
        try {
          const result = await planProject(project, fallback?.id ?? null);
          if (result.fallbackReason) console.warn(`[story] plan ${project.id} fell back in part: ${result.fallbackReason}`);
          finishPlan(project.id, { shots: result.shots, rules: result.engine === 'rules' });
        } catch (error) {
          if (!(error instanceof StoryError)) console.error(`[story] plan ${project.id}:`, error);
          finishPlan(project.id, { error: error instanceof StoryError ? error.message : 'วางช็อตไม่สำเร็จ ลองใหม่อีกครั้ง' });
        }
      });
      return NextResponse.json({ ...(await serializeProject(project, admin)), planner: 'ai' }, { status: 202 });
    }
    const result = await planProject(project, fallback?.id ?? null);
    if (result.fallbackReason) console.warn(`[story] plan ${project.id} fell back to rules: ${result.fallbackReason}`);
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json({
      ...(await serializeProject(fresh, admin)),
      planner: result.engine === 'rules' ? 'rules' : 'ai',
    });
  } catch (error) {
    return storyErrorReply(error, 'plan');
  }
}
