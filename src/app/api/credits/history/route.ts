import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { CreditService } from '@/lib/services/credits';

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));

  const result = await CreditService.getTransactions(userId, page, limit);

  return NextResponse.json({
    data: result.data.map((txn) => ({
      id: txn.id,
      type: txn.type,
      amount: txn.amount,
      balanceAfter: txn.balanceAfter,
      description: txn.description,
      createdAt: txn.createdAt,
    })),
    total: result.total,
    pages: result.pages,
    page: result.page,
  });
}
