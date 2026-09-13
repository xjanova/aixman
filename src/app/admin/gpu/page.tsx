"use client";

/**
 * /admin/gpu — rented-GPU control room.
 *
 * Everything on this page is about one question: is renting a GPU making or
 * losing money right now? Because billing is per second of uptime, the numbers
 * that matter are the live burn rate, how much of that uptime actually produced
 * video (utilisation), and the resulting margin — not the per-job cost, which
 * always looks flattering.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bell,
  ChevronDown,
  CircleDollarSign,
  Cpu,
  ExternalLink,
  Gauge,
  Image as ImageIcon,
  KeyRound,
  Percent,
  RefreshCw,
  Save,
  Send,
  Server,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { ALERT_ICON, ALERT_LABEL, ALERT_TYPES } from "@/lib/notify/alert-types";

interface DailyPoint {
  date: string;
  spendUsd: number;
  renderCostUsd: number;
  jobs: number;
  failed: number;
  revenueThb: number;
  profitThb: number;
  credits: number;
}

interface WorkerRow {
  id: number;
  status: string;
  modelKey: string;
  modelName: string;
  /** Generation being rendered right now, if any. */
  currentGenerationId: number | null;
  bootMinutes: number | null;
  lastJobAt: string | null;
  /** Minutes until the idle reaper shuts it down; null unless idle. */
  idleOffInMinutes: number | null;
  /** A customer is on the studio with this model selected (idle grace applies). */
  customerPresent: boolean;
  lifetimeLeftMinutes: number;
  gpuModel: string | null;
  gpuCount: number;
  /** Which vendor it was rented from. */
  vendor?: string;
  supportId: string | null;
  pricePerHourUsd: number;
  accruedCostUsd: number;
  uptimeMinutes: number;
  jobsCompleted: number;
  jobsFailed: number;
  lastError: string | null;
  rentedAt: string;
  readyAt: string | null;
  hasEndpoint: boolean;
}

/** One rental, live or closed — the history table. */
interface RentalRow {
  id: number;
  status: string;
  modelKey: string;
  modelName: string;
  gpuModel: string | null;
  gpuCount: number;
  vendor?: string;
  supportId: string | null;
  pricePerHourUsd: number;
  rentedAt: string;
  readyAt: string | null;
  terminatedAt: string | null;
  bootMinutes: number | null;
  uptimeMinutes: number;
  costUsd: number;
  jobsCompleted: number;
  jobsFailed: number;
  endReason: string | null;
  /** Why this offer was rented (estimated cost of the work), when recorded. */
  pickNote: string | null;
}

interface JobRow {
  id: number;
  generationId: number;
  status: string;
  attempts: number;
  gpuSeconds: number;
  costUsd: number;
  credits: number;
  errorMessage: string | null;
  queuedAt: string;
  completedAt: string | null;
}

interface GpuConfig {
  enabled: boolean;
  maxConcurrentWorkers: number;
  maxPricePerHourUsd: number;
  dailyBudgetUsd: number;
  idleTimeoutMinutes: number;
  presenceExtensionMinutes: number;
  maxWorkerLifetimeMinutes: number;
  warmupTimeoutMinutes: number;
  jobTimeoutMinutes: number;
  waitValueUsdPerHour: number;
}

/** One GPU vendor: whether we hold its key, rent from it, and its balance. */
interface VendorRow {
  slug: string;
  label: string;
  credential: "api-key" | "client-id-secret";
  connected: boolean;
  enabled: boolean;
  balanceUsd: number | null;
  balanceUnknown: boolean;
  error: string | null;
  liveWorkers: number;
}

/** The vendor balance against the thresholds in gpu-balance.ts. */
type BalanceState = "ok" | "low" | "insufficient" | "unknown";

interface TelegramStatus {
  configured: boolean;
  source: "settings" | "env" | null;
  tokenSaved: boolean;
  chatIds: string[];
}

interface Analytics {
  config: GpuConfig;
  pricing: { thbPerCredit: number; usdToThb: number };
  /** The best-funded vendor's balance — what one rental can draw on; each vendor's is in `vendors`. */
  balance: {
    balanceUsd: number;
    availableRentalHours: number | null;
    hoursAtCurrentBurn: number | null;
    state: BalanceState;
    lowBelowUsd: number;
    insufficientAtOrBelowUsd: number;
    checkedAt: string | null;
  } | null;
  balanceError: string | null;
  vendors?: VendorRow[];
  telegram: TelegramStatus;
  storageConfigured: boolean;
  budget: {
    spentTodayUsd: number;
    dailyBudgetUsd: number;
    remainingUsd: number;
    usedPct: number;
    burnRateUsdPerHour: number;
    liveWorkers: number;
    maxConcurrentWorkers: number;
  };
  profit: {
    windowDays: number;
    revenueThb: number;
    costThb: number;
    profitThb: number;
    marginPct: number | null;
    totalSpendUsd: number;
    renderCostUsd: number;
    overheadPct: number | null;
    creditsEarned: number;
    completedJobs: number;
    failedJobs: number;
    costPerClipUsd: number | null;
    revenuePerClipThb: number | null;
  };
  utilisation: { rentedHours: number; renderHours: number; pct: number | null };
  daily: DailyPoint[];
  workers: WorkerRow[];
  rentals: RentalRow[];
  rentalSummary: { count: number; hours: number; costUsd: number; avgBootMinutes: number | null; neverReady: number };
  recentJobs: JobRow[];
  queue: { queued: number; running: number };
}

/**
 * Where the marketplace API key lives.
 *
 * `simplepod.ai/account` is the only path confirmed by a real server redirect
 * (to `dash.simplepod.ai/account`) — the dashboard is a single-page app, so
 * every other path also answers 200 and proves nothing about existing.
 */
const SIMPLEPOD_KEY_URL = 'https://dash.simplepod.ai/account';
/** Balance top-up. Renting stops dead when this runs out. */
const SIMPLEPOD_BILLING_URL = 'https://dash.simplepod.ai/';
/** Where an admin makes the alert bot. */
const BOTFATHER_URL = 'https://t.me/BotFather';

/**
 * Where each vendor's credential and top-up live, plus a line on what it is
 * good for. The consoles are single-page apps too, so these are the pages
 * their docs name, not paths a redirect has proven.
 */
const VENDOR_INFO: Record<string, { keyUrl: string; billingUrl: string; keyHint: string; blurb: string }> = {
  simplepod: {
    keyUrl: SIMPLEPOD_KEY_URL,
    billingUrl: SIMPLEPOD_BILLING_URL,
    keyHint: "แท็บ Subaccounts — คัดลอกทั้งบรรทัด",
    blurb: "ตลาดเช่าหลัก โฮสต์ A100 บูต ~2 นาที",
  },
  runpod: {
    keyUrl: "https://console.runpod.io/user/settings",
    billingUrl: "https://console.runpod.io/user/billing",
    keyHint: "Settings → API Keys — สิทธิ์ Read/Write",
    blurb: "ศูนย์ข้อมูลของ RunPod + เครื่องชุมชน • HTTPS ในตัว • ต้องมีเครดิตพอ 1 ชม.",
  },
  vast: {
    keyUrl: "https://cloud.vast.ai/manage-keys/",
    billingUrl: "https://cloud.vast.ai/billing/",
    keyHint: "Keys → API Keys",
    blurb: "ถูกสุด ของเยอะ ใช้รับงานล้น • คิดค่าเน็ตขาเข้าบางโฮสต์ • เข้าผ่าน tunnel ของเราเอง",
  },
  verda: {
    keyUrl: "https://console.verda.com/",
    billingUrl: "https://console.verda.com/",
    keyHint: "Keys → Cloud API credentials (Client ID + Client Secret)",
    blurb: "ศูนย์ข้อมูลฟินแลนด์ RTX PRO 6000/H100/A100/L40S • เป็น VM บูตช้ากว่า ~3 นาที",
  },
};

type VendorCreds = { apiKey?: string; clientId?: string; clientSecret?: string };

/** What "ทดสอบการเชื่อมต่อ" found at one vendor — nothing is rented to find it. */
interface VendorTest {
  balanceUsd: number | null;
  balanceUnknown: boolean;
  models: {
    modelKey: string;
    name: string;
    offers: number;
    eligible: number;
    best: { gpuModel: string; pricePerHourUsd: number; region: string | null; costUsd: number; bootSeconds: number; renderSeconds: number } | null;
    note?: string;
  }[];
}
type VendorTestState = VendorTest | { error: string } | "loading";

const thb = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const shortDate = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
const duration = (min: number) =>
  min < 60 ? `${Math.round(min)} นาที` : `${Math.floor(min / 60)} ชม. ${Math.round(min % 60)} นาที`;

/**
 * Why a rental ended, in Thai. The raw reason stays in the cell's tooltip;
 * these are the strings GpuWorkerManager and the admin route write.
 */
