import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { STEM_TOLERANCE_SECONDS } from '@/lib/story/sing';
import { StoryError, loadOwnedProject } from '@/lib/story/service';
import { STORY_REPLY, hourlyLimitReply, isOwnUpload, serializeProject, songSeconds, storyErrorReply, storyReply } from '@/lib/story/http';
import { requestLocale } from '@/lib/i18n/locale';
import { startSeparation, adoptUploadedVocals } from '@/lib/story/vocals';

/**
 * POST /api/story/[id]/vocals — the MV's lead vocal, for lip-sync.
 *   { action: 'separate' }  take it out of the song on our server (Demucs,
 *                           free, a few minutes; the page polls `vocals.state`)
 *   { uploadUrl }           a vocal stem the customer uploaded instead; must be
 *                           as long as the song or the slices will not line up
 */

export const dynamic = 'force-dynamic';

const SEPARATIONS_PER_HOUR = 6;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    if (project.mode !== 'mv' || !project.songUrl) throw new StoryError({ th: 'ใช้ได้เฉพาะ MV ที่มีเพลง', en: 'Only for an MV with a song.' }, 422);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (body?.action === 'separate') {
      if (!admin) {
        const limit = rateLimit(`story-separate:${userId}`, SEPARATIONS_PER_HOUR, 60 * 60_000);
        if (!limit.ok) return hourlyLimitReply({ th: 'แยกเสียงร้อง', en: 'separated vocals' }, SEPARATIONS_PER_HOUR, limit.retryAfter, locale);
      }
      if (!(await startSeparation(project))) throw new StoryError({ th: 'กำลังแยกเสียงร้องอยู่แล้ว', en: 'The vocals are already being separated.' }, 409);
    } else if (body?.uploadUrl !== undefined) {
      if (!isOwnUpload(body.uploadUrl, userId, 'audio')) {
        throw new StoryError({ th: 'ไฟล์เสียงร้องไม่ถูกต้อง อัปโหลดใหม่อีกครั้ง', en: "The vocal file isn't valid. Please upload it again." }, 422);
      }
      const seconds = await songSeconds(body.uploadUrl);
      const song = Number(project.songSeconds ?? 0);
      if (song > 0 && Math.abs(seconds - song) > STEM_TOLERANCE_SECONDS) {
        throw new StoryError(
          {
            th: `ไฟล์เสียงร้องยาว ${seconds.toFixed(1)} วินาที แต่เพลงยาว ${song.toFixed(1)} วินาที — ต้องเป็นแทร็กเสียงร้องของเพลงนี้ ยาวเท่ากัน`,
            en: `The vocal file is ${seconds.toFixed(1)} seconds long but the song is ${song.toFixed(1)} seconds — it must be this song's vocal track, the same length.`,
          },
          422
        );
      }
      await adoptUploadedVocals(project, body.uploadUrl);
    } else {
      throw new StoryError(STORY_REPLY.badRequest);
    }
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin, locale));
  } catch (error) {
    return storyErrorReply(error, 'vocals', locale);
  }
}
