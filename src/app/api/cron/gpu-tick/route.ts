import { NextRequest, NextResponse } from 'next/server';
import { GpuQueue } from '@/lib/services/gpu-queue';
import { withTickLock } from '@/lib/services/gpu-lock';
import { hasValidCronSecret } from '@/lib/utils/cron-auth';
import { isAdmin } from '@/lib/auth';

/**
 * Cron endpoint — advances the GPU rental queue.
 *
 * Every tick reconciles rented machines, polls running renders, reaps idle or
 * over-age workers, and dispatches queued jobs. Renting is triggered from here,
 * so this endpoint is also what stops a rented GPU from billing forever:
 * **if this stops running, machines are never reaped.**
 *
 * Schedule it every minute (self-hosted: system crontab / PM2 cron):
 *   * * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *                https://ai.xman4289.com/api/cron/gpu-tick
 *
 * The route is also kicked opportunistically right after a job is enqueued, so
 * a user isn't waiting up to a minute for their GPU to start warming.
 */

// GPU reconciliation talks to an external marketplace on every call — caching
// it would report stale worker state and hide a machine that needs reaping.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req: NextRequest) {
  const authorized = hasValidCronSecret(req) || (await isAdmin());
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // A skipped tick is expected and harmless — another process holds the lease
    // and is doing exactly this work right now.
    const report = await withTickLock(() => GpuQueue.tick());
    if (!report) {
      return NextResponse.json({ skipped: true, reason: 'Another tick is already running' });
    }
    return NextResponse.json(report);
  } catch (error) {
    console.error('[gpu] tick failed:', error);
    return NextResponse.json({ error: 'GPU tick failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
