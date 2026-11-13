import prisma from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { chatViaPool } from '@/lib/services/prompt-enhancer';
import { withTargetSeconds } from './cinematic';
import { MAX_STORY_PROJECTS, StoryError } from './service';
import { dubbingSettings } from './dubbing';
import {
  NEW_SERIES_TITLE,
  SERIES_LIMITS,
  batchFrom,
  bibleMessages,
  bibleOf,
  castOf,
  episodeBrief,
  episodeLibrary,
  episodeTitle,
  firstUnwritten,
  isSeriesFormat,
  isWritten,
  mergeBible,
  parseBible,
  writtenCount,
  type BibleBatch,
  type SeriesInfo,
} from './series';
import type { Prisma } from '@/generated/prisma/client';
import { translator, type Locale, type Msg } from '@/lib/i18n/locale';
import { packMsg, readStoredMessage } from '@/lib/i18n/messages';

/**
 * Series and short dramas: storage, the AI-written outline, and making an
 * episode into a film project. The vocabulary and every check on what a model
 * or a page sends is in series.ts (pure, tested).
 *
 * The outline is written after the response, BIBLE_BATCH episodes per chat
 * call, each batch saved as it lands so the page shows episodes appearing. The
 * writer holds the series with a conditional claim (status 'planning' +
 * planningAt), refreshed before every chat attempt and with every batch saved; every write it makes is
 * conditional on still holding it, so a claim retaken after it went stale is
 * never overwritten by the writer that lost it.
 */

/**
 * A writer that has not beaten for this long died with its process; the
 * series may be claimed again. It beats before every chat attempt, and one
 * attempt can walk every engine of chatViaPool's auto order (4 × 150 s), so
 * this must stay well above 10 minutes.
 */
export const BIBLE_STALE_MS = 15 * 60_000;

const episodeSelect = {
  id: true,
  episodeNumber: true,
  title: true,
  status: true,
  finalVideoUrl: true,
  _count: { select: { shots: true } },
} as const;

/** The series if it belongs to this user, with the episodes made of it. */
export async function loadOwnedSeries(userId: number, seriesId: number) {
  if (!Number.isInteger(seriesId) || seriesId <= 0) return null;
  return prisma.aiStorySeries.findFirst({
    where: { id: seriesId, userId },
    include: { episodes: { where: { userId }, select: episodeSelect, orderBy: { episodeNumber: 'asc' } } },
  });
}

export type SeriesFull = NonNullable<Awaited<ReturnType<typeof loadOwnedSeries>>>;

/** AI is writing the outline now (an older claim died with its process). */
export function isPlanning(s: { status: string; planningAt: Date | null }, now = Date.now()): boolean {
  return s.status === 'planning' && s.planningAt !== null && now - s.planningAt.getTime() <= BIBLE_STALE_MS;
}

/** Rows not being written by a live writer — what a claim or an outline edit may touch. */
export function notPlanningWhere(now = Date.now()): Prisma.AiStorySeriesWhereInput {
  return { OR: [{ status: { not: 'planning' } }, { planningAt: null }, { planningAt: { lt: new Date(now - BIBLE_STALE_MS) } }] };
}

export const PLANNING_NOW: Msg = {
  th: 'AI กำลังเขียนโครงเรื่องของซีรีส์นี้อยู่ รอให้เสร็จก่อน',
  en: 'AI is writing this series’ outline. Wait for it to finish.',
};
const AI_BUSY: Msg = {
  th: 'ผู้ช่วย AI ไม่ว่างตอนนี้ ลองใหม่อีกครั้ง หรือเขียนโครงเรื่องแต่ละตอนเองได้',
  en: 'The AI assistant is busy right now. Try again, or write the episodes’ outlines yourself.',
};
const partlyWritten = (n: number): Msg => ({
  th: `AI เขียนโครงเรื่องได้ถึงตอนที่ ${n} — กด "ให้ AI เขียนต่อ" เพื่อเขียนตอนที่เหลือ`,
  en: `AI outlined up to episode ${n}. Press "AI: write the rest" to finish.`,
});
const STALE_PLAN: Msg = { th: 'การเขียนโครงเรื่องครั้งก่อนค้าง ลองใหม่อีกครั้ง', en: 'The last outline got stuck. Please try again.' };

/** Outlines AI may write per customer per hour — free, so limited. */
const SERIES_PLANS_PER_HOUR = 10;

