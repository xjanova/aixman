import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { LIMITS } from '@/lib/story/cinematic';
import { StoryError, idList, loadOwnedProject } from '@/lib/story/service';
import { STORY_REPLY, hourlyLimitReply, serializeProject, storyErrorReply, storyReply } from '@/lib/story/http';
import { requestLocale } from '@/lib/i18n/locale';
import { claimLipsync, lipsyncModel, placeLipsync } from '@/lib/story/vocals';

/**
 * POST /api/story/[id]/lipsync { shotIds } — re-dub finished MV shots so the
 * singer mouths the song. The shots are claimed now; their vocal slices are
 * cut and the LatentSync orders placed after the response (one ordinary,
 * charged, refundable order per shot). The page polls `lipsync.state`.
 */

export const dynamic = 'force-dynamic';

const PER_HOUR = 20;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const shotIds = [...new Set(idList(body?.shotIds))].slice(0, LIMITS.shotsMv);
    if (shotIds.length === 0) throw new StoryError({ th: 'เลือกช็อตที่จะลิปซิงก์ก่อน', en: 'Pick the shots to lip-sync first.' });
    const model = await lipsyncModel(admin);
    if (!model?.orderable) throw new StoryError({ th: 'ตัวลิปซิงก์ยังไม่เปิดให้ใช้ ลองใหม่ภายหลัง', en: "Lip-sync isn't available yet. Please try again later." }, 409);
    if (!admin) {
      const limit = rateLimit(`story-lipsync:${userId}`, PER_HOUR, 60 * 60_000);
      if (!limit.ok) return hourlyLimitReply({ th: 'สั่งลิปซิงก์', en: 'ordered lip-sync' }, PER_HOUR, limit.retryAfter, locale);
    }
    const claimed = await claimLipsync(project, shotIds);
    if (claimed.length === 0) {
      throw new StoryError(
        { th: 'ไม่มีช็อตที่ลิปซิงก์ได้ — ช็อตต้องสร้างเสร็จแล้ว และไม่ได้กำลังลิปซิงก์อยู่', en: 'No shots can be lip-synced — a shot must be finished and not already being lip-synced.' },
        409
      );
    }
    after(() => placeLipsync(userId, admin, project.id, claimed).catch((e) => console.error(`[story] lipsync ${project.id}:`, e)));
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json({ ...(await serializeProject(fresh, admin, locale)), ordered: claimed.length });
  } catch (error) {
    return storyErrorReply(error, 'lipsync', locale);
  }
}
