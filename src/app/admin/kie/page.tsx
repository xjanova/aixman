"use client";

/**
 * /admin/kie — KIE.ai, the primary provider, on a page of its own.
 *
 * KIE takes every order on its models first; the account pool is the
 * fallback, used only when KIE cannot take one (kie-fallback.ts). This page
 * shows the key and its balance, the 402 state, what KIE cost today and this
 * month, the model list with a test order per family, recent failures, and
 * the fallback switch, map and log. Data: /api/admin/kie; adding a key and
 * syncing rows: the KIE card (/api/admin/providers/kie).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { KieCard } from "../providers/kie-card";

interface Tally { orders: number; completed: number; failed: number; credits: number; costUsd: number }
interface Period extends Tally { kieUsd: number; kieCalls: number; fallback: number }
interface KeyView {
  id: number; label: string; masked: string; isActive: boolean; block: string | null;
  cooldownUntil: string | null; consecutiveErrors: number; lastError: string | null; lastErrorAt: string | null;
  lastUsedAt: string | null; usageToday: number; usageThisMonth: number; totalCostUsd: number;
  out402: boolean; alert402At: string | null;
}
interface RefView { ref: string; name: string | null; provider: string; costPerUnit: number | null; usable: boolean; why: string | null }
interface ModelView {
  id: number; modelId: string; name: string; family: string; category: string; subcategory: string | null;
  isActive: boolean; readiness: string; inCatalog: boolean; priceFrom: number; unit: string;
  today: Tally; month: Tally; fallback: { custom: boolean; refs: RefView[] };
}
interface RouteView { name: string; provider: string; reason: string }
interface Candidate { ref: string; name: string; provider: string; category: string; subcategory: string | null; readiness: string; isActive: boolean; hasKey: boolean }
interface Overview {
  provider: { id: number; isActive: boolean } | null;
  catalog: number;
  keys: KeyView[];
  out402?: boolean;
  spend?: { today: Period; month: Period };
  models: ModelView[];
  failures?: { id: number; model: string; error: string; refunded: number; at: string; route: RouteView | null }[];
  fallback: {
    enabled: boolean;
    recent?: { id: number; model: string; status: string; credits: number; costUsd: number; at: string; route: RouteView | null }[];
    candidates?: Candidate[];
  };
}

type Answer = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

async function call(body?: Record<string, unknown>): Promise<Answer> {
  try {
    const res = await fetch(
      "/api/admin/kie",
      body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" }
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : `HTTP ${res.status}` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" };
  }
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const usd = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;
const CATEGORY: Record<string, string> = { image: "ภาพ", edit: "แก้ภาพ", video: "วิดีโอ", audio: "เสียง" };
const BLOCK: Record<string, string> = { inactive: "ปิดอยู่", cooldown: "พักชั่วคราว", quota: "ครบโควตา", errors: "ผิดพลาดติดกันจนถูกพัก" };

function keyState(k: KeyView): { tone: "ok" | "warn" | "bad"; text: string } {
  if (k.out402) return { tone: "bad", text: "เครดิตหมด (402)" };
  if (k.block === "cooldown") return { tone: "warn", text: `พักถึง ${when(k.cooldownUntil)}` };
  if (k.block) return { tone: "bad", text: BLOCK[k.block] ?? k.block };
  return { tone: "ok", text: "รับงานได้" };
}

export default function KiePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [balance, setBalance] = useState<{ credits: number; usd: number } | { error: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [replacing, setReplacing] = useState<{ id: number; value: string } | null>(null);
  const [editing, setEditing] = useState<{ modelId: string; refs: string[] } | null>(null);
  const [family, setFamily] = useState<string>("all");

  const load = useCallback(async () => {
    const r = await call();
    if (r.ok) {
      setData(r.data as unknown as Overview);
      setLoadError(null);
    } else setLoadError(r.error);
  }, []);
  const readBalance = useCallback(async () => {
    const r = await call({ action: "balance" });
    setBalance(r.ok ? { credits: Number(r.data.credits), usd: Number(r.data.usd) } : { error: r.error });
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- the page's first read; state lands after the fetch */
    void load();
    void readBalance();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [load, readBalance]);

  /** One action at a time: a second click while one runs would send it twice. */
  const act = async (id: string, body: Record<string, unknown>, done: (d: Record<string, unknown>) => string) => {
    if (busy) return;
    setBusy(id);
    setNote(null);
    const r = await call(body);
    setBusy(null);
    if (!r.ok) {
      setNote({ ok: false, text: r.error });
      return false;
    }
    setNote({ ok: true, text: done(r.data) });
    await load();
    return true;
  };

  const families = useMemo(() => [...new Set((data?.models ?? []).map((m) => m.family))], [data]);
  const shown = (data?.models ?? []).filter((m) => family === "all" || m.family === family);
  const grouped = useMemo(() => {
    const out = new Map<string, ModelView[]>();
    for (const m of shown) out.set(m.family, [...(out.get(m.family) ?? []), m]);
    return [...out.entries()];
  }, [shown]);

  const toggleFallback = () => {
    if (!data) return;
    const next = !data.fallback.enabled;
    if (!next && !window.confirm("ปิดระบบสำรอง? ถ้า KIE รับงานไม่ได้ ลูกค้าจะได้เครดิตคืนแทนการสลับไปผู้ให้บริการอื่น")) return;
    void act("fallback", { action: "fallback", enabled: next }, (d) => (d.enabled ? "เปิดระบบสำรองแล้ว" : "ปิดระบบสำรองแล้ว"));
  };

  const saveMap = async (modelId: string, refs: string[] | null) => {
    if (refs === null && !window.confirm("กลับไปใช้รายการสำรองตั้งต้นจากแคตตาล็อก? รายการที่แก้ไว้จะหายไป")) return;
    const ok = await act(`map:${modelId}`, { action: "fallback-map", modelId, refs }, () => "บันทึกโมเดลสำรองแล้ว");
    if (ok) setEditing(null);
  };

  if (loadError && !data) {
    return <div className="kp"><div className="kp-card kp-bad">โหลดข้อมูลไม่สำเร็จ: {loadError}</div><style>{styles}</style></div>;
  }

  const spend = data?.spend;
  return (
    <div className="kp">
      <header className="kp-head">
        <div>
          <div className="kp-eyebrow">ผู้ให้บริการหลัก</div>
          <h1>KIE.ai</h1>
          <p>ทุกออร์เดอร์ของโมเดล KIE ไปที่ KIE ก่อน — จะสลับไปโมเดลสำรองใน Account Pool เฉพาะตอนที่ KIE รับงานไม่ได้
            (เครดิตหมด คีย์ถูกพัก ติดลิมิต หรือ KIE ล่ม) ลูกค้าจ่ายราคาเดิม</p>
        </div>
        <button type="button" className="kp-btn" onClick={() => { void load(); void readBalance(); }} disabled={busy !== null}>รีเฟรช</button>
      </header>

      {note && <div className={`kp-note ${note.ok ? "kp-good" : "kp-bad"}`} role="status">{note.text}</div>}

      {data?.out402 && (
        <div className="kp-alarm" role="alert">
          <strong>เครดิต KIE หมด (402)</strong> — งานกำลังไปที่โมเดลสำรอง{data.fallback.enabled ? "" : " (ระบบสำรองปิดอยู่: ลูกค้าได้เครดิตคืน)"}.
          เติมที่ <a href="https://kie.ai/billing" target="_blank" rel="noreferrer">kie.ai</a> แล้วกด &quot;ตรวจคีย์อีกครั้ง&quot; ด้านล่าง
        </div>
      )}

      <section className="kp-tiles">
        <div className="kp-card kp-tile">
          <div className="kp-label">ยอดเครดิต KIE</div>
          {balance === null ? <div className="kp-big">…</div> : "error" in balance ? (
            <div className="kp-small kp-badtext">{balance.error}</div>
          ) : (
            <>
              <div className="kp-big">{balance.credits.toLocaleString()}</div>
              <div className="kp-small">≈ {usd(balance.usd)} · อ่านจาก KIE (ไม่เสียเครดิต)</div>
            </>
          )}
        </div>
        <div className="kp-card kp-tile">
          <div className="kp-label">ระบบสำรอง (Account Pool)</div>
          <button type="button" role="switch" aria-checked={data?.fallback.enabled ?? false} className={`kp-switch ${data?.fallback.enabled ? "on" : ""}`}
            onClick={toggleFallback} disabled={!data || busy !== null}>
            <span className="kp-knob" />{data?.fallback.enabled ? "เปิด" : "ปิด"}
          </button>
          <div className="kp-small">สลับวันนี้ {spend?.today.fallback ?? 0} · เดือนนี้ {spend?.month.fallback ?? 0} ออร์เดอร์</div>
        </div>
        {(["today", "month"] as const).map((p) => (
          <div className="kp-card kp-tile" key={p}>
            <div className="kp-label">{p === "today" ? "วันนี้" : "เดือนนี้"} (เวลาไทย)</div>
            <div className="kp-big">{(spend?.[p].orders ?? 0).toLocaleString()} <span className="kp-unit">ออร์เดอร์</span></div>
            <div className="kp-small">
              สำเร็จ {spend?.[p].completed ?? 0} · ล้ม {spend?.[p].failed ?? 0} · ขายได้ {(spend?.[p].credits ?? 0).toLocaleString()} เครดิต
            </div>
            <div className="kp-small">ค่า KIE {usd(spend?.[p].kieUsd ?? 0)} · ต้นทุนรวม {usd(spend?.[p].costUsd ?? 0)}</div>
          </div>
        ))}
      </section>

      <section className="kp-card">
        <h2>คีย์ KIE</h2>
        {data && data.keys.length === 0 && <p className="kp-small">ยังไม่มีคีย์ — วางคีย์ที่การ์ดด้านล่าง</p>}
        <div className="kp-keys">
          {data?.keys.map((k) => {
            const s = keyState(k);
            return (
              <div className="kp-key" key={k.id}>
                <div className="kp-keyhead">
                  <span className={`kp-dot ${s.tone}`} aria-hidden />
                  <strong>{k.label}</strong>
                  <code>{k.masked}</code>
                  <span className={`kp-chip ${s.tone}`}>{s.text}</span>
                </div>
                <div className="kp-small">
                  ใช้วันนี้ {k.usageToday} · เดือนนี้ {k.usageThisMonth} · ค่าใช้จ่ายสะสม {usd(k.totalCostUsd)} · ใช้ล่าสุด {when(k.lastUsedAt)}
                  {k.alert402At && <> · แจ้งเตือน 402 ล่าสุด {when(k.alert402At)}</>}
                </div>
                {k.lastError && <div className="kp-small kp-warntext">ข้อผิดพลาดล่าสุด ({when(k.lastErrorAt)}): {k.lastError}</div>}
                <div className="kp-row">
                  <button type="button" className="kp-btn" disabled={busy !== null}
                    onClick={() => act(`recheck:${k.id}`, { action: "recheck", keyId: k.id }, (d) => `คีย์ใช้งานได้ ยอด ${Number(d.credits).toLocaleString()} เครดิต — กลับมารับงานแล้ว`).then(() => readBalance())}>
                    {busy === `recheck:${k.id}` ? "กำลังตรวจ…" : "ตรวจคีย์อีกครั้ง"}
                  </button>
                  {replacing?.id === k.id ? (
                    <>
                      <input type="password" autoComplete="off" className="kp-input" placeholder="วางคีย์ใหม่จาก kie.ai/api-key"
                        value={replacing.value} onChange={(e) => setReplacing({ id: k.id, value: e.target.value })} />
                      <button type="button" className="kp-btn kp-primary" disabled={busy !== null || replacing.value.trim().length < 16}
                        onClick={() => {
                          if (!window.confirm(`แทนที่คีย์ ${k.masked} ด้วยคีย์ใหม่? คีย์เดิมจะถูกลบจากระบบ`)) return;
                          void act(`replace:${k.id}`, { action: "replace", keyId: k.id, apiKey: replacing.value.trim() }, (d) => `เปลี่ยนคีย์แล้ว ยอด ${Number(d.credits).toLocaleString()} เครดิต`)
                            .then((ok) => { if (ok) { setReplacing(null); void readBalance(); } });
                        }}>
                        {busy === `replace:${k.id}` ? "กำลังตรวจคีย์…" : "บันทึกคีย์ใหม่"}
                      </button>
                      <button type="button" className="kp-btn" onClick={() => setReplacing(null)}>ยกเลิก</button>
                    </>
                  ) : (
                    <button type="button" className="kp-btn" disabled={busy !== null} onClick={() => setReplacing({ id: k.id, value: "" })}>เปลี่ยนคีย์</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <KieCard onChanged={() => void load()} onKiePage />

      <section className="kp-card">
        <div className="kp-sectionhead">
          <h2>โมเดล ({data?.models.length ?? 0}/{data?.catalog ?? 0})</h2>
          <select className="kp-input kp-select" value={family} onChange={(e) => setFamily(e.target.value)} aria-label="กรองตามตระกูล">
            <option value="all">ทุกตระกูล</option>
            {families.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <p className="kp-small">&quot;สั่งทดสอบ&quot; เปิดสตูดิโอที่โมเดลนั้นในแท็บใหม่ — ออร์เดอร์ของแอดมินเป็นงานจริง (เสียเครดิต KIE) และผ่านการตรวจเหมือนลูกค้าทุกข้อ</p>
        {grouped.map(([name, list]) => (
          <div className="kp-family" key={name}>
            <div className="kp-familyhead">
              <h3>{name}</h3>
              {list.find((m) => m.isActive) && (
                <Link className="kp-btn kp-primary" href={`/generate?model=${list.find((m) => m.isActive)!.id}`} target="_blank">สั่งทดสอบตระกูลนี้</Link>
              )}
            </div>
            {list.map((m) => (
              <div className={`kp-model ${m.isActive ? "" : "off"}`} key={m.id}>
                <div className="kp-modelmain">
                  <div>
                    <strong>{m.name}</strong>
                    <span className="kp-chip">{CATEGORY[m.category] ?? m.category}</span>
                    <span className={`kp-chip ${m.readiness === "ready" ? "ok" : "warn"}`}>{m.readiness === "ready" ? "พร้อมขาย" : m.readiness === "tuning" ? "รอทดสอบ" : m.readiness}</span>
                    {!m.inCatalog && <span className="kp-chip bad">เลิกขายแล้ว</span>}
                  </div>
                  <div className="kp-small">
                    เริ่ม {m.priceFrom.toLocaleString()} เครดิต {m.unit} · วันนี้ {m.today.orders} งาน (ล้ม {m.today.failed}) ·
                    เดือนนี้ {m.month.orders} งาน {m.month.credits.toLocaleString()} เครดิต ต้นทุน {usd(m.month.costUsd)}
                  </div>
                  <div className="kp-fallbacks">
                    <span className="kp-small">สำรอง{m.fallback.custom ? " (แก้แล้ว)" : ""}:</span>
                    {m.fallback.refs.length === 0 && <span className="kp-small">ไม่มี — KIE รับไม่ได้ = คืนเครดิต</span>}
                    {m.fallback.refs.map((r) => (
                      <span key={r.ref} className={`kp-chip ${r.usable ? "ok" : "warn"}`} title={r.why ?? "พร้อมรับงานแทน"}>
                        {r.name ?? r.ref} · {r.provider}{r.usable ? "" : ` — ${r.why}`}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="kp-row kp-actions">
                  <button type="button" role="switch" aria-checked={m.isActive} className={`kp-switch small ${m.isActive ? "on" : ""}`} disabled={busy !== null}
                    onClick={() => act(`model:${m.id}`, { action: "model", id: m.id, isActive: !m.isActive }, () => `${m.name} ${m.isActive ? "ปิดแล้ว" : "เปิดแล้ว"}`)}>
                    <span className="kp-knob" />{m.isActive ? "เปิด" : "ปิด"}
                  </button>
                  {m.isActive && <Link className="kp-btn" href={`/generate?model=${m.id}`} target="_blank">สั่งทดสอบ</Link>}
                  {m.inCatalog && (
                    <button type="button" className="kp-btn" disabled={busy !== null}
                      onClick={() => setEditing(editing?.modelId === m.modelId ? null : { modelId: m.modelId, refs: m.fallback.refs.map((r) => r.ref) })}>
                      แก้โมเดลสำรอง
                    </button>
                  )}
                </div>
                {editing?.modelId === m.modelId && (
                  <FallbackEditor
                    model={m}
                    refs={editing.refs}
                    candidates={(data?.fallback.candidates ?? []).filter((c) => c.category === m.category)}
                    busy={busy !== null}
                    onChange={(refs) => setEditing({ modelId: m.modelId, refs })}
                    onSave={() => saveMap(m.modelId, editing.refs)}
                    onReset={() => saveMap(m.modelId, null)}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="kp-card">
        <h2>ออร์เดอร์ที่สลับไปโมเดลสำรอง (30 วัน)</h2>
        {(data?.fallback.recent ?? []).length === 0 ? <p className="kp-small">ยังไม่มี — KIE รับงานเองทุกออร์เดอร์</p> : (
          <div className="kp-list">
            {data?.fallback.recent?.map((g) => (
              <div className="kp-item" key={g.id}>
                <span className="kp-small">{when(g.at)} · #{g.id}</span>
                <span>{g.model} → <strong>{g.route?.name || "?"}</strong> <span className="kp-small">({g.route?.provider})</span></span>
                <span className="kp-small">{g.route?.reason}</span>
                <span className={`kp-chip ${g.status === "completed" ? "ok" : g.status === "failed" ? "bad" : "warn"}`}>
                  {g.status === "completed" ? `ส่งแล้ว · ${g.credits} เครดิต · ต้นทุน ${usd(g.costUsd)}` : g.status === "failed" ? "ล้ม (คืนเครดิตแล้ว)" : "กำลังทำ"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="kp-card">
        <h2>ออร์เดอร์ที่ล้มล่าสุด (30 วัน)</h2>
        {(data?.failures ?? []).length === 0 ? <p className="kp-small">ไม่มี</p> : (
          <div className="kp-list">
            {data?.failures?.map((f) => (
              <div className="kp-item" key={f.id}>
                <span className="kp-small">{when(f.at)} · #{f.id}</span>
                <span>{f.model}{f.route && <span className="kp-small"> (สำรอง: {f.route.name})</span>}</span>
                <span className="kp-small kp-warntext kp-wrap">{f.error || "—"}</span>
                <span className="kp-chip">{f.refunded > 0 ? `คืน ${f.refunded} เครดิต` : "ไม่ได้ตัดเครดิต"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <style>{styles}</style>
    </div>
  );
}

function FallbackEditor(props: {
  model: ModelView;
  refs: string[];
  candidates: Candidate[];
  busy: boolean;
  onChange: (refs: string[]) => void;
  onSave: () => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const { model, refs, candidates, busy, onChange } = props;
  const [adding, setAdding] = useState("");
  const label = (ref: string) => {
    const c = candidates.find((x) => x.ref === ref);
    return c ? `${c.name} · ${c.provider}` : ref;
  };
  const move = (i: number, d: number) => {
    const next = [...refs];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  const free = candidates.filter((c) => !refs.includes(c.ref));
  return (
    <div className="kp-editor">
      <div className="kp-small">ลำดับที่ระบบจะลองเมื่อ {model.name} ส่งไป KIE ไม่ได้ (สูงสุด 5) — ข้ามตัวที่ยังไม่พร้อม หรือรับงานนั้นไม่ได้ (ภาพอ้างอิง เฟรม ความยาว)</div>
      {refs.length === 0 && <div className="kp-small">ไม่มีโมเดลสำรอง</div>}
      {refs.map((ref, i) => (
        <div className="kp-row kp-editrow" key={ref}>
          <span className="kp-order">{i + 1}</span>
          <span className="kp-grow">{label(ref)}</span>
          <button type="button" className="kp-btn tiny" disabled={i === 0} onClick={() => move(i, -1)} aria-label="เลื่อนขึ้น">↑</button>
          <button type="button" className="kp-btn tiny" disabled={i === refs.length - 1} onClick={() => move(i, 1)} aria-label="เลื่อนลง">↓</button>
          <button type="button" className="kp-btn tiny" onClick={() => onChange(refs.filter((r) => r !== ref))} aria-label="เอาออก">✕</button>
        </div>
      ))}
      {refs.length < 5 && (
        <div className="kp-row">
          <select className="kp-input kp-grow" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="เพิ่มโมเดลสำรอง">
            <option value="">— เลือกโมเดล{CATEGORY[model.category] ?? ""}ของผู้ให้บริการอื่น —</option>
            {free.map((c) => (
              <option key={c.ref} value={c.ref}>
                {c.name} · {c.provider}{c.readiness !== "ready" ? " (รอทดสอบ)" : ""}{!c.isActive ? " (ปิด)" : ""}{!c.hasKey ? " (ไม่มีคีย์)" : ""}
              </option>
            ))}
          </select>
          <button type="button" className="kp-btn" disabled={!adding} onClick={() => { onChange([...refs, adding]); setAdding(""); }}>เพิ่ม</button>
        </div>
      )}
      <div className="kp-row">
        <button type="button" className="kp-btn kp-primary" disabled={busy} onClick={props.onSave}>บันทึก</button>
        {model.fallback.custom && <button type="button" className="kp-btn" disabled={busy} onClick={props.onReset}>กลับไปใช้ค่าตั้งต้น</button>}
        <button type="button" className="kp-btn" onClick={props.onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

const styles = `
  .kp { max-width: 1180px; margin: 0 auto; padding: 8px 0 48px; color: #e2e8f0; }
  .kp-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
  .kp-head h1 { font-size: 30px; font-weight: 300; margin: 2px 0 6px; color: #fff; letter-spacing: 0.01em; }
  .kp-head p { margin: 0; max-width: 760px; font-size: 13px; line-height: 1.65; color: rgba(203,213,225,0.78); }
  .kp-eyebrow, .kp-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #a5f3fc; }
  .kp-card {
    border-radius: 18px; padding: 20px; margin-bottom: 18px;
    background: linear-gradient(135deg, rgba(16,185,129,0.06), rgba(139,92,246,0.06));
    border: 1px solid rgba(165,243,252,0.16); backdrop-filter: blur(18px);
  }
  .kp-card h2 { font-size: 17px; font-weight: 500; margin: 0 0 12px; color: #fff; }
  .kp-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 18px; }
  .kp-tile { margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .kp-big { font-size: 28px; font-weight: 300; color: #fff; font-variant-numeric: tabular-nums; }
  .kp-unit { font-size: 13px; color: #94a3b8; }
  .kp-small { font-size: 12px; color: #94a3b8; line-height: 1.6; }
  .kp-wrap { overflow-wrap: anywhere; }
  .kp-badtext { color: #fca5a5; }
  .kp-warntext { color: #fcd34d; }
  .kp-note { border-radius: 12px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }
  .kp-good { background: rgba(16,185,129,0.12); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.3); }
  .kp-bad { background: rgba(239,68,68,0.12); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }
  .kp-alarm {
    border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; font-size: 13px; line-height: 1.6;
    background: linear-gradient(135deg, rgba(239,68,68,0.18), rgba(245,158,11,0.12)); border: 1px solid rgba(248,113,113,0.45); color: #fee2e2;
  }
  .kp-alarm a { color: #fde68a; }
  .kp-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
    border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #e2e8f0; text-decoration: none;
  }
  .kp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .kp-btn.tiny { padding: 4px 9px; font-size: 12px; }
  .kp-primary { border: none; background: linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%); color: #fff; }
  .kp-input {
    padding: 8px 12px; border-radius: 10px; background: rgba(2,6,23,0.55); color: #f1f5f9;
    border: 1px solid rgba(255,255,255,0.1); font-size: 13px; outline: none; min-width: 0;
  }
  .kp-select { max-width: 220px; }
  .kp-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
  .kp-grow { flex: 1 1 200px; }
  .kp-switch {
    display: inline-flex; align-items: center; gap: 10px; align-self: flex-start; cursor: pointer;
    padding: 6px 14px 6px 6px; border-radius: 999px; font-size: 13px; font-weight: 600; color: #cbd5e1;
    border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05);
  }
  .kp-switch.small { padding: 4px 12px 4px 4px; font-size: 12px; }
  .kp-switch .kp-knob { width: 22px; height: 22px; border-radius: 50%; background: #475569; transition: transform 0.2s, background 0.2s; }
  .kp-switch.small .kp-knob { width: 16px; height: 16px; }
  .kp-switch.on { color: #ecfeff; border-color: rgba(16,185,129,0.5); background: rgba(16,185,129,0.15); }
  .kp-switch.on .kp-knob { background: linear-gradient(135deg, #10b981, #06b6d4); transform: scale(1.05); }
  .kp-switch:disabled { opacity: 0.55; cursor: not-allowed; }
  .kp-keys { display: grid; gap: 12px; }
  .kp-key { padding: 14px; border-radius: 14px; background: rgba(2,6,23,0.35); border: 1px solid rgba(255,255,255,0.07); }
  .kp-keyhead { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .kp-keyhead code { font-size: 12px; color: #a5f3fc; background: rgba(165,243,252,0.08); padding: 2px 8px; border-radius: 6px; }
  .kp-dot { width: 9px; height: 9px; border-radius: 50%; background: #10b981; box-shadow: 0 0 10px rgba(16,185,129,0.7); }
  .kp-dot.warn { background: #f59e0b; box-shadow: 0 0 10px rgba(245,158,11,0.7); }
  .kp-dot.bad { background: #ef4444; box-shadow: 0 0 10px rgba(239,68,68,0.7); }
  .kp-chip {
    display: inline-block; font-size: 11px; padding: 2px 9px; border-radius: 999px; margin-left: 6px;
    background: rgba(255,255,255,0.06); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1);
  }
  .kp-chip.ok { background: rgba(16,185,129,0.12); color: #6ee7b7; border-color: rgba(16,185,129,0.3); }
  .kp-chip.warn { background: rgba(245,158,11,0.12); color: #fcd34d; border-color: rgba(245,158,11,0.3); }
  .kp-chip.bad { background: rgba(239,68,68,0.12); color: #fca5a5; border-color: rgba(239,68,68,0.3); }
  .kp-sectionhead { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
  .kp-family { margin-top: 18px; }
  .kp-familyhead { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .kp-familyhead h3 { margin: 0; font-size: 15px; font-weight: 500; color: #e0f2fe; }
  .kp-model { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .kp-model.off { opacity: 0.6; }
  .kp-modelmain strong { color: #fff; font-weight: 500; }
  .kp-fallbacks { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 4px; }
  .kp-fallbacks .kp-chip { margin-left: 0; }
  .kp-actions { margin-top: 8px; }
  .kp-editor { margin-top: 10px; padding: 14px; border-radius: 12px; background: rgba(2,6,23,0.45); border: 1px dashed rgba(165,243,252,0.25); }
  .kp-editrow { margin-top: 6px; }
  .kp-order { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; background: rgba(6,182,212,0.2); color: #a5f3fc; }
  .kp-list { display: grid; gap: 8px; }
  .kp-item {
    display: grid; grid-template-columns: 150px minmax(0, 1.2fr) minmax(0, 1.4fr) auto; gap: 10px; align-items: center;
    padding: 10px 12px; border-radius: 12px; background: rgba(2,6,23,0.3); font-size: 13px;
  }
  .kp-item .kp-chip { margin-left: 0; justify-self: end; }
  @media (max-width: 760px) {
    .kp-head { flex-direction: column; }
    .kp-item { grid-template-columns: 1fr; gap: 4px; }
    .kp-item .kp-chip { justify-self: start; }
    .kp-select { max-width: none; width: 100%; }
  }
`;
