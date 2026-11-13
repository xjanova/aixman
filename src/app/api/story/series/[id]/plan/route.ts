import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { StoryError } from '@/lib/story/service';
import { STORY_REPLY, storyErrorReply, storyReply } from '@/lib/story/http';
import {
  PLANNING_NOW,
  checkSeriesPlanLimit,
  claimBible,
  isPlanning,
  loadOwnedSeries,
  nothingToWrite,
  serializeSeries,
  writeBible,
} from '@/lib/story/series-service';
import { requestLocale } from '@/lib/i18n/locale';

/**
 * POST /api/story/series/[id]/plan — "✨ ให้ AI เขียนโครงเรื่อง". Without
 * `rewrite`, AI outlines every episode that has none and never touches one
 * that has. With `{rewrite: true}`, it writes again every episode after the
 * last one already made into a film (those keep their outline — they exist).
 *
 * Written after the response, a batch of episodes per chat call, each saved
 * as it lands — 202 with `planning`, and the page polls the series. Free, so
 * limited per hour.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const id = Number((await params).id);
  try {
    const series = await loadOwnedSeries(userId, id);
    if (!series) return storyReply({ th: 'ไม่พบซีรีส์', en: 'Series not found.' }, locale, 404);
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const rewrite = body.rewrite === true;
    if (isPlanning(series)) throw new StoryError(PLANNING_NOW, 409);
    if (nothingToWrite(series, rewrite)) {
      throw new StoryError(
        rewrite
          ? { th: 'ทุกตอนสร้างเป็นหนังแล้ว ไม่มีตอนให้ AI เขียนใหม่', en: 'Every episode is already a film — there is nothing left for AI to rewrite.' }
          : { th: 'ทุกตอนมีโครงเรื่องแล้ว — เพิ่มจำนวนตอน หรือให้ AI เขียนใหม่', en: 'Every episode has an outline. Add episodes, or have AI rewrite them.' },
        409
      );
    }
    if (!(await isAdmin())) checkSeriesPlanLimit(userId);
    const claimed = await claimBible(series.id);
    if (!claimed) throw new StoryError(PLANNING_NOW, 409);
    after(async () => {
      try {
        await writeBible(series.id, claimed, rewrite);
      } catch (error) {
        console.error(`[story] series ${series.id} outline:`, error);
      }
    });
    const fresh = (await loadOwnedSeries(userId, id))!;
    return NextResponse.json(await serializeSeries(fresh, locale), { status: 202 });
  } catch (error) {
    return storyErrorReply(error, 'series plan', locale);
  }
}
