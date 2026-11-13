/**
 * Next.js startup hook — runs once per server process.
 *
 * Starts the background schedulers. They exist so the app does not depend on
 * an operator remembering a crontab: without the GPU tick a rented machine
 * bills indefinitely, without the retention sweep stored media grows without
 * bound, and without the API order sweep an order cut off by a restart stays
 * charged and spinning. The matching /api/cron/* routes remain available for external
 * scheduling.
 *
 * It also adds the KIE rows a deploy's new catalogue entries need. That belongs
 * here and not in auto-deploy.yml: the app that knows the catalogue is the one
 * starting, the rows cannot exist before the code that serves them, and nothing
 * in the deploy can fail over it.
 */
export async function register() {
  // The edge runtime has no timers that survive a request, and this must not
  // run during static generation at build time.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  try {
    const { startGpuScheduler } = await import('@/lib/services/gpu-scheduler');
    startGpuScheduler();
  } catch (error) {
    // A scheduler that fails to start must not prevent the app from serving.
    console.error('[gpu] could not start scheduler:', (error as Error).message);
  }

  try {
    const { startRetentionScheduler } = await import('@/lib/services/retention');
    startRetentionScheduler();
  } catch (error) {
    console.error('[retention] could not start scheduler:', (error as Error).message);
  }
  try {
    const { startApiOrderSweep } = await import('@/lib/services/api-order-sweep');
    startApiOrderSweep();
  } catch (error) {
    console.error('[api-orders] could not start the sweep:', (error as Error).message);
  }
  try {
    const { startKieRowBackfill } = await import('@/lib/providers/kie-sync');
    startKieRowBackfill();
  } catch (error) {
    console.error('[kie] could not start the row backfill:', (error as Error).message);
  }
}
