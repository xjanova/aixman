"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Plus, RefreshCw, Save, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import GpuSection from "./gpu-section";

interface LlmConfig {
  backend: "upstream" | "gpu";
  upstreamModel: string;
  inputCreditsPerMTok: number;
  outputCreditsPerMTok: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  contextLength: number;
  maxOutputTokens: number;
}

interface LlmModelRow {
  id: number;
  modelId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  readiness: string;
  provider: { id: number; slug: string; name: string; isActive: boolean; accounts: number };
  config: LlmConfig;
}

interface UsageRow {
  model: string;
  requests: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  credits: number;
  costUsd: number;
}

interface Data {
  days: number;
  thbPerCredit: number;
  usdToThb: number;
  activeKeys: number;
  ratePerMinute: number;
  models: LlmModelRow[];
  usage: UsageRow[];
}

const CONFIG_FIELDS: { key: keyof LlmConfig; label: string; step?: string }[] = [
  { key: "upstreamModel", label: "ชื่อโมเดลฝั่งต้นทาง (GPU: คีย์ llm-…)" },
  { key: "inputCreditsPerMTok", label: "ราคาขาย input (เครดิต/1M token)", step: "0.1" },
  { key: "outputCreditsPerMTok", label: "ราคาขาย output (เครดิต/1M token)", step: "0.1" },
  { key: "inputUsdPerMTok", label: "ต้นทุน input (USD/1M)", step: "0.01" },
  { key: "outputUsdPerMTok", label: "ต้นทุน output (USD/1M)", step: "0.01" },
  { key: "contextLength", label: "Context (token)" },
  { key: "maxOutputTokens", label: "Output สูงสุดต่อคำขอ" },
];

const fmt = (n: number, digits = 0) => n.toLocaleString("th-TH", { maximumFractionDigits: digits });

/** Margin of a price over its cost, both turned into baht. */
function margin(credits: number, usd: number, d: Data): string {
  const sale = credits * d.thbPerCredit;
  const cost = usd * d.usdToThb;
  if (sale <= 0 || d.thbPerCredit <= 0) return "—";
  return `${fmt(((sale - cost) / sale) * 100, 0)}%`;
}

