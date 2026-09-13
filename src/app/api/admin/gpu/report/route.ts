import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { getGpuConfig } from '@/lib/gpu/config';
import { buildDailyReport } from '@/lib/services/gpu-report';
import { renderCurrentBalanceCard } from '@/lib/services/gpu-balance';

/**
 * Preview of the Telegram report cards, as the PNG that would be sent.
 * `?kind=daily` (default) — yesterday's report; `?kind=balance` — the alert
 * card for the current balance reading. Renders only; sends nothing.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const kind = request.nextUrl.searchParams.get('kind') === 'balance' ? 'balance' : 'daily';
  const cfg = await getGpuConfig();
  try {
    const png = kind === 'balance' ? await renderCurrentBalanceCard(cfg) : (await buildDailyReport(cfg)).png;
    if (!png) {
      return NextResponse.json({ error: 'ยังไม่มีข้อมูลยอดเงิน — เปิดการเช่า GPU แล้วรอรอบเช็คถัดไป' }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[gpu-report] preview failed:', error);
    return NextResponse.json({ error: `สร้างรูปไม่สำเร็จ: ${(error as Error).message}` }, { status: 500 });
  }
}
