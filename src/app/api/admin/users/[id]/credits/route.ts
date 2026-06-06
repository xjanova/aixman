import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { parseId } from '@/lib/utils/admin';
import { CreditService } from '@/lib/services/credits';
import prisma from '@/lib/db';

/**
 * Adjust a user's AI credit balance (admin only).
 * Positive amount grants, negative deducts. Records an 'admin_adjust' ledger row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseId(id);
    if (!userId) {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const amount = parseInt(body.amount, 10);
    if (!Number.isInteger(amount) || amount === 0) {
      return NextResponse.json({ error: 'amount ต้องเป็นจำนวนเต็มที่ไม่ใช่ 0' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 });
    }

    // Don't let an adjustment drive the balance negative.
    const current = await CreditService.getUserCredits(userId);
    if (current.balance + amount < 0) {
      return NextResponse.json(
        { error: `หักเกินยอดคงเหลือ (มี ${current.balance})` },
        { status: 400 }
      );
    }

    const description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : 'ปรับเครดิตโดยแอดมิน';

    const result = await CreditService.adminAdjust(userId, amount, description);
    return NextResponse.json({ success: true, balance: result.balance });
  } catch (error) {
    console.error('Failed to adjust credits:', error);
    return NextResponse.json({ error: 'Failed to adjust credits' }, { status: 500 });
  }
}
