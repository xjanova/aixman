import prisma from '@/lib/db';
import type { GpuBudgetConfig } from '@/lib/gpu/config';
import { isCommunityOnlyModel } from '@/lib/gpu/catalog';
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
 *
 * With several vendors the question is whether *any* of them can pay for a
 * machine — the picker rents wherever the best funded machine is — so the
 * state follows the best-funded vendor, and each vendor's own balance is kept
 * alongside for the admin page and the alert text. One vendor running dry is
 * not a pause while another can still rent. A vendor whose balance cannot be
 * read any more (RunPod after its GraphQL retires) never counts as empty.
 */

/** One vendor's balance as last read. */
export interface VendorBalanceReading {
  slug: string;
  label: string;
  /** Null when unknown or unreadable. */
  usd: number | null;
  /** The vendor no longer reports it (RunPod) — not the same as empty. */
  unknown?: boolean;
  error?: string;
}

export interface BalanceReading {
  /** The best-funded vendor's balance — what a single rental can draw on. */
  usd: number | null;
  availableRentalHours: number | null;
  checkedAt: string | null;
  state: BalanceState;
  /** Below this it warns: one hour of every allowed machine at the price ceiling. */
  lowBelowUsd: number;
  /** At or below this nothing can be rented — one hour at the price ceiling. */
  insufficientAtOrBelowUsd: number;
  vendors: VendorBalanceReading[];
}

