"use client";

/**
 * /pricing — credit packages (X-DREAMER themed)
 *
 * Layout follows the X-DREAMER pricing pattern from the landing page +
 * the bottom credit-cost table.
 *
 * Preserves all features from the previous pricing page:
 *   currency toggle (THB/USD), live packages from /api/packages,
 *   credit-cost breakdown derived from /api/models, wallet hint card.
 */

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

const HUE = 70;
const HUE_BY_SLUG: Record<string, number> = {
  trial: 140, starter: 160, weaver: 200, creator: 220, pro: 260, studio: 280, enterprise: 300,
};

interface Package {
  id: number;
  name: string;
  slug: string;
  credits: number;
  bonusCredits: number;
  priceThb: number;
  priceUsd: number;
  badge: string | null;
  isFeatured: boolean;
  features: string | string[];
  sortOrder: number;
}

interface Model {
  id: number;
  name: string;
  category: string;
  creditsPerUnit: number;
  provider: { name: string };
}

export default function PricingPage() {
  const [currency, setCurrency] = useState<"thb" | "usd">("thb");
  const [packages, setPackages] = useState<Package[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const xmanCheckoutUrl = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

  useEffect(() => {
    Promise.all([
      fetch("/api/packages").then(r => r.json()),
      fetch("/api/models").then(r => r.json()),
    ]).then(([pkgData, modelData]) => {
      setPackages(Array.isArray(pkgData) ? pkgData : pkgData.packages || pkgData);
      setModels(modelData.models || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const creditCosts = useMemo(() => {
    const categories: Record<string, { min: number; max: number; examples: string[] }> = {};
    for (const m of models) {
      const key = m.category;
      if (!categories[key]) categories[key] = { min: Infinity, max: 0, examples: [] };
      categories[key].min = Math.min(categories[key].min, m.creditsPerUnit);
      categories[key].max = Math.max(categories[key].max, m.creditsPerUnit);
      if (categories[key].examples.length < 3) categories[key].examples.push(m.name);
    }
    const labels: Record<string, string> = { image: "สร้างภาพ", video: "สร้างวิดีโอ", edit: "แก้ไขภาพ" };
    return Object.entries(categories).map(([cat, data]) => ({
      type: labels[cat] || cat,
      credits: data.min === data.max ? String(data.min) : `${data.min}-${data.max}`,
      examples: data.examples.join(", "),
    }));
  }, [models]);

  const parseFeatures = (f: string | string[]): string[] => {
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f); } catch { return []; }
  };

  return (
    <div style={{ padding: "30px 48px 80px", maxWidth: 1400, margin: "0 auto", color: "#f1f5f9" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· แผนการใช้งาน</div>
        <h1 style={{ fontSize: "clamp(40px, 6vw, 80px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05, margin: 0 }}>
          เลือกแพ็กเกจ<span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#c4b5fd" }}> ที่ใช่</span>
        </h1>
        <p style={{ marginTop: 18, color: "rgba(203,213,225,0.7)", fontSize: 17, fontWeight: 300, maxWidth: 560, margin: "18px auto 0" }}>
          ซื้อเครดิตใช้สร้างภาพและวิดีโอ AI · ไม่มีวันหมดอายุ · ใช้ได้ทุก Provider
        </p>

        {/* Currency toggle */}
        <div style={{ display: "inline-flex", gap: 4, marginTop: 28, padding: 4, borderRadius: 999, background: "rgba(2,6,23,0.5)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {([["thb", "฿ THB"], ["usd", "$ USD"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setCurrency(key)}
              style={{
                padding: "7px 18px", borderRadius: 999, fontSize: 12, cursor: "pointer", border: "none",
                background: currency === key ? `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))` : "transparent",
                color: currency === key ? "#fff" : "#94a3b8", fontWeight: 500,
              }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Packages */}
      {loading ? (
        <div className="rp-grid-pkg" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginBottom: 64 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: 380, borderRadius: 22, background: "rgba(15,23,42,0.45)", border: "1px solid rgba(255,255,255,0.05)", animation: "pulse 1.6s ease-in-out infinite" }} />
          ))}
        </div>
      ) : (
        <div className="rp-grid-pkg" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(packages.length || 1, 5)}, 1fr)`, gap: 20, marginBottom: 64 }}>
          {packages.map(pkg => {
            const features = parseFeatures(pkg.features);
            const slug = pkg.slug || String(pkg.id);
            const h = ((HUE_BY_SLUG[slug] ?? 220) + HUE) % 360;
            const isFree = Number(pkg.priceThb) === 0;
            const pop = pkg.isFeatured;
            const href = isFree ? "/generate" : `${xmanCheckoutUrl}/checkout/ai-credits/${slug}?ref=ai`;
            return (
              <div key={pkg.id} style={{
                padding: 32, borderRadius: 22, position: "relative",
                background: pop
                  ? `linear-gradient(160deg, hsla(${h},60%,20%,0.65), hsla(${h + 40},60%,12%,0.65))`
                  : "rgba(15,23,42,0.45)",
                border: pop ? `1px solid hsla(${h},70%,55%,0.5)` : "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(18px)",
                boxShadow: pop ? `0 30px 60px -20px hsla(${h},70%,50%,0.35)` : "none",
                display: "flex", flexDirection: "column",
              }}>
                {pkg.badge && (
                  <div style={{ position: "absolute", top: -12, left: 24, padding: "4px 12px", borderRadius: 999, background: `linear-gradient(90deg, hsl(${h},80%,60%), hsl(${h + 40},80%,65%))`, fontSize: 11, fontWeight: 600, color: "#fff", letterSpacing: "0.08em" }}>
                    {pkg.badge}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#a5f3fc", letterSpacing: "0.08em", marginBottom: 14 }}>{pkg.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 18 }}>
                  <div style={{ fontSize: 38, fontWeight: 300, color: "#fff", letterSpacing: "-0.02em" }}>
                    {currency === "thb" ? `฿${Number(pkg.priceThb).toLocaleString()}` : `$${Number(pkg.priceUsd)}`}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
                  ✦ {pkg.credits.toLocaleString()}{pkg.bonusCredits > 0 && (
                    <span style={{ color: `hsl(${h},80%,75%)` }}> + {pkg.bonusCredits.toLocaleString()} โบนัส</span>
                  )} เครดิต
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", flex: 1 }}>
                  {features.map(f => (
                    <li key={f} style={{ fontSize: 13, color: "rgba(226,232,240,0.8)", marginBottom: 8, display: "flex", gap: 10, fontWeight: 300 }}>
                      <span style={{ color: `hsl(${h},80%,70%)`, flexShrink: 0 }}>✦</span> {f}
                    </li>
                  ))}
                </ul>
                {isFree ? (
                  <Link href={href} style={{ display: "block", textAlign: "center", width: "100%", padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
                    เริ่มใช้ฟรี →
                  </Link>
                ) : (
                  <a href={href} style={{
                    display: "block", textAlign: "center", width: "100%", padding: 14, borderRadius: 12,
                    background: pop
                      ? `linear-gradient(135deg, hsl(${h},70%,50%), hsl(${h + 40},70%,60%))`
                      : "rgba(255,255,255,0.06)",
                    color: "#fff", border: pop ? "none" : "1px solid rgba(255,255,255,0.15)",
                    textDecoration: "none", fontSize: 14, fontWeight: 600,
                  }}>{pop ? "เริ่มทอเลย →" : "เลือกแผนนี้ →"}</a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Credit cost table */}
      {creditCosts.length > 0 && (
        <div style={{
          padding: 32, borderRadius: 22,
          background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(18px)", marginBottom: 24,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: `linear-gradient(135deg, hsla(${160 + HUE},60%,30%,0.4), hsla(${280 + HUE},60%,25%,0.4))`, border: "1px solid rgba(255,255,255,0.08)", display: "grid", placeItems: "center", color: `hsl(${220 + HUE},70%,75%)`, fontSize: 18 }}>
              ✦
            </div>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 500, color: "#fff", margin: 0 }}>ตารางเครดิต</h2>
              <p style={{ fontSize: 12, color: "#94a3b8", margin: "2px 0 0" }}>เครดิตที่ใช้ขึ้นอยู่กับโมเดลและคุณภาพ</p>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: "#94a3b8", fontWeight: 500, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>ประเภท</th>
                  <th style={{ textAlign: "center", padding: "12px 16px", color: "#94a3b8", fontWeight: 500, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>เครดิต/ครั้ง</th>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: "#94a3b8", fontWeight: 500, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>ตัวอย่างโมเดล</th>
                </tr>
              </thead>
              <tbody>
                {creditCosts.map(row => (
                  <tr key={row.type} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 500, color: "#f1f5f9" }}>{row.type}</td>
                    <td style={{ padding: "14px 16px", textAlign: "center" }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, background: `hsla(${220 + HUE},60%,50%,0.2)`, color: `hsl(${220 + HUE},80%,80%)`, fontSize: 12, fontWeight: 600 }}>
                        {row.credits}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: 12, color: "#94a3b8" }}>{row.examples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Wallet hint */}
      <div style={{
        padding: 22, borderRadius: 18,
        background: `linear-gradient(135deg, hsla(${160 + HUE},60%,20%,0.35), hsla(${280 + HUE},60%,18%,0.35))`,
        border: `1px solid hsla(${220 + HUE},60%,55%,0.25)`,
        backdropFilter: "blur(18px)",
        display: "flex", gap: 16, alignItems: "flex-start",
      }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, hsla(${160 + HUE},70%,50%,0.4), hsla(${280 + HUE},70%,55%,0.4))`, border: "1px solid rgba(255,255,255,0.1)", display: "grid", placeItems: "center", flexShrink: 0, color: "#fff", fontSize: 20 }}>
          ✦
        </div>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#fff", margin: "0 0 6px" }}>ใช้ Wallet จาก XMAN Studio ได้</h3>
          <p style={{ fontSize: 13, color: "rgba(203,213,225,0.78)", margin: 0, lineHeight: 1.55 }}>
            หากคุณมี Wallet balance ที่{" "}
            <a href="https://xman4289.com" target="_blank" rel="noopener noreferrer" style={{ color: "#a5f3fc", textDecoration: "none" }}>xman4289.com</a>{" "}
            สามารถใช้จ่ายซื้อเครดิตได้โดยตรงผ่านหน้าชำระเงิน
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @media (max-width: 1024px) {
          .rp-grid-pkg { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 720px) {
          .rp-grid-pkg { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
