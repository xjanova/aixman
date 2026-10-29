import { NextResponse } from 'next/server';
import type { Translate } from '@/lib/i18n/locale';
import { AUDIO_TYPE, audioTypeFor } from '@/lib/own-audio';

/**
 * Hand an audio file in our bucket to the page from our own origin — the only
 * way the studio can draw its waveform or write a WAV of it (R2 sends no CORS
 * header). The caller has already decided the file is the visitor's to read.
 *
 * A Range is passed through, so a player streaming from here can still seek.
 * The upstream URL is never handed back, only its bytes.
 */

const EXT_OF_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(AUDIO_TYPE).map(([ext, type]) => [type, ext])
);

export async function streamAudio(
  request: Request,
  url: string,
  t: Translate,
  /** Basename for `?download=1`, without extension. */
  downloadBase?: string
): Promise<Response> {
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: t('ไม่พบไฟล์', 'File not found') }, { status: 404 });
  }
  const path = new URL(url).pathname;
  // A known audio extension, or `.bin` (an old copy, judged by its stored type
  // below); nothing else is fetched at all.
  if (!audioTypeFor(path, null) && !/\.bin$/i.test(path)) {
    return NextResponse.json({ error: t('ไฟล์นี้ไม่ใช่ไฟล์เสียง', 'This isn’t an audio file') }, { status: 400 });
  }

  const range = request.headers.get('range');
  // The timeout covers reaching the file, not sending it.
  const connect = new AbortController();
  const timer = setTimeout(() => connect.abort(), 30_000);
  let upstream: Response | null = null;
  try {
    upstream = await fetch(url, { headers: range ? { range } : undefined, cache: 'no-store', signal: connect.signal });
  } catch {
    upstream = null;
  }
  clearTimeout(timer);

  if (!upstream?.ok || !upstream.body) {
    const gone = upstream?.status === 404;
    return NextResponse.json(
      { error: gone ? t('ไม่พบไฟล์', 'File not found') : t('ดึงไฟล์จากที่เก็บไม่สำเร็จ', 'Couldn’t fetch the file from storage') },
      { status: gone ? 404 : 502 }
    );
  }

  const contentType = audioTypeFor(path, upstream.headers.get('content-type'));
  if (!contentType) {
    void upstream.body.cancel();
    return NextResponse.json({ error: t('ไฟล์นี้ไม่ใช่ไฟล์เสียง', 'This isn’t an audio file') }, { status: 400 });
  }

  const headers = new Headers({
    'content-type': contentType,
    'accept-ranges': 'bytes',
    // Private: one customer's file behind an auth check, so a shared cache must
    // never keep it. The browser may, which is what lets a player decode the
    // bytes without paying for the download twice.
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (downloadBase && new URL(request.url).searchParams.get('download') === '1') {
    headers.set('content-disposition', `attachment; filename="${downloadBase}.${EXT_OF_TYPE[contentType] ?? 'mp3'}"`);
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
