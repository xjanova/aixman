import { NextResponse } from 'next/server';
import { CreditService } from '@/lib/services/credits';

/**
 * Public endpoint: Get active credit packages
 * Used by both AI site and xmanstudio for price syncing
 */
export async function GET() {
  const packages = await CreditService.getPackages();
  return NextResponse.json({ packages });
}