/** Count one outline against the caller's hourly allowance; a 429 StoryError when it is spent. */
export function checkSeriesPlanLimit(userId: number): void {
  const limit = rateLimit(`story-series-plan:${userId}`, SERIES_PLANS_PER_HOUR, 60 * 60_000);
  if (limit.ok) return;
  const minutes = Math.ceil(limit.retryAfter / 60);
  throw new StoryError(
    {
      th: `ให้ AI เขียนโครงเรื่องครบ ${SERIES_PLANS_PER_HOUR} ครั้งในชั่วโมงนี้แล้ว ลองใหม่ในอีก ${minutes} นาที`,
      en: `AI has written ${SERIES_PLANS_PER_HOUR} outlines for you this hour. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    },
    429
  );
}

const isPlaceholderTitle = (title: string) => !title.trim() || title === NEW_SERIES_TITLE.th || title === NEW_SERIES_TITLE.en;

/**
 * Claim the series for one outline writer: a conditional update, so a double
 * click or two tabs start one writer. The claim's time, or null when a live
 * writer holds it.
 */
export async function claimBible(seriesId: number): Promise<Date | null> {
  const at = new Date();
  const r = await prisma.aiStorySeries.updateMany({
    where: { id: seriesId, ...notPlanningWhere(at.getTime()) },
    data: { status: 'planning', planningAt: at, errorMessage: null },
  });
  return r.count > 0 ? at : null;
}

/** Nothing left for AI to write: every episode has an outline (or, rewriting, every one after the last made). */
export function nothingToWrite(series: SeriesFull, rewrite: boolean): boolean {
  const bible = bibleOf(series.bibleJson);
  const from = rewrite ? lastMade(series) + 1 : firstUnwritten(bible, 1, series.episodeCount);
  return from > series.episodeCount;
}

function lastMade(series: { episodes: { episodeNumber: number | null }[] }): number {
  return series.episodes.reduce((n, e) => Math.max(n, e.episodeNumber ?? 0), 0);
}

/**
 * Write the outline after the response. Continuing, AI fills every episode
 * without an outline and never touches one that has one; rewriting, it writes
 * again every episode after the last one already made into a film (those keep
 * theirs — they exist). Ends 'ready', or 'failed' with what is still missing.
 */
export async function writeBible(seriesId: number, claimedAt: Date, rewrite: boolean): Promise<void> {
  let held = claimedAt;
  const failed: string[] = [];
  let wrote = 0;
  let first = true;
  // Still ours? Moves planningAt on, so a long chat attempt never looks dead.
  const beat = async (): Promise<boolean> => {
    const at = new Date();
    const r = await prisma.aiStorySeries.updateMany({ where: { id: seriesId, status: 'planning', planningAt: held }, data: { planningAt: at } });
    if (r.count > 0) held = at;
    return r.count > 0;
  };
  try {
    // Each round writes one batch; a batch that lands always moves the start on.
    for (let round = 0; round < SERIES_LIMITS.maxEpisodes; round++) {
      const series = await prisma.aiStorySeries.findFirst({
        where: { id: seriesId, status: 'planning', planningAt: held },
        include: { episodes: { select: { episodeNumber: true } } },
      });
      if (!series) return; // deleted, or the claim was retaken after it went stale
      const bible = bibleOf(series.bibleJson);
      const count = series.episodeCount;
      const replacing = first && rewrite;
      const start = replacing ? lastMade(series) + 1 : firstUnwritten(bible, 1, count);
      const batch = batchFrom(bible, start, count, !replacing);
      if (!batch) break;

      const cast = castOf(series.castJson);
      const { system, user } = bibleMessages({
        title: isPlaceholderTitle(series.title) ? '' : series.title,
        premise: series.premise,
        format: isSeriesFormat(series.format) ? series.format : 'short',
        genre: series.genre,
        language: series.language,
        episodeSeconds: series.episodeSeconds,
        count,
        cast,
        characters: bible?.characters ?? [],
        done: (bible?.episodes ?? []).slice(0, batch.from - 1),
        from: batch.from,
        to: batch.to,
      });
      let parsed: BibleBatch | null = null;
      // A thinking model may spend its whole budget reasoning; one retry before giving up.
      for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
        if (!(await beat())) return; // deleted, or retaken meanwhile
        try {
          const reply = await chatViaPool(system, user, { maxTokens: 16_000, maxChars: 60_000, timeoutMs: 150_000 });
          parsed = parseBible(reply.text, { from: batch.from, to: batch.to, cast });
          if (!parsed) failed.push(`episodes ${batch.from}-${batch.to} try ${attempt}: no usable outline (${reply.engine})`);
        } catch (error) {
          failed.push(`episodes ${batch.from}-${batch.to} try ${attempt}: ${(error as Error).message.slice(0, 200)}`);
        }
      }
      if (!parsed) break;

      const merged = mergeBible(bible, parsed, batch.from, count, !replacing);
      const savedAt = new Date();
      const data: Prisma.AiStorySeriesUpdateManyMutationInput = {
        bibleJson: merged as unknown as Prisma.InputJsonValue,
        planningAt: savedAt,
      };
      if (batch.from === 1 && parsed.title && isPlaceholderTitle(series.title)) data.title = parsed.title;
      const r = await prisma.aiStorySeries.updateMany({ where: { id: seriesId, status: 'planning', planningAt: held }, data });
      if (r.count === 0) return;
      held = savedAt;
      wrote += parsed.episodes.length;
      first = false;
    }
  } catch (error) {
    failed.push((error as Error).message.slice(0, 200));
  }
  if (failed.length) console.warn(`[story] series ${seriesId} outline fell back in part: ${failed.join(' | ')}`);

  const now = await prisma.aiStorySeries.findFirst({ where: { id: seriesId, status: 'planning', planningAt: held } });
  if (!now) return;
  const bible = bibleOf(now.bibleJson);
  const missing = firstUnwritten(bible, 1, now.episodeCount) <= now.episodeCount;
  // A rewrite that wrote nothing failed, though the old outline still fills every episode.
  const failedOutright = wrote === 0 && failed.length > 0;
  await prisma.aiStorySeries.updateMany({
    where: { id: seriesId, status: 'planning', planningAt: held },
    data:
      missing || failedOutright
        ? { status: 'failed', planningAt: null, errorMessage: packMsg(wrote > 0 ? partlyWritten(writtenCount(bible)) : AI_BUSY) }
        : { status: 'ready', planningAt: null, errorMessage: null },
  });
}

/** What an episode's brief and plan read from its series. */
export function seriesInfo(series: { title: string; premise: string; format: string; genre: string; language: string; aspectRatio: string; episodeCount: number }): SeriesInfo {
  return {
    title: series.title,
    premise: series.premise,
    format: series.format,
    genre: series.genre,
    language: series.language,
    aspectRatio: series.aspectRatio,
    episodeCount: series.episodeCount,
  };
}

/**
 * Make episode `n` into a film project: its brief from the outline, the
 * series' look, frame and episode length, and the reference library of the
 * nearest episode already made (before it first) — so faces, props and places
 * drawn there carry on — plus any cast member it lacks. With none made, the
 * cast and the characters AI added. A second click finds the first one's
 * episode instead of making another (unique series + episode number).
 */
export async function createEpisode(userId: number, series: SeriesFull, n: number): Promise<{ id: number; created: boolean }> {
  if (!Number.isInteger(n) || n < 1 || n > series.episodeCount) throw new StoryError({ th: 'ไม่พบตอนนี้', en: 'Episode not found.' }, 404);
  const existing = series.episodes.find((e) => e.episodeNumber === n);
  if (existing) return { id: existing.id, created: false };
  // A rewrite in flight may replace this episode's outline after the film was made from it.
  if (isPlanning(series)) throw new StoryError(PLANNING_NOW, 409);
  const bible = bibleOf(series.bibleJson);
  const outline = bible?.episodes[n - 1];
  if (!bible || !isWritten(outline)) {
    throw new StoryError(
      { th: `ตอนที่ ${n} ยังไม่มีโครงเรื่อง — ให้ AI เขียน หรือเขียนเองก่อน`, en: `Episode ${n} has no outline yet. Have AI write it, or write it yourself first.` },
      422
    );
  }
  const projects = await prisma.aiStoryProject.count({ where: { userId } });
  if (projects >= MAX_STORY_PROJECTS) {
    throw new StoryError(
      {
        th: `มีโปรเจกต์ครบ ${MAX_STORY_PROJECTS} อันแล้ว (นับรวมทุกตอน) ลบอันที่ไม่ใช้ก่อน`,
        en: `You already have ${MAX_STORY_PROJECTS} projects (episodes count too). Delete one you no longer need first.`,
      },
      409
    );
  }

  const made = series.episodes.filter((e): e is typeof e & { episodeNumber: number } => e.episodeNumber !== null);
  const before = made.filter((e) => e.episodeNumber < n).sort((a, b) => b.episodeNumber - a.episodeNumber)[0];
  const after = made.filter((e) => e.episodeNumber > n).sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
  const source = before ?? after;
  const sourceProject = source ? await prisma.aiStoryProject.findUnique({ where: { id: source.id }, select: { scriptJson: true } }) : null;
  const rows = source ? await prisma.aiStoryCharacter.findMany({ where: { projectId: source.id }, orderBy: { sortOrder: 'asc' } }) : [];
  // A picture still being drawn lands on that episode's row only: the copy would miss it.
  const drawing = rows.find((r) => r.imageStatus === 'rendering');
  if (source && drawing) {
    throw new StoryError(
      {
        th: `รอภาพ "${drawing.name}" ใน EP.${source.episodeNumber} วาดเสร็จก่อน แล้วค่อยสร้างตอนนี้ — ตอนใหม่จะได้ภาพนั้นไปด้วย`,
        en: `Wait for the picture of "${drawing.name}" in EP.${source.episodeNumber} to finish first, so the new episode gets it too.`,
      },
      409
    );
  }
  const library = episodeLibrary(
    rows.map((r) => ({ kind: r.kind, name: r.name, description: r.description, origin: r.origin, referenceUrl: r.referenceUrl, images: r.images, voiceId: r.voiceId })),
    castOf(series.castJson),
    bible.characters
  );

  try {
    const project = await prisma.aiStoryProject.create({
      data: {
        userId,
        seriesId: series.id,
        episodeNumber: n,
        mode: 'film',
        title: episodeTitle(series.title, n, outline),
        brief: episodeBrief(seriesInfo(series), bible, n),
        language: series.language,
        templateKey: series.templateKey,
        aspectRatio: series.aspectRatio,
        scriptJson: withTargetSeconds({ dubbing: dubbingSettings(sourceProject?.scriptJson) }, String(series.episodeSeconds)) as Prisma.InputJsonValue,
        characters: {
          create: library.map((s, k) => ({
            kind: s.kind,
            name: s.name,
            description: s.description,
            origin: s.origin,
            referenceUrl: s.referenceUrl,
            ...(Array.isArray(s.images) && s.images.length ? { images: s.images as Prisma.InputJsonValue } : {}),
            voiceId: s.voiceId,
            sortOrder: k,
          })),
        },
      },
      select: { id: true },
    });
    // The series moves to the top of the list, like a project being worked on.
    await prisma.aiStorySeries.update({ where: { id: series.id }, data: { updatedAt: new Date() } }).catch(() => {});
    return { id: project.id, created: true };
  } catch (error) {
    // Two clicks: the other one made it.
    if ((error as { code?: string }).code === 'P2002') {
      const row = await prisma.aiStoryProject.findFirst({ where: { seriesId: series.id, episodeNumber: n, userId }, select: { id: true } });
      if (row) return { id: row.id, created: false };
    }
    throw error;
  }
}

/** What the series page gets, labels and stored reasons in the visitor's language. */
export async function serializeSeries(series: SeriesFull, locale: Locale) {
  const t = translator(locale);
  const bible = bibleOf(series.bibleJson);
  const ids = series.episodes.map((e) => e.id);
  const done = ids.length
    ? await prisma.aiStoryShot.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: 'done' }, _count: { _all: true } })
    : [];
  const planning = isPlanning(series);
  const stale = series.status === 'planning' && !planning;
  return {
    series: {
      id: series.id,
      title: series.title,
      premise: series.premise,
      format: series.format,
      genre: series.genre,
      look: series.templateKey,
      aspect: series.aspectRatio,
      language: series.language,
      episodeSeconds: series.episodeSeconds,
      episodeCount: series.episodeCount,
      cast: castOf(series.castJson),
      logline: bible?.logline ?? '',
      characters: bible?.characters ?? [],
      status: planning ? 'planning' : stale ? 'failed' : series.status,
      error: stale ? t(STALE_PLAN) : readStoredMessage(series.errorMessage, locale),
      written: writtenCount(bible),
      lastMade: lastMade(series),
      episodes: Array.from({ length: series.episodeCount }, (_, k) => {
        const outline = bible?.episodes[k] ?? null;
        const p = series.episodes.find((e) => e.episodeNumber === k + 1);
        return {
          number: k + 1,
          outline,
          written: isWritten(outline),
          project: p
            ? {
                id: p.id,
                title: p.title,
                status: p.status,
                shots: p._count.shots,
                done: done.find((d) => d.projectId === p.id)?._count._all ?? 0,
                film: p.finalVideoUrl,
              }
            : null,
        };
      }),
    },
  };
}

/** The caller's series for the list. */
export async function listSeries(userId: number) {
  const rows = await prisma.aiStorySeries.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: SERIES_LIMITS.series,
    select: {
      id: true,
      title: true,
      format: true,
      genre: true,
      aspectRatio: true,
      episodeCount: true,
      status: true,
      planningAt: true,
      castJson: true,
      updatedAt: true,
      _count: { select: { episodes: true } },
    },
  });
  return rows.map((s) => ({
    id: s.id,
    title: s.title,
    format: s.format,
    genre: s.genre,
    aspect: s.aspectRatio,
    episodes: s.episodeCount,
    made: s._count.episodes,
    planning: isPlanning(s),
    updatedAt: s.updatedAt,
    cover: castOf(s.castJson).find((c) => c.referenceUrl)?.referenceUrl ?? null,
  }));
}
