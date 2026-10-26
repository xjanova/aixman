"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Cpu, Save } from "lucide-react";

type Mode = "off" | "on-demand" | "schedule" | "always";

interface Policy {
  mode: Mode;
  idleMinutes: number;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleDays: number[];
  timezone: string;
  maxMachines: number;
}

interface Fleet {
  dailyBudgetUsd: number;
  maxWorkers: number;
  maxPricePerHourUsd: number;
}

interface Worker {
  id: number;
  status: string;
  gpuModel: string | null;
  providerSlug: string;
  pricePerHourUsd: number;
  rentedAt: string;
  readyAt: string | null;
  lastJobAt: string | null;
  lastError: string | null;
}

interface GpuModel {
  key: string;
  name: string;
  description: string;
  repo: string;
  weightsGb: number;
  minVramGb: number;
  licence: string;
  policy: Policy;
  sale: { id: number; modelId: string; isActive: boolean } | null;
  workers: Worker[];
}

interface Data {
  rentalEnabled: boolean;
  gpuProviderReady: boolean;
  fleet: Fleet;
  spentTodayUsd: number;
  models: GpuModel[];
}

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "off", label: "ปิด", hint: "ไม่เปิดเครื่องเลย ลูกค้าที่เรียกจะได้ 503" },
  { value: "on-demand", label: "เปิดเมื่อมีคนใช้", hint: "เช่าเมื่อมีคำขอแรก (รอ 20–40 นาที) แล้วปิดเมื่อว่างเกินเวลาที่ตั้ง — ถูกที่สุด" },
  { value: "schedule", label: "ตามช่วงเวลา", hint: "เปิด 1 เครื่องตลอดช่วงเวลาที่ตั้ง นอกช่วงทำงานแบบเปิดเมื่อมีคนใช้" },
  { value: "always", label: "เปิดตลอดเวลา", hint: "เปิด 1 เครื่องตลอด 24 ชม. ตอบทันที — แพงที่สุด" },
];

const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

const STATUS_TH: Record<string, string> = {
  provisioning: "กำลังเช่า",
  warming: "กำลังโหลดโมเดล",
  ready: "พร้อมตอบ",
  busy: "กำลังทำงาน",
  draining: "กำลังปิด",
};

const input = "px-2 py-1 rounded bg-surface-light border border-border text-sm text-foreground";

