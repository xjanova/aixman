import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { requestLocale, translator } from '@/lib/i18n/locale';
import { streamAudio } from '@/lib/audio-stream';

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
 * so a signed or private object stays private. A song copied in as `.bin`
 * (before audio types had names) is served by the type it was stored with.
 * Any other file of the caller's — a version or a stem — goes through
 * /api/studio/audio/file.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const t = translator(requestLocale(request));
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const genId = Number.parseInt(id, 10);
  if (!Number.isInteger(genId) || genId <= 0) {
    return NextResponse.json({ error: t('id ไม่ถูกต้อง', 'Invalid id') }, { status: 400 });
  }

  const generation = await prisma.aiGeneration.findUnique({
    where: { id: genId },
    select: { userId: true, resultUrl: true },
  });

  if (!generation?.resultUrl) {
    return NextResponse.json({ error: t('ไม่พบไฟล์', 'File not found') }, { status: 404 });
  }
  if (generation.userId !== userId && !(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return streamAudio(request, generation.resultUrl, t, `song-${genId}`);
}
