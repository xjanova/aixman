import prisma from '@/lib/db';
import { getGpuProvider } from '@/lib/gpu';
import type { GpuBudgetConfig } from '@/lib/gpu/config';
import type { GpuBalance as VendorBalance } from '@/lib/gpu/types';
import { notifyAdminsWithCard } from '@/lib/notify/telegram';
import { balanceThresholds, classifyBalance as classify, decideAlert, type BalanceState } from './gpu-balance-rules';

export { balanceThresholds, type BalanceState };

/**
 * The GPU marketplace's prepaid balance, watched so it never runs out unseen.
 *
 * On 2026-09-13 it reached −$0.03 in the middle of a 37-clip batch. From then
 * on addCapacity refused to rent on every tick ("Provider balance too low"),
 * nobody was told, and the last two jobs sat queued for the full 90-minute
 * stuck-job allowance before being refunded as "queue too busy".
 *
 * So the last reading is kept in `ai_settings` — refreshed by the tick at most
 * every few minutes, and fresh whenever addCapacity is about to rent — admins
 * get a Telegram alert when it turns low or insufficient, and while it cannot
 * rent, new orders are refused and waiting jobs are released after a short
 * grace instead of 90 minutes.
 */

export interface BalanceReading {
  usd: number | null;
  availableRentalHours: number | null;
  checkedAt: string | null;
  state: BalanceState;
  /** Below this it warns: one hour of every allowed machine at the price ceiling. */
  lowBelowUsd: number;
  /** At or below this nothing can be rented — one hour at the price ceiling. */
  insufficientAtOrBelowUsd: number;
}

interface Stored {
  usd: number;
  hours: number | null;
  checkedAt: number;
  /** State last reported to admins, and when — so an alert fires once per change. */
  alerted?: BalanceState;
  alertedAt?: number;
}

const SETTING_KEY = 'gpu_provider_balance';

/** How often the tick asks the vendor. SimplePod's API is slow and flaky; no need to hammer it. */
export const BALANCE_REFRESH_MS = 5 * 60_000;
/** An older reading is not trusted to refuse orders — the tick may have stopped. */
const BALANCE_STALE_MS = 30 * 60_000;
/**
 * How long a queued job waits for a top-up before it is refunded. Long enough
 * for an admin to act on the alert, far short of the 90 min it used to wait.
 */
export const INSUFFICIENT_BALANCE_GRACE_MS = 15 * 60_000;

/** Customer copy when rendering is paused. Names no machine, GPU or vendor. */
export const RENDERING_PAUSED_MESSAGE = 'ระบบสร้างงานปิดให้บริการชั่วคราว กรุณาลองใหม่ภายหลัง';

async function load(): Promise<Stored | null> {
  const row = await prisma.aiSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Stored;
    return Number.isFinite(parsed.usd) && Number.isFinite(parsed.checkedAt) ? parsed : null;
  } catch {
    return null;
  }
}

async function save(stored: Stored): Promise<void> {
  const value = JSON.stringify(stored);
  await prisma.aiSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value, type: 'json', group: 'gpu' },
  });
}

