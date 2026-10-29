import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { isQuoteReference, isTxHash } from '@/lib/tpix/chain';
import { callXmanTpix } from '@/lib/tpix/xman-api';
import { pickStatus } from '@/lib/tpix/quote';

/**
 * POST /api/tpix/payments/{reference}/tx — "I paid with this transaction".
 * Body: { txHash }. The hash is only a pointer: xmanstudio reads the chain and
 * pays the order only for a mined, successful transfer of exactly the quoted
 * amount to the shop's address on TPIX Chain, within the quote's window, that
 * no other quote has claimed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  }

  const { ref } = await params;
  if (!isQuoteReference(ref)) {
    return NextResponse.json({ error: 'ไม่พบรายการนี้' }, { status: 404 });
  }

  const limit = rateLimit(`tpix-tx:${userId}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: 'ส่งเลขธุรกรรมถี่เกินไป' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
  }

  let txHash = '';
  try {
    const body = await request.json();
    txHash = typeof body?.txHash === 'string' ? body.txHash.trim() : '';
  } catch {
    // falls through to the check below
  }
  if (!isTxHash(txHash)) {
    return NextResponse.json({ error: 'เลขธุรกรรมต้องขึ้นต้นด้วย 0x ตามด้วยตัวอักษร 64 ตัว' }, { status: 400 });
  }

  const result = await callXmanTpix('payments/tx', { user_id: userId, reference: ref, tx_hash: txHash.toLowerCase() });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({
    result: typeof result.data.result === 'string' ? result.data.result : 'unknown',
    message: typeof result.data.message === 'string' ? result.data.message : '',
    status: pickStatus(result.data),
  });
}
