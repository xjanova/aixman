"use client";

/**
 * Admin → ผู้ให้บริการ: the KIE.ai card — the primary provider since
 * 2026-10-29. Paste one key and every KIE model is created and priced
 * (/api/admin/providers/kie, kie-sync.ts). The key is checked against KIE's
 * free balance endpoint before it is stored, encrypted, in the account pool.
 */

import { useEffect, useState } from "react";

interface KieStatus {
  provider: { id: number; isActive: boolean } | null;
  keys: { id: number; label: string; isActive: boolean; consecutiveErrors: number; lastError: string | null }[];
  models: { total: number; ready: number; tuning: number };
  catalog: number;
}

type KieAnswer = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** One call to the KIE admin route; failures come back as values, so the component has no try/catch. */
async function kieCall(init?: { action: string; apiKey?: string; openNow?: boolean }): Promise<KieAnswer> {
  try {
    const res = await fetch(
      "/api/admin/providers/kie",
      init ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init) } : undefined
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : `HTTP ${res.status}` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" };
  }
}

function syncLine(sync: unknown): string {
  const s = sync as { created?: number; updated?: number; opened?: number } | undefined;
  if (!s) return "";
  return ` · โมเดลใหม่ ${s.created ?? 0} · อัปเดต ${s.updated ?? 0}${s.opened ? ` · เปิดขาย ${s.opened}` : ""}`;
}

function balanceLine(credits: unknown): string {
  if (typeof credits !== "number") return "";
  return `ยอดคงเหลือ ${credits.toLocaleString()} เครดิต KIE (≈ $${(credits * 0.005).toFixed(2)})`;
}

const inputStyle: React.CSSProperties = {
  flex: "1 1 260px", padding: "10px 12px", borderRadius: 10,
  background: "rgba(2,6,23,0.55)", color: "#f1f5f9",
  border: "1px solid rgba(255,255,255,0.1)",
  fontSize: 13, fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em", outline: "none",
};

export function KieCard({ onChanged, onKiePage = false }: { onChanged: () => void; onKiePage?: boolean }) {
  const [status, setStatus] = useState<KieStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [openNow, setOpenNow] = useState(false);
  const [busy, setBusy] = useState<"save-key" | "test" | "sync" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    kieCall().then((r) => {
      if (r.ok) setStatus(r.data as unknown as KieStatus);
    });
  };
  useEffect(() => { load(); }, []);

  const run = async (action: "save-key" | "test" | "sync") => {
    // A second click while one runs would store or sync twice.
    if (busy) return;
    setBusy(action);
    setMessage(null);
    const r = await kieCall({ action, apiKey: action === "save-key" ? apiKey.trim() : undefined, openNow });
    setBusy(null);
    if (!r.ok) {
      setMessage({ ok: false, text: r.error });
      return;
    }
    if (action === "save-key") {
      setApiKey("");
      setMessage({ ok: true, text: `บันทึกคีย์แล้ว · ${balanceLine(r.data.credits)}${syncLine(r.data.sync)}` });
    } else if (action === "test") {
      setMessage({ ok: true, text: `คีย์ใช้งานได้ · ${balanceLine(r.data.credits)}` });
    } else {
      setMessage({ ok: true, text: `ซิงก์โมเดลแล้ว${syncLine(r.data.sync)}` });
    }
    load();
    onChanged();
  };

  const activeKeys = status ? status.keys.filter((k) => k.isActive).length : 0;
  const lastError = status ? status.keys.find((k) => k.lastError)?.lastError ?? null : null;
  const button = (primary: boolean): React.CSSProperties => ({
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
    cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
    border: primary ? "none" : "1px solid rgba(255,255,255,0.15)",
    background: primary ? "linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%)" : "rgba(255,255,255,0.06)",
    color: primary ? "#fff" : "#e2e8f0",
  });

  return (
    <div style={{
      borderRadius: 18, padding: 22, marginBottom: 22,
      background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(139,92,246,0.08))",
      border: "1px solid rgba(165,243,252,0.2)", backdropFilter: "blur(18px)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#a5f3fc", textTransform: "uppercase" }}>ผู้ให้บริการหลัก</div>
          <div style={{ fontSize: 22, fontWeight: 300, color: "#fff", marginTop: 4 }}>KIE.ai — คีย์เดียวใช้ได้ทุกโมเดล</div>
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {status === null
            ? "กำลังโหลด…"
            : `คีย์ที่ใช้งาน ${activeKeys} · โมเดล ${status.models.total}/${status.catalog} · พร้อมขาย ${status.models.ready} · รอทดสอบ ${status.models.tuning}`}
          {!onKiePage && (
            <>
              {" · "}
              <a href="/admin/kie" style={{ color: "#a5f3fc" }}>หน้าจัดการ KIE →</a>
            </>
          )}
        </div>
      </div>
      <p style={{ fontSize: 13, color: "rgba(203,213,225,0.75)", lineHeight: 1.6, margin: "10px 0 14px" }}>
        สร้างคีย์ที่{" "}
        <a href="https://kie.ai/api-key" target="_blank" rel="noreferrer" style={{ color: "#a5f3fc" }}>kie.ai/api-key</a>{" "}
        แล้ววางที่นี่ — ระบบตรวจคีย์กับ KIE (ไม่เสียเครดิต) เก็บแบบเข้ารหัส แล้วสร้างโมเดลทั้งหมดพร้อมราคา
        (ต้นทุน × 2 ที่เรทแพ็กเกจที่ถูกที่สุด). โมเดลใหม่จะ &quot;รอทดสอบ&quot; จนแอดมินสั่งงานสำเร็จ 1 ครั้ง — หรือติ๊กเปิดขายทันที
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder="วาง KIE API key" style={inputStyle} />
        <button type="button" disabled={busy !== null || apiKey.trim().length < 16} onClick={() => run("save-key")} style={button(true)}>
          {busy === "save-key" ? "กำลังตรวจคีย์…" : "บันทึกคีย์ + สร้างโมเดล"}
        </button>
        <button type="button" disabled={busy !== null || activeKeys === 0} onClick={() => run("test")} style={button(false)}>
          {busy === "test" ? "กำลังทดสอบ…" : "ทดสอบคีย์"}
        </button>
        <button type="button" disabled={busy !== null || !status?.provider} onClick={() => run("sync")} style={button(false)}>
          {busy === "sync" ? "กำลังซิงก์…" : "ซิงก์โมเดล/ราคา"}
        </button>
      </div>
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 12, color: "#cbd5e1", cursor: "pointer" }}>
        <input type="checkbox" checked={openNow} onChange={(e) => setOpenNow(e.target.checked)} />
        เปิดขายทุกโมเดลทันทีเมื่อบันทึกคีย์/ซิงก์ (ข้ามการทดสอบทีละโมเดล)
      </label>
      {message && <div style={{ marginTop: 12, fontSize: 13, color: message.ok ? "#6ee7b7" : "#fca5a5" }}>{message.text}</div>}
      {lastError && <div style={{ marginTop: 8, fontSize: 12, color: "#fcd34d" }}>ข้อผิดพลาดล่าสุดของคีย์: {lastError.slice(0, 160)}</div>}
    </div>
  );
}
