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
  /** Rendering is stopped for now (the label says what happens next). */
  paused: boolean;
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
  paused?: boolean;
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

/** A short start-up: one place per this many seconds of it. */
export const STARTUP_SECONDS_PER_PLACE = 30;
/** A slow start-up must not show an absurd queue; the ETA carries its length. */
export const MAX_STARTUP_PLACES = 10;

/**
 * Places in the queue that stand for a machine still starting (the customer
 * is shown a queue, never the start-up). The whole start-up is spread over at
 * most MAX_STARTUP_PLACES places, so the number falls steadily from the first
 * poll to the last: a 2-minute one counts 4 → 1 every 30 s, a 20-minute one
 * 10 → 1 every 2 minutes. A flat 30 s a place capped at 8 sat on 8 for all
 * but the last four minutes of a 20-minute start-up.
 *
 * `totalSeconds` is the expected full start-up, `remainingSeconds` what is
 * left of it; 0 once a machine is up.
 */
export function startupPlaces(remainingSeconds: number, totalSeconds: number): number {
  if (!(remainingSeconds > 0)) return 0;
  const span = Math.max(remainingSeconds, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const perPlace = Math.max(STARTUP_SECONDS_PER_PLACE, span / MAX_STARTUP_PLACES);
  return Math.min(MAX_STARTUP_PLACES, Math.ceil(remainingSeconds / perPlace));
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
    paused: gpu.paused === true,
    at,
  };
}