export default function AdminLlmPage() {
  const [data, setData] = useState<Data | null>(null);
  const [drafts, setDrafts] = useState<Record<number, LlmConfig>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rate, setRate] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/llm");
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "โหลดไม่สำเร็จ");
      return;
    }
    setData(json);
    setRate(String(json.ratePerMinute));
    setDrafts(Object.fromEntries((json.models as LlmModelRow[]).map((m) => [m.id, m.config])));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const post = async (body: object, ok: string) => {
    setBusy(true);
    const res = await fetch("/api/admin/llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? ok : json.error || "ไม่สำเร็จ");
    setBusy(false);
    load();
  };

  const patch = async (id: number, body: object) => {
    setBusy(true);
    const res = await fetch(`/api/admin/llm/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? "บันทึกแล้ว" : json.error || "บันทึกไม่สำเร็จ");
    setBusy(false);
    load();
  };

  const remove = async (m: LlmModelRow) => {
    if (!confirm(`ลบ ${m.name}? ลูกค้าที่เรียกโมเดลนี้จะได้ 404`)) return;
    await fetch(`/api/admin/llm/${m.id}`, { method: "DELETE" });
    load();
  };

  const setField = (id: number, key: keyof LlmConfig, value: string) => {
    setDrafts((d) => ({
      ...d,
      [id]: { ...d[id], [key]: key === "upstreamModel" || key === "backend" ? value : Number(value) },
    }));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">API โมเดลภาษา</h1>
          <p className="text-sm text-muted">
            ขายโมเดลเขียนโค้ด/แชตผ่าน <code className="font-mono">/api/v1</code> (รูปแบบเดียวกับ OpenAI) คิดเครดิตตาม token
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all" aria-label="รีเฟรช">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            disabled={busy}
            onClick={() => post({ preset: "deepseek" }, "เพิ่ม DeepSeek แล้ว — ใส่ API key ของ DeepSeek ที่ Account Pools")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> เพิ่ม DeepSeek
          </button>
        </div>
      </div>

      {message && <div className="glass-light rounded-lg px-4 py-2 mb-4 text-sm">{message}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="glass rounded-xl p-4">
              <div className="text-xs text-muted mb-1">คีย์ลูกค้าที่ใช้งาน</div>
              <div className="text-2xl font-bold">{fmt(data.activeKeys)}</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-xs text-muted mb-1">คำขอ {data.days} วัน</div>
              <div className="text-2xl font-bold">{fmt(data.usage.reduce((s, u) => s + u.requests, 0))}</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-xs text-muted mb-1">รายได้ {data.days} วัน</div>
              <div className="text-2xl font-bold">฿{fmt(data.usage.reduce((s, u) => s + u.credits, 0) * data.thbPerCredit)}</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-xs text-muted mb-1">ต้นทุน {data.days} วัน</div>
              <div className="text-2xl font-bold">฿{fmt(data.usage.reduce((s, u) => s + u.costUsd, 0) * data.usdToThb)}</div>
            </div>
          </div>

          <div className="glass rounded-xl p-4 mb-6 text-sm space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">จำกัดคำขอต่อคีย์</span>
              <input
                type="number"
                min={1}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-24 px-2 py-1 rounded bg-surface-light border border-border"
              />
              <span className="text-muted">ครั้ง/นาที</span>
              <button disabled={busy} onClick={() => post({ ratePerMinute: Number(rate) }, "บันทึกแล้ว")} className="px-3 py-1 rounded glass-light">
                บันทึก
              </button>
            </div>
            <p className="text-muted">
              1 เครดิต ≈ ฿{fmt(data.thbPerCredit, 2)} (เฉลี่ยจากแพ็กเกจ) · 1 USD ≈ ฿{fmt(data.usdToThb, 2)} — ใส่คีย์ของผู้ให้บริการที่{" "}
              <Link href="/admin/pools" className="underline">Account Pools</Link> และตั้งโควตารายวันเป็น 0 (ไม่จำกัด) ไม่งั้นคีย์จะหยุดที่ 1,000 คำขอต่อวัน
            </p>
          </div>

          <div className="space-y-4 mb-8">
            {data.models.length === 0 && (
              <div className="glass rounded-xl p-8 text-center text-muted">ยังไม่มีโมเดล — กด &quot;เพิ่ม DeepSeek&quot;</div>
            )}
            {data.models.map((m) => {
              const d = drafts[m.id] ?? m.config;
              return (
                <div key={m.id} className="glass rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <div className="font-semibold">
                        {m.name} <code className="ml-2 text-xs font-mono text-muted">{m.modelId}</code>
                      </div>
                      <div className="text-xs text-muted">
                        {m.provider.name} · {m.config.backend === "gpu" ? "GPU ที่เช่า" : "API ต้นทาง"} ·{" "}
                        {m.provider.accounts > 0 ? `${m.provider.accounts} คีย์ใน pool` : <span className="text-warning">ยังไม่มีคีย์ใน pool</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => patch(m.id, { isActive: !m.isActive })} className="flex items-center gap-1 text-sm">
                        {m.isActive ? <ToggleRight className="w-5 h-5 text-success" /> : <ToggleLeft className="w-5 h-5 text-muted" />}
                        {m.isActive ? "เปิดขาย" : "ปิดอยู่"}
                      </button>
                      <button onClick={() => remove(m)} className="p-1.5 rounded hover:bg-surface-light" aria-label="ลบ">
                        <Trash2 className="w-4 h-4 text-muted" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {CONFIG_FIELDS.map((f) => (
                      <label key={f.key} className="text-xs text-muted">
                        {f.label}
                        <input
                          type={f.key === "upstreamModel" ? "text" : "number"}
                          step={f.step}
                          value={String(d[f.key])}
                          onChange={(e) => setField(m.id, f.key, e.target.value)}
                          className="mt-1 w-full px-2 py-1.5 rounded bg-surface-light border border-border text-sm text-foreground"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-xs text-muted">
                    <span>
                      กำไรขั้นต้น · input {margin(d.inputCreditsPerMTok, d.inputUsdPerMTok, data)} · output{" "}
                      {margin(d.outputCreditsPerMTok, d.outputUsdPerMTok, data)}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() => patch(m.id, { config: d })}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/20 text-primary-light text-sm"
                    >
                      <Save className="w-4 h-4" /> บันทึก
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="font-semibold mb-2 flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> การใช้งาน {data.days} วันล่าสุด
          </h2>
          <div className="glass rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="text-left p-3 font-medium">โมเดล</th>
                  <th className="text-right p-3 font-medium">คำขอ</th>
                  <th className="text-right p-3 font-medium">ผิดพลาด</th>
                  <th className="text-right p-3 font-medium">Input token</th>
                  <th className="text-right p-3 font-medium">Output token</th>
                  <th className="text-right p-3 font-medium">เครดิต</th>
                  <th className="text-right p-3 font-medium">ต้นทุน (USD)</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted">ยังไม่มีการใช้งาน</td>
                  </tr>
                ) : (
                  data.usage.map((u) => (
                    <tr key={u.model} className="border-b border-border/50">
                      <td className="p-3 font-mono text-xs">{u.model}</td>
                      <td className="p-3 text-right">{fmt(u.requests)}</td>
                      <td className="p-3 text-right">{fmt(u.errors)}</td>
                      <td className="p-3 text-right">{fmt(u.promptTokens)}</td>
                      <td className="p-3 text-right">{fmt(u.completionTokens)}</td>
                      <td className="p-3 text-right">{fmt(u.credits, 1)}</td>
                      <td className="p-3 text-right">${fmt(u.costUsd, 2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <GpuSection />
    </div>
  );
}
