import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { ASPECTS, LIMITS, LOOKS, MOODS, pickKey } from '@/lib/story/cinematic';
import { NEW_PROJECT_TITLE, StoryError } from '@/lib/story/service';
import { STORY_REPLY, parseCharacters, resolveSong, storyErrorReply, storyReply, text, withFilmLength } from '@/lib/story/http';
import { pick, requestLocale } from '@/lib/i18n/locale';

/**
 * GET  /api/story — the caller's movie and MV projects.
 * POST /api/story — start one: the story (or the song and its lyrics), the
 *                   look or mood, the frame, and the characters' pictures.
 *                   Nothing is charged here; each shot is charged when it is
 *                   rendered.
 */

export const dynamic = 'force-dynamic';

const MAX_PROJECTS = 50;

export async function GET(request: NextRequest) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const rows = await prisma.aiStoryProject.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: MAX_PROJECTS,
    select: {
      id: true,
      mode: true,
      title: true,
      status: true,
      aspectRatio: true,
      updatedAt: true,
      characters: { select: { referenceUrl: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
      _count: { select: { shots: true } },
    },
  });
  return NextResponse.json({
    projects: rows.map((p) => ({
      id: p.id,
      mode: p.mode,
      title: p.title,
      status: p.status,
      aspect: p.aspectRatio,
      updatedAt: p.updatedAt,
      cover: p.characters[0]?.referenceUrl ?? null,
      shots: p._count.shots,
    })),
  });
}

export async function POST(request: NextRequest) {
  const locale = requestLocale(request);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new StoryError(STORY_REPLY.badRequest);
    const mode = body.mode === 'mv' ? 'mv' : 'film';

    const count = await prisma.aiStoryProject.count({ where: { userId } });
    if (count >= MAX_PROJECTS) {
      throw new StoryError({ th: `มีโปรเจกต์ครบ ${MAX_PROJECTS} อันแล้ว ลบอันเก่าก่อน`, en: `You already have ${MAX_PROJECTS} projects. Delete an old one first.` }, 409);
    }

    const characters = parseCharacters(body.characters, userId, locale);
    let brief = text(body.brief, LIMITS.brief);
    let song: { url: string; seconds: number } | null = null;
    if (mode === 'mv') {
      const resolved = await resolveSong(userId, body.song);
      song = { url: resolved.url, seconds: resolved.seconds };
      // A song made here already has its lyrics; the customer may still edit them.
      if (!brief && resolved.lyrics) brief = resolved.lyrics.slice(0, LIMITS.brief);
      if (!brief) {
        throw new StoryError({ th: 'ใส่เนื้อเพลงให้ครบก่อน ระบบใช้เนื้อเพลงวางช็อตตามจังหวะ', en: 'Add the full lyrics first — the shots are laid out along them.' });
      }
    } else if (!brief) {
      throw new StoryError({ th: 'เขียนเรื่องย่อหรือบทก่อน', en: 'Write a story or a script first.' });
    }

    const project = await prisma.aiStoryProject.create({
      data: {
        userId,
        mode,
        title: text(body.title, LIMITS.title) || pick(NEW_PROJECT_TITLE, locale),
        brief,
        templateKey: pickKey(body.look, LOOKS, 'film'),
        mood: mode === 'mv' ? pickKey(body.mood, MOODS, 'romantic') : null,
        aspectRatio: pickKey(body.aspect, ASPECTS, '16:9'),
        songUrl: song?.url ?? null,
        songSeconds: song?.seconds ?? null,
        ...(mode === 'film' && body.filmLength !== undefined ? { scriptJson: withFilmLength(null, body.filmLength) } : {}),
        characters: {
          create: characters.map((c, k) => ({
            name: c.name,
            description: c.description,
            origin: 'uploaded',
            referenceUrl: c.referenceUrl,
            sortOrder: k,
          })),
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ id: project.id }, { status: 201 });
  } catch (error) {
    return storyErrorReply(error, 'create', locale);
  }
}
