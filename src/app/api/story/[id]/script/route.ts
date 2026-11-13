import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { loadOwnedProject } from '@/lib/story/service';
import { STORY_REPLY, storyErrorReply, storyReply } from '@/lib/story/http';
import { episodeLedger, shootingScript } from '@/lib/story/shooting';
import { previousEpisodeContext } from '@/lib/story/shooting-service';
import { requestLocale } from '@/lib/i18n/locale';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return storyReply(STORY_REPLY.projectNotFound, locale, 404);
    const format = request.nextUrl.searchParams.get('format') ?? 'script';
    const script = (project.scriptJson ?? {}) as Record<string, unknown>;
    const delivery = script.delivery as { videoUrl?: unknown; srt?: unknown; script?: unknown } | undefined;
    const final = delivery && delivery.videoUrl === project.finalVideoUrl ? delivery : null;
    if (format === 'view') return NextResponse.json({ script: shootingScript(project, locale), ledger: episodeLedger(project), previous: await previousEpisodeContext(project) });
    if (format === 'srt' || format === 'manifest' || format === 'final-script') {
      if (!final || typeof final.srt !== 'string') return storyReply({ th: 'ตัดต่อใหม่ก่อนดาวน์โหลดแพ็กตอนและซับที่ตรงกับไฟล์หนัง', en: 'Cut the film first to download its matching episode package and subtitles.' }, locale, 422);
      const content = format === 'srt' ? '\uFEFF' + final.srt : format === 'final-script' ? '\uFEFF' + String(final.script ?? '') : JSON.stringify(final, null, 2);
      return new NextResponse(content, { headers: { 'Content-Type': format === 'manifest' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="episode-${project.episodeNumber ?? project.id}.${format === 'srt' ? 'srt' : format === 'manifest' ? 'json' : 'txt'}"`, 'Cache-Control': 'private, no-store' } });
    }
    if (format !== 'script') return storyReply(STORY_REPLY.badRequest, locale, 400);
    return new NextResponse('\uFEFF' + shootingScript(project, locale), { headers: { 'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="shooting-script-${project.id}.txt"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return storyErrorReply(error, 'shooting-script', locale);
  }
}
