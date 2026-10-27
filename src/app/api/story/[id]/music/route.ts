import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { loadOwnedProject, orderMusic } from '@/lib/story/service';
import { serializeProject, storyErrorReply } from '@/lib/story/http';

/**
 * POST /api/story/[id]/music — order the film's score from ACE-Step: an
 * instrumental in the film's look, as long as the storyboard. A normal music
 * order: charged now, refunded if it fails, kept in the gallery.
 */

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    await orderMusic(userId, admin, project);
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin));
  } catch (error) {
    return storyErrorReply(error, 'music');
  }
}
