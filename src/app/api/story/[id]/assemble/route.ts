import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { karaokeForCut, startAssembly } from '@/lib/story/assemble';
import { assemblePrice, parseEdit } from '@/lib/story/edit';
import type { StoryMode } from '@/lib/story/cinematic';
import { StoryJobError } from '@/lib/story/media';
import { StoryError, assemblePriceSettings, loadOwnedProject, readyFilmSeconds } from '@/lib/story/service';
import { STORY_REPLY, hourlyLimitReply, serializeProject, storyErrorReply, storyReply } from '@/lib/story/http';
import { requestLocale } from '@/lib/i18n/locale';

/**
 * POST /api/story/[id]/assemble — join the finished shots into one film with
 * the project's edit switches (sound, music, subtitles, cover, fades, title).
 * Runs on our server after the response, one film at a time; the page polls
 * the project for `film.status`. Charged per started minute (edit.ts
 * assemblePrice; separate shot files are free), refunded if it fails, and
 * still limited per hour.
 */

export const dynamic = 'force-dynamic';

const PER_HOUR = 10;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    if (!project.shots.some((s) => s.status === 'done' && s.mediaUrl)) throw new StoryError({ th: 'ยังไม่มีช็อตที่สร้างเสร็จ', en: 'No shots are finished yet.' }, 422);
    // A karaoke cut needs its timing: refused here, before the charge.
    const edit = parseEdit(((project.scriptJson ?? {}) as Record<string, unknown>).edit, project.mode as StoryMode);
    if (project.mode === 'mv' && edit.karaoke) {
      await karaokeForCut(project, edit).catch((e) => {
        throw e instanceof StoryJobError ? new StoryError(e.msg, 409) : e;
      });
    }
    if (!admin) {
      const limit = rateLimit(`story-assemble:${userId}`, PER_HOUR, 60 * 60_000);
      if (!limit.ok) return hourlyLimitReply({ th: 'ตัดต่อ', en: 'cut a film' }, PER_HOUR, limit.retryAfter, locale);
    }
    const credits = admin ? 0 : assemblePrice(readyFilmSeconds(project), await assemblePriceSettings());
    if (!(await startAssembly(userId, project.id, credits, project.title))) throw new StoryError({ th: 'กำลังตัดต่ออยู่แล้ว', en: 'The film is already being cut.' }, 409);
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin, locale));
  } catch (error) {
    return storyErrorReply(error, 'assemble', locale);
  }
}
