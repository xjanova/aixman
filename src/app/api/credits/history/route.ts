import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { CreditService } from '@/lib/services/credits';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await CreditService.getTransactions(userId, 1, 20);

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
  });
}
