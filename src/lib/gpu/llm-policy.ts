/**
 * How long a self-hosted language model's machines stay up.
 *
 * A render machine lives for its queue; an API machine has no queue — requests
 * arrive one by one and expect an answer in seconds — so it is kept up by a
 * policy instead. Every mode answers demand: a request that finds no machine
 * records it (`llm_gpu_demand`), the tick rents one, and it stays until it has
 * been idle for `idleMinutes`. What the modes add is a baseline kept up with
 * no demand at all:
 *
 *   off        nothing, ever (demand is refused)
 *   on-demand  0 — the first request waits for a boot (20–40 min)
 *   schedule   1 inside the hours, Asia/Bangkok by default
 *   always     1, day and night
 *
 * API machines have their own budget and slot cap (`llm_gpu_config`): they
 * never take a render slot, and the render budget never shuts them down.
 *
 * The pure functions here are what the tests pin; the rest reads ai_settings.
 */

import prisma from '@/lib/db';

export type LlmUptimeMode = 'off' | 'on-demand' | 'schedule' | 'always';

export interface LlmPolicy {
  mode: LlmUptimeMode;
  /** A machine above the baseline closes after this long without a request. */
  idleMinutes: number;
  /** "HH:MM", in `timezone`. The window may cross midnight (22:00–06:00). */
  scheduleStart: string;
  scheduleEnd: string;
  /** Days the window opens on, 0 = Sunday. */
  scheduleDays: number[];
  timezone: string;
  /** The most machines this model may have at once, demand included. */
  maxMachines: number;
}

export interface LlmFleetConfig {
  /** USD per calendar day for API machines, apart from the render budget. */
  dailyBudgetUsd: number;
  /** API machines up at once, across every model. */
  maxWorkers: number;
  maxPricePerHourUsd: number;
}

export const DEFAULT_LLM_POLICY: LlmPolicy = {
  mode: 'off',
  idleMinutes: 20,
  scheduleStart: '09:00',
  scheduleEnd: '23:00',
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  timezone: 'Asia/Bangkok',
  maxMachines: 1,
};

export const DEFAULT_LLM_FLEET: LlmFleetConfig = {
  dailyBudgetUsd: 20,
  maxWorkers: 2,
  maxPricePerHourUsd: 2.5,
};

/** Demand older than this no longer asks for a machine (one is booting or it went away). */
export const DEMAND_WINDOW_MS = 10 * 60_000;
/** A request that finds every machine this busy asks for one more (up to maxMachines). */
export const BUSY_INFLIGHT = 8;