function endReasonText(raw: string | null): string {
  if (!raw) return "–";
  let m: RegExpMatchArray | null;
  if ((m = raw.match(/^Idle for more than (\d+) min/))) return `ว่างเกิน ${m[1]} นาที — ปิดอัตโนมัติ`;
  if ((m = raw.match(/^Released to make room for (.+)$/))) return `สลับไปโหลดโมเดล ${m[1]}`;
  if ((m = raw.match(/^Reached maximum lifetime of (\d+) min/))) return `ครบอายุสูงสุด ${m[1]} นาที`;
  if ((m = raw.match(/^Inference server never became healthy within (\d+) min/))) return `บูตไม่เสร็จใน ${m[1]} นาที`;
  if (raw.startsWith("Terminated manually by admin")) return "แอดมินสั่งปิด";
  if (raw.startsWith("Emergency stop by admin")) return "หยุดทั้งหมดโดยแอดมิน";
  if (raw.startsWith("Daily GPU budget exhausted")) return "งบรายวันหมด";
  if (raw.startsWith("Worker failed to provision")) return "บูตไม่สำเร็จ (ดู log)";
  if (raw.startsWith("Instance no longer exists") || raw.startsWith("Instance stopped")) return "เครื่องหายไปจากฝั่ง SimplePod";
  if (raw.startsWith("Provider reported an error")) return "SimplePod แจ้งข้อผิดพลาด";
  if (raw === "Drained") return "ปิดหลังงานค้างหมดเวลา";
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
}

const STATUS_LABEL: Record<string, string> = {
  provisioning: "กำลังเช่าเครื่อง",
  warming: "กำลังโหลดโมเดล",
  ready: "พร้อมใช้งาน",
  busy: "กำลังเรนเดอร์",
  draining: "กำลังปิด",
  queued: "รอคิว",
  assigned: "กำลังส่งงาน",
  running: "กำลังเรนเดอร์",
  completed: "สำเร็จ",
  failed: "ล้มเหลว",
};

const STATUS_COLOR: Record<string, string> = {
  ready: "#34d399",
  busy: "#60a5fa",
  warming: "#fbbf24",
  provisioning: "#fbbf24",
  draining: "#f87171",
  completed: "#34d399",
  failed: "#f87171",
  running: "#60a5fa",
  queued: "#94a3b8",
  assigned: "#94a3b8",
};

// ────────────────────────────────────────────────────────────
// Charts — hand-rolled SVG so the page adds no chart dependency
// ────────────────────────────────────────────────────────────

/** Revenue vs cost over time, with the gap between them shaded as profit. */
function ProfitChart({ data, usdToThb }: { data: DailyPoint[]; usdToThb: number }) {
  const W = 720;
  const H = 220;
  const P = { top: 16, right: 12, bottom: 26, left: 48 };

  const revenue = data.map((d) => d.revenueThb);
  const cost = data.map((d) => d.spendUsd * usdToThb);
  const max = Math.max(...revenue, ...cost, 1);

  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;
  const x = (i: number) => P.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => P.top + innerH - (v / max) * innerH;

  const line = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const area = (vals: number[]) =>
    `${line(vals)} L${x(vals.length - 1)},${P.top + innerH} L${x(0)},${P.top + innerH} Z`;

  const ticks = [0, 0.5, 1].map((t) => max * t);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }} role="img"
         aria-label="กราฟรายได้เทียบต้นทุน GPU รายวัน">
      <defs>
        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={P.left} x2={W - P.right} y1={y(t)} y2={y(t)} stroke="rgba(148,163,184,0.15)" strokeWidth={1} />
          <text x={P.left - 8} y={y(t) + 4} textAnchor="end" fontSize={10} fill="rgba(148,163,184,0.7)">
            {Math.round(t).toLocaleString("th-TH")}
          </text>
        </g>
      ))}

      <path d={area(revenue)} fill="url(#revFill)" />
      <path d={line(revenue)} fill="none" stroke="#34d399" strokeWidth={2} strokeLinejoin="round" />
      <path d={line(cost)} fill="none" stroke="#f87171" strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" />

      {data.map((d, i) =>
        i % Math.ceil(data.length / 6) === 0 ? (
          <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="rgba(148,163,184,0.7)">
            {shortDate(d.date)}
          </text>
        ) : null
      )}
    </svg>
  );
}

/** Clips rendered per day, failures stacked on top in red. */
function ClipsChart({ data }: { data: DailyPoint[] }) {
  const W = 720;
  const H = 160;
  const P = { top: 12, right: 12, bottom: 24, left: 32 };
  const max = Math.max(...data.map((d) => d.jobs + d.failed), 1);
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;
  const bw = Math.max(2, (innerW / data.length) * 0.6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 180 }} role="img"
         aria-label="กราฟจำนวนคลิปที่สร้างต่อวัน">
      <line x1={P.left} x2={W - P.right} y1={P.top + innerH} y2={P.top + innerH} stroke="rgba(148,163,184,0.25)" />
      <text x={P.left - 6} y={P.top + 10} textAnchor="end" fontSize={10} fill="rgba(148,163,184,0.7)">{max}</text>

      {data.map((d, i) => {
        const cx = P.left + (i + 0.5) * (innerW / data.length);
        const okH = (d.jobs / max) * innerH;
        const failH = (d.failed / max) * innerH;
        return (
          <g key={d.date}>
            <rect x={cx - bw / 2} y={P.top + innerH - okH} width={bw} height={okH} fill="#60a5fa" rx={2} />
            <rect x={cx - bw / 2} y={P.top + innerH - okH - failH} width={bw} height={failH} fill="#f87171" rx={2} />
          </g>
        );
      })}

      {data.map((d, i) =>
        i % Math.ceil(data.length / 6) === 0 ? (
          <text key={d.date} x={P.left + (i + 0.5) * (innerW / data.length)} y={H - 6}
                textAnchor="middle" fontSize={10} fill="rgba(148,163,184,0.7)">
            {shortDate(d.date)}
          </text>
        ) : null
      )}
    </svg>
  );
}

