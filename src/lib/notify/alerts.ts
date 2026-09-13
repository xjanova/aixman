import prisma from '@/lib/db';
import { isTelegramConfigured, notifyAdmins } from './telegram';
import { formatAlert, type AlertLevel } from './alert-types';

/**
 * Urgent admin alerts on Telegram, as text — quick to read on a phone, and
 * nothing to render that could fail. (The balance alert and the daily report
 * are picture cards; see report-card.tsx.)
 *
 * Each alert has a de-duplication key and a cooldown, recorded in
 * `ai_settings` so a restart does not repeat it: a machine that cannot be
 * terminated is retried every tick, but the admin hears about it once an hour,
 * not once a minute. A send that fails is not recorded, so it is tried again.
 *
 * Nothing here ever throws, and `raiseAlert` never makes its caller wait:
 * an alert must not be able to break the thing it reports on.
 */

const STATE_KEY = 'notify_alert_state';
const DEFAULT_COOLDOWN_MS = 60 * 60_000;
/** Keys older than this are dropped from the stored state. */
const FORGET_AFTER_MS = 7 * 86_400_000;

export interface AlertInput {
  /** One of ALERT_TYPES' ids. */
  type: string;
  /** Narrows de-duplication, e.g. a worker id or a date. */
  key?: string;
  level: AlertLevel;
  title: string;
  lines?: (string | null | undefined)[];
  /** Same type+key is not repeated within this window. Default 1 h. */
  cooldownMs?: number;
  /** Admin page linked under the alert. Default /admin/gpu. */
  path?: string;
}

async function loadState(): Promise<Record<string, number>> {
  const row = await prisma.aiSetting.findUnique({ where: { key: STATE_KEY } });
  try {
    const parsed = JSON.parse(row?.value ?? '{}') as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveState(state: Record<string, number>): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.aiSetting.upsert({
    where: { key: STATE_KEY },
    update: { value },
    create: { key: STATE_KEY, value, type: 'json', group: 'notify' },
  });
}

function adminLink(path = '/admin/gpu'): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}${path}` : undefined;
}

/** Send now, subject to the cooldown. True when it went out. */
export async function sendAlert(alert: AlertInput): Promise<boolean> {
  try {
    if (!(await isTelegramConfigured())) return false;
    const id = alert.key ? `${alert.type}:${alert.key}` : alert.type;
    const now = Date.now();
    const state = await loadState();
    const last = state[id];
    if (last && now - last < (alert.cooldownMs ?? DEFAULT_COOLDOWN_MS)) return false;

    const sent = await notifyAdmins(formatAlert(alert.level, alert.title, alert.lines, adminLink(alert.path)));
    if (!sent) return false;

    // Re-read before writing: another alert may have landed meanwhile.
    const fresh = await loadState();
    fresh[id] = now;
    for (const [k, t] of Object.entries(fresh)) if (now - t > FORGET_AFTER_MS) delete fresh[k];
    await saveState(fresh);
    return true;
  } catch (error) {
    console.error(`[alerts] ${alert.type} not sent:`, (error as Error).message);
    return false;
  }
}

/** Fire and forget — for code paths that must not wait on Telegram. */
export function raiseAlert(alert: AlertInput): void {
  void sendAlert(alert);
}
