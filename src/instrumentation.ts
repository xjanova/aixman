/**
 * Next.js startup hook — runs once per server process.
 *
 * Used to start the GPU queue scheduler. Without it, rented GPUs would only be
 * reaped when an external cron happened to fire, and a forgotten crontab means
 * a machine billing indefinitely.
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
}
