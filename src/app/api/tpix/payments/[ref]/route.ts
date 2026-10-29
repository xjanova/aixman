import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { isQuoteReference } from '@/lib/tpix/chain';
import { callXmanTpix } from '@/lib/tpix/xman-api';
import { pickStatus } from '@/lib/tpix/quote';

/**
 * GET /api/tpix/payments/{reference} — where the customer's TPIX payment is:
 * waiting, confirming on the chain, paid (credits sent), expired… Only the
 * quote's owner gets an answer; xmanstudio checks that against our session's
 * user id. Each call may make xmanstudio look at the chain (at most once per
 * 8 s per quote on its side).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  }

  const { ref } = await params;
  if (!isQuoteReference(ref)) {
    return NextResponse.json({ error: 'ไม่พบรายการนี้' }, { status: 404 });
  }

  const limit = rateLimit(`tpix-status:${userId}`, 40, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: 'ตรวจสถานะถี่เกินไป' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
  }

  const result = await callXmanTpix('payments/status', { user_id: userId, reference: ref });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ status: pickStatus(result.data) });
}
