import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { callXmanTpix } from '@/lib/tpix/xman-api';
import { pickQuote } from '@/lib/tpix/quote';
import { requestLocale, translator } from '@/lib/i18n/locale';

/**
 * POST /api/tpix/orders — a TPIX quote for one credit package, for the
 * signed-in customer. Body: { packageSlug }.
 *
 * xmanstudio makes (or reuses, within 24 h) the pending order with the TPIX
 * discount and returns the exact amount to send, the shop's address and the
 * deadline. Asking again for the same package therefore does not pile up
 * orders; it refreshes an expired quote.
 */
export async function POST(request: NextRequest) {
  const t = translator(requestLocale(request));
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: t('กรุณาเข้าสู่ระบบก่อนซื้อด้วย TPIX', 'Please sign in to buy with TPIX.') }, { status: 401 });
  }

  const limit = rateLimit(`tpix-order:${userId}`, 8, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: t(
          `ขอยอดชำระถี่เกินไป กรุณารอ ${limit.retryAfter} วินาที`,
          `Too many payment requests. Please wait ${limit.retryAfter} ${limit.retryAfter === 1 ? 'second' : 'seconds'}.`,
        ),
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let packageSlug = '';
  try {
    const body = await request.json();
    packageSlug = typeof body?.packageSlug === 'string' ? body.packageSlug.trim() : '';
  } catch {
    // falls through to the check below
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(packageSlug)) {
    return NextResponse.json({ error: t('ไม่พบแพ็กเกจนี้', 'This package was not found.') }, { status: 400 });
  }

  const result = await callXmanTpix('orders', { user_id: userId, package_slug: packageSlug });
  if (!result.ok) {
    return NextResponse.json({ error: t(result.message) }, { status: result.status });
  }

  const quote = pickQuote(result.data);
  if (!quote) {
    console.error('[tpix] xmanstudio sent a quote this page cannot pay', { userId, packageSlug });
    return NextResponse.json(
      { error: t('ได้รับยอดชำระที่ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 'We received an invalid payment amount. Please try again.') },
      { status: 502 },
    );
  }
  return NextResponse.json({ quote });
}
