"use client";

/**
 * /admin — admin dashboard (X-DREAMER themed)
 *
 * Layout follows the X-DREAMER `DashboardPage` reference: header,
 * 8 hue-mapped stat cards (2x4 grid), seed-data action card, quick
 * actions row.
 *
 * Preserves all features from the previous admin dashboard:
 *   stats fetch from /api/admin/stats, run seed via /api/admin/seed.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

const HUE = 70;

interface Stats {
  totalGenerations: number;
  generationsToday: number;
  totalCreditsUsed: number;
  activeUsers: number;
  totalRevenue: number;
  revenueToday: number;
  providerCosts: number;
  activeAccounts: number;
  errorRate: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats").then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const runSeed = async () => {
    setSeeding(true); setSeedResult(null);
    try {
      const res = await fetch("/api/admin/seed", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSeedResult({ ok: true, msg: `สำเร็จ · ${data.results.providers} providers · ${data.results.models} models · ${data.results.packages} packages · ${data.results.styles} styles · ${data.results.settings} settings` });
        fetch("/api/admin/stats").then(r => r.json()).then(setStats).catch(() => {});
      } else {
        setSeedResult({ ok: false, msg: data.error || "ผิดพลาด" });
      }
    } catch {
      setSeedResult({ ok: false, msg: "ไม่สามารถเชื่อมต่อ API ได้" });
    }
    setSeeding(false);
  };

  // 8 stat cards mapped onto the X-DREAMER hue palette
  const cards = [
    { l: "Generations วันนี้", v: stats?.generationsToday ?? 0, hue: 160, suffix: "" },
    { l: "Generations ทั้งหมด", v: stats?.totalGenerations ?? 0, hue: 200, suffix: "" },
    { l: "Credits ที่ใช้", v: stats?.totalCreditsUsed ?? 0, hue: 30, suffix: " ✦" },
    { l: "Active Users", v: stats?.activeUsers ?? 0, hue: 220, suffix: " 👤" },
    { l: "รายได้วันนี้", v: stats?.revenueToday ?? 0, hue: 130, suffix: " ฿" },
    { l: "รายได้ทั้งหมด", v: stats?.totalRevenue ?? 0, hue: 140, suffix: " ฿" },
    { l: "ต้นทุน API", v: stats?.providerCosts ?? 0, hue: 30, suffix: " $" },
    { l: "Error Rate", v: `${stats?.errorRate ?? 0}%`, hue: 350, suffix: "" },
  ];

  return (
    <div style={{ color: "#f1f5f9" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 8 }}>· admin · ภาพรวมระบบ</div>
        <h1 style={{ fontSize: "clamp(32px, 4vw, 48px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", margin: 0 }}>
          แดชบอร์ด<span className="xdr-italic-th" style={{ fontStyle: "italic", color: "#c4b5fd", marginLeft: 12 }}>ผู้ดูแล</span>
        </h1>
      </div>

      {/* 8 Stat cards (2x4) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }} className="rp-stat-grid">
        {cards.map((card, i) => {
          const h = (card.hue + HUE) % 360;
          return (
            <div key={i} style={{
              padding: 22, borderRadius: 16, position: "relative", overflow: "hidden",
              background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
              backdropFilter: "blur(18px)",
            }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 90, height: 90, background: `radial-gradient(circle, hsla(${h},70%,55%,0.4), transparent 70%)`, filter: "blur(12px)" }} />
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.05em" }}>{card.l}</div>
              <div style={{ fontSize: 32, fontWeight: 300, color: "#fff", marginTop: 6, letterSpacing: "-0.02em" }}>
                {typeof card.v === "number" ? card.v.toLocaleString() : card.v}
                {card.suffix && <span style={{ fontSize: 14, color: `hsl(${h},70%,75%)`, marginLeft: 4 }}>{card.suffix}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Seed data card */}
      <div style={{
        padding: 28, borderRadius: 22, marginBottom: 32,
        background: `linear-gradient(160deg, hsla(${260 + HUE},60%,22%,0.5), hsla(${300 + HUE},60%,15%,0.5))`,
        border: `1px solid hsla(${280 + HUE},60%,55%,0.35)`,
        backdropFilter: "blur(18px)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: `hsla(${280 + HUE},60%,40%,0.4)`, border: "1px solid rgba(255,255,255,0.1)", display: "grid", placeItems: "center", fontSize: 18, color: `hsl(${280 + HUE},80%,80%)` }}>▣</span>
              <h2 style={{ fontSize: 18, fontWeight: 500, color: "#fff", margin: 0 }}>ข้อมูลเริ่มต้น (Seed Data)</h2>
            </div>
            <p style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", margin: "6px 0 0 48px" }}>
              สร้าง Providers · Models · Packages · Styles · Settings ทั้งหมดในครั้งเดียว
            </p>
          </div>
          <button onClick={runSeed} disabled={seeding}
            style={{
              padding: "12px 22px", borderRadius: 12,
              background: `linear-gradient(135deg, hsl(${260 + HUE},70%,55%), hsl(${300 + HUE},70%,60%))`,
              color: "#fff", border: "none", fontSize: 13, fontWeight: 600,
              cursor: seeding ? "wait" : "pointer", opacity: seeding ? 0.7 : 1,
              boxShadow: `0 12px 30px -10px hsla(${280 + HUE},80%,50%,0.55)`,
              flexShrink: 0,
            }}>
            {seeding ? "⟳ กำลังสร้าง..." : "✦ สร้างข้อมูลเริ่มต้น"}
          </button>
        </div>
        {seedResult && (
          <div style={{
            marginTop: 16, padding: "12px 16px", borderRadius: 10,
            background: seedResult.ok ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${seedResult.ok ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.3)"}`,
            color: seedResult.ok ? "#34d399" : "#fca5a5",
            fontSize: 12,
          }}>
            {seedResult.msg}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div style={{
        padding: 28, borderRadius: 22,
        background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(18px)",
      }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 18 }}>· ดำเนินการด่วน</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }} className="rp-actions-grid">
          {[
            { href: "/admin/providers", label: "จัดการ Providers", icon: "⚙", hue: 200, desc: "เพิ่ม / แก้ไข AI providers" },
            { href: "/admin/pools", label: "Account Pools", icon: "▣", hue: 270, desc: "จัดการ pool ของแต่ละ provider" },
            { href: "/admin/packages", label: "แพ็กเกจเครดิต", icon: "✧", hue: 30, desc: "ราคา / โบนัส / sort order" },
            { href: "/admin/models", label: "โมเดล AI", icon: "✦", hue: 160, desc: "เปิดปิด · ตั้งราคา credits" },
            { href: "/admin/analytics", label: "สถิติ", icon: "▧", hue: 220, desc: "การใช้งาน · รายได้ · trends" },
            { href: "/admin/settings", label: "ตั้งค่าระบบ", icon: "⚛", hue: 290, desc: "key/value · global config" },
          ].map((a) => {
            const h = (a.hue + HUE) % 360;
            return (
              <Link key={a.href} href={a.href} style={{
                padding: 18, borderRadius: 14,
                background: "rgba(2,6,23,0.4)",
                border: "1px solid rgba(255,255,255,0.06)",
                textDecoration: "none", color: "#fff",
                display: "flex", flexDirection: "column", gap: 8,
                transition: "all 200ms",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `hsla(${h},70%,55%,0.4)`; e.currentTarget.style.background = `linear-gradient(135deg, hsla(${h},50%,15%,0.4), hsla(${h + 30},50%,10%,0.4))`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.background = "rgba(2,6,23,0.4)"; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: `radial-gradient(circle at 30% 30%, hsl(${h},70%,55%), hsl(${h + 30},70%,40%))`, display: "grid", placeItems: "center", fontSize: 14, color: "#fff", boxShadow: `0 0 16px hsla(${h},80%,55%,0.4)` }}>
                    {a.icon}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{a.label}</span>
                </div>
                <p style={{ fontSize: 11, color: "rgba(203,213,225,0.6)", margin: "4px 0 0 42px" }}>{a.desc}</p>
              </Link>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 1100px) {
          .rp-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .rp-actions-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 720px) {
          .rp-stat-grid { grid-template-columns: 1fr 1fr !important; gap: 12px !important; }
          .rp-actions-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
