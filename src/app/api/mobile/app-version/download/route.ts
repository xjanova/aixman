import { NextRequest, NextResponse } from 'next/server';
import { getApkAssetUrl } from '@/lib/services/app-release';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * GET /api/mobile/app-version/download
 *
 * Streams the latest APK.
 *
 * Only used when `GITHUB_TOKEN` is set, i.e. the app repo is private and its
 * release assets are not publicly readable. For a public repo the version
 * endpoint hands out GitHub's own CDN URL and this route is never called —
 * which is much better, because streaming a 40MB binary through the Next
 * server is a poor use of it.
 *
 * Unauthenticated for the same reason as the version endpoint, and rate limited
 * hard because each hit is tens of megabytes of egress.
 */
export async function GET(request: NextRequest) {
  const limit = rateLimit(`apk-download:${clientIp(request.headers)}`, 5, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'ดาวน์โหลดบ่อยเกินไป กรุณารอสักครู่' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  const assetUrl = await getApkAssetUrl();
  if (!assetUrl) {
    return NextResponse.json({ error: 'ไม่พบไฟล์ติดตั้ง' }, { status: 404 });
  }

  const upstream = await fetch(assetUrl, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'aixman-mobile-release-proxy',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    redirect: 'follow',
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'ดาวน์โหลดไฟล์ติดตั้งไม่สำเร็จ' }, { status: 502 });
  }

  // Streamed, not buffered — a 40MB Buffer per concurrent download would take
  // the 512MB PM2 memory cap down with it.
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="xdreamer.apk"',
      ...(upstream.headers.get('content-length')
        ? { 'Content-Length': upstream.headers.get('content-length')! }
        : {}),
      'Cache-Control': 'no-store',
    },
  });
}
