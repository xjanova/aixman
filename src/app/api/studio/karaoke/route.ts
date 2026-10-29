import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { requestLocale, translator, type Locale } from '@/lib/i18n/locale';
import { messageFor } from '@/lib/i18n/messages';
import {
  KaraokeError,
  findKaraoke,
  isKaraokeId,
  karaokeNeedsRun,
  karaokeReady,
  karaokeStatus,
  karaokeStatusJson as statusJson,
  saveKaraokeTiming,
  startKaraoke,
} from '@/lib/lyrics/karaoke-job';
import { isOwnAudioKey } from '@/lib/own-audio';
import { rateLimit } from '@/lib/rate-limit';
import { keyFromPublicUrl } from '@/lib/storage/r2';

/**
 * Karaoke timing for one of the caller's own songs (lyrics/karaoke-job.ts).
 *
 *   POST { src, lyrics, force? }  time the song to these lyrics (free, a few
 *                                 minutes) → { id, status }; an existing timing
 *                                 comes back at once
 *   POST { src, lyrics, peek }    where a timing of these stands, starting nothing
 *   GET  ?id=                     where it stands → { status }
 *   PUT  { id, timing }           save lines the customer moved
 *
 * The song must be the caller's own upload or result (own-audio.ts, from the
 * key alone). A timing lives under the caller's own prefix, so an id only
 * ever reaches their own.
 */

export const dynamic = 'force-dynamic';

const STARTS_PER_HOUR = 6;
const MAX_LYRICS = 6000;

function errorReply(error: unknown, locale: Locale) {
  if (error instanceof KaraokeError) return NextResponse.json({ error: messageFor(error, locale) }, { status: error.status });
  console.error('[karaoke] route:', error);
  return NextResponse.json({ error: translator(locale)({ th: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', en: 'Something went wrong. Please try again.' }) }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!isKaraokeId(id)) return NextResponse.json({ available: karaokeReady() });
  try {
    return NextResponse.json({ id, available: karaokeReady(), status: statusJson(await karaokeStatus(userId, id), locale) });
  } catch (error) {
    return errorReply(error, locale);
  }
}

export async function POST(request: NextRequest) {
  const locale = requestLocale(request);
  const t = translator(locale);
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const src = typeof body?.src === 'string' && body.src.length <= 2000 ? body.src : '';
  if (!isOwnAudioKey(keyFromPublicUrl(src), userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const lyrics = typeof body?.lyrics === 'string' ? body.lyrics : '';
  if (lyrics.length > MAX_LYRICS) {
    return NextResponse.json({ error: t({ th: `เนื้อเพลงยาวเกิน ${MAX_LYRICS} ตัวอักษร`, en: `The lyrics are longer than ${MAX_LYRICS} characters.` }) }, { status: 422 });
  }
  try {
    const force = body?.force === true;
    // Counted only when a timing is really made: asking for one that exists is free.
    const found = await findKaraoke({ userId, songUrl: src, lyrics });
    // `peek`: only where it stands, so a page can show a timing made earlier without starting one.
    if (body?.peek === true) return NextResponse.json({ id: found.id, available: karaokeReady(), status: statusJson(found.status, locale) });
    if (karaokeNeedsRun(found.status, force)) {
      if (!(await isAdmin())) {
        const limit = rateLimit(`karaoke:${userId}`, STARTS_PER_HOUR, 60 * 60_000);
        if (!limit.ok) {
          const minutes = Math.ceil(limit.retryAfter / 60);
          return NextResponse.json(
            {
              error: t({
                th: `จับจังหวะเนื้อร้องครบ ${STARTS_PER_HOUR} เพลงในชั่วโมงนี้แล้ว ลองใหม่ในอีก ${minutes} นาที`,
                en: `You've timed ${STARTS_PER_HOUR} songs this hour. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
              }),
            },
            { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
          );
        }
      }
      const made = await startKaraoke({ userId, songUrl: src, lyrics, force });
      return NextResponse.json({ id: made.id, status: statusJson(made.status, locale) });
    }
    return NextResponse.json({ id: found.id, status: statusJson(found.status, locale) });
  } catch (error) {
    return errorReply(error, locale);
  }
}

export async function PUT(request: NextRequest) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 400_000) return NextResponse.json({ error: 'Too large' }, { status: 413 });
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!isKaraokeId(body?.id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  try {
    const doc = await saveKaraokeTiming(userId, body.id, body.timing);
    return NextResponse.json({ id: body.id, status: { state: 'done', doc } });
  } catch (error) {
    return errorReply(error, locale);
  }
}
