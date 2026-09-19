import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

/**
 * Serve a generated song from our own origin.
 *
 * R2 sends no `Access-Control-Allow-Origin`, so a browser can play those URLs
 * but cannot read their bytes. Everything the studio player does beyond pressing
 * play — drawing the real waveform, writing a WAV or an MP3 on download — needs
 * the samples, and the samples need a same-origin response. That is all this is.
 *
 * It is not a public mirror: the row has to belong to the caller, or the caller
 * has to be an admin. The upstream URL is never handed back, only its contents,
 * so a signed or private object stays private.
 */

const AUDIO_TYPE: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const genId = Number.parseInt(id, 10);
  if (!Number.isInteger(genId) || genId <= 0) {
    return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
  }

  const generation = await prisma.aiGeneration.findUnique({
    where: { id: genId },
    select: { userId: true, resultUrl: true },
  });

  if (!generation?.resultUrl) {
    return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 404 });
  }
  if (generation.userId !== userId && !(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ext = (generation.resultUrl.split('?')[0].split('.').pop() || '').toLowerCase();
  const contentType = AUDIO_TYPE[ext];
  if (!contentType) {
    return NextResponse.json({ error: 'ไฟล์นี้ไม่ใช่ไฟล์เสียง' }, { status: 400 });
  }

  // Pass a Range through so seeking still works for anything that streams from
  // here rather than downloading the whole object first.
  const range = request.headers.get('range');
  let upstream: Response;
  try {
    upstream = await fetch(generation.resultUrl, {
      headers: range ? { range } : undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'ดึงไฟล์จากที่เก็บไม่สำเร็จ' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'ดึงไฟล์จากที่เก็บไม่สำเร็จ' }, { status: 502 });
  }

  const headers = new Headers({
    'content-type': contentType,
    'accept-ranges': 'bytes',
    // Private: this is one customer's song behind an auth check, so a shared
    // cache must never keep it. The browser may, which is what lets the player
    // decode the bytes without paying for the download twice.
    'cache-control': 'private, max-age=3600',
  });
  for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (request.nextUrl.searchParams.get('download') === '1') {
    headers.set('content-disposition', `attachment; filename="song-${genId}.${ext}"`);
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
