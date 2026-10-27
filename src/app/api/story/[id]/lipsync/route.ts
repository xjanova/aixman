import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { LIMITS } from '@/lib/story/cinematic';
import { StoryError, idList, loadOwnedProject } from '@/lib/story/service';
import { serializeProject, storyErrorReply } from '@/lib/story/http';
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
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const shotIds = [...new Set(idList(body?.shotIds))].slice(0, LIMITS.shotsMv);
    if (shotIds.length === 0) throw new StoryError('เลือกช็อตที่จะลิปซิงก์ก่อน');
    const model = await lipsyncModel(admin);
    if (!model?.orderable) throw new StoryError('ตัวลิปซิงก์ยังไม่เปิดให้ใช้ ลองใหม่ภายหลัง', 409);
    if (!admin) {
      const limit = rateLimit(`story-lipsync:${userId}`, PER_HOUR, 60 * 60_000);
      if (!limit.ok) {
        return NextResponse.json(
          { error: `สั่งลิปซิงก์ครบ ${PER_HOUR} ครั้งในชั่วโมงนี้แล้ว ลองใหม่ในอีก ${Math.ceil(limit.retryAfter / 60)} นาที` },
          { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
        );
      }
    }
    const claimed = await claimLipsync(project, shotIds);
    if (claimed.length === 0) throw new StoryError('ไม่มีช็อตที่ลิปซิงก์ได้ — ช็อตต้องสร้างเสร็จแล้ว และไม่ได้กำลังลิปซิงก์อยู่', 409);
    after(() => placeLipsync(userId, admin, project.id, claimed).catch((e) => console.error(`[story] lipsync ${project.id}:`, e)));
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json({ ...(await serializeProject(fresh, admin)), ordered: claimed.length });
  } catch (error) {
    return storyErrorReply(error, 'lipsync');
  }
}
