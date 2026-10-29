/**
 * Every plan runs after the response: a structure call and several scene
 * calls take longer than the proxy in front of us waits for one request. The
 * page polls `planning` until the storyboard lands. A plan of some scenes
 * holds the same per-project slot as a whole one.
 *
 * In process like rate-limit.ts — correct because PM2 runs a single instance.
 * Planning is free and replaces shots in one transaction at its end, so a
 * restart mid-plan loses nothing but the wait; the page offers it again.
 */

import { packMsg } from '@/lib/i18n/messages';

interface PlanJob {
  startedAt: number;
  /** Why it failed — a packed pair (packMsg); readStoredMessage picks the language. */
  error: string | null;
  /** Shots written, once done. */
  shots: number | null;
  /** Set when the model gave nothing usable and the rules laid out the film. */
  rules: boolean;
}

const jobs = new Map<number, PlanJob>();

/** A plan that has run this long died with something; another may start. */
const STALE_MS = 10 * 60_000;
/** A finished plan's result is shown this long, then forgotten. */
const KEEP_MS = 30 * 60_000;

const STALE_ERROR = packMsg({ th: 'การวางช็อตครั้งก่อนค้าง ลองใหม่อีกครั้ง', en: 'The last plan got stuck. Please try again.' });

export type PlanJobView = { state: 'planning' | 'failed' | 'done'; error: string | null; shots: number | null; rules: boolean } | null;

export function planJob(projectId: number, now = Date.now()): PlanJobView {
  const job = jobs.get(projectId);
  if (!job) return null;
  const running = job.shots === null && job.error === null;
  if (running && now - job.startedAt > STALE_MS) return { state: 'failed', error: STALE_ERROR, shots: null, rules: false };
  if (!running && now - job.startedAt > KEEP_MS) {
    jobs.delete(projectId);
    return null;
  }
  return { state: running ? 'planning' : job.error ? 'failed' : 'done', error: job.error, shots: job.shots, rules: job.rules };
}

/**
 * Claim the project's plan slot. False when a plan for it is already running.
 * The caller runs the work and reports it through `finishPlan`.
 */
export function claimPlan(projectId: number, now = Date.now()): boolean {
  if (planJob(projectId, now)?.state === 'planning') return false;
  jobs.set(projectId, { startedAt: now, error: null, shots: null, rules: false });
  return true;
}

export function finishPlan(projectId: number, result: { shots: number; rules: boolean } | { error: string }): void {
  const job = jobs.get(projectId);
  if (!job) return;
  if ('error' in result) job.error = result.error;
  else {
    job.shots = result.shots;
    job.rules = result.rules;
  }
}
