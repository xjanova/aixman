/**
 * What the studio shows while an API order runs: the vendor's own queue,
 * then the render with a percentage that starts the moment the vendor starts
 * on it. Pure, so the status route and a test share it.
 *
 * KIE reports a task's stage (waiting → queuing → generating) but no
 * percentage, so the percentage is time served against how long this model's
 * recent orders took — and says so (`phase: null`, as for a GPU render that
 * cannot report steps).
 */

/** A vendor task's stage as last read (KIE's `state`). */
export type VendorStage = 'waiting' | 'queuing' | 'generating';

export interface LiveTask {
  stage: VendorStage;
  /** When the vendor was first seen generating it, ms; null before. */
  generatingSince: number | null;
}

export interface ApiQueueBlock {
  stage: 'queued' | 'rendering';
  etaSeconds: number;
  /** 0–0.99 while rendering; null while queued. */
  progress: number | null;
}

/** Never promise less than this much more wait, however late the order runs. */
const MIN_REMAINING_SECONDS = 10;
/** …or less than this share of the usual time. */
const MIN_REMAINING_SHARE = 0.1;
/** The most a time-based estimate may claim before the file arrives. */
const ESTIMATE_CAP = 0.95;

/**
 * The queue reading for one order.
 *
 * `elapsedSeconds` runs from when the order started, `typicalSeconds` is how
 * long this model's orders take from start to file. `live` is the vendor's
 * last word on the task, null when nothing in this process is reading it (a
 * restart, or a provider that reports no stages): the order is then shown as
 * rendering, against the whole time it has run.
 */
export function apiQueueBlock(
  live: LiveTask | null,
  elapsedSeconds: number,
  typicalSeconds: number,
  now: number
): ApiQueueBlock {
  const elapsed = Math.max(0, elapsedSeconds);
  const floor = Math.max(MIN_REMAINING_SECONDS, typicalSeconds * MIN_REMAINING_SHARE);
  const remaining = Math.round(Math.max(typicalSeconds - elapsed, floor));
  if (live && live.stage !== 'generating') {
    return { stage: 'queued', etaSeconds: remaining, progress: null };
  }
  // The bar starts at 0 when the vendor starts: that is the moment worth seeing.
  const rendered = live?.generatingSince != null ? Math.max(0, (now - live.generatingSince) / 1000) : elapsed;
  const progress = Math.min(ESTIMATE_CAP, rendered / Math.max(1, rendered + remaining));
  return { stage: 'rendering', etaSeconds: remaining, progress };
}

/**
 * How long a model's orders take, from the recent ones that delivered: the
 * median, preferring orders of the same length when there are enough of
 * them. Null with too little history.
 */
export function typicalSeconds(
  history: { ms: number; duration: number | null }[],
  duration: number | null
): number | null {
  const same = duration != null ? history.filter((h) => h.duration === duration) : [];
  const pool = (same.length >= 3 ? same : history).map((h) => h.ms).filter((ms) => ms > 0);
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const ms = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.max(1, Math.round(ms / 1000));
}

/** A first guess for a model with no history yet, by what it makes. */
export function baselineSeconds(type: string): number {
  if (type === 'video') return 240;
  if (type === 'audio') return 90;
  return 40;
}
