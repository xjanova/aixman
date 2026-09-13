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
 *
 * One loop drives both lanes, so they can never race each other for the
 * lock: the full tick once a minute, and between them the fast lane
 * (`GpuQueue.fastTick`), which only collects finished renders and feeds idle
 * machines. Two timers would let a fast pass holding the lock make the full
 * tick — the one that reaps — skip its minute.
 */

const LOOP_INTERVAL_MS = 10_000;
const FULL_TICK_EVERY_MS = 60_000;
/** Wait for the app to finish booting before the first tick. */
const STARTUP_DELAY_MS = 15_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastFullTick = 0;

async function runLoop(): Promise<void> {
  // Never overlap with ourselves: a slow tick (renting can take 90s) would
  // otherwise pile up timers.
  if (running) return;
  running = true;
  try {
    if (Date.now() - lastFullTick >= FULL_TICK_EVERY_MS) {
      lastFullTick = Date.now();
      await withTickLock(() => GpuQueue.tick());
    } else if (await GpuQueue.hasFastWork()) {
      // Checked before the lock, so an idle system costs one count query
      // every ten seconds rather than a lock write.
      await withTickLock(() => GpuQueue.fastTick());
    }
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
    void runLoop();
    timer = setInterval(() => void runLoop(), LOOP_INTERVAL_MS);
    // Don't hold the event loop open on shutdown.
    timer.unref?.();
  }, STARTUP_DELAY_MS);
  begin.unref?.();

  console.log('[gpu] scheduler started (tick every 60s, fast lane every 10s)');
}

export function stopGpuScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
