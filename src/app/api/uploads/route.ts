import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isStorageConfigured, uploadBuffer } from '@/lib/storage/r2';
import { MAX_BYTES, isUploadKind, maxBytesLabel, sniff, uploadKey, type UploadKind } from '@/lib/uploads';

/**
 * Accept an input file for a generation and return a URL the model can fetch.
 *
 * Reference images used to travel as base64 data URLs inside the generation
 * request. That works for a still and breaks for everything else: a voice
 * track or a clip to re-dub is megabytes, base64 adds a third on top, and the
 * whole thing has to sit in memory twice before the provider is even called.
 * Both lip-sync routes want a URL anyway — fal reads `audio_url` / `video_url`
 * over the network, and a rented worker downloads into its own input dir — so
 * the file goes to R2 once here and only its URL moves afterwards.
 */

/**
 * Uploads per user per window.
 *
 * In-process, so a clustered PM2 deployment enforces it per worker rather than
 * globally. That is deliberate rather than overlooked: the alternative is a
 * database round-trip on every upload, and the loss this bounds is R2 storage
 * from a logged-in account, not spend or data. The hard per-file cap in
 * `MAX_BYTES` is the control that actually limits the damage; this one just
 * stops a stuck client hammering the bucket.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const recent = new Map<number, number[]>();

function overRateLimit(userId: number): boolean {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recent.set(userId, hits);

  // Drop other users' expired entries occasionally so the map cannot grow
  // without bound on a long-lived process.
  if (recent.size > 500) {
    for (const [id, times] of recent) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) recent.delete(id);
    }
  }

  return hits.length > RATE_MAX;
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isStorageConfigured()) {
    // Worth naming plainly: without R2 there is nowhere to put the file, and a
    // generic failure here would send the operator hunting through the model
    // config instead of the environment.
    return NextResponse.json(
      { error: 'ระบบยังไม่ได้ตั้งค่าที่เก็บไฟล์ กรุณาติดต่อผู้ดูแลระบบ' },
      { status: 503 }
    );
  }

  if (overRateLimit(userId)) {
    return NextResponse.json({ error: 'อัปโหลดถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' }, { status: 429 });
  }

  const kindParam = request.nextUrl.searchParams.get('kind');
  if (!isUploadKind(kindParam)) {
    return NextResponse.json({ error: 'Invalid upload kind' }, { status: 400 });
  }
  const kind: UploadKind = kindParam;
  const limit = MAX_BYTES[kind];

  // Checked before the body is read so an oversized upload is refused at the
  // header rather than after we have buffered it. A lying or absent
  // Content-Length is caught by the size check on the real bytes below.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    return NextResponse.json(
      { error: `ไฟล์ใหญ่เกินไป (สูงสุด ${maxBytesLabel(kind)})` },
      { status: 413 }
    );
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get('file');
    if (entry instanceof File) file = entry;
  } catch {
    return NextResponse.json({ error: 'Malformed upload' }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'ไฟล์ว่างเปล่า' }, { status: 400 });
  }

  if (file.size > limit) {
    return NextResponse.json(
      { error: `ไฟล์ใหญ่เกินไป (สูงสุด ${maxBytesLabel(kind)})` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // The declared MIME type is not consulted. What the bytes say is the only
  // thing we are willing to put our own domain behind.
  const detected = sniff(buffer, kind);
  if (!detected) {
    return NextResponse.json(
      { error: 'ไม่รองรับไฟล์ชนิดนี้ กรุณาใช้ไฟล์รูปแบบมาตรฐาน' },
      { status: 415 }
    );
  }

  try {
    const key = uploadKey(userId, kind, detected.ext);
    const url = await uploadBuffer(buffer, key, detected.contentType);

    return NextResponse.json({
      url,
      kind,
      bytes: buffer.length,
      contentType: detected.contentType,
    });
  } catch (error) {
    // The S3 client's message can carry the bucket name and endpoint. Log it,
    // return nothing that describes our storage layout.
    console.error('[uploads] failed to store file:', error);
    return NextResponse.json({ error: 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
  }
}
