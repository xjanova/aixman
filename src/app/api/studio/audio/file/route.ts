import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { requestLocale, translator } from '@/lib/i18n/locale';
import { keyFromPublicUrl } from '@/lib/storage/r2';
import { isOwnAudioKey } from '@/lib/own-audio';
import { streamAudio } from '@/lib/audio-stream';

/**
 * GET /api/studio/audio/file?src=<public URL>
 *
 * Any one of the caller's own audio files, from our origin, so the page can
 * draw its waveform: a song's second version, each stem of a split, a song
 * uploaded or carried on to cover, extend or split. /api/studio/audio/[id]
 * serves an order's first file; this serves the rest.
 *
 * Ownership comes from the object key (own-audio.ts), so no row is read: only
 * a URL in our bucket under the caller's own `uploads/<id>/audio/` or
 * `generations/<id>/…` is fetched, never a stranger's file or another host.
 */
export async function GET(request: NextRequest) {
  const t = translator(requestLocale(request));
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const src = request.nextUrl.searchParams.get('src') ?? '';
  const key = src.length <= 2000 ? keyFromPublicUrl(src) : null;
  if (!key || !isOwnAudioKey(key, userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return streamAudio(request, src, t);
}
