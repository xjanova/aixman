import { NextRequest, NextResponse } from 'next/server';
import { RetentionService } from '@/lib/services/retention';
import { hasValidCronSecret } from '@/lib/utils/cron-auth';
import { isAdmin } from '@/lib/auth';

/**
 * Cron endpoint — deletes generated media whose retention window has passed.
 *
 * The app also sweeps on its own schedule (see `src/instrumentation.ts`), so
 * this exists for operators who prefer an external cron and for running a
 * backfill on demand:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://ai.xman4289.com/api/cron/retention?backfill=1
 *
 * Deleting is deliberately bounded per call — a large backlog is worked through
 * over several runs rather than in one request that could time out partway and
 * leave storage and database disagreeing.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req: NextRequest) {
  const authorized = hasValidCronSecret(req) || (await isAdmin());
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const backfilled = req.nextUrl.searchParams.get('backfill') === '1'
      ? await RetentionService.backfill()
      : 0;

    const limit = Math.min(1000, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 200));
    const swept = await RetentionService.sweep(limit);

    return NextResponse.json({
      retentionDays: await RetentionService.getRetentionDays(),
      backfilled,
      ...swept,
    });
  } catch (error) {
    console.error('[retention] sweep failed:', error);
    return NextResponse.json({ error: 'Retention sweep failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