interface Stored {
  usd: number;
  hours: number | null;
  checkedAt: number;
  /** State last reported to admins, and when — so an alert fires once per change. */
  alerted?: BalanceState;
  alertedAt?: number;
  vendors?: VendorBalanceReading[];
  /** Some vendor's balance is unknown: renting may still work there. */
  anyUnknown?: boolean;
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

/** The state a stored reading stands for: a vendor of unknown balance may still rent. */
function stateOf(stored: Stored, cfg: GpuBudgetConfig): Exclude<BalanceState, 'unknown'> {
  const state = classify(stored.usd, cfg);
  return stored.anyUnknown && state !== 'ok' ? 'ok' : state;
}

function toReading(stored: Stored | null, cfg: GpuBudgetConfig): BalanceReading {
  const t = balanceThresholds(cfg);
  if (!stored) {
    return { usd: null, availableRentalHours: null, checkedAt: null, state: 'unknown', ...t, vendors: [] };
  }
  const fresh = Date.now() - stored.checkedAt < BALANCE_STALE_MS;
  return {
    usd: stored.usd,
    availableRentalHours: stored.hours,
    checkedAt: new Date(stored.checkedAt).toISOString(),
    state: fresh ? stateOf(stored, cfg) : 'unknown',
    ...t,
    vendors: stored.vendors ?? [],
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** "SimplePod $0.30 · RunPod $12.00" — each vendor's own balance, for the alert. */
function vendorLine(stored: Stored): string {
  const list = (stored.vendors ?? []).map(
    (v) => `${v.label} ${v.usd !== null ? money(v.usd) : v.unknown ? 'ไม่ทราบยอด' : 'อ่านไม่ได้'}`
  );
  return list.length > 1 ? `\n(${list.join(' · ')})` : '';
}

/** The best-funded vendor, or null when not one balance could be read. */
function bestOf(vendors: VendorBalanceReading[]): { usd: number; anyUnknown: boolean } | null {
  const known = vendors.filter((v) => v.usd !== null).map((v) => v.usd as number);
  const anyUnknown = vendors.some((v) => v.unknown);
  if (known.length === 0 && !anyUnknown) return null;
  return { usd: known.length ? Math.max(...known) : 0, anyUnknown };
}

function adminLink(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `\n${base}/admin/gpu` : '';
}

async function alertText(state: BalanceState, stored: Stored, cfg: GpuBudgetConfig): Promise<string> {
  const t = balanceThresholds(cfg);
  const usd = stored.usd;
  const who = (stored.vendors?.length ?? 0) > 1 ? 'ผู้ให้เช่า GPU ที่มีเงินมากสุด' : `${stored.vendors?.[0]?.label ?? 'ผู้ให้เช่า GPU'}`;
  if (state === 'ok') {
    return `✅ AIXMAN: ยอดเงิน ${who} กลับมาเป็น ${money(usd)} — เช่าเครื่องได้ตามปกติแล้ว${vendorLine(stored)}`;
  }
  if (state === 'low') {
    return (
      `⚠️ AIXMAN: ยอดเงิน ${who} เหลือ ${money(usd)} ` +
      `(ต่ำกว่า ${money(t.lowBelowUsd)} = ค่าเช่า ${Math.max(1, cfg.maxConcurrentWorkers)} เครื่องนาน 1 ชม.)\n` +
      `ถ้าเหลือไม่เกิน ${money(t.insufficientAtOrBelowUsd)} ระบบจะเช่าเครื่องไม่ได้ — ควรเติมเงินก่อน` +
      vendorLine(stored) +
      adminLink()
    );
  }
  const queued = await prisma.aiGpuJob.count({ where: { status: 'queued' } });
  return (
    `🛑 AIXMAN: ยอดเงิน ${who} เหลือ ${money(usd)} — ไม่พอเช่าเครื่อง (ต้องมากกว่า ${money(t.insufficientAtOrBelowUsd)})\n` +
    `ปิดรับงานที่ใช้ GPU เช่าชั่วคราว · งานรอคิว ${queued} งาน จะถูกยกเลิกและคืนเครดิต ` +
    `ถ้ายังเติมเงินไม่ทันใน ${Math.round(INSUFFICIENT_BALANCE_GRACE_MS / 60_000)} นาที` +
    vendorLine(stored) +
    adminLink()
  );
}

/**
 * Tell admins per `decideAlert`. The state counts as alerted only once a
 * message actually went out, so an unconfigured or failing Telegram keeps
 * trying on the next reading rather than going quiet.
 */
async function maybeAlert(prev: Stored | null, next: Stored, cfg: GpuBudgetConfig): Promise<void> {
  const state = stateOf(next, cfg);
  const decision = decideAlert(prev, state, next.checkedAt);
  if (decision.send) {
    const text = await alertText(state, next, cfg);
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
  return balanceCard(stateOf(stored, cfg), stored, cfg);
}

/** Every vendor we may rent from that holds a key, each asked for its balance. */
async function readVendors(cfg: GpuBudgetConfig): Promise<VendorBalanceReading[]> {
  // Imported lazily: gpu-worker imports this module for addCapacity.
  const { GpuWorkerManager } = await import('./gpu-worker');
  const keyed = await GpuWorkerManager.keyedProviders();
  // The community pool reports an infinite balance ("never blocked on funds"),
  // which would read as `unknown` and keep the state 'ok' while every vendor
  // we actually rent from runs dry. It is not rented, so it is not counted.
  const slugs = cfg.providers.filter((slug) => keyed.has(slug) && !GpuWorkerManager.isCommunity(slug));
  if (slugs.length === 0) throw new Error('No active API key for any GPU provider');
  return Promise.all(
    slugs.map(async (slug): Promise<VendorBalanceReading> => {
      const vendor = keyed.get(slug)!;
      try {
        const balance = await Promise.race([
          vendor.provider.getBalance(vendor.apiKey),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 15_000)),
        ]);
        return {
          slug,
          label: vendor.provider.label,
          usd: Number.isFinite(balance.balanceUsd) ? balance.balanceUsd : null,
          unknown: Boolean(balance.unknown),
        };
      } catch (error) {
        return { slug, label: vendor.provider.label, usd: null, error: (error as Error).message.slice(0, 160) };
      }
    })
  );
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
    return this.store(prev, await readVendors(cfg), cfg);
  }

  /**
   * Store balances the renter has just read anyway (addCapacity asks every
   * vendor for its market and balance), so alerts and the order pause follow
   * them without a second round of vendor calls. A market with no balance
   * (its vendor failed) is recorded as unreadable.
   */
  static async recordMarkets(
    cfg: GpuBudgetConfig,
    markets: { slug: string; label: string; balanceUsd?: number }[]
  ): Promise<BalanceReading | null> {
    if (markets.length === 0) return null;
    const vendors: VendorBalanceReading[] = markets.map((m) => ({
      slug: m.slug,
      label: m.label,
      usd: typeof m.balanceUsd === 'number' && Number.isFinite(m.balanceUsd) ? m.balanceUsd : null,
      unknown: m.balanceUsd === Number.POSITIVE_INFINITY,
      ...(m.balanceUsd === undefined ? { error: 'unreadable' } : {}),
    }));
    if (!bestOf(vendors)) return null; // nothing read — keep the last reading
    return this.store(await load(), vendors, cfg);
  }

  private static async store(prev: Stored | null, vendors: VendorBalanceReading[], cfg: GpuBudgetConfig): Promise<BalanceReading> {
    const best = bestOf(vendors);
    if (!best) throw new Error('Could not read the balance of any GPU provider');
    const next: Stored = {
      usd: best.usd,
      hours: null,
      checkedAt: Date.now(),
      alerted: prev?.alerted,
      alertedAt: prev?.alertedAt,
      vendors,
      anyUnknown: best.anyUnknown,
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
    // Nothing is rented for a community-only model, so no vendor balance can pause it.
    if (isCommunityOnlyModel(modelKey)) return false;
    if ((await this.read(cfg)).state !== 'insufficient') return false;
    const live = await prisma.aiGpuWorker.count({
      where: { modelKey, status: { in: ['provisioning', 'warming', 'ready', 'busy'] } },
    });
    return live === 0;
  }
}
