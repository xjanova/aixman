import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { handoffAudio, handoffHeaders, verifyHandoff } from '@/lib/aquachord-handoff';
import { handoffEnabled, handoffKey } from '@/lib/aquachord-config';

/**
 * Song Handoff v1 audio — the song's bytes for AquaChord, streamed from R2 the
 * way /api/studio/audio/[id] does it for the studio player.
 *
 * R2 sends no CORS header, so AquaChord could play the stored URL but never
 * read it; this route is what it reads instead, with the token in the path as
 * its only credential. The upstream URL is never handed back. No Range support:
 * AquaChord downloads the whole file once.
 */

function gone() {
  return NextResponse.json({ error: 'gone' }, { status: 410, headers: handoffHeaders() });
}

function storageFailed() {
  return NextResponse.json({ error: 'storage' }, { status: 502, headers: handoffHeaders() });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  // Switched off in admin: links already handed out stop working too.
  const claim = (await handoffEnabled()) ? verifyHandoff(token, Date.now(), await handoffKey()) : null;
  if (!claim) return gone();

  const generation = await prisma.aiGeneration.findUnique({
    where: { id: claim.genId },
    select: { type: true, resultUrl: true, mediaDeletedAt: true },
  });
  const audio = generation ? handoffAudio(generation) : null;
  if (!audio) return gone();

  let upstream: Response;
  try {
    upstream = await fetch(audio.url, { cache: 'no-store' });
  } catch {
    return storageFailed();
  }
  if (upstream.status === 404 || upstream.status === 410) return gone();
  if (!upstream.ok || !upstream.body) return storageFailed();

  const headers = handoffHeaders({ 'content-type': audio.mime });
  // A compressed upstream is decoded by fetch, so its length would be wrong.
  const length = upstream.headers.get('content-length');
  if (length && !upstream.headers.get('content-encoding')) headers.set('content-length', length);

  return new NextResponse(upstream.body, { status: 200, headers });
}
