import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { songTracks } from '@/lib/output-lyrics';
import { keyFromPublicUrl } from '@/lib/storage/r2';
import { translator, requestLocale } from '@/lib/i18n/locale';
import { STORY_REPLY, storyReply } from '@/lib/story/http';

/**
 * GET /api/story/songs — songs the caller made on the site, for an MV. Only
 * finished ones still in our bucket, one entry per take (Suno makes two, each
 * an MV of its own); the words each take sings come along so the MV form can
 * fill them in — what the karaoke is timed to.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const locale = requestLocale(request);
  const t = translator(locale);
  const userId = await getCurrentUserId();
  if (!userId) return storyReply(STORY_REPLY.signIn, locale, 401);
  const rows = await prisma.aiGeneration.findMany({
    where: { userId, type: 'audio', status: 'completed', resultUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { id: true, prompt: true, params: true, resultUrl: true, resultUrls: true, createdAt: true },
  });
  return NextResponse.json({
    songs: rows.flatMap((r) => {
      const title = (r.prompt ?? '').slice(0, 80) || t(`เพลง #${r.id}`, `Song #${r.id}`);
      const tracks = songTracks(r.params, r.resultUrl, r.resultUrls);
      return tracks
        .map((track, i) => ({ ...track, i }))
        .filter((track) => keyFromPublicUrl(track.url))
        .map((track) => ({
          id: r.id,
          track: track.i,
          title: tracks.length > 1 ? `${title} · ${t(`เวอร์ชัน ${track.i + 1}`, `Version ${track.i + 1}`)}` : title,
          url: track.url,
          lyrics: track.lyrics,
          createdAt: r.createdAt,
        }));
    }),
  });
}
