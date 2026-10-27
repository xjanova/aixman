import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { loadOwnedProject, movieModels, planProject } from '@/lib/story/service';
import { serializeProject, storyErrorReply } from '@/lib/story/http';

/**
 * POST /api/story/[id]/plan — "✨ ให้ AI แตกช็อต": write (or rewrite) the
 * storyboard from the story or the lyrics. Free, so limited per hour; a model
 * that cannot be reached falls back to the rule-based planner, never fails.
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
