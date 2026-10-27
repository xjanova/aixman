import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { StoryError, idList, loadOwnedProject, movieModels, renderShot } from '@/lib/story/service';
import { serializeProject, storyErrorReply } from '@/lib/story/http';

/**
 * POST /api/story/[id]/render {shotIds} — order shots. Each shot is its own
 * studio order, charged and refunded like one. Several are ordered one after
 * another; the first refusal (credits ran out, model paused) stops the rest,
 * and the shots already ordered stay ordered.
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
    if (shotIds.length === 0) throw new StoryError('เลือกช็อตที่จะสร้างก่อน');

    const models = await movieModels(admin);
    const ordered: number[] = [];
    let stoppedBy: string | null = null;
    let stoppedStatus = 0;
    for (const shotId of shotIds) {
      try {
        await renderShot(userId, admin, project, shotId, models);
        ordered.push(shotId);
      } catch (error) {
        const reply = storyErrorReply(error, 'render');
        stoppedBy = ((await reply.json()) as { error: string }).error;
        stoppedStatus = reply.status;
        break;
      }
    }
    if (ordered.length === 0 && stoppedBy) {
      return NextResponse.json({ error: stoppedBy }, { status: stoppedStatus });
    }
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json({ ...(await serializeProject(fresh, admin)), ordered: ordered.length, stoppedBy });
  } catch (error) {
    return storyErrorReply(error, 'render');
  }
}
