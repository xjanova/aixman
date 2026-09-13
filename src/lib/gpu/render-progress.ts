import type { WorkerProgress } from './worker-client';

/**
 * How far a running render is, for the customer's progress bar.
 *
 * The worker reports raw facts — sampler step N of M, how many samplers the
 * graph has, whether decoding has begun. This folds them into one number.
 * Denoising is the only stage ComfyUI measures, so it gets the wide middle
 * band; loading before it and decoding after it get narrow bands that creep
 * with time and carry their own label, so a pause at 85% reads as "finishing"
 * rather than "stuck". Nothing short of the stored result reaches 100%.
 *
 * Pure, so it can be exercised without a worker.
 */

export type RenderPhase = 'waiting' | 'loading' | 'sampling' | 'finishing' | 'saving';

export interface RenderProgress {
  /** 0 to 0.99. */
  fraction: number;
  /** Null for a time-based estimate, when the worker could not say. */
  phase: RenderPhase | null;
}

const LOAD_FROM = 0.02;
const SAMPLE_FROM = 0.08;
const FINISH_FROM = 0.85;
const FINISH_TO = 0.98;
const SAVING = 0.99;
/** Time constants of the creeping bands: ~63% of the band after this long. */
const LOAD_TAU_S = 90;
const FINISH_TAU_S = 60;
/** A time-based bar stops here, however late the render runs. */
const ESTIMATE_CAP = 0.95;

const creep = (from: number, to: number, seconds: number, tau: number) =>
  from + (to - from) * (1 - Math.exp(-Math.max(0, seconds) / tau));

/** Fold a worker report for our prompt into one fraction and the stage it is in. */
export function renderFraction(p: WorkerProgress): { fraction: number; phase: RenderPhase } {
  // ComfyUI is done; the result is still being copied to storage.
  if (p.done) return { fraction: SAVING, phase: 'saving' };

  const step = p.max > 0 ? Math.min(1, p.value / p.max) : 0;
  if (p.samplersTotal > 0) {
    if (p.samplersDone >= p.samplersTotal) {
      return { fraction: creep(FINISH_FROM, FINISH_TO, p.sinceSampling ?? 0, FINISH_TAU_S), phase: 'finishing' };
    }
    const through = (p.samplersDone + (p.progressIsSampler ? step : 0)) / p.samplersTotal;
    if (through > 0) return { fraction: SAMPLE_FROM + (FINISH_FROM - SAMPLE_FROM) * through, phase: 'sampling' };
  } else if (p.max > 0) {
    // No node recognised as a sampler: any stepped node is the best signal left.
    return { fraction: SAMPLE_FROM + (FINISH_FROM - SAMPLE_FROM) * step, phase: 'sampling' };
  }
  return { fraction: creep(LOAD_FROM, SAMPLE_FROM, p.elapsed, LOAD_TAU_S), phase: 'loading' };
}

/** The bar when the worker cannot report: time served against the estimate. */
export function estimatedFraction(elapsedSeconds: number, remainingSeconds: number | null): number | null {
  if (remainingSeconds == null) return null;
  const total = Math.max(1, elapsedSeconds + remainingSeconds);
  return Math.min(ESTIMATE_CAP, Math.max(0, elapsedSeconds) / total);
}