/** Radial gauge — share of rented time that actually rendered. */
function UtilisationGauge({ pct }: { pct: number | null }) {
  const value = pct ?? 0;
  const R = 54;
  const C = Math.PI * R; // half circle
  const filled = (Math.min(100, Math.max(0, value)) / 100) * C;
  // Low utilisation is the expensive failure mode: the card is rented but idle.
  const colour = value >= 50 ? "#34d399" : value >= 20 ? "#fbbf24" : "#f87171";

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 82" style={{ width: "100%", maxWidth: 180 }} role="img"
           aria-label={`อัตราการใช้งานจริง ${value}%`}>
        <path d={`M16,70 A${R},${R} 0 0 1 124,70`} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth={12} strokeLinecap="round" />
        <path d={`M16,70 A${R},${R} 0 0 1 124,70`} fill="none" stroke={colour} strokeWidth={12} strokeLinecap="round"
              strokeDasharray={`${filled} ${C}`} />
        <text x="70" y="60" textAnchor="middle" fontSize={22} fontWeight={700} fill={colour}>
          {pct === null ? "–" : `${value}%`}
        </text>
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, tone = "default",
}: {
  // ReactNode rather than string so a card can carry an action — the balance
  // card needs a top-up link exactly when the number is bad.
  label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const colour =
    tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-error" : "";
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted">{label}</span>
        <span className={colour}>{icon}</span>
      </div>
      {/* nowrap: values like "$0.35/ชม." otherwise break across two lines and
          shove the card taller than its neighbours in the grid */}
      <div className={`text-2xl font-bold whitespace-nowrap ${colour}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}

/*
 * The helpers below own the try/catch that their callers inside `GpuAdminPage`
 * cannot have, and hand back errors as values. They live outside the component
 * on purpose: React Compiler cannot compile a component containing `finally`,
 * or a `throw` inside `try`, and responds by silently giving up on the
 * **whole** component — this page loses its auto-memoization and every
 * compiler-based lint rule stops running on the file, with no diagnostic.
 *
 * The one visible symptom is a suppression going stale: the `useEffect` below
 * carries `react-hooks/set-state-in-effect`, and ESLint calling it "unused" is
 * how the log viewer's `throw` was found. To check directly, run ESLint with
 * the compiler's bail-out rule on (it is off in eslint-config-next):
 *   npx eslint --rule '{"react-hooks/todo":"error"}' src/app/admin/gpu/page.tsx
 */

type LoadResult =
  | { ok: true; data: Analytics }
  | { ok: false; error: string };

async function fetchAnalytics(): Promise<LoadResult> {
  try {
    const res = await fetch("/api/admin/gpu/analytics");
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 403
            ? "ต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบก่อน"
            : `เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status}`,
      };
    }
    return { ok: true, data: (await res.json()) as Analytics };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" };
  }
}

async function postAction(
  payload: Record<string, unknown>,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/admin/gpu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body.error || "ทำรายการไม่สำเร็จ" };
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function postVendorKey(
  provider: string,
  creds: VendorCreds,
): Promise<{ ok: true; warning?: string; balanceUsd: number | null } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/admin/gpu/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, ...creds, enable: true }),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body.error || "บันทึกไม่สำเร็จ" };
    return { ok: true, warning: body.warning, balanceUsd: body.balanceUsd ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** What a vendor test found, per model — and the button to rent a test machine there. */
function VendorTestResult({
  slug,
  label,
  state,
  busy,
  idleMinutes,
  onRentTest,
}: {
  slug: string;
  label: string;
  state: VendorTestState | undefined;
  busy: string | null;
  idleMinutes: number;
  onRentTest: (slug: string, modelKey: string, confirmText: string) => void;
}) {
  if (!state || state === "loading") return null;
  if ("error" in state) return <p className="text-xs text-error mt-2">ทดสอบไม่ผ่าน: {state.error}</p>;
  return (
    <div className="mt-2 text-xs space-y-1.5">
      <div className="text-success">
        เชื่อมต่อได้ • ยอดเงิน {state.balanceUsd !== null ? usd(state.balanceUsd) : state.balanceUnknown ? "ไม่ทราบ" : "–"}
      </div>
      {state.models.map((m) => (
        <div key={m.modelKey} className="flex items-center justify-between gap-2 flex-wrap">
          <span>
            <b>{m.name}</b>{" "}
            {m.best ? (
              <span className="text-muted">
                — ว่าง {m.eligible} เครื่อง • ดีสุด {m.best.gpuModel} {usd(m.best.pricePerHourUsd)}/ชม.
                {m.best.region ? ` (${m.best.region})` : ""} • บูต ~{Math.round(m.best.bootSeconds / 60)} นาที
              </span>
            ) : (
              <span className="text-muted">— ไม่มีเครื่องว่างที่รันได้{m.offers > 0 ? ` (มี ${m.offers} แต่ไม่ผ่านเกณฑ์)` : ""}{m.note ? ` • ${m.note}` : ""}</span>
            )}
          </span>
          {m.best && (
            <button
              disabled={busy !== null}
              onClick={() =>
                onRentTest(
                  slug,
                  m.modelKey,
                  `เช่าเครื่องทดสอบ ${m.name} ที่ ${label}?\n\n` +
                    `• เครื่อง: ${m.best!.gpuModel} ราว ${usd(m.best!.pricePerHourUsd)}/ชม. (เสียเงินจริงตั้งแต่เริ่มเช่า)\n` +
                    `• บูตประมาณ ${Math.round(m.best!.bootSeconds / 60)} นาที แล้วสั่งงานจากสตูดิโอได้เลย\n` +
                    `• ถ้าไม่มีงาน เครื่องจะปิดเองเมื่อว่างเกิน ${idleMinutes} นาที หรือกด "ปิด" ในตารางเครื่องได้ทุกเมื่อ`,
                )
              }
              className="px-2 py-1 rounded-md bg-warning/15 text-warning hover:bg-warning/25 disabled:opacity-40"
            >
              {busy === `rent:${slug}:${m.modelKey}` ? "กำลังเช่า..." : "เช่าเครื่องทดสอบ"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Every vendor on one strip: connect it, see its balance and machines, and
 * choose whether the picker may rent there. The picker compares offers from
 * all enabled vendors and rents the best value anywhere.
 */
function VendorsSection({
  vendors,
  creds,
  busy,
  tests,
  idleMinutes,
  onCreds,
  onConnect,
  onToggle,
  onTest,
  onRentTest,
}: {
  vendors: VendorRow[];
  creds: Record<string, VendorCreds>;
  busy: string | null;
  tests: Record<string, VendorTestState>;
  idleMinutes: number;
  onCreds: (slug: string, next: VendorCreds) => void;
  onConnect: (slug: string) => void;
  onToggle: (slug: string, enabled: boolean) => void;
  onTest: (slug: string) => void;
  onRentTest: (slug: string, modelKey: string, confirmText: string) => void;
}) {
  return (
    <div className="glass rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-5 h-5 text-primary-light" />
        <h2 className="font-bold">ผู้ให้เช่า GPU</h2>
      </div>
      <p className="text-sm text-muted mb-4">
        ระบบจะถามราคาและเครื่องว่างจากทุกเจ้าที่เปิดไว้พร้อมกัน แล้วเช่าเครื่องที่คุ้มที่สุด — เจ้าไหนเครื่องหมด เงินหมด
        หรือ API ล่ม ก็ไปเจ้าอื่นเอง
      </p>
      <div className="grid md:grid-cols-2 gap-3">
        {vendors.map((v) => {
          const info = VENDOR_INFO[v.slug];
          const c = creds[v.slug] ?? {};
          const filled = v.credential === "client-id-secret" ? Boolean(c.clientId?.trim() && c.clientSecret?.trim()) : Boolean(c.apiKey?.trim());
          return (
            <div key={v.slug} className="rounded-lg glass-light p-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="font-semibold">{v.label}</div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${v.connected ? "bg-success/15 text-success" : "bg-surface-light text-muted"}`}>
                  {v.connected ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ"}
                </span>
              </div>
              {info && <p className="text-[11px] text-muted mb-2">{info.blurb}</p>}
              {v.connected && (
                <div className="text-sm mb-2 flex items-center gap-3 flex-wrap">
                  <span>
                    ยอดเงิน{" "}
                    <b className={v.balanceUsd !== null && v.balanceUsd < 1 ? "text-error" : ""}>
                      {v.balanceUsd !== null ? usd(v.balanceUsd) : v.balanceUnknown ? "ไม่ทราบ (เจ้านี้ไม่เปิดให้อ่าน)" : v.error ?? "–"}
                    </b>
                  </span>
                  <span className="text-muted text-xs">เครื่องที่เปิดอยู่ {v.liveWorkers}</span>
                  {info && (
                    <a href={info.billingUrl} target="_blank" rel="noopener noreferrer"
                       className="text-primary-light text-xs underline underline-offset-2 inline-flex items-center gap-1">
                      เติมเงิน <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
              {v.connected && (
                <label className="flex items-center gap-2 text-sm mb-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4" checked={v.enabled} disabled={busy !== null}
                         onChange={(e) => onToggle(v.slug, e.target.checked)} />
                  ให้ระบบเช่าจากเจ้านี้
                  {!v.enabled && v.liveWorkers > 0 && <span className="text-[11px] text-muted">(เครื่องที่เปิดอยู่ยังถูกดูแลและปิดตามปกติ)</span>}
                </label>
              )}
              <div className="flex gap-2 flex-wrap items-center">
                {v.credential === "client-id-secret" ? (
                  <>
                    <input type="text" value={c.clientId ?? ""} autoComplete="off" placeholder="Client ID"
                           onChange={(e) => onCreds(v.slug, { ...c, clientId: e.target.value })}
                           className="flex-1 min-w-[140px] px-3 py-2 rounded-lg glass text-sm outline-none" />
                    <input type="password" value={c.clientSecret ?? ""} autoComplete="off" placeholder="Client Secret"
                           onChange={(e) => onCreds(v.slug, { ...c, clientSecret: e.target.value })}
                           className="flex-1 min-w-[140px] px-3 py-2 rounded-lg glass text-sm outline-none" />
                  </>
                ) : (
                  <input type="password" value={c.apiKey ?? ""} autoComplete="off"
                         placeholder={v.connected ? "API key ใหม่ (ถ้าจะเปลี่ยน)" : `${v.label} API key`}
                         onChange={(e) => onCreds(v.slug, { ...c, apiKey: e.target.value })}
                         className="flex-1 min-w-[200px] px-3 py-2 rounded-lg glass text-sm outline-none" />
                )}
                <button onClick={() => onConnect(v.slug)} disabled={busy !== null || !filled}
                        className="px-3 py-2 rounded-lg bg-primary/20 text-primary-light hover:bg-primary/30 text-sm font-medium disabled:opacity-40">
                  {busy === `setup:${v.slug}` ? "กำลังตรวจสอบ..." : v.connected ? "เปลี่ยน key" : "เชื่อมต่อ"}
                </button>
              </div>
              {info && (
                <p className="text-[11px] text-muted mt-2">
                  <a href={info.keyUrl} target="_blank" rel="noopener noreferrer"
                     className="text-primary-light underline underline-offset-2 inline-flex items-center gap-1">
                    เปิดหน้าเอา key <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  ({info.keyHint})
                </p>
              )}
              {v.connected && (
                <div className="mt-3 border-t border-white/5 pt-3">
                  <button onClick={() => onTest(v.slug)} disabled={busy !== null || tests[v.slug] === "loading"}
                          className="px-3 py-1.5 rounded-lg glass text-xs font-medium hover:bg-surface-light disabled:opacity-40">
                    {tests[v.slug] === "loading" ? "กำลังทดสอบ..." : "ทดสอบการเชื่อมต่อ (ไม่เสียเงิน)"}
                  </button>
                  <VendorTestResult
                    slug={v.slug}
                    label={v.label}
                    state={tests[v.slug]}
                    busy={busy}
                    idleMinutes={idleMinutes}
                    onRentTest={onRentTest}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Boot/ComfyUI logs of one worker, read through its proxy. */
async function fetchWorkerLogs(
  workerId: number,
): Promise<{ ok: true; logs: Record<string, string> } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/admin/gpu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "worker-log", workerId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
    return { ok: true, logs: body.logs ?? {} };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export default function GpuAdminPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, VendorCreds>>({});
  const [tests, setTests] = useState<Record<string, VendorTestState>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<GpuConfig | null>(null);
  // Telegram alerts. The saved token never comes back from the server, so the
  // field starts empty and an empty field on save keeps the saved one. The chat
  // field is null until edited, and shows the saved ids until then.
  const [tgToken, setTgToken] = useState("");
  const [tgChat, setTgChat] = useState<string | null>(null);
  // Boot/ComfyUI logs of one worker, read through its proxy on demand.
  const [logs, setLogs] = useState<{ workerId: number; text: Record<string, string> | null; error?: string } | null>(null);

  const showLogs = async (workerId: number) => {
    setLogs({ workerId, text: null });
    const result = await fetchWorkerLogs(workerId);
    setLogs(result.ok ? { workerId, text: result.logs } : { workerId, text: null, error: result.error });
  };

  const load = useCallback(async () => {
    const result = await fetchAnalytics();
    setLoading(false);

    if (!result.ok) {
      // Recorded separately from `message` so the page can render an explicit
      // failure state. Without it a failed load leaves every section hidden and
      // the panel just looks blank, with nothing telling the admin why.
      setLoadError(result.error);
      return;
    }
    setData(result.data);
    setLoadError(null);
    // Only seed the form once, so a background refresh can't discard edits
    // the admin is in the middle of typing.
    setForm((prev) => prev ?? result.data.config);
  }, []);

  useEffect(() => {
    // `load` reaches its first setState only after awaiting the network, so
    // nothing here is a synchronous cascading render — but the rule cannot see
    // through the await and flags the call site either way. This suppression
    // was invisible until the `finally` blocks came out of this file: while
    // React Compiler was bailing on the component, no compiler rule ran at all.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Often enough to watch a machine boot, render and get reaped.
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (
    payload: Record<string, unknown>,
    label: string,
    done?: (body: Record<string, unknown>) => string,
  ): Promise<boolean> => {
    setBusy(label);
    setMessage(null);

    const result = await postAction(payload);
    if (!result.ok) {
      setMessage({ kind: "err", text: result.error });
      setBusy(null);
      return false;
    }
    // The form is seeded once and not refreshed, so a switch flipped by an
    // action must be mirrored here — otherwise the next "บันทึก" would quietly
    // turn rental back on after an emergency stop.
    if (typeof result.body.rentalEnabled === "boolean") {
      const enabled = result.body.rentalEnabled;
      setForm((f) => (f ? { ...f, enabled } : f));
    }
    setMessage({ kind: "ok", text: done ? done(result.body) : "เรียบร้อย" });
    // `busy` stays set across the reload, so the control the admin just used
    // keeps its spinner until the fresh numbers are actually on screen.
    await load();
    setBusy(null);
    return true;
  };

  const saveTelegram = async () => {
    const payload: Record<string, unknown> = { action: "save-telegram" };
    if (tgToken.trim()) payload.botToken = tgToken.trim();
    if (tgChat !== null) payload.chatId = tgChat;
    const saved = await post(payload, "tg-save", () => "บันทึกการตั้งค่า Telegram แล้ว — กด “ส่งข้อความทดสอบ” เพื่อเช็คว่าถึงจริง");
    if (saved) {
      setTgToken("");
      setTgChat(null);
    }
  };

  const connectVendor = async (slug: string) => {
    const c = creds[slug] ?? {};
    setBusy(`setup:${slug}`);
    setMessage(null);

    const result = await postVendorKey(slug, {
      apiKey: c.apiKey?.trim(),
      clientId: c.clientId?.trim(),
      clientSecret: c.clientSecret?.trim(),
    });
    if (!result.ok) {
      setMessage({ kind: "err", text: result.error });
      setBusy(null);
      return;
    }
    setCreds((all) => ({ ...all, [slug]: {} }));
    const label = data?.vendors?.find((v) => v.slug === slug)?.label ?? slug;
    setMessage({
      kind: result.warning ? "err" : "ok",
      text:
        result.warning ||
        `เชื่อมต่อ ${label} สำเร็จ${result.balanceUsd !== null ? ` • ยอดเงิน ${usd(result.balanceUsd)}` : ""} — ระบบจะเทียบข้อเสนอจากเจ้านี้ด้วยตั้งแต่รอบถัดไป`,
    });
    setForm(null);
    // As in `post`, `busy` stays set across the reload.
    await load();
    setBusy(null);
  };

  const testVendor = async (slug: string) => {
    setTests((all) => ({ ...all, [slug]: "loading" }));
    const result = await postAction({ action: "test-vendor", provider: slug });
    setTests((all) => ({
      ...all,
      [slug]: result.ok ? (result.body as unknown as VendorTest) : { error: result.error },
    }));
  };

  const rentTest = (slug: string, modelKey: string, confirmText: string) => {
    if (!confirm(confirmText)) return;
    const idle = data?.config.idleTimeoutMinutes ?? 0;
    void post({ action: "rent-test", provider: slug, modelKey }, `rent:${slug}:${modelKey}`, (r) =>
      `เช่าเครื่องทดสอบแล้ว #${Number(r.workerId)} (${String(r.gpuModel ?? "GPU")}) — รอบูตในตารางเครื่องด้านล่าง ` +
      `แล้วสั่งงานจากสตูดิโอได้เลย • ปิดเองเมื่อว่างเกิน ${idle} นาที หรือกด "ปิด" ได้ทุกเมื่อ`);
  };

  const toggleVendor = (slug: string, enabled: boolean) => {
    const current = (data?.vendors ?? []).filter((v) => v.enabled).map((v) => v.slug);
    const providers = enabled ? [...new Set([...current, slug])] : current.filter((s) => s !== slug);
    void post({ action: "set-providers", providers }, `toggle:${slug}`, () =>
      enabled ? "เปิดให้เช่าจากเจ้านี้แล้ว" : "หยุดเช่าจากเจ้านี้แล้ว — เครื่องที่เปิดอยู่ยังถูกดูแลจนปิดตามปกติ");
  };

  // This page renders entirely on the client, so the server sends an empty
  // shell. A bare spinner here is indistinguishable from a broken page — label
  // it, so a slow load never looks like the panel failed to render.
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted">กำลังโหลดข้อมูล GPU...</p>
      </div>
    );
  }

  // Likewise, a failed load used to leave every section hidden (no data, no
  // form, no setup card) — a blank right-hand pane with no explanation.
  if (!data) {
    return (
      <div className="glass rounded-xl p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-warning mx-auto mb-3" />
        <h2 className="font-bold mb-1">โหลดข้อมูล GPU ไม่สำเร็จ</h2>
        <p className="text-sm text-muted mb-1">{loadError}</p>
        <p className="text-xs text-muted mb-4">
          ตาราง GPU อาจยังไม่ถูกสร้าง หรือเซิร์ฟเวอร์กำลังรีสตาร์ทอยู่ ลองใหม่อีกครั้งได้เลย
        </p>
        <button
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="px-4 py-2 rounded-lg bg-primary/20 text-primary-light hover:bg-primary/30 text-sm font-medium"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  const vendors = data?.vendors ?? [];
  const needsKey = vendors.length > 0 ? !vendors.some((v) => v.connected) : Boolean(data?.balanceError);
  const connectedCount = vendors.filter((v) => v.connected).length;
  const p = data?.profit;
  const b = data?.budget;
  const bal = data?.balance;
  const tg = data?.telegram;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-6 h-6 text-primary-light" />
            GPU ที่เช่า
          </h1>
          <p className="text-sm text-muted mt-1">
            คิดเงินตามเวลาที่เครื่องเปิด — ไม่ใช่ตามจำนวนงาน ตัวเลขกำไรด้านล่างรวมเวลาบูตและเวลาว่างแล้ว
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"
                  title="รีเฟรช">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => void post({ action: "tick" }, "tick")}
            disabled={busy !== null}
            className="px-3 py-2 rounded-lg glass-light hover:bg-surface-light transition-all text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Activity className="w-4 h-4" /> รันคิวเดี๋ยวนี้
          </button>
          <button
            onClick={() => {
              if (confirm(
                "หยุดระบบ GPU ทั้งหมดทันที?\n\n" +
                "• ปิดเครื่องที่เช่าอยู่ทุกเครื่อง\n" +
                "• ปิดการเช่าใหม่ (โมเดล GPU จะถูกซ่อนจากลูกค้า)\n" +
                "• งานที่ยังไม่เสร็จจะถูกยกเลิกและคืนเครดิตทันที\n\n" +
                "เปิดใหม่ได้ด้วยปุ่ม \"เปิดการเช่าอีกครั้ง\""
              ))
                void post({ action: "terminate-all" }, "stop", (r) =>
                  `หยุดแล้ว — ปิด ${Number(r.terminated ?? 0)} เครื่อง • คืนเครดิต ${Number(r.refunded ?? 0)} งาน • ปิดการเช่าใหม่แล้ว`);
            }}
            disabled={busy !== null}
            title="ปิดทุกเครื่อง หยุดเช่าใหม่ และคืนเครดิตงานที่ค้าง"
            className="px-3 py-2 rounded-lg bg-error/15 text-error hover:bg-error/25 transition-all text-sm flex items-center gap-2 disabled:opacity-40"
          >
            <Ban className="w-4 h-4" /> {busy === "stop" ? "กำลังหยุด..." : "หยุดทั้งหมด"}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 rounded-xl p-3 text-sm ${message.kind === "ok" ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
          {message.text}
        </div>
      )}

      {/* Rental switched off (by an emergency stop or the settings) — say so
          at the top, because from here it otherwise looks like a quiet day. */}
      {data.config.enabled === false && !needsKey && (
        <div className="glass rounded-xl p-4 mb-6 border border-warning/30 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
            <span>
              <b>ปิดการเช่า GPU อยู่</b>
              <span className="text-muted"> — ระบบจะไม่เช่าเครื่องใหม่ และลูกค้าจะไม่เห็นโมเดลที่ใช้ GPU เช่า</span>
            </span>
          </div>
          <button
            onClick={() => void post({ action: "save-config", config: { enabled: true } }, "enable", () => "เปิดการเช่าแล้ว — โมเดล GPU กลับมาให้ลูกค้าสั่งได้")}
            disabled={busy !== null}
            className="px-3 py-2 rounded-lg bg-success/15 text-success hover:bg-success/25 text-sm font-medium disabled:opacity-40"
          >
            {busy === "enable" ? "กำลังเปิด..." : "เปิดการเช่าอีกครั้ง"}
          </button>
        </div>
      )}

      {/* A render lives on the rented machine's tunnel and dies with it; without
          R2 there is nowhere to keep it, so the queue refunds instead of renting. */}
      {data.storageConfigured === false && (
        <div className="glass rounded-xl p-5 mb-6 border border-error/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-error" />
            <h2 className="font-bold">ยังไม่ได้ตั้งค่าที่เก็บไฟล์ (R2)</h2>
          </div>
          <p className="text-sm text-muted">
            ไฟล์ที่เรนเดอร์บนเครื่อง GPU จะหายไปพร้อมเครื่องตอนคืนเครื่อง จึงต้องก๊อปไปเก็บที่ Cloudflare R2 ก่อนเสมอ
            ระหว่างที่ยังไม่ได้ตั้งค่า ระบบจะไม่เช่าเครื่อง และคืนเครดิตให้งานที่สั่งเข้ามาทันที
          </p>
          <p className="text-xs text-muted mt-2">
            ตั้งค่าใน .env ของเซิร์ฟเวอร์: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
          </p>
        </div>
      )}

      {/* Vendor balance running out. On 2026-09-13 it hit −$0.03 mid-batch and
          nothing said so until two jobs had waited 90 minutes. With several
          vendors this follows the best-funded one: it only pauses orders when
          no vendor can pay for a machine. */}
      {(bal?.state === "low" || bal?.state === "insufficient") && (
        <div className={`glass rounded-xl p-4 mb-6 border flex items-center justify-between gap-3 flex-wrap ${bal.state === "insufficient" ? "border-error/40" : "border-warning/30"}`}>
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className={`w-5 h-5 shrink-0 ${bal.state === "insufficient" ? "text-error" : "text-warning"}`} />
            <span>
              {bal.state === "insufficient" ? (
                <>
                  <b>ไม่มีผู้ให้เช่าเจ้าไหนมีเงินพอเช่าเครื่อง (มากสุด {usd(bal.balanceUsd)})</b>
                  <span className="text-muted">
                    {" "}— ปิดรับงานที่ใช้ GPU เช่าชั่วคราว งานที่รอคิวจะถูกยกเลิกและคืนเครดิตหลังรอ 15 นาที
                    เติมเงินที่การ์ดของเจ้าไหนก็ได้ด้านล่าง แล้วกด “อ่านยอดใหม่” เพื่อเปิดรับงานทันที
                  </span>
                </>
              ) : (
                <>
                  <b>ยอดเงินผู้ให้เช่า GPU ใกล้หมด (เจ้าที่มีมากสุด {usd(bal.balanceUsd)})</b>
                  <span className="text-muted">
                    {" "}— ต่ำกว่า {usd(bal.lowBelowUsd)} (ค่าเช่าเต็มกำลัง 1 ชม.) ถ้าเหลือไม่เกิน {usd(bal.insufficientAtOrBelowUsd)} จะเช่าเครื่องไม่ได้
                  </span>
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void post({ action: "refresh-balance" }, "balance", (r) => {
                const next = (r.balance as { usd?: number | null } | undefined)?.usd;
                return next != null ? `ยอดเงินล่าสุด ${usd(next)}` : "อ่านยอดใหม่แล้ว";
              })}
              disabled={busy !== null}
              className="px-3 py-2 rounded-lg glass-light hover:bg-surface-light text-sm disabled:opacity-40"
            >
              {busy === "balance" ? "กำลังอ่าน..." : "อ่านยอดใหม่"}
            </button>
          </div>
        </div>
      )}

      {/* Setup — one credential per vendor is all it takes to go live */}
      {needsKey && (
        <div className="glass rounded-xl p-4 mb-3 border border-warning/30 text-sm">
          <b>ยังไม่ได้เชื่อมต่อผู้ให้เช่า GPU เจ้าไหนเลย</b>
          <span className="text-muted">
            {" "}— ใส่ key ของเจ้าใดเจ้าหนึ่งด้านล่าง ระบบจะตั้งค่าที่เหลือให้เองทั้งหมด (เพิ่มโมเดล ตั้งเพดานงบ)
            ไม่ต้อง build Docker image และไม่ต้องตั้ง cron เอง
          </span>
        </div>
      )}
      {vendors.length > 0 && (
        <VendorsSection
          vendors={vendors}
          creds={creds}
          busy={busy}
          tests={tests}
          idleMinutes={data.config.idleTimeoutMinutes}
          onCreds={(slug, next) => setCreds((all) => ({ ...all, [slug]: next }))}
          onConnect={(slug) => void connectVendor(slug)}
          onToggle={toggleVendor}
          onTest={(slug) => void testVendor(slug)}
          onRentTest={rentTest}
        />
      )}

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label={connectedCount > 1 ? `ยอดเงินเจ้าที่มีมากสุด (จาก ${connectedCount} เจ้า)` : "ยอดเงินผู้ให้เช่า"}
          value={bal ? usd(bal.balanceUsd) : "–"}
          sub={
            // Each vendor's own balance and top-up link sit on its card above:
            // an empty balance is the one failure that cannot be fixed here.
            bal?.hoursAtCurrentBurn != null
              ? `พอใช้อีก ~${bal.hoursAtCurrentBurn} ชม. ที่อัตราปัจจุบัน`
              : bal
                ? `เตือนเมื่อต่ำกว่า ${usd(bal.lowBelowUsd)}${tg?.configured ? " ทาง Telegram" : ""}`
                : data?.balanceError ?? ""
          }
          icon={<Wallet className="w-4 h-4" />}
          tone={bal?.state === "insufficient" ? "bad" : bal?.state === "low" ? "warn" : "default"}
        />
        <KpiCard
          label="กำลังเผาอยู่ตอนนี้"
          value={`${usd(b?.burnRateUsdPerHour ?? 0)}/ชม.`}
          sub={`เครื่องทำงาน ${b?.liveWorkers ?? 0}/${b?.maxConcurrentWorkers ?? 0} • คิว ${data?.queue.queued ?? 0} งาน`}
          icon={<Zap className="w-4 h-4" />}
          tone={(b?.burnRateUsdPerHour ?? 0) > 0 ? "warn" : "default"}
        />
        <KpiCard
          label={`กำไร ${p?.windowDays ?? 30} วัน`}
          value={thb(p?.profitThb ?? 0)}
          sub={p?.marginPct != null ? `มาร์จิน ${p.marginPct}%` : "ยังไม่มีรายได้"}
          icon={<TrendingUp className="w-4 h-4" />}
          tone={(p?.profitThb ?? 0) >= 0 ? "good" : "bad"}
        />
        <KpiCard
          label="ต้นทุนจริงต่อคลิป"
          value={p?.costPerClipUsd != null ? usd(p.costPerClipUsd) : "–"}
          sub={p?.revenuePerClipThb != null ? `ขายได้ ${thb(p.revenuePerClipThb)}/คลิป` : "ยังไม่มีคลิปสำเร็จ"}
          icon={<CircleDollarSign className="w-4 h-4" />}
        />
      </div>

      {/* Budget + utilisation */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <div className="glass rounded-xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold flex items-center gap-2">
              <Gauge className="w-4 h-4 text-primary-light" /> งบวันนี้
            </h2>
            <span className="text-sm text-muted">
              {usd(b?.spentTodayUsd ?? 0)} / {usd(b?.dailyBudgetUsd ?? 0)}
            </span>
          </div>
          <div className="h-3 rounded-full bg-surface-light overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, b?.usedPct ?? 0)}%`,
                background:
                  (b?.usedPct ?? 0) >= 90
                    ? "linear-gradient(90deg,#f87171,#ef4444)"
                    : (b?.usedPct ?? 0) >= 60
                      ? "linear-gradient(90deg,#fbbf24,#f59e0b)"
                      : "linear-gradient(90deg,#34d399,#10b981)",
              }}
            />
          </div>
          <p className="text-xs text-muted mt-2">
            เหลือ {usd(b?.remainingUsd ?? 0)} • เมื่อใช้ครบ ระบบจะปิดเครื่องที่ว่างทันทีและหยุดเช่าใหม่จนถึงเที่ยงคืน
          </p>

          <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-white/5">
            <div>
              <div className="text-xs text-muted">รายได้</div>
              <div className="font-bold text-success">{thb(p?.revenueThb ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">ต้นทุน GPU จริง</div>
              <div className="font-bold text-warning">{thb(p?.costThb ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">คลิปสำเร็จ / ล้มเหลว</div>
              <div className="font-bold">
                {p?.completedJobs ?? 0} <span className="text-error text-sm">/ {p?.failedJobs ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="glass rounded-xl p-5">
          <h2 className="font-bold flex items-center gap-2 mb-1">
            <Percent className="w-4 h-4 text-primary-light" /> ใช้งานจริง
          </h2>
          <p className="text-xs text-muted mb-2">
            สัดส่วนเวลาที่การ์ดเรนเดอร์จริง เทียบกับเวลาที่เช่าทั้งหมด
          </p>
          <UtilisationGauge pct={data?.utilisation.pct ?? null} />
          <div className="text-xs text-muted text-center mt-1">
            เรนเดอร์ {data?.utilisation.renderHours ?? 0} ชม. จากที่เช่า {data?.utilisation.rentedHours ?? 0} ชม.
          </div>
          {p?.overheadPct != null && p.overheadPct > 60 && (
            <div className="mt-3 text-xs bg-warning/10 text-warning rounded-lg p-2 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                {p.overheadPct}% ของค่าใช้จ่ายหมดไปกับตอนบูตและตอนว่าง — ลด “ปิดเครื่องเมื่อว่างเกิน” ให้สั้นลง
                หรือรอสะสมงานหลายคลิปก่อนค่อยสั่ง
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Charts */}
      <div className="glass rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-bold">รายได้เทียบต้นทุน ({p?.windowDays ?? 30} วัน)</h2>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span style={{ width: 14, height: 2, background: "#34d399", display: "inline-block" }} /> รายได้
            </span>
            <span className="flex items-center gap-1">
              <span style={{ width: 14, height: 2, background: "#f87171", display: "inline-block" }} /> ต้นทุน GPU
            </span>
          </div>
        </div>
        {data && data.daily.length > 0 ? (
          <ProfitChart data={data.daily} usdToThb={data.pricing.usdToThb} />
        ) : (
          <p className="text-sm text-muted py-8 text-center">ยังไม่มีข้อมูล</p>
        )}
      </div>

      <div className="glass rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-bold">คลิปที่สร้างต่อวัน</h2>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span style={{ width: 10, height: 10, background: "#60a5fa", borderRadius: 2, display: "inline-block" }} /> สำเร็จ
            </span>
            <span className="flex items-center gap-1">
              <span style={{ width: 10, height: 10, background: "#f87171", borderRadius: 2, display: "inline-block" }} /> ล้มเหลว
            </span>
          </div>
        </div>
        {data && data.daily.length > 0 ? (
          <ClipsChart data={data.daily} />
        ) : (
          <p className="text-sm text-muted py-8 text-center">ยังไม่มีข้อมูล</p>
        )}
      </div>

      {/* Quota / caps */}
      {form && (
        <div className="glass rounded-xl p-5 mb-6">
          <h2 className="font-bold mb-1">โควต้าและเพดานค่าใช้จ่าย</h2>
          <p className="text-xs text-muted mb-4">
            ค่าเหล่านี้คือสิ่งเดียวที่กันไม่ให้เครื่องที่เช่าเผาเงินทิ้งไว้ — ระบบอ่านค่าใหม่ทุกนาที ไม่ต้อง deploy ใหม่
          </p>

          <label className="flex items-center gap-3 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-sm">
              เปิดใช้งานการเช่า GPU
              <span className="text-muted"> — ปิดแล้วเครื่องที่ว่างจะถูกปิดทันที และโมเดลจะถูกซ่อนจากผู้ใช้</span>
            </span>
          </label>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {([
              ["dailyBudgetUsd", "งบต่อวัน (USD)", "ใช้ครบแล้วหยุดเช่าใหม่"],
              ["maxPricePerHourUsd", "ราคาสูงสุด/ชม. (USD)", "ไม่เช่าเครื่องที่แพงกว่านี้"],
              ["maxConcurrentWorkers", "เครื่องพร้อมกันสูงสุด", "เปิดเพิ่มเองเมื่อคิวยาว / แยกเครื่องต่อโมเดล ไม่เกินเท่านี้"],
              ["idleTimeoutMinutes", "ปิดเครื่องเมื่อว่างเกิน (นาที)", "สั้น = ประหยัด แต่บูตใหม่บ่อย"],
              ["presenceExtensionMinutes", "รอเพิ่มถ้าลูกค้ายังเปิดสตูดิโอ (นาที)", "ต่อจากเวลาว่าง เฉพาะตอนมีคนอยู่หน้าสร้างงาน • 0 = ปิด"],
              ["maxWorkerLifetimeMinutes", "อายุเครื่องสูงสุด (นาที)", "กันเครื่องหลุดค้าง"],
              ["warmupTimeoutMinutes", "รอเครื่องพร้อมสูงสุด (นาที)", "ต้องเผื่อโหลดโมเดล ~42GB"],
              ["jobTimeoutMinutes", "เรนเดอร์นานสุด (นาที)", "เกินแล้วยกเลิกและคืนเครดิต"],
              ["waitValueUsdPerHour", "มูลค่าเวลาที่ลูกค้ารอ (USD/ชม.)", "ใช้ชั่งการ์ดถูกแต่ช้า กับแพงแต่เร็ว • 0 = ดูแค่ค่าเช่า"],
            ] as const).map(([key, label, hint]) => (
              <div key={key}>
                <label className="text-xs text-muted block mb-1">{label}</label>
                <input
                  type="number"
                  step={key.includes("Usd") ? "0.01" : "1"}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg glass-light text-sm outline-none"
                />
                <p className="text-[11px] text-muted mt-1">{hint}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => void post({ action: "save-config", config: form }, "save")}
              disabled={busy !== null}
              className="px-4 py-2 rounded-lg bg-primary/20 text-primary-light hover:bg-primary/30 text-sm font-medium flex items-center gap-2 disabled:opacity-40"
            >
              <Save className="w-4 h-4" /> {busy === "save" ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button
              onClick={() => void post({ action: "sweep-orphans" }, "sweep")}
              disabled={busy !== null}
              className="px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm disabled:opacity-40"
              title="ค้นหาเครื่องที่ระบบหลุดการติดตามแล้วปิดทิ้ง"
            >
              ตรวจหาเครื่องตกค้าง
            </button>
          </div>
        </div>
      )}

      {/* Telegram alerts — the owner's pick: no push quota to run out of. */}
      <div className="glass rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h2 className="font-bold flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary-light" /> แจ้งเตือนผ่าน Telegram
          </h2>
          <span className={`text-xs ${tg?.configured ? "text-success" : "text-warning"}`}>
            {tg?.configured
              ? `● เปิดใช้งาน${tg.source === "env" ? " (จาก .env ของเซิร์ฟเวอร์)" : ""}`
              : tg?.tokenSaved
                ? "● มี token แล้ว — ยังขาด Chat ID"
                : "● ยังไม่ได้ตั้งค่า"}
          </span>
        </div>
        <p className="text-xs text-muted mb-4">
          ส่งถึงแอดมินทุกเรื่องที่ต้องรู้ทันที — ยอดเงินผู้ให้เช่าต่ำกว่า {usd(bal?.lowBelowUsd ?? 0)} หรือไม่พอเช่า,
          ปิดเครื่องไม่ได้, โมเดลถูกปิดรับงาน, งบวันนี้ใกล้หมด ฯลฯ ({ALERT_TYPES.length} เรื่อง ดูรายการด้านล่าง)
          — เรื่องเดิมไม่ส่งซ้ำถี่ ๆ
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted block mb-1">Bot token</label>
            <input
              type="password"
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              placeholder={tg?.tokenSaved ? "บันทึกไว้แล้ว — เว้นว่างเพื่อใช้ตัวเดิม" : "123456789:ABCdef..."}
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg glass-light text-sm outline-none"
            />
            <p className="text-[11px] text-muted mt-1">
              สร้างบอทที่{" "}
              <a href={BOTFATHER_URL} target="_blank" rel="noopener noreferrer"
                 className="text-primary-light underline underline-offset-2 hover:opacity-80">
                @BotFather
              </a>{" "}
              → /newbot แล้วคัดลอก token มาวาง • เก็บแบบเข้ารหัส และไม่แสดงกลับอีก
            </p>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Chat ID</label>
            <input
              type="text"
              value={tgChat ?? tg?.chatIds.join(", ") ?? ""}
              onChange={(e) => setTgChat(e.target.value)}
              placeholder="เช่น 123456789 หรือ -1001234567890"
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg glass-light text-sm outline-none"
            />
            <p className="text-[11px] text-muted mt-1">
              ทักบอทก่อน 1 ครั้ง แล้วเปิด api.telegram.org/bot&lt;token&gt;/getUpdates ดูเลข chat → id •
              กลุ่มขึ้นต้นด้วย - • หลายที่คั่นด้วยจุลภาค
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-4 flex-wrap">
          <button
            onClick={() => void saveTelegram()}
            disabled={busy !== null || (!tgToken.trim() && tgChat === null)}
            className="px-4 py-2 rounded-lg bg-primary/20 text-primary-light hover:bg-primary/30 text-sm font-medium flex items-center gap-2 disabled:opacity-40"
          >
            <Save className="w-4 h-4" /> {busy === "tg-save" ? "กำลังบันทึก..." : "บันทึก"}
          </button>
          <button
            onClick={() => void post({ action: "test-telegram" }, "tg-test", () => "ส่งข้อความทดสอบแล้ว — เช็คใน Telegram")}
            disabled={busy !== null || !tg?.configured}
            className="px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm flex items-center gap-2 disabled:opacity-40"
          >
            <Send className="w-4 h-4" /> {busy === "tg-test" ? "กำลังส่ง..." : "ส่งข้อความทดสอบ"}
          </button>
          <button
            onClick={() => void post({ action: "send-report" }, "tg-report", () => "ส่งรายงานประจำวันแล้ว — เช็คใน Telegram")}
            disabled={busy !== null || !tg?.configured}
            className="px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm flex items-center gap-2 disabled:opacity-40"
          >
            <ImageIcon className="w-4 h-4" /> {busy === "tg-report" ? "กำลังสร้างรูป..." : "ส่งรายงานประจำวันตอนนี้"}
          </button>
        </div>

        {/* The cards are PNGs drawn on the server (next/og); these open the
            exact image that would be sent, without sending it. */}
        <div className="flex items-center gap-4 mt-3 text-xs text-muted flex-wrap">
          <span>รายงานแบบรูปภาพส่งอัตโนมัติทุกเช้า 09:00 (เวลาไทย) และทุกครั้งที่ยอดเงินเปลี่ยนสถานะ</span>
          <a href="/api/admin/gpu/report?kind=daily" target="_blank" rel="noopener noreferrer"
             className="text-primary-light underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-1">
            ดูตัวอย่างรายงานประจำวัน <ExternalLink className="w-3 h-3" />
          </a>
          <a href="/api/admin/gpu/report?kind=balance" target="_blank" rel="noopener noreferrer"
             className="text-primary-light underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-1">
            ดูตัวอย่างการ์ดแจ้งเตือนยอดเงิน <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* What the bot will send, so a message never comes as a surprise. */}
        <details className="group mt-4 rounded-lg glass-light">
          <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden px-3 py-2 text-sm flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary-light" />
            เรื่องที่บอทจะแจ้ง ({ALERT_TYPES.length} แบบ)
            <span className="text-xs text-muted hidden sm:inline">
              {ALERT_ICON.critical} {ALERT_LABEL.critical} · {ALERT_ICON.warning} {ALERT_LABEL.warning} · {ALERT_ICON.info} {ALERT_LABEL.info}
            </span>
            <ChevronDown className="w-4 h-4 ml-auto text-muted transition-transform group-open:rotate-180" />
          </summary>
          <ul className="px-3 pb-3 pt-1 grid md:grid-cols-2 gap-x-6 gap-y-2.5">
            {ALERT_TYPES.map((a) => (
              <li key={a.id} className="flex gap-2 text-xs leading-relaxed">
                <span aria-label={ALERT_LABEL[a.level]} className="shrink-0">{ALERT_ICON[a.level]}</span>
                <div className="min-w-0">
                  <div className="text-foreground">
                    {a.title}
                    {a.card && (
                      <span className="ml-1.5 px-1.5 py-px rounded bg-primary/15 text-primary-light text-[10px] align-middle">
                        รูปภาพ
                      </span>
                    )}
                  </div>
                  <div className="text-muted">{a.when}</div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      </div>

      {/* Live workers */}
      <div className="glass rounded-xl p-5 mb-6">
        <h2 className="font-bold flex items-center gap-2 mb-3">
          <Server className="w-4 h-4 text-primary-light" /> เครื่องที่กำลังเช่า
        </h2>
        {data && data.workers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted text-left border-b border-white/5">
                  <th className="pb-2 pr-3">สถานะ</th>
                  <th className="pb-2 pr-3">โมเดล</th>
                  <th className="pb-2 pr-3">GPU</th>
                  <th className="pb-2 pr-3">ราคา/ชม.</th>
                  <th className="pb-2 pr-3">เปิดมาแล้ว</th>
                  <th className="pb-2 pr-3">ค่าใช้จ่ายสะสม</th>
                  <th className="pb-2 pr-3">งาน</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {data.workers.map((w) => (
                  <tr key={w.id} className="border-b border-white/5 last:border-0 align-top">
                    <td className="py-2 pr-3">
                      <span style={{ color: STATUS_COLOR[w.status] ?? "#94a3b8" }}>
                        ● {STATUS_LABEL[w.status] ?? w.status}
                      </span>
                      <span className="text-muted text-xs"> #{w.id}</span>
                      {/* What it is doing, and when it will stop billing by itself. */}
                      <div className="text-[11px] text-muted max-w-[240px]">
                        {w.status === "busy" && w.currentGenerationId
                          ? `เรนเดอร์งาน #${w.currentGenerationId}`
                          : w.status === "ready" && w.idleOffInMinutes !== null
                            ? w.customerPresent
                              ? `ว่าง — มีลูกค้าเปิดสตูดิโออยู่ รอได้อีก ${w.idleOffInMinutes} นาที`
                              : `ว่าง — ปิดเองใน ${w.idleOffInMinutes} นาทีถ้าไม่มีงาน`
                            : w.status === "provisioning" || w.status === "warming"
                              ? `บูตมาแล้ว ${w.uptimeMinutes} นาที (โหลดโมเดล)`
                              : null}
                      </div>
                      {w.lastError && (w.status === "warming" || w.status === "draining") && (
                        <div className="text-[11px] text-muted max-w-[240px] truncate" title={w.lastError}>
                          {w.lastError}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">{w.modelName}</td>
                    <td className="py-2 pr-3">
                      {w.gpuModel ?? "–"}{w.gpuCount > 1 ? ` ×${w.gpuCount}` : ""}
                      {w.vendor && <div className="text-[11px] text-primary-light">{w.vendor}</div>}
                      {w.supportId && <div className="text-[11px] text-muted" title={`รหัสเครื่องฝั่ง ${w.vendor ?? "ผู้ให้เช่า"}`}>{w.supportId}</div>}
                    </td>
                    <td className="py-2 pr-3">{usd(w.pricePerHourUsd)}</td>
                    <td className="py-2 pr-3" title={`ปิดแน่นอนใน ${w.lifetimeLeftMinutes} นาที (อายุเครื่องสูงสุด)`}>
                      {duration(w.uptimeMinutes)}
                      <div className="text-[11px] text-muted">
                        เปิด {clock(w.rentedAt)}{w.bootMinutes !== null ? ` • พร้อมใน ${w.bootMinutes} นาที` : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-warning">{usd(w.accruedCostUsd)}</td>
                    <td className="py-2 pr-3">
                      {w.jobsCompleted} <span className="text-error">/ {w.jobsFailed}</span>
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      <button
                        onClick={() => void showLogs(w.id)}
                        disabled={!w.hasEndpoint}
                        title={w.hasEndpoint ? "ดู log การบูตและ ComfyUI" : "เครื่องยังไม่เปิดพอร์ต"}
                        className="px-2 py-1 mr-1 rounded glass-light hover:bg-surface-light text-xs disabled:opacity-40"
                      >
                        log
                      </button>
                      <button
                        onClick={() => {
                          // Say what happens to the work, not just the machine:
                          // an interrupted render is retried on a new rental,
                          // which is right for a stuck box and a surprise
                          // otherwise.
                          const lines = [`ปิดเครื่อง #${w.id} (${w.modelName}) ทันที?`];
                          if (w.currentGenerationId) {
                            lines.push(`\nกำลังเรนเดอร์งาน #${w.currentGenerationId} — งานนี้จะถูกส่งไปทำบนเครื่องใหม่ (หรือคืนเครดิตถ้าลองครบแล้ว)`);
                          }
                          if (data.queue.queued > 0) {
                            lines.push(`\nยังมีงานรอคิว ${data.queue.queued} งาน ระบบจะเช่าเครื่องใหม่ให้เอง — ถ้าต้องการหยุดจริงให้ใช้ "หยุดทั้งหมด"`);
                          }
                          if (confirm(lines.join("\n")))
                            void post({ action: "terminate", workerId: w.id }, `t${w.id}`, () => `ปิดเครื่อง #${w.id} แล้ว — หยุดคิดเงินเครื่องนี้`);
                        }}
                        disabled={busy !== null}
                        className="px-2 py-1 rounded bg-error/15 text-error hover:bg-error/25 text-xs disabled:opacity-40"
                      >
                        {busy === `t${w.id}` ? "กำลังปิด..." : "ปิด"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted">log ของเครื่อง #{logs.workerId} (ท้ายไฟล์)</span>
                  <span className="flex gap-2">
                    <button onClick={() => void showLogs(logs.workerId)} className="text-xs text-primary-light hover:opacity-80">รีเฟรช</button>
                    <button onClick={() => setLogs(null)} className="text-xs text-muted hover:opacity-80">ปิด</button>
                  </span>
                </div>
                {logs.error ? (
                  <p className="text-sm text-error">{logs.error}</p>
                ) : !logs.text ? (
                  <p className="text-sm text-muted">กำลังโหลด log...</p>
                ) : (
                  Object.entries(logs.text).map(([name, text]) => (
                    <details key={name} open={name === "boot.log"} className="mb-2">
                      <summary className="text-xs cursor-pointer text-muted">{name}</summary>
                      <pre className="text-[11px] leading-relaxed max-h-80 overflow-auto p-3 rounded-lg bg-black/40 whitespace-pre-wrap break-all">
                        {text?.trim() ? text.split("\n").slice(-150).join("\n") : "(ว่าง)"}
                      </pre>
                    </details>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted py-6 text-center">
            ไม่มีเครื่องเปิดอยู่ — ไม่มีค่าใช้จ่ายตอนนี้ ระบบจะเช่าให้อัตโนมัติเมื่อมีคนสั่งสร้างวิดีโอ
          </p>
        )}
      </div>

      {/* Rental history — every machine, open and closed, in the window. */}
      <div className="glass rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="font-bold flex items-center gap-2">
            <Server className="w-4 h-4 text-primary-light" /> ประวัติการเช่าเครื่อง
            <span className="text-xs text-muted font-normal">({p?.windowDays ?? 30} วันล่าสุด)</span>
          </h2>
          {data.rentalSummary.count > 0 && (
            <div className="text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
              <span>เช่า <b className="text-foreground">{data.rentalSummary.count}</b> ครั้ง</span>
              <span>รวม <b className="text-foreground">{data.rentalSummary.hours.toFixed(1)}</b> ชม.</span>
              <span>ค่าเช่า <b className="text-warning">{usd(data.rentalSummary.costUsd)}</b></span>
              {data.rentalSummary.avgBootMinutes !== null && (
                <span>บูตเฉลี่ย <b className="text-foreground">{data.rentalSummary.avgBootMinutes}</b> นาที</span>
              )}
              {data.rentalSummary.neverReady > 0 && (
                <span className="text-error">ปิดก่อนพร้อมใช้ {data.rentalSummary.neverReady} ครั้ง</span>
              )}
            </div>
          )}
        </div>
        {data.rentals.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted text-left border-b border-white/5">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">โมเดล</th>
                  <th className="pb-2 pr-3">GPU</th>
                  <th className="pb-2 pr-3">เปิด</th>
                  <th className="pb-2 pr-3">พร้อมใช้</th>
                  <th className="pb-2 pr-3">ปิด</th>
                  <th className="pb-2 pr-3">ใช้เวลา</th>
                  <th className="pb-2 pr-3">ค่าเช่า</th>
                  <th className="pb-2 pr-3">งาน</th>
                  <th className="pb-2">สาเหตุที่ปิด</th>
                </tr>
              </thead>
              <tbody>
                {data.rentals.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 last:border-0 align-top">
                    <td className="py-2 pr-3 text-muted">
                      {r.id}
                      {r.vendor && <div className="text-[10px] text-primary-light">{r.vendor}</div>}
                      {r.supportId && <div className="text-[10px]" title={`รหัสเครื่องฝั่ง ${r.vendor ?? "ผู้ให้เช่า"}`}>{r.supportId}</div>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.modelName}</td>
                    <td className="py-2 pr-3 whitespace-nowrap" title={r.pickNote ?? undefined}>
                      {r.gpuModel ?? "–"}{r.gpuCount > 1 ? ` ×${r.gpuCount}` : ""}
                      <div className="text-[11px] text-muted">
                        {usd(r.pricePerHourUsd)}/ชม.{r.pickNote ? " • ⓘ เหตุผลที่เลือก" : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{dateTime(r.rentedAt)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.bootMinutes !== null ? `${r.bootMinutes} นาที` : <span className="text-muted">ไม่ได้บูตเสร็จ</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.terminatedAt ? clock(r.terminatedAt) : (
                        <span style={{ color: STATUS_COLOR[r.status] ?? "#34d399" }}>● ยังเปิดอยู่</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{duration(r.uptimeMinutes)}</td>
                    <td className="py-2 pr-3 text-warning">{usd(r.costUsd)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.jobsCompleted}{r.jobsFailed > 0 && <span className="text-error"> / {r.jobsFailed}</span>}
                    </td>
                    <td className="py-2 text-xs" title={r.endReason ?? undefined}>
                      {r.terminatedAt ? endReasonText(r.endReason) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted py-6 text-center">ยังไม่เคยเช่าเครื่องในช่วงนี้</p>
        )}
      </div>

      {/* Recent jobs */}
      <div className="glass rounded-xl p-5">
        <h2 className="font-bold mb-3">งานล่าสุด</h2>
        {data && data.recentJobs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted text-left border-b border-white/5">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">สถานะ</th>
                  <th className="pb-2 pr-3">เวลาเรนเดอร์</th>
                  <th className="pb-2 pr-3">ต้นทุน</th>
                  <th className="pb-2 pr-3">เครดิต</th>
                  <th className="pb-2">เมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {data.recentJobs.map((j) => (
                  <tr key={j.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 text-muted">{j.generationId}</td>
                    <td className="py-2 pr-3">
                      <span style={{ color: STATUS_COLOR[j.status] ?? "#94a3b8" }}>
                        {STATUS_LABEL[j.status] ?? j.status}
                      </span>
                      {j.attempts > 1 && <span className="text-muted text-xs"> (ลอง {j.attempts} ครั้ง)</span>}
                      {j.errorMessage && (
                        <div className="text-[11px] text-muted max-w-[260px] truncate" title={j.errorMessage}>
                          {j.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">{j.gpuSeconds > 0 ? `${j.gpuSeconds} วิ` : "–"}</td>
                    <td className="py-2 pr-3">{j.costUsd > 0 ? usd(j.costUsd) : "–"}</td>
                    <td className="py-2 pr-3">{j.credits}</td>
                    <td className="py-2 text-muted text-xs">
                      {new Date(j.queuedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted py-6 text-center">ยังไม่มีงาน</p>
        )}
      </div>
    </div>
  );
}
