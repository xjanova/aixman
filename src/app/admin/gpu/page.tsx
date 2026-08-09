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
  recentJobs: JobRow[];
  queue: { queued: number; running: number };
}

const thb = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const shortDate = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });

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
  label: string; value: string; sub?: string; icon: React.ReactNode;
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

export default function GpuAdminPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [form, setForm] = useState<GpuConfig | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/gpu/analytics");
      if (!res.ok) throw new Error();
      const d: Analytics = await res.json();
      setData(d);
      // Only seed the form once, so a background refresh can't discard edits
      // the admin is in the middle of typing.
      setForm((prev) => prev ?? d.config);
    } catch {
      setMessage({ kind: "err", text: "โหลดข้อมูลไม่สำเร็จ" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/gpu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "ทำรายการไม่สำเร็จ");
      setMessage({ kind: "ok", text: "เรียบร้อย" });
      await load();
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async () => {
    if (!apiKey.trim()) return;
    setBusy("setup");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/gpu/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), enable: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "บันทึกไม่สำเร็จ");
      setApiKey("");
      setMessage({
        kind: body.warning ? "err" : "ok",
        text: body.warning || `เชื่อมต่อสำเร็จ • ยอดเงิน ${usd(body.balanceUsd)}`,
      });
      setForm(null);
      await load();
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
              if (confirm("ปิดเครื่อง GPU ที่กำลังเช่าทั้งหมดทันที?\nงานที่กำลังเรนเดอร์จะถูกยกเลิกและคืนเครดิตให้ผู้ใช้"))
                void post({ action: "terminate-all" }, "stop");
            }}
            disabled={busy !== null || (b?.liveWorkers ?? 0) === 0}
            className="px-3 py-2 rounded-lg bg-error/15 text-error hover:bg-error/25 transition-all text-sm flex items-center gap-2 disabled:opacity-40"
          >
            <Ban className="w-4 h-4" /> หยุดทั้งหมด
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 rounded-xl p-3 text-sm ${message.kind === "ok" ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
          {message.text}
        </div>
      )}

      {/* Setup — the only thing needed to go live */}
      {needsKey && (
        <div className="glass rounded-xl p-5 mb-6 border border-warning/30">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound className="w-5 h-5 text-warning" />
            <h2 className="font-bold">เชื่อมต่อ SimplePod</h2>
          </div>
          <p className="text-sm text-muted mb-3">
            กรอก API key จาก Account Settings → Subaccounts ของ SimplePod แล้วระบบจะตั้งค่าที่เหลือให้เองทั้งหมด
            (สร้าง provider, เปิดโมเดล MiniMax H3, ตั้งเพดานงบ) — ไม่ต้อง build Docker image เอง
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
            data?.balance?.hoursAtCurrentBurn != null
              ? `พอใช้อีก ~${data.balance.hoursAtCurrentBurn} ชม. ที่อัตราปัจจุบัน`
              : data?.balanceError ?? undefined
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
                  <tr key={w.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3">
                      <span style={{ color: STATUS_COLOR[w.status] ?? "#94a3b8" }}>
                        ● {STATUS_LABEL[w.status] ?? w.status}
                      </span>
                      {w.lastError && (
                        <div className="text-[11px] text-muted max-w-[220px] truncate" title={w.lastError}>
                          {w.lastError}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">{w.gpuModel ?? "–"}{w.gpuCount > 1 ? ` ×${w.gpuCount}` : ""}</td>
                    <td className="py-2 pr-3">{usd(w.pricePerHourUsd)}</td>
                    <td className="py-2 pr-3">{w.uptimeMinutes} นาที</td>
                    <td className="py-2 pr-3 text-warning">{usd(w.accruedCostUsd)}</td>
                    <td className="py-2 pr-3">
                      {w.jobsCompleted} <span className="text-error">/ {w.jobsFailed}</span>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => {
                          if (confirm("ปิดเครื่องนี้ทันที?")) void post({ action: "terminate", workerId: w.id }, `t${w.id}`);
                        }}
                        disabled={busy !== null}
                        className="px-2 py-1 rounded bg-error/15 text-error hover:bg-error/25 text-xs disabled:opacity-40"
                      >
                        ปิด
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted py-6 text-center">
            ไม่มีเครื่องเปิดอยู่ — ไม่มีค่าใช้จ่ายตอนนี้ ระบบจะเช่าให้อัตโนมัติเมื่อมีคนสั่งสร้างวิดีโอ
          </p>
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
