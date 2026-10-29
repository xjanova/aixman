import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { aixmanBaseUrl } from '@/lib/xman-sso';
import {
  handoffAudio,
  handoffHeaders,
  handoffLang,
  handoffLyrics,
  handoffTitle,
  verifyHandoff,
} from '@/lib/aquachord-handoff';

/**
 * Song Handoff v1 manifest — what AquaChord reads first: the song's name, its
 * lyrics, and where to fetch the audio (our own route below, never R2).
 *
 * No session: the token in the path is the whole authority, minted by
 * /api/studio/aquachord-handoff after the owner check. Wrong, expired, or the
 * file gone → 410, which AquaChord shows as "link expired — send it again".
 * The token is not logged anywhere.
 */

function gone() {
  return NextResponse.json({ error: 'gone' }, { status: 410, headers: handoffHeaders() });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const claim = verifyHandoff(token);
  if (!claim) return gone();

  const generation = await prisma.aiGeneration.findUnique({
    where: { id: claim.genId },
    select: { type: true, resultUrl: true, mediaDeletedAt: true, prompt: true, params: true },
  });
  const audio = generation ? handoffAudio(generation) : null;
  if (!generation || !audio) return gone();

  // The size lets AquaChord refuse an oversized file before downloading it.
  // Optional in the contract, so a storage hiccup here only drops the field;
  // a file that is really gone is a 410 now rather than after the click.
  let bytes: number | undefined;
  try {
    const head = await fetch(audio.url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (head.status === 404 || head.status === 410) return gone();
    const length = Number(head.headers.get('content-length'));
    if (head.ok && Number.isSafeInteger(length) && length > 0) bytes = length;
  } catch {
    // Left out; the audio route reports a real failure.
  }

  const lyrics = handoffLyrics(generation.params);
  return NextResponse.json(
    {
      type: 'aquachord.handoff',
      v: 1,
      title: handoffTitle(generation.prompt, generation.params),
      lyrics,
      lang: handoffLang(generation.params, lyrics),
      source: { app: 'aixman', name: 'X-DREAMER' },
      audio: {
        url: `${aixmanBaseUrl()}/api/partner/aquachord/handoff/${token}/audio`,
        mime: audio.mime,
        ...(bytes ? { bytes } : {}),
        filename: `song-${claim.genId}.${audio.ext}`,
      },
      expiresAt: new Date(claim.exp * 1000).toISOString(),
    },
    { headers: handoffHeaders() }
  );
}
