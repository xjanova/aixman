import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

/**
 * GET /api/generate/[id]/download?i=<index>
 *
 * Streams one of the caller's own results back as an attachment.
 *
 * The browser cannot save these itself: the R2 bucket sends no CORS headers,
 * so a page's fetch() of its public URL is refused — which made the download
 * button fail on every in-house render (songs, clips and stills alike). From
 * our own origin there is nothing to allow.
 *
 * Only URLs already stored on the caller's generation are fetched, never one
 * named by the request, so this cannot be pointed at an arbitrary address.
 */
const EXT_BY_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Each hit is megabytes of egress through this server.
  const limit = rateLimit(`gen-download:${userId}`, 60, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'ดาวน์โหลดบ่อยเกินไป กรุณารอสักครู่' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  const { id } = await params;
  const generationId = parseInt(id, 10);
  if (isNaN(generationId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const generation = await prisma.aiGeneration.findFirst({
    where: { id: generationId, userId },
    select: { id: true, resultUrl: true, resultUrls: true, mediaDeletedAt: true },
  });
  if (!generation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (generation.mediaDeletedAt) {
    return NextResponse.json({ error: 'ไฟล์นี้หมดอายุและถูกลบแล้ว' }, { status: 410 });
  }

  const index = Number(new URL(request.url).searchParams.get('i'));
  const urls = Array.isArray(generation.resultUrls)
    ? generation.resultUrls.filter((u): u is string => typeof u === 'string')
    : [];
  const source = Number.isInteger(index) && index >= 0 && index < urls.length
    ? urls[index]
    : generation.resultUrl;
  if (!source || !/^https?:\/\//i.test(source)) {
    return NextResponse.json({ error: 'ไม่พบไฟล์ของผลงานนี้' }, { status: 404 });
  }

  // The timeout covers reaching the file, not sending it: a phone on a slow
  // line can take minutes over a clip, and cutting it off mid-stream would
  // hand over a truncated file.
  const connect = new AbortController();
  const timer = setTimeout(() => connect.abort(), 30_000);
  let upstream: Response;
  try {
    upstream = await fetch(source, { redirect: 'follow', signal: connect.signal });
  } catch {
    return NextResponse.json({ error: 'ดาวน์โหลดไฟล์ไม่สำเร็จ' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'ดาวน์โหลดไฟล์ไม่สำเร็จ' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  const fromPath = /\.([a-z0-9]{2,5})$/i.exec(new URL(source).pathname)?.[1]?.toLowerCase();
  const ext = fromPath ?? EXT_BY_TYPE[contentType] ?? 'bin';
  const suffix = urls.length > 1 && source !== generation.resultUrl ? `-${index + 1}` : '';
  // fetch() has already undone any content-encoding, so a compressed
  // upstream's length would no longer describe the bytes sent on.
  const length = upstream.headers.get('content-encoding') ? null : upstream.headers.get('content-length');

  // Streamed, not buffered: a clip held in memory per concurrent download
  // would take the PM2 memory cap down with it.
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="xdreamer-${generation.id}${suffix}.${ext}"`,
      ...(length ? { 'Content-Length': length } : {}),
      'Cache-Control': 'private, no-store',
    },
  });
}
