import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { STEM_TOLERANCE_SECONDS } from '@/lib/story/sing';
import { StoryError, loadOwnedProject } from '@/lib/story/service';
import { isOwnUpload, serializeProject, songSeconds, storyErrorReply } from '@/lib/story/http';
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
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    if (project.mode !== 'mv' || !project.songUrl) throw new StoryError('ใช้ได้เฉพาะ MV ที่มีเพลง', 422);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (body?.action === 'separate') {
      if (!admin) {
        const limit = rateLimit(`story-separate:${userId}`, SEPARATIONS_PER_HOUR, 60 * 60_000);
        if (!limit.ok) {
          return NextResponse.json(
            { error: `แยกเสียงร้องครบ ${SEPARATIONS_PER_HOUR} ครั้งในชั่วโมงนี้แล้ว ลองใหม่ในอีก ${Math.ceil(limit.retryAfter / 60)} นาที` },
            { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
          );
        }
      }
      if (!(await startSeparation(project))) throw new StoryError('กำลังแยกเสียงร้องอยู่แล้ว', 409);
    } else if (body?.uploadUrl !== undefined) {
      if (!isOwnUpload(body.uploadUrl, userId, 'audio')) throw new StoryError('ไฟล์เสียงร้องไม่ถูกต้อง อัปโหลดใหม่อีกครั้ง', 422);
      const seconds = await songSeconds(body.uploadUrl);
      const song = Number(project.songSeconds ?? 0);
      if (song > 0 && Math.abs(seconds - song) > STEM_TOLERANCE_SECONDS) {
        throw new StoryError(`ไฟล์เสียงร้องยาว ${seconds.toFixed(1)} วินาที แต่เพลงยาว ${song.toFixed(1)} วินาที — ต้องเป็นแทร็กเสียงร้องของเพลงนี้ ยาวเท่ากัน`, 422);
      }
      await adoptUploadedVocals(project, body.uploadUrl);
    } else {
      throw new StoryError('ข้อมูลไม่ถูกต้อง');
    }
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin));
  } catch (error) {
    return storyErrorReply(error, 'vocals');
  }
}
