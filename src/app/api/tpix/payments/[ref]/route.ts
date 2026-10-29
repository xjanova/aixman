import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { isQuoteReference } from '@/lib/tpix/chain';
import { callXmanTpix, xmanText } from '@/lib/tpix/xman-api';
import { pickStatus } from '@/lib/tpix/quote';
import { requestLocale, translator } from '@/lib/i18n/locale';

/**
 * GET /api/tpix/payments/{reference} — where the customer's TPIX payment is:
 * waiting, confirming on the chain, paid (credits sent), expired… Only the
 * quote's owner gets an answer; xmanstudio checks that against our session's
 * user id. Each call may make xmanstudio look at the chain (at most once per
 * 8 s per quote on its side).
 */
export async function GET(request: Request, { params }: { params: Promise<{ ref: string }> }) {
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

  const limit = rateLimit(`tpix-status:${userId}`, 40, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: t('ตรวจสถานะถี่เกินไป', 'Checking too often. Please wait a moment.') },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  const result = await callXmanTpix('payments/status', { user_id: userId, reference: ref });
  if (!result.ok) {
    return NextResponse.json({ error: t(result.message) }, { status: result.status });
  }
  // xmanstudio's label is Thai; an English page falls back to its own wording when it is dropped
  const status = pickStatus(result.data);
  return NextResponse.json({ status: { ...status, label: xmanText(status.label, locale) } });
}
