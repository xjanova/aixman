import prisma from '@/lib/db';
import type { GpuBudgetConfig } from '@/lib/gpu/config';
import { isTelegramConfigured, sendTelegramPhoto, sendTelegram } from '@/lib/notify/telegram';
import { GpuBalance } from './gpu-balance';
import { loadRecentDaily } from './gpu-stats';

/**
 * Yesterday's GPU business as one picture card on Telegram, every morning.
 *
 * Numbers come from gpu-stats.ts, the same formula as the dashboard's charts:
 * machine cost spread over the hours it was alive, revenue valued at the
 * blended package rate, jobs counted on the day they were queued.
 */

/** Sent once a day, the first tick at or after this hour in Bangkok. */
const REPORT_HOUR = 9;
const REPORT_TZ = 'Asia/Bangkok';
const LAST_SENT_KEY = 'notify_daily_report_last';
/** Yesterday plus the six days before it — a week of context on the chart. */
const SERIES_DAYS = 8;
/** After a failed send, wait this long before trying again. */
const RETRY_AFTER_MS = 30 * 60_000;
/** In-process: one server (`instances: 1` in ecosystem.config.cjs), and a restart may retry early. */
let lastAttemptAt = 0;

function bangkokNow(now: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const thb = (n: number) => `${n < 0 ? '-' : ''}฿${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

/** The card and its caption for the day before `now`. */
export async function buildDailyReport(cfg: GpuBudgetConfig, now: Date = new Date()): Promise<{ png: Buffer; caption: string }> {
  const [{ daily, usdToThb }, balance, queued, { renderDailyCard }] = await Promise.all([
    loadRecentDaily(SERIES_DAYS, now),
    GpuBalance.read(cfg),
    prisma.aiGpuJob.count({ where: { status: 'queued' } }),
    import('@/lib/notify/report-card'),
  ]);
  // The last bucket is today, still running; the report is about yesterday.
  const series = daily.slice(0, -1);
  const day = series[series.length - 1];

  const png = await renderDailyCard({
    day,
    series,
    usdToThb,
    balanceUsd: balance.usd,
    balanceState: balance.state,
    queued,
    at: now,
  });

  const costThb = day.spendUsd * usdToThb;
  const profit = day.revenueThb - costThb;
  const caption =
    `📊 AIXMAN · รายงาน GPU ประจำวัน ${new Date(`${day.date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}\n` +
    `คลิปสำเร็จ ${day.jobs} · ล้ม ${day.failed}\n` +
    `ค่าเครื่อง ${usd(day.spendUsd)} (${thb(costThb)}) · รายได้ ${thb(day.revenueThb)} · กำไร ${thb(profit)}\n` +
    `ยอดเงินผู้ให้เช่า GPU ${balance.usd != null ? usd(balance.usd) : '—'}` +
    (balance.vendors.length > 1
      ? ` (${balance.vendors.map((v) => `${v.label} ${v.usd != null ? usd(v.usd) : '—'}`).join(' · ')})`
      : '') +
    ` · งานรอคิว ${queued}`;
  return { png, caption };
}

/** Send the report now (the admin page's button). */
export async function sendDailyReport(cfg: GpuBudgetConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  let report: { png: Buffer; caption: string };
  try {
    report = await buildDailyReport(cfg);
  } catch (error) {
    // Still worth sending as text: the numbers are what matter.
    console.error('[gpu-report] card failed:', (error as Error).message);
    return sendTelegram(`📊 AIXMAN: สร้างรูปรายงานไม่สำเร็จ (${(error as Error).message.slice(0, 120)}) — ดูตัวเลขที่ /admin/gpu`);
  }
  return sendTelegramPhoto(report.png, report.caption);
}

/**
 * Called by every tick: sends at most once per Bangkok day, from REPORT_HOUR
 * on. Marked as sent only once Telegram accepted it, so a failure retries on
 * the next tick instead of skipping the day.
 */
export async function maybeSendDailyReport(cfg: GpuBudgetConfig, now: Date = new Date()): Promise<void> {
  const { date, hour } = bangkokNow(now);
  if (hour < REPORT_HOUR) return;
  const last = await prisma.aiSetting.findUnique({ where: { key: LAST_SENT_KEY } });
  if (last?.value === date) return;
  // A send that keeps failing (a revoked token, say) must not rebuild the
  // card on every one-minute tick.
  if (Date.now() - lastAttemptAt < RETRY_AFTER_MS) return;
  if (!(await isTelegramConfigured())) return;

  lastAttemptAt = Date.now();
  const result = await sendDailyReport(cfg);
  if (!result.ok) {
    console.error('[gpu-report] daily report not delivered:', result.error);
    return;
  }
  await prisma.aiSetting.upsert({
    where: { key: LAST_SENT_KEY },
    update: { value: date },
    create: { key: LAST_SENT_KEY, value: date, type: 'string', group: 'notify' },
  });
}
