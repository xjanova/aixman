import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { CreditService } from '@/lib/services/credits';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const credits = await CreditService.getUserCredits(userId);
  return NextResponse.json(credits);
}
