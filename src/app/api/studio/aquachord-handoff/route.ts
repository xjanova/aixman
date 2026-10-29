import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { requestLocale, translator } from '@/lib/i18n/locale';
import { aixmanBaseUrl } from '@/lib/xman-sso';
import { aquachordOrigin, handoffAudio, signHandoff } from '@/lib/aquachord-handoff';
import { handoffEnabled, handoffKey } from '@/lib/aquachord-config';

/**
 * "แกะคอร์ดใน AquaChord" — mint the link that hands one finished song to
 * AquaChord (Song Handoff v1, see src/lib/aquachord-handoff.ts).
 *
 * The same gate as /api/studio/audio/[id]: the song is the caller's own, or the
 * caller is an admin. What comes back is AquaChord's import page with our
 * short-lived manifest URL behind the `#`, so it never reaches AquaChord's
 * server or anyone's access log; the studio opens it in a new tab.
 *
 * Body: { "generationId": 123 } → { "url": "https://aquachord.online/#/import?m=…" }
 * GET → { enabled }: the studio hides the card while an admin has it switched off.
 */
export async function GET() {
  return NextResponse.json({ enabled: await handoffEnabled() }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const t = translator(requestLocale(request));
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await handoffEnabled())) {
    return NextResponse.json(
      { error: t('ยังไม่ได้เปิดการส่งเพลงไป AquaChord', 'Sending songs to AquaChord isn’t switched on yet') },
      { status: 503 }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).generationId : undefined;
  const genId = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(genId) || genId <= 0) {
    return NextResponse.json({ error: t('id ไม่ถูกต้อง', 'Invalid id') }, { status: 400 });
  }

  const generation = await prisma.aiGeneration.findUnique({
    where: { id: genId },
    select: { userId: true, type: true, resultUrl: true, mediaDeletedAt: true },
  });
  if (!generation) {
    return NextResponse.json({ error: t('ไม่พบเพลงนี้', 'Song not found') }, { status: 404 });
  }
  if (generation.userId !== userId && !(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (generation.type !== 'audio') {
    return NextResponse.json({ error: t('งานนี้ไม่ใช่เพลง', 'This isn’t a song') }, { status: 400 });
  }
  if (!generation.resultUrl || generation.mediaDeletedAt) {
    return NextResponse.json({ error: t('ไฟล์เพลงนี้หมดอายุแล้ว', 'This song’s file has expired') }, { status: 410 });
  }
  if (!handoffAudio(generation)) {
    return NextResponse.json({ error: t('ไฟล์นี้ไม่ใช่ไฟล์เสียง', 'This isn’t an audio file') }, { status: 400 });
  }

  const signed = signHandoff(genId, Date.now(), await handoffKey());
  if (!signed) {
    return NextResponse.json(
      { error: t('ยังไม่ได้เปิดการส่งเพลงไป AquaChord', 'Sending songs to AquaChord isn’t switched on yet') },
      { status: 503 }
    );
  }

  const manifestUrl = `${aixmanBaseUrl()}/api/partner/aquachord/handoff/${signed.token}`;
  return NextResponse.json(
    {
      url: `${aquachordOrigin()}/#/import?m=${encodeURIComponent(manifestUrl)}`,
      expiresAt: new Date(signed.exp * 1000).toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
