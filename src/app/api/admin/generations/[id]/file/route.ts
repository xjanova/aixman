import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId } from '@/lib/utils/admin';
import { keyFromPublicUrl } from '@/lib/storage/r2';
import prisma from '@/lib/db';

/**
 * Stream a generation's media through this origin so it can be saved.
 *
 * The stored file lives on object storage under its own domain, and a browser
 * ignores `download` on a cross-origin link: the admin's "ดาวน์โหลด" button
 * opened the clip in a tab instead of saving it, which is useless when the job
 * is to collect forty of them. Fetching it here and re-sending it with
 * Content-Disposition makes it a real download — and keeps the storage URL out
 * of the page.
 */

export const dynamic = 'force-dynamic';

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const genId = parseId(id);
    if (!genId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const gen = await prisma.aiGeneration.findUnique({
      where: { id: genId },
      select: { id: true, type: true, resultUrl: true, mediaDeletedAt: true },
    });
    if (!gen?.resultUrl) {
      return NextResponse.json({ error: 'ผลงานนี้ไม่มีไฟล์' }, { status: 404 });
    }
    if (gen.mediaDeletedAt) {
      return NextResponse.json({ error: 'ไฟล์ถูกลบตามกำหนดเก็บรักษาไปแล้ว' }, { status: 410 });
    }

    // Only media we stored ourselves: this proxy must never be aimable at an
    // arbitrary host. keyFromPublicUrl answers null for anything outside our
    // own bucket, which is exactly the test the generate route uses.
    if (!keyFromPublicUrl(gen.resultUrl)) {
      return NextResponse.json({ error: 'ไฟล์นี้ไม่ได้อยู่บนที่เก็บของเรา' }, { status: 400 });
    }

    const upstream = await fetch(gen.resultUrl, { cache: 'no-store' });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `อ่านไฟล์จากที่เก็บไม่ได้ (HTTP ${upstream.status})` }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    // The stored name is a hash, which tells an admin nothing once forty of
    // them are sitting in one folder. Name it after the generation instead.
    const extension = EXTENSIONS[contentType] ?? (gen.resultUrl.split('?')[0].split('.').pop() || 'bin');
    const filename = `${gen.type}-${gen.id}.${extension}`;

    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    });
    const length = upstream.headers.get('content-length');
    if (length) headers.set('Content-Length', length);

    return new NextResponse(upstream.body, { headers });
  } catch (error) {
    console.error('Failed to stream generation file:', error);
    return NextResponse.json({ error: 'ส่งไฟล์ไม่สำเร็จ' }, { status: 500 });
  }
}
