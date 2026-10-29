import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { requestLocale, type Locale } from '@/lib/i18n/locale';
import { messageFor } from '@/lib/i18n/messages';
import { KaraokeError, findKaraoke, karaokeNeedsRun, karaokeReady, karaokeStatusJson, startKaraoke } from '@/lib/lyrics/karaoke-job';
import { rateLimit } from '@/lib/rate-limit';
import { STORY_REPLY, hourlyLimitReply, storyErrorReply, storyReply } from '@/lib/story/http';
import { StoryError, loadOwnedProject } from '@/lib/story/service';
import { separatedStems } from '@/lib/story/vocals';

/**
 * The MV's karaoke timing: its song timed to its lyrics (lyrics/karaoke-job.ts),
 * the same timing the studio makes for that song and those words. A song
 * lip-sync already separated is timed on that vocal (story/vocals.ts separatedStems).
 *   GET            → { available, id, status }
 *   POST { force } → start it (free; the page polls GET)
 * The cut reads it when the karaoke switch is on (story/assemble.ts).
 */

export const dynamic = 'force-dynamic';

const STARTS_PER_HOUR = 6;

function errorReply(error: unknown, locale: Locale) {
  if (error instanceof KaraokeError) return NextResponse.json({ error: messageFor(error, locale) }, { status: error.status });
  return storyErrorReply(error, 'karaoke', locale);
}

async function project(request: NextRequest, params: Promise<{ id: string }>) {
  const userId = await getCurrentUserId();
  if (!userId) return { error: storyReply(STORY_REPLY.signIn, requestLocale(request), 401) } as const;
  const p = await loadOwnedProject(userId, Number((await params).id));
  if (!p) return { error: storyReply(STORY_REPLY.projectNotFound, requestLocale(request), 404) } as const;
  if (p.mode !== 'mv' || !p.songUrl) throw new StoryError({ th: 'คาราโอเกะใช้ได้เฉพาะ MV ที่มีเพลง', en: 'Karaoke is only for an MV with a song.' }, 422);
  return { userId, project: p, songUrl: p.songUrl, lyrics: p.brief ?? '' } as const;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  try {
    const p = await project(request, params);
    if ('error' in p) return p.error;
    const found = await findKaraoke({ userId: p.userId, songUrl: p.songUrl, lyrics: p.lyrics });
    return NextResponse.json({ available: karaokeReady(), id: found.id, status: karaokeStatusJson(found.status, locale) });
  } catch (error) {
    return errorReply(error, locale);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  try {
    const p = await project(request, params);
    if ('error' in p) return p.error;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const force = body?.force === true;
    const found = await findKaraoke({ userId: p.userId, songUrl: p.songUrl, lyrics: p.lyrics });
    const runs = karaokeNeedsRun(found.status, force);
    if (runs && !(await isAdmin())) {
      const limit = rateLimit(`karaoke:${p.userId}`, STARTS_PER_HOUR, 60 * 60_000);
      if (!limit.ok) return hourlyLimitReply({ th: 'จับจังหวะเนื้อร้อง', en: 'timed lyrics' }, STARTS_PER_HOUR, limit.retryAfter, locale);
    }
    // The vocal lip-sync already separated from this song, when there is one: not separated twice.
    const stems = runs ? await separatedStems(p.project) : null;
    const made = await startKaraoke({ userId: p.userId, songUrl: p.songUrl, lyrics: p.lyrics, force, stems });
    return NextResponse.json({ available: karaokeReady(), id: made.id, status: karaokeStatusJson(made.status, locale) });
  } catch (error) {
    return errorReply(error, locale);
  }
}
