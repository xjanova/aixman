import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { ASPECTS, LOOKS, pickKey } from '@/lib/story/cinematic';
import { StoryError } from '@/lib/story/service';
import { STORY_REPLY, parseCharacters, storyErrorReply, storyReply, text } from '@/lib/story/http';
import {
  SERIES_GENRES,
  SERIES_LIMITS,
  bibleOf,
  editEpisodes,
  episodeCountOf,
  episodeSecondsOf,
  firstUnwritten,
  isSeriesFormat,
  seriesLanguage,
} from '@/lib/story/series';
import { PLANNING_NOW, isPlanning, loadOwnedSeries, notPlanningWhere, serializeSeries } from '@/lib/story/series-service';
import { requestLocale } from '@/lib/i18n/locale';
import type { Prisma } from '@/generated/prisma/client';

/**
 * GET    /api/story/series/[id] — the series, its outline and the episodes made.
 * PATCH  /api/story/series/[id] — title, premise, format, genre, look, frame,
 *                                 episode length and count, the cast, the
 *                                 logline and episode outlines typed by hand.
 *                                 The look, frame and length apply to episodes
 *                                 made from then on; made ones keep their own.
 *                                 Outline edits are refused while AI writes it.
 * DELETE /api/story/series/[id] — the series. Its episodes stay, as standalone
 *                                 films (ON DELETE SET NULL).
 */

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  try {
    const series = await loadOwnedSeries(userId, Number((await params).id));
    if (!series) return storyReply(SERIES_NOT_FOUND, locale, 404);
    return NextResponse.json(await serializeSeries(series, locale));
  } catch (error) {
    return storyErrorReply(error, 'series get', locale);
  }
}

const SERIES_NOT_FOUND = { th: 'ไม่พบซีรีส์', en: 'Series not found.' };
const CHANGED_ELSEWHERE = {
  th: 'ซีรีส์นี้เพิ่งถูกแก้จากที่อื่น (อีกแท็บหรือ AI) — โหลดหน้าใหม่แล้วแก้อีกครั้ง',
  en: 'This series was just changed elsewhere (another tab or AI). Reload and make your edit again.',
};

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  try {
    const series = await loadOwnedSeries(userId, id);
    if (!series) return storyReply(SERIES_NOT_FOUND, locale, 404);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new StoryError(STORY_REPLY.badRequest);

    const data: Prisma.AiStorySeriesUpdateManyMutationInput = {};
    if (body.title !== undefined) {
      const title = text(body.title, SERIES_LIMITS.title);
      if (title) data.title = title;
    }
    if (body.premise !== undefined) {
      const premise = text(body.premise, SERIES_LIMITS.premise);
      if (!premise) throw new StoryError({ th: 'เรื่องย่อว่างไม่ได้', en: "The story can't be empty." });
      data.premise = premise;
      data.language = seriesLanguage(premise);
    }
    if (isSeriesFormat(body.format)) data.format = body.format;
    if (body.genre !== undefined) data.genre = pickKey(body.genre, SERIES_GENRES, 'romance');
    if (body.look !== undefined) data.templateKey = pickKey(body.look, LOOKS, 'drama');
    if (body.aspect !== undefined) data.aspectRatio = pickKey(body.aspect, ASPECTS, '9:16');
    if (body.episodeSeconds !== undefined) data.episodeSeconds = episodeSecondsOf(body.episodeSeconds, series.episodeSeconds);
    if (body.characters !== undefined) {
      const cast = parseCharacters(body.characters, userId, locale).map((c) => ({ name: c.name, description: c.description, referenceUrl: c.referenceUrl, voiceId: c.voiceId ?? null }));
      data.castJson = cast as unknown as Prisma.InputJsonValue;
    }

    // The outline: how many episodes, the logline, episodes typed by hand.
    let count = series.episodeCount;
    if (body.episodeCount !== undefined) {
      count = episodeCountOf(body.episodeCount, series.episodeCount);
      const lastMade = series.episodes.reduce((n, e) => Math.max(n, e.episodeNumber ?? 0), 0);
      if (count < lastMade) {
        throw new StoryError(
          { th: `ตอนที่ ${lastMade} สร้างเป็นหนังแล้ว — ลดจำนวนตอนให้น้อยกว่านั้นไม่ได้`, en: `Episode ${lastMade} is already a film, so the series can't have fewer episodes.` },
          422
        );
      }
      data.episodeCount = count;
    }
    const outlineEdit = body.episodes !== undefined || body.logline !== undefined || count !== series.episodeCount;
    if (outlineEdit) {
      const bible = editEpisodes(bibleOf(series.bibleJson), body.episodes, count);
      if (body.logline !== undefined) bible.logline = text(body.logline, SERIES_LIMITS.logline);
      data.bibleJson = bible as unknown as Prisma.InputJsonValue;
      // Written in full by hand: nothing is left for AI, so its last failure no longer applies.
      const complete = firstUnwritten(bible, 1, count) > count;
      data.status = complete ? 'ready' : series.status === 'failed' ? 'failed' : 'draft';
      data.planningAt = null;
      if (complete) data.errorMessage = null;
    }

    if (Object.keys(data).length > 0) {
      // An outline edit is merged onto the outline read above, so it is saved
      // only if nothing changed the row since: not a live outline writer (it
      // would overwrite these edits, or these its batch), another tab's edit,
      // or an episode made meanwhile (the count check above read the episodes;
      // making one bumps updatedAt). Other fields are replaced whole.
      const where: Prisma.AiStorySeriesWhereInput = outlineEdit
        ? { id, userId, updatedAt: series.updatedAt, ...notPlanningWhere() }
        : { id, userId };
      const r = await prisma.aiStorySeries.updateMany({ where, data });
      if (r.count === 0) {
        const now = await loadOwnedSeries(userId, id);
        if (!now) return storyReply(SERIES_NOT_FOUND, locale, 404);
        throw new StoryError(isPlanning(now) ? PLANNING_NOW : CHANGED_ELSEWHERE, 409);
      }
    }
    const fresh = (await loadOwnedSeries(userId, id))!;
    return NextResponse.json(await serializeSeries(fresh, locale));
  } catch (error) {
    return storyErrorReply(error, 'series patch', locale);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return storyReply(SERIES_NOT_FOUND, locale, 404);
  // Its episodes become standalone films (ON DELETE SET NULL); their clips stay in the gallery.
  const r = await prisma.aiStorySeries.deleteMany({ where: { id, userId } });
  if (r.count === 0) return storyReply(SERIES_NOT_FOUND, locale, 404);
  return NextResponse.json({ ok: true });
}