const MODES: LlmUptimeMode[] = ['off', 'on-demand', 'schedule', 'always'];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Read a stored policy field by field; anything unusable falls back. Never throws. */
export function parsePolicy(raw: unknown): LlmPolicy {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_LLM_POLICY;
  const days = Array.isArray(o.scheduleDays)
    ? [...new Set(o.scheduleDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    : d.scheduleDays;
  return {
    mode: MODES.includes(o.mode as LlmUptimeMode) ? (o.mode as LlmUptimeMode) : d.mode,
    idleMinutes: Math.round(bounded(o.idleMinutes, d.idleMinutes, 5, 24 * 60)),
    scheduleStart: typeof o.scheduleStart === 'string' && HHMM.test(o.scheduleStart) ? o.scheduleStart : d.scheduleStart,
    scheduleEnd: typeof o.scheduleEnd === 'string' && HHMM.test(o.scheduleEnd) ? o.scheduleEnd : d.scheduleEnd,
    scheduleDays: days,
    timezone: validTimezone(o.timezone) ? o.timezone : d.timezone,
    maxMachines: Math.round(bounded(o.maxMachines, d.maxMachines, 1, 8)),
  };
}

export function parseFleet(raw: unknown): LlmFleetConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_LLM_FLEET;
  return {
    dailyBudgetUsd: bounded(o.dailyBudgetUsd, d.dailyBudgetUsd, 0, 10_000),
    maxWorkers: Math.round(bounded(o.maxWorkers, d.maxWorkers, 0, 20)),
    maxPricePerHourUsd: bounded(o.maxPricePerHourUsd, d.maxPricePerHourUsd, 0.1, 100),
  };
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Day of week and minute of day at `now` in `timezone`. */
function localClock(now: Date, timezone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Whether the schedule window is open. A window that crosses midnight belongs
 * to the day it opened on: Friday 22:00–06:00 is open at 03:00 on Saturday.
 */
export function inSchedule(policy: LlmPolicy, now: Date): boolean {
  const { day, minute } = localClock(now, policy.timezone);
  const start = minutes(policy.scheduleStart);
  const end = minutes(policy.scheduleEnd);
  if (start === end) return policy.scheduleDays.includes(day);
  if (start < end) return policy.scheduleDays.includes(day) && minute >= start && minute < end;
  if (minute >= start) return policy.scheduleDays.includes(day);
  return minute < end && policy.scheduleDays.includes((day + 6) % 7);
}

/** Machines kept up with no demand. */
export function baselineMachines(policy: LlmPolicy, now: Date): number {
  switch (policy.mode) {
    case 'always':
      return 1;
    case 'schedule':
      return inSchedule(policy, now) ? 1 : 0;
    default:
      return 0;
  }
}

export interface Demand {
  /** A request found no ready machine. */
  at?: number;
  /** A request found every ready machine at BUSY_INFLIGHT or more. */
  busyAt?: number;
}

/** Machines the model should have now: the baseline, plus what recent demand asks for. */
export function wantedMachines(policy: LlmPolicy, now: Date, demand: Demand | undefined, live: number): number {
  if (policy.mode === 'off') return 0;
  const t = now.getTime();
  let wanted = baselineMachines(policy, now);
  if (demand?.at && t - demand.at <= DEMAND_WINDOW_MS) wanted = Math.max(wanted, 1);
  if (demand?.busyAt && t - demand.busyAt <= DEMAND_WINDOW_MS) wanted = Math.max(wanted, live + 1);
  return Math.min(wanted, policy.maxMachines);
}

/**
 * Whether a ready machine should close. The oldest `baseline` machines are
 * kept whatever their idleness; any other closes after `idleMinutes` without
 * a request.
 */
export function shouldRelease(
  policy: LlmPolicy,
  now: Date,
  rankAmongReady: number,
  lastUsedAt: Date
): boolean {
  if (rankAmongReady < baselineMachines(policy, now)) return false;
  return now.getTime() - lastUsedAt.getTime() > policy.idleMinutes * 60_000;
}

// ---------------------------------------------------------------------------
// Stored in ai_settings, group `llm`
// ---------------------------------------------------------------------------

const POLICIES_KEY = 'llm_gpu_policies';
const FLEET_KEY = 'llm_gpu_config';
const DEMAND_KEY = 'llm_gpu_demand';

async function readJson(key: string): Promise<unknown> {
  const row = await prisma.aiSetting.findUnique({ where: { key } }).catch(() => null);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  await prisma.aiSetting.upsert({
    where: { key },
    create: { key, value: text, type: 'json', group: 'llm' },
    update: { value: text },
  });
}

export async function getPolicies(): Promise<Record<string, LlmPolicy>> {
  const raw = (await readJson(POLICIES_KEY)) as Record<string, unknown> | null;
  return Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, parsePolicy(v)]));
}

export async function getPolicy(modelKey: string): Promise<LlmPolicy> {
  return (await getPolicies())[modelKey] ?? DEFAULT_LLM_POLICY;
}

export async function savePolicy(modelKey: string, policy: LlmPolicy): Promise<void> {
  const all = await getPolicies();
  all[modelKey] = parsePolicy(policy);
  await writeJson(POLICIES_KEY, all);
}

export async function getFleetConfig(): Promise<LlmFleetConfig> {
  return parseFleet(await readJson(FLEET_KEY));
}

export async function saveFleetConfig(cfg: LlmFleetConfig): Promise<void> {
  await writeJson(FLEET_KEY, parseFleet(cfg));
}

export async function getDemand(): Promise<Record<string, Demand>> {
  return ((await readJson(DEMAND_KEY)) as Record<string, Demand> | null) ?? {};
}

/** Noted at most once a minute per model and kind, from this process. */
const lastNoted = new Map<string, number>();

export async function noteDemand(modelKey: string, kind: 'at' | 'busyAt'): Promise<void> {
  const memo = `${modelKey}:${kind}`;
  const now = Date.now();
  if (now - (lastNoted.get(memo) ?? 0) < 60_000) return;
  lastNoted.set(memo, now);
  const all = await getDemand();
  all[modelKey] = { ...all[modelKey], [kind]: now };
  await writeJson(DEMAND_KEY, all).catch((error) => console.error('[llm] could not note demand:', (error as Error).message));
}
