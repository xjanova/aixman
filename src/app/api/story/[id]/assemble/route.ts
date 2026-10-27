import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { startAssembly } from '@/lib/story/assemble';
import { assemblePrice } from '@/lib/story/edit';
import { StoryError, assemblePriceSettings, loadOwnedProject, readyFilmSeconds } from '@/lib/story/service';
import { serializeProject, storyErrorReply } from '@/lib/story/http';

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

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    if (!project.shots.some((s) => s.status === 'done' && s.mediaUrl)) throw new StoryError('ยังไม่มีช็อตที่สร้างเสร็จ', 422);
    if (!admin) {
      const limit = rateLimit(`story-assemble:${userId}`, PER_HOUR, 60 * 60_000);
      if (!limit.ok) {
        return NextResponse.json(
          { error: `ตัดต่อครบ ${PER_HOUR} ครั้งในชั่วโมงนี้แล้ว ลองใหม่ในอีก ${Math.ceil(limit.retryAfter / 60)} นาที` },
          { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
        );
      }
    }
    const credits = admin ? 0 : assemblePrice(readyFilmSeconds(project), await assemblePriceSettings());
    if (!(await startAssembly(userId, project.id, credits, project.title))) throw new StoryError('กำลังตัดต่ออยู่แล้ว', 409);
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin));
  } catch (error) {
    return storyErrorReply(error, 'assemble');
  }
}
