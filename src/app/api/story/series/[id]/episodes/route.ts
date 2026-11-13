import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { STORY_REPLY, storyErrorReply, storyReply } from '@/lib/story/http';
import { createEpisode, loadOwnedSeries } from '@/lib/story/series-service';
import { requestLocale } from '@/lib/i18n/locale';

/**
 * POST /api/story/series/[id]/episodes — `{episode: n}`: make episode n into
 * a film project (its brief from the outline, the series' look, frame and
 * length, the library of the nearest episode made) and answer its id; the
 * page opens it in the film editor, where AI plans its shots as for any film.
 * An episode already made answers its id (200) rather than a second copy.
 * Nothing is charged here.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  try {
    const series = await loadOwnedSeries(userId, Number((await params).id));
    if (!series) return storyReply({ th: 'ไม่พบซีรีส์', en: 'Series not found.' }, locale, 404);
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const result = await createEpisode(userId, series, Number(body.episode));
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return storyErrorReply(error, 'series episode', locale);
  }
}
