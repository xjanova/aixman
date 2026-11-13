import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { requestLocale } from '@/lib/i18n/locale';
import { rateLimit } from '@/lib/rate-limit';
import { LIMITS } from '@/lib/story/cinematic';
import { claimSpeech, placeSpeech, speechModel } from '@/lib/story/dub-service';
import { idList, loadOwnedProject, StoryError } from '@/lib/story/service';
import { STORY_REPLY, hourlyLimitReply, serializeProject, storyErrorReply, storyReply } from '@/lib/story/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  try {
    const admin = await isAdmin();
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    const body = await request.json().catch(() => null);
    const ids = [...new Set(idList(body?.shotIds))].slice(0, LIMITS.shotsFilm);
    if (!ids.length) throw new StoryError({ th: 'เลือกช็อตที่จะพากย์ก่อน', en: 'Select shots to dub first.' });
    if (!(await speechModel(admin))?.orderable) throw new StoryError({ th: 'ElevenLabs V3 ยังไม่เปิดให้ใช้ — ให้ผู้ดูแลทดสอบโมเดลก่อน', en: 'ElevenLabs V3 is not available yet — ask an admin to test the model first.' }, 409);
    if (!admin) {
      const limit = rateLimit(`story-dubbing:${userId}`, 20, 3600_000);
      if (!limit.ok) return hourlyLimitReply({ th: 'สั่งพากย์', en: 'ordered dubbing' }, 20, limit.retryAfter, locale);
    }
    const claimed = await claimSpeech(project, ids);
    if (!claimed.length) throw new StoryError({ th: 'ไม่มีช็อตที่พากย์ได้ — ต้องมีบทพูดและไม่กำลังสร้างอยู่', en: 'No shots can be dubbed — they need dialogue and must not be rendering.' }, 409);
    after(() => placeSpeech(userId, admin, id, claimed));
    return NextResponse.json({ ...await serializeProject((await loadOwnedProject(userId, id))!, admin, locale), ordered: claimed.length });
  } catch (e) { return storyErrorReply(e, 'dubbing', locale); }
}
