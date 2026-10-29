import { NextRequest, NextResponse } from 'next/server';
import { GenerationService } from '@/lib/services/generation';
import { hasValidCronSecret } from '@/lib/utils/cron-auth';

/**
 * How many orders this process is waiting on that a restart would lose — read
 * by the deploy before it restarts the app (.github/workflows/auto-deploy.yml),
 * so a deploy no longer cuts a customer's paid order off mid-render.
 *
 * KIE and fal orders are not counted once the vendor has named the job: a
 * restart leaves those for ApiOrderSweep to collect. Rented-GPU jobs live in
 * their own queue and are never counted.
 *
 * Open to the cron secret, or to a request made on the server itself straight
 * to the app's port — the deploy script's — which arrives without the
 * X-Forwarded-For every proxied request carries. It answers counts only.
 */
export const dynamic = 'force-dynamic';

function onTheServer(req: NextRequest): boolean {
  if (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip')) return false;
  const host = (req.headers.get('host') ?? '').replace(/:\d+$/, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

export async function GET(req: NextRequest) {
  if (!hasValidCronSecret(req) && !onTheServer(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ unrecoverable: GenerationService.unrecoverableInFlight() });
}
