/**
 * The studio's reading of a queued or rendering job, and how its bar moves
 * between polls. Pure, so the page and a test can share it.
 */

/**
 * What /api/generate/[id] reports while a queued job waits — a place in the
 * queue and an honest ETA, never how the work is run.
 */
export interface QueueProgress {
  stage: 'queued' | 'starting' | 'rendering';
  label: string;
  position: number | null;
  etaSeconds: number | null;
  etaLabel: string | null;
  basis: string;
  /**
   * How far the render itself is, 0–0.99, once it is this customer's turn —
   * measured by the renderer where it can say. Null while queued. This is
   * the last reading as reported; what is drawn is `shownFraction`.
   */
  fraction: number | null;
  /** What the bar showed when this reading arrived — it never drops below. */
  floor: number;
  /** Fraction per second over recent readings, to carry the bar between polls. */
  rate: number;
  /** When this reading arrived, so the bar keeps moving between polls. */
  at: number;
}

/** The `gpu` block of GET /api/generate/[id]. */
export interface QueueReading {
  stage: QueueProgress['stage'];
  label: string;
  queuePosition?: number | null;
  etaSeconds?: number | null;
  etaLabel?: string | null;
  etaBasis?: string;
  progress?: number | null;
  phase?: string | null;
}

/**
 * The most a bar may run ahead of the last real reading. Steps land every few
 * seconds; this keeps the bar moving through them without ever inventing more
 * than about one step's worth.
 */
const MAX_DRIFT = 0.05;

/**
 * The render fraction to draw now: the last reading carried forward at its
 * recent pace — never more than MAX_DRIFT past it, and never below what was
 * already on screen.
 */
export function shownFraction(p: QueueProgress | null, now: number): number | null {
  if (!p || p.fraction == null) return null;
  const drift = Math.min(MAX_DRIFT, Math.max(0, p.rate) * Math.max(0, now - p.at) / 1000);
  return Math.min(0.99, Math.max(p.floor, p.fraction + drift));
}

/** Fold a new reading into the last one. */
export function nextQueueProgress(prev: QueueProgress | null, gpu: QueueReading, at: number): QueueProgress {
  const reported = typeof gpu.progress === 'number' ? gpu.progress : null;
  const last = prev && prev.stage === gpu.stage && prev.fraction != null && reported != null ? prev : null;
  // Pace is measured reading to reading — the drift drawn in between is not
  // evidence of anything.
  const instant =
    last && reported != null && at > last.at
      ? Math.max(0, (reported - (last.fraction as number)) / ((at - last.at) / 1000))
      : 0;
  return {
    stage: gpu.stage,
    label: gpu.label,
    position: gpu.queuePosition ?? null,
    etaSeconds: gpu.etaSeconds ?? null,
    etaLabel: gpu.etaLabel ?? null,
    // With no history the estimate is a rough baseline, and is worded as such
    // rather than quoted like a firm figure.
    basis: gpu.etaBasis ?? 'history',
    fraction: reported,
    // Within a stage the bar never steps back, even when a stale read lags
    // behind what was drawn. A new stage starts its own bar.
    floor: last ? shownFraction(last, at) ?? 0 : reported ?? 0,
    // Smoothed, so one long step doesn't stall the bar and one fast one
    // doesn't fling it.
    rate: last ? 0.5 * last.rate + 0.5 * instant : 0,
    at,
  };
}