function toReading(stored: Stored | null, cfg: GpuBudgetConfig): BalanceReading {
  const t = balanceThresholds(cfg);
  if (!stored) {
    return { usd: null, availableRentalHours: null, checkedAt: null, state: 'unknown', ...t };
  }
  const fresh = Date.now() - stored.checkedAt < BALANCE_STALE_MS;
  return {
    usd: stored.usd,
    availableRentalHours: stored.hours,
    checkedAt: new Date(stored.checkedAt).toISOString(),
    state: fresh ? classify(stored.usd, cfg) : 'unknown',
    ...t,
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;

function adminLink(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `\n${base}/admin/gpu` : '';
}

async function alertText(state: BalanceState, usd: number, cfg: GpuBudgetConfig): Promise<string> {
  const t = balanceThresholds(cfg);
  if (state === 'ok') {
    return `✅ AIXMAN: ยอดเงิน SimplePod กลับมาเป็น ${money(usd)} — เช่าเครื่องได้ตามปกติแล้ว`;
  }
  if (state === 'low') {
    return (
      `⚠️ AIXMAN: ยอดเงิน SimplePod เหลือ ${money(usd)} ` +
      `(ต่ำกว่า ${money(t.lowBelowUsd)} = ค่าเช่า ${Math.max(1, cfg.maxConcurrentWorkers)} เครื่องนาน 1 ชม.)\n` +
      `ถ้าเหลือไม่เกิน ${money(t.insufficientAtOrBelowUsd)} ระบบจะเช่าเครื่องไม่ได้ — ควรเติมเงินก่อน` +
      adminLink()
    );
  }
  const queued = await prisma.aiGpuJob.count({ where: { status: 'queued' } });
  return (
    `🛑 AIXMAN: ยอดเงิน SimplePod เหลือ ${money(usd)} — ไม่พอเช่าเครื่อง (ต้องมากกว่า ${money(t.insufficientAtOrBelowUsd)})\n` +
    `ปิดรับงานที่ใช้ GPU เช่าชั่วคราว · งานรอคิว ${queued} งาน จะถูกยกเลิกและคืนเครดิต ` +
    `ถ้ายังเติมเงินไม่ทันใน ${Math.round(INSUFFICIENT_BALANCE_GRACE_MS / 60_000)} นาที` +
    adminLink()
  );
}

/**
 * Tell admins per `decideAlert`. The state counts as alerted only once a
 * message actually went out, so an unconfigured or failing Telegram keeps
 * trying on the next reading rather than going quiet.
 */
async function maybeAlert(prev: Stored | null, next: Stored, cfg: GpuBudgetConfig): Promise<void> {
  const state = classify(next.usd, cfg);
  const decision = decideAlert(prev, state, next.checkedAt);
  if (decision.send) {
    const text = await alertText(state, next.usd, cfg);
    if (await notifyAdminsWithCard(() => balanceCard(state, next, cfg), text)) {
      next.alerted = state;
      next.alertedAt = next.checkedAt;
    }
  } else if (decision.remember) {
    next.alerted = decision.remember;
  }
}

/**
 * The alert as a picture: balance, gauge against both thresholds, queue, live
 * machines, today's spend and runway. next/og is loaded only here, so the
 * routes that merely read the balance (/api/models, every order) never load it.
 */
async function balanceCard(state: Exclude<BalanceState, 'unknown'>, reading: Stored, cfg: GpuBudgetConfig): Promise<Buffer> {
  const [{ renderBalanceCard }, { GpuWorkerManager }] = await Promise.all([
    import('@/lib/notify/report-card'),
    import('./gpu-worker'),
  ]);
  const [queued, live, spentTodayUsd] = await Promise.all([
    prisma.aiGpuJob.count({ where: { status: 'queued' } }),
    prisma.aiGpuWorker.findMany({
      where: { status: { in: ['provisioning', 'warming', 'ready', 'busy', 'draining'] } },
      select: { pricePerHourUsd: true },
    }),
    GpuWorkerManager.todaySpendUsd(),
  ]);
  const burn = live.reduce((s, w) => s + Number(w.pricePerHourUsd), 0);
  return renderBalanceCard({
    state,
    usd: reading.usd,
    ...balanceThresholds(cfg),
    queued,
    liveWorkers: live.length,
    spentTodayUsd,
    dailyBudgetUsd: cfg.dailyBudgetUsd,
    runwayHours: burn > 0 && reading.usd > 0 ? Number((reading.usd / burn).toFixed(1)) : null,
    at: new Date(reading.checkedAt),
  });
}

/** The card for the stored reading, for the admin preview. Null before the first reading. */
export async function renderCurrentBalanceCard(cfg: GpuBudgetConfig): Promise<Buffer | null> {
  const stored = await load();
  if (!stored) return null;
  return balanceCard(classify(stored.usd, cfg), stored, cfg);
}

export class GpuBalance {
  /** The last stored reading, without calling the vendor. Cheap enough for every request. */
  static async read(cfg: GpuBudgetConfig): Promise<BalanceReading> {
    return toReading(await load(), cfg);
  }

  /**
   * The balance, fetched from the vendor when the stored reading is older than
   * `maxAgeMs` (0 = always). Stores it and alerts on a change of state.
   * Throws when the vendor cannot be asked; callers decide what that means.
   */
  static async check(cfg: GpuBudgetConfig, maxAgeMs: number = BALANCE_REFRESH_MS): Promise<BalanceReading> {
    const prev = await load();
    if (prev && Date.now() - prev.checkedAt < maxAgeMs) return toReading(prev, cfg);

    const provider = getGpuProvider(cfg.providerSlug);
    if (!provider) throw new Error(`Unknown GPU rental provider: ${cfg.providerSlug}`);
    // Imported lazily: gpu-worker imports this module for addCapacity.
    const { GpuWorkerManager } = await import('./gpu-worker');
    const apiKey = await GpuWorkerManager.getApiKey(cfg.providerSlug);
    const balance: VendorBalance = await provider.getBalance(apiKey);

    const next: Stored = {
      usd: balance.balanceUsd,
      hours: balance.availableRentalHours ?? null,
      checkedAt: Date.now(),
      alerted: prev?.alerted,
      alertedAt: prev?.alertedAt,
    };
    try {
      await maybeAlert(prev, next, cfg);
    } catch (error) {
      console.error('[gpu-balance] alert failed:', (error as Error).message);
    }
    await save(next);
    return toReading(next, cfg);
  }

  /**
   * Whether new work for `modelKey` should be refused: a fresh reading says
   * nothing can be rented, and no machine for this model is up or on its way.
   * A machine still running keeps taking jobs until the vendor stops it.
   */
  static async pausesModel(cfg: GpuBudgetConfig, modelKey: string): Promise<boolean> {
    if ((await this.read(cfg)).state !== 'insufficient') return false;
    const live = await prisma.aiGpuWorker.count({
      where: { modelKey, status: { in: ['provisioning', 'warming', 'ready', 'busy'] } },
    });
    return live === 0;
  }
}
