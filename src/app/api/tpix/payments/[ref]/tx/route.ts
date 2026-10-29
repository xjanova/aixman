import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { isQuoteReference, isTxHash } from '@/lib/tpix/chain';
import { callXmanTpix, xmanText } from '@/lib/tpix/xman-api';
import { pickStatus } from '@/lib/tpix/quote';
import { requestLocale, translator } from '@/lib/i18n/locale';

/**
 * POST /api/tpix/payments/{reference}/tx — "I paid with this transaction".
 * Body: { txHash }. The hash is only a pointer: xmanstudio reads the chain and
 * pays the order only for a mined, successful transfer of exactly the quoted
 * amount to the shop's address on TPIX Chain, within the quote's window, that
 * no other quote has claimed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const locale = requestLocale(request);
  const t = translator(locale);
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: t('กรุณาเข้าสู่ระบบ', 'Please sign in.') }, { status: 401 });
  }

  const { ref } = await params;
  if (!isQuoteReference(ref)) {
    return NextResponse.json({ error: t('ไม่พบรายการนี้', 'This payment was not found.') }, { status: 404 });
  }

  const limit = rateLimit(`tpix-tx:${userId}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: t('ส่งเลขธุรกรรมถี่เกินไป', 'Too many transaction submissions. Please wait a moment.') },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let txHash = '';
  try {
    const body = await request.json();
    txHash = typeof body?.txHash === 'string' ? body.txHash.trim() : '';
  } catch {
    // falls through to the check below
  }
  if (!isTxHash(txHash)) {
    return NextResponse.json(
      { error: t('เลขธุรกรรมต้องขึ้นต้นด้วย 0x ตามด้วยตัวอักษร 64 ตัว', 'A transaction hash starts with 0x followed by 64 characters.') },
      { status: 400 },
    );
  }

  const result = await callXmanTpix('payments/tx', { user_id: userId, reference: ref, tx_hash: txHash.toLowerCase() });
  if (!result.ok) {
    return NextResponse.json({ error: t(result.message) }, { status: result.status });
  }
  // xmanstudio's message and label are Thai; in English they are left out and the page's own wording shows
  const status = pickStatus(result.data);
  return NextResponse.json({
    result: typeof result.data.result === 'string' ? result.data.result : 'unknown',
    message: typeof result.data.message === 'string' ? xmanText(result.data.message, locale) : '',
    status: { ...status, label: xmanText(status.label, locale) },
  });
}
