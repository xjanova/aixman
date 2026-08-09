/**
 * Next.js startup hook — runs once per server process.
 *
 * Starts the background schedulers. Both exist so the app does not depend on an
 * operator remembering a crontab: without the GPU tick a rented machine bills
 * indefinitely, and without the retention sweep stored media grows without
 * bound. The matching /api/cron/* routes remain available for external
 * scheduling.
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
}
