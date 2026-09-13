/**
 * The rules behind gpu-balance.ts, with no imports so they can be exercised on
 * their own: what counts as low or insufficient, and when admins are told.
 */

/**
 * - `ok`           enough for an hour of the whole fleet
 * - `low`          can still rent, but not for long
 * - `insufficient` cannot rent at all — addCapacity's own test
 * - `unknown`      never read, or the reading is too old to act on
 */
export type BalanceState = 'ok' | 'low' | 'insufficient' | 'unknown';

/** While still low or insufficient, remind this often. */
export const REMIND_EVERY_MS = 6 * 3_600_000;

interface Caps {
  maxPricePerHourUsd: number;
  maxConcurrentWorkers: number;
}

/**
 * Insufficient: at or below one hour at the price ceiling — the same test
 * addCapacity always applied before renting. Low: under one hour of every
 * machine the fleet may run at once.
 */
export function balanceThresholds(cfg: Caps): { lowBelowUsd: number; insufficientAtOrBelowUsd: number } {
  const insufficient = cfg.maxPricePerHourUsd;
  return {
    lowBelowUsd: Math.max(insufficient, cfg.maxPricePerHourUsd * Math.max(1, cfg.maxConcurrentWorkers)),
    insufficientAtOrBelowUsd: insufficient,
  };
}

export function classifyBalance(usd: number, cfg: Caps): Exclude<BalanceState, 'unknown'> {
  const t = balanceThresholds(cfg);
  if (usd <= t.insufficientAtOrBelowUsd) return 'insufficient';
  if (usd < t.lowBelowUsd) return 'low';
  return 'ok';
}

/**
 * Whether a reading in `state` should message admins, given what they were
 * last told. Once per change for the worse, a reminder while it stays bad, one
 * "recovered" when it is fine again. `remember` is the state to record when no
 * message is due — a partial top-up (insufficient → low) needs none, but must
 * be remembered, or dropping back to insufficient would not count as worse.
 */
export function decideAlert(
  last: { alerted?: BalanceState; alertedAt?: number } | null,
  state: Exclude<BalanceState, 'unknown'>,
  now: number
): { send: boolean; remember?: BalanceState } {
  const told = last?.alerted ?? 'ok';
  if (state === 'ok') return told === 'ok' ? { send: false } : { send: true };

  const worse = told === 'ok' || (told === 'low' && state === 'insufficient');
  const remind = !last?.alertedAt || now - last.alertedAt > REMIND_EVERY_MS;
  if (worse || remind) return { send: true };
  return state !== told ? { send: false, remember: state } : { send: false };
}