export default function GpuSection() {
  const [data, setData] = useState<Data | null>(null);
  const [policies, setPolicies] = useState<Record<string, Policy>>({});
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/llm/gpu");
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "โหลดไม่สำเร็จ");
      return;
    }
    setData(json);
    setFleet(json.fleet);
    setPolicies(Object.fromEntries((json.models as GpuModel[]).map((m) => [m.key, m.policy])));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const post = async (body: object, ok: string) => {
    setBusy(true);
    const res = await fetch("/api/admin/llm/gpu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? ok : json.error || "ไม่สำเร็จ");
    setBusy(false);
    load();
  };

  const setPolicy = (key: string, patch: Partial<Policy>) =>
    setPolicies((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  if (!data || !fleet) return null;

  const burn = data.models.flatMap((m) => m.workers).reduce((s, w) => s + w.pricePerHourUsd, 0);

  return (
    <div className="mt-10">
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <Cpu className="w-5 h-5" /> รันเองบน GPU ที่เช่า (vLLM)
      </h2>
      <p className="text-sm text-muted mb-4">
        เช่าการ์ดจอมารันโมเดลเขียนโค้ดเอง แล้วขายผ่าน API เดียวกัน · คิดค่าเครื่องเป็นรายชั่วโมงไม่ว่าจะมีคนใช้หรือไม่ ·
        งบและจำนวนเครื่องแยกจากเครื่องเรนเดอร์ภาพ/วิดีโอ
      </p>
      {message && <div className="glass-light rounded-lg px-4 py-2 mb-4 text-sm">{message}</div>}
      {(!data.rentalEnabled || !data.gpuProviderReady) && (
        <div className="glass-light rounded-lg px-4 py-2 mb-4 text-sm text-warning">
          ระบบเช่า GPU ยังไม่เปิด — ตั้งค่าที่ <Link href="/admin/gpu" className="underline">GPU ที่เช่า</Link> ก่อน ไม่งั้นจะไม่มีเครื่องเปิดให้
        </div>
      )}

      <div className="glass rounded-xl p-4 mb-4 text-sm">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-muted">
            งบต่อวัน (USD)
            <input type="number" step="1" min={0} value={fleet.dailyBudgetUsd} onChange={(e) => setFleet({ ...fleet, dailyBudgetUsd: Number(e.target.value) })} className={`${input} block w-28 mt-1`} />
          </label>
          <label className="text-xs text-muted">
            เครื่องพร้อมกันสูงสุด
            <input type="number" min={0} value={fleet.maxWorkers} onChange={(e) => setFleet({ ...fleet, maxWorkers: Number(e.target.value) })} className={`${input} block w-24 mt-1`} />
          </label>
          <label className="text-xs text-muted">
            ราคาเครื่องสูงสุด (USD/ชม.)
            <input type="number" step="0.1" min={0.1} value={fleet.maxPricePerHourUsd} onChange={(e) => setFleet({ ...fleet, maxPricePerHourUsd: Number(e.target.value) })} className={`${input} block w-28 mt-1`} />
          </label>
          <button disabled={busy} onClick={() => post({ fleet }, "บันทึกงบแล้ว")} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/20 text-primary-light">
            <Save className="w-4 h-4" /> บันทึก
          </button>
          <span className="text-muted">
            วันนี้ใช้ไป ${data.spentTodayUsd.toFixed(2)} · ตอนนี้จ่ายอยู่ ${burn.toFixed(2)}/ชม. (≈ ${(burn * 24 * 30).toFixed(0)}/เดือน ถ้าเปิดค้าง)
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {data.models.map((m) => {
          const p = policies[m.key] ?? m.policy;
          return (
            <div key={m.key} className="glass rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="text-xs text-muted">{m.description}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {m.repo} · โมเดล {m.weightsGb} GB · การ์ด ≥ {m.minVramGb} GB · {m.licence}
                  </div>
                </div>
                {m.sale ? (
                  <span className="text-xs px-2 py-1 rounded bg-success/15 text-success">
                    ขายเป็น <code className="font-mono">{m.sale.modelId}</code> {m.sale.isActive ? "" : "(ปิดขายอยู่)"}
                  </span>
                ) : (
                  <button disabled={busy} onClick={() => post({ key: m.key, sell: true }, `เพิ่ม ${m.name} ในรายการขายแล้ว — ตั้งราคาในรายการด้านบน`)} className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm">
                    เพิ่มในรายการขาย
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2 mb-2">
                {MODES.map((mode) => (
                  <button
                    key={mode.value}
                    onClick={() => setPolicy(m.key, { mode: mode.value })}
                    title={mode.hint}
                    className={`px-3 py-1.5 rounded-lg text-sm ${p.mode === mode.value ? "bg-primary/30 text-primary-light" : "glass-light"}`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mb-3">{MODES.find((x) => x.value === p.mode)?.hint}</p>

              <div className="flex flex-wrap items-end gap-4 text-xs text-muted">
                <label>
                  ปิดเมื่อว่างเกิน (นาที)
                  <input type="number" min={5} value={p.idleMinutes} onChange={(e) => setPolicy(m.key, { idleMinutes: Number(e.target.value) })} className={`${input} block w-24 mt-1`} />
                </label>
                <label>
                  เครื่องสูงสุดของโมเดลนี้
                  <input type="number" min={1} max={8} value={p.maxMachines} onChange={(e) => setPolicy(m.key, { maxMachines: Number(e.target.value) })} className={`${input} block w-24 mt-1`} />
                </label>
                {p.mode === "schedule" && (
                  <>
                    <label>
                      เปิด
                      <input type="time" value={p.scheduleStart} onChange={(e) => setPolicy(m.key, { scheduleStart: e.target.value })} className={`${input} block mt-1`} />
                    </label>
                    <label>
                      ปิด
                      <input type="time" value={p.scheduleEnd} onChange={(e) => setPolicy(m.key, { scheduleEnd: e.target.value })} className={`${input} block mt-1`} />
                    </label>
                    <div>
                      วัน
                      <div className="flex gap-1 mt-1">
                        {DAYS.map((d, i) => (
                          <button
                            key={d}
                            onClick={() =>
                              setPolicy(m.key, {
                                scheduleDays: p.scheduleDays.includes(i) ? p.scheduleDays.filter((x) => x !== i) : [...p.scheduleDays, i].sort(),
                              })
                            }
                            className={`w-8 py-1 rounded ${p.scheduleDays.includes(i) ? "bg-primary/30 text-primary-light" : "glass-light"}`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                    <span className="self-center">เวลาไทย (Asia/Bangkok)</span>
                  </>
                )}
                <button disabled={busy} onClick={() => post({ key: m.key, policy: p }, `บันทึกการเปิดเครื่องของ ${m.name} แล้ว`)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/20 text-primary-light text-sm">
                  <Save className="w-4 h-4" /> บันทึก
                </button>
              </div>

              {m.workers.length > 0 && (
                <div className="mt-3 text-xs space-y-1">
                  {m.workers.map((w) => (
                    <div key={w.id} className="flex flex-wrap gap-x-3 text-muted">
                      <span className="text-foreground">#{w.id} {STATUS_TH[w.status] ?? w.status}</span>
                      <span>{w.gpuModel ?? "GPU"} · {w.providerSlug} · ${w.pricePerHourUsd.toFixed(2)}/ชม.</span>
                      <span>เปิดเมื่อ {new Date(w.rentedAt).toLocaleString("th-TH")}</span>
                      {w.lastJobAt && <span>ใช้ล่าสุด {new Date(w.lastJobAt).toLocaleTimeString("th-TH")}</span>}
                      {w.lastError && <span className="text-warning">{w.lastError.slice(0, 120)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
