import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { ASPECTS, LOOKS, pickKey } from '@/lib/story/cinematic';
import { StoryError } from '@/lib/story/service';
import { STORY_REPLY, parseCharacters, storyErrorReply, storyReply, text } from '@/lib/story/http';
import {
  NEW_SERIES_TITLE,
  SERIES_FORMATS,
  SERIES_GENRES,
  SERIES_LIMITS,
  episodeCountOf,
  episodeSecondsOf,
  isSeriesFormat,
  seriesLanguage,
} from '@/lib/story/series';
import { checkSeriesPlanLimit, claimBible, listSeries, writeBible } from '@/lib/story/series-service';
import { pick, requestLocale } from '@/lib/i18n/locale';
import type { Prisma } from '@/generated/prisma/client';

/**
 * GET  /api/story/series — the caller's series and short dramas.
 * POST /api/story/series — start one: the premise, the format (vertical short
 *                          drama or series), genre, look, frame, how many
 *                          episodes and how long, and the cast's pictures.
 *                          AI starts writing the outline after the response
 *                          (`planning`); the page polls the series. Nothing is
 *                          charged — each episode's shots are, when rendered.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  try {
    return NextResponse.json({ series: await listSeries(userId) });
  } catch (error) {
    return storyErrorReply(error, 'series list', locale);
  }
}

export async function POST(request: NextRequest) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new StoryError(STORY_REPLY.badRequest);
    const premise = text(body.premise, SERIES_LIMITS.premise);
    if (!premise) throw new StoryError({ th: 'เขียนเรื่องย่อของทั้งเรื่องก่อน', en: 'Write what the whole story is about first.' });

    const count = await prisma.aiStorySeries.count({ where: { userId } });
    if (count >= SERIES_LIMITS.series) {
      throw new StoryError(
        { th: `มีซีรีส์ครบ ${SERIES_LIMITS.series} เรื่องแล้ว ลบเรื่องเก่าก่อน`, en: `You already have ${SERIES_LIMITS.series} series. Delete an old one first.` },
        409
      );
    }

    const format = isSeriesFormat(body.format) ? body.format : 'short';
    const defaults = SERIES_FORMATS[format];
    const genre = pickKey(body.genre, SERIES_GENRES, 'romance');
    const cast = parseCharacters(body.characters, userId, locale).map((c) => ({ name: c.name, description: c.description, referenceUrl: c.referenceUrl, voiceId: c.voiceId ?? null }));
    // AI writes the outline unless the customer would rather write it.
    const plan = body.plan !== false;
    if (plan && !(await isAdmin())) checkSeriesPlanLimit(userId);

    const series = await prisma.aiStorySeries.create({
      data: {
        userId,
        title: text(body.title, SERIES_LIMITS.title) || pick(NEW_SERIES_TITLE, locale),
        premise,
        format,
        genre,
        language: seriesLanguage(premise),
        aspectRatio: pickKey(body.aspect, ASPECTS, defaults.aspect),
        templateKey: pickKey(body.look, LOOKS, SERIES_GENRES[genre].look),
        episodeSeconds: episodeSecondsOf(body.episodeSeconds, defaults.episodeSeconds),
        episodeCount: episodeCountOf(body.episodeCount, defaults.episodeCount),
        castJson: cast as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    const claimed = plan ? await claimBible(series.id) : null;
    if (claimed) {
      after(async () => {
        try {
          await writeBible(series.id, claimed, false);
        } catch (error) {
          console.error(`[story] series ${series.id} outline:`, error);
        }
      });
    }
    return NextResponse.json({ id: series.id, planning: Boolean(claimed) }, { status: 201 });
  } catch (error) {
    return storyErrorReply(error, 'series create', locale);
  }
}
