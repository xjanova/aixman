import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { loadOwnedProject, orderMusic } from '@/lib/story/service';
import { STORY_REPLY, serializeProject, storyErrorReply, storyReply } from '@/lib/story/http';
import { requestLocale } from '@/lib/i18n/locale';

/**
 * POST /api/story/[id]/music — order the film's score from ACE-Step: an
 * instrumental in the film's look, as long as the storyboard. A normal music
 * order: charged now, refunded if it fails, kept in the gallery.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    await orderMusic(userId, admin, project);
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin, locale));
  } catch (error) {
    return storyErrorReply(error, 'music', locale);
  }
}
