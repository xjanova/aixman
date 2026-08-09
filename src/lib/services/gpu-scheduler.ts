import { GpuQueue } from './gpu-queue';
import { withTickLock } from './gpu-lock';

/**
 * In-process scheduler for the GPU queue.
 *
 * The queue only advances when something ticks it, and the tick is what reaps
 * rented machines — so if nothing schedules it, a rented GPU bills forever.
 * Relying on the operator to install a crontab makes that a single point of
 * failure with a very expensive failure mode, so the app schedules itself.
 *
 * `/api/cron/gpu-tick` remains available and is still worth wiring to system
 * cron: it keeps working if the Node process is restarting or wedged.
 *
 * Several PM2 instances each run their own timer; the lease lock in
 * `gpu-lock.ts` makes that safe — extra ticks return immediately.
 */

const TICK_INTERVAL_MS = 60_000;
/** Wait for the app to finish booting before the first tick. */
const STARTUP_DELAY_MS = 15_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runTick(): Promise<void> {
  // Never overlap with ourselves: a slow tick (renting can take 90s) would
  // otherwise pile up timers.
  if (running) return;
  running = true;
  try {
    await withTickLock(() => GpuQueue.tick());
  } catch (error) {
    // Must never throw out of a timer — an unhandled rejection here would take
    // down the process that is responsible for reaping GPUs.
    console.error('[gpu] scheduled tick failed:', (error as Error).message);
  } finally {
    running = false;
  }
}

export function startGpuScheduler(): void {
  if (timer) return;

  const begin = setTimeout(() => {
    void runTick();
    timer = setInterval(() => void runTick(), TICK_INTERVAL_MS);
    // Don't hold the event loop open on shutdown.
    timer.unref?.();
  }, STARTUP_DELAY_MS);
  begin.unref?.();

  console.log('[gpu] scheduler started (tick every 60s)');
}

export function stopGpuScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
