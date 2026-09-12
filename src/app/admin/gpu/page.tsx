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
  CircleDollarSign,
  Cpu,
  ExternalLink,
  Gauge,
  KeyRound,
  Percent,
  RefreshCw,
  Save,
  Server,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";

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
  lifetimeLeftMinutes: number;
  gpuModel: string | null;
  gpuCount: number;
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
  maxWorkerLifetimeMinutes: number;
  warmupTimeoutMinutes: number;
  jobTimeoutMinutes: number;
}

interface Analytics {
  config: GpuConfig;
  pricing: { thbPerCredit: number; usdToThb: number };
  balance: { balanceUsd: number; availableRentalHours: number | null; hoursAtCurrentBurn: number | null } | null;
  balanceError: string | null;
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

async function postApiKey(
  apiKey: string,
): Promise<{ ok: true; warning?: string; balanceUsd: number } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/admin/gpu/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, enable: true }),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body.error || "บันทึกไม่สำเร็จ" };
    return { ok: true, warning: body.warning, balanceUsd: body.balanceUsd };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<GpuConfig | null>(null);
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
  ) => {
    setBusy(label);
    setMessage(null);

    const result = await postAction(payload);
    if (!result.ok) {
      setMessage({ kind: "err", text: result.error });
      setBusy(null);
      return;
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
  };

  const saveKey = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setBusy("setup");
    setMessage(null);

    const result = await postApiKey(key);
    if (!result.ok) {
      setMessage({ kind: "err", text: result.error });
      setBusy(null);
      return;
    }
    setApiKey("");
    setMessage({
      kind: result.warning ? "err" : "ok",
      text: result.warning || `เชื่อมต่อสำเร็จ • ยอดเงิน ${usd(result.balanceUsd)}`,
    });
    setForm(null);
    // As in `post`, `busy` stays set across the reload.
    await load();
    setBusy(null);
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

  const needsKey = Boolean(data?.balanceError);
  const p = data?.profit;
  const b = data?.budget;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-6 h-6 text-primary-light" />
            GPU ที่เช่า (SimplePod)
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

      {/* Setup — the only thing needed to go live */}
      {needsKey && (
        <div className="glass rounded-xl p-5 mb-6 border border-warning/30">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound className="w-5 h-5 text-warning" />
            <h2 className="font-bold">เชื่อมต่อ SimplePod</h2>
          </div>
          <p className="text-sm text-muted mb-2">
            กรอก API key ครั้งเดียว ระบบจะตั้งค่าที่เหลือให้เองทั้งหมด — สร้าง provider, เพิ่มโมเดลทั้งหมด,
            ตั้งเพดานงบ ไม่ต้อง build Docker image และไม่ต้องตั้ง cron เอง
          </p>
          <p className="text-sm mb-3 flex items-center gap-2 flex-wrap">
            <a
              href={SIMPLEPOD_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-light underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-1"
            >
              เปิดหน้าเอา API key ของ SimplePod <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <span className="text-muted text-xs">(อยู่ในแท็บ Subaccounts — คัดลอกทั้งบรรทัด)</span>
          </p>
          <div className="flex gap-2 flex-wrap">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="SimplePod API key"
              autoComplete="off"
              className="flex-1 min-w-[240px] px-3 py-2 rounded-lg glass-light text-sm outline-none"
            />
            <button
              onClick={() => void saveKey()}
              disabled={busy !== null || !apiKey.trim()}
              className="px-4 py-2 rounded-lg bg-primary/20 text-primary-light hover:bg-primary/30 text-sm font-medium disabled:opacity-40"
            >
              {busy === "setup" ? "กำลังตรวจสอบ..." : "เชื่อมต่อและเปิดใช้งาน"}
            </button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="ยอดเงิน SimplePod"
          value={data?.balance ? usd(data.balance.balanceUsd) : "–"}
          sub={
            <span className="flex items-center gap-2 flex-wrap">
              <span>
                {data?.balance?.hoursAtCurrentBurn != null
                  ? `พอใช้อีก ~${data.balance.hoursAtCurrentBurn} ชม. ที่อัตราปัจจุบัน`
                  : data?.balanceError ?? ""}
              </span>
              {/* Surfaced here because an empty balance is the one failure that
                  cannot be fixed from inside this app. */}
              <a
                href={SIMPLEPOD_BILLING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-light underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-1"
              >
                เติมเงิน <ExternalLink className="w-3 h-3" />
              </a>
            </span>
          }
          icon={<Wallet className="w-4 h-4" />}
          tone={data?.balance && data.balance.balanceUsd < 1 ? "bad" : "default"}
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
              ["maxConcurrentWorkers", "เครื่องพร้อมกันสูงสุด", "1 เครื่อง = 1 คลิปต่อครั้ง"],
              ["idleTimeoutMinutes", "ปิดเครื่องเมื่อว่างเกิน (นาที)", "สั้น = ประหยัด แต่บูตใหม่บ่อย"],
              ["maxWorkerLifetimeMinutes", "อายุเครื่องสูงสุด (นาที)", "กันเครื่องหลุดค้าง"],
              ["warmupTimeoutMinutes", "รอเครื่องพร้อมสูงสุด (นาที)", "ต้องเผื่อโหลดโมเดล ~42GB"],
              ["jobTimeoutMinutes", "เรนเดอร์นานสุด (นาที)", "เกินแล้วยกเลิกและคืนเครดิต"],
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
                            ? `ว่าง — ปิดเองใน ${w.idleOffInMinutes} นาทีถ้าไม่มีงาน`
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
                      {w.supportId && <div className="text-[11px] text-muted" title="รหัสเครื่องฝั่ง SimplePod">{w.supportId}</div>}
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
                      {r.supportId && <div className="text-[10px]" title="รหัสเครื่องฝั่ง SimplePod">{r.supportId}</div>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.modelName}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.gpuModel ?? "–"}{r.gpuCount > 1 ? ` ×${r.gpuCount}` : ""}
                      <div className="text-[11px] text-muted">{usd(r.pricePerHourUsd)}/ชม.</div>
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
