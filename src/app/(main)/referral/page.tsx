"use client";

/**
 * /referral — invite friends (X-DREAMER themed)
 *
 * Layout uses X-DREAMER glass cards + 3-step "How it works" pattern from
 * the landing's HowItWorks section.
 *
 * Preserves all features from the previous referral page:
 *   referral code display, copy/share, stats, apply-code form, list of
 *   referred users.
 */

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast-provider";

const HUE = 70;

interface ReferralStats {
  referralCode: string;
  totalReferred: number;
  totalCommission: number;
  pendingCommission: number;
  commissionRate: number;
  referrals: {
    id: number;
    referredName: string;
    referredEmail: string;
    joinedAt: string;
    totalCommission: number;
    bonusCredits: number;
  }[];
}

export default function ReferralPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyCode, setApplyCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (session === null) router.push("/login"); }, [session, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/referral").then(r => r.json()).then(data => { setStats(data); setLoading(false); }).catch(() => setLoading(false));
  }, [session]);

  const copyCode = async () => {
    if (!stats?.referralCode) return;
    await navigator.clipboard.writeText(stats.referralCode);
    setCopied(true);
    toast("success", "คัดลอกรหัสแล้ว!");
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!stats?.referralCode) return;
    const url = `${window.location.origin}?ref=${stats.referralCode}`;
    if (navigator.share) {
      try { await navigator.share({ title: "X-DREAMER · ชวนเพื่อนรับเครดิตฟรี!", url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast("success", "คัดลอกลิงก์แล้ว!");
    }
  };

  const handleApplyCode = async () => {
    if (!applyCode.trim()) return;
    setApplying(true);
    try {
      const res = await fetch("/api/referral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: applyCode.trim() }) });
      const data = await res.json();
      if (!res.ok) toast("error", data.error || "ไม่สามารถใช้รหัสได้");
      else {
        toast("success", data.message || "ใช้รหัสสำเร็จ!");
        setApplyCode("");
        const statsRes = await fetch("/api/referral");
        const newStats = await statsRes.json();
        setStats(newStats);
      }
    } catch { toast("error", "เกิดข้อผิดพลาด"); }
    setApplying(false);
  };

  if (!session) return null;

  return (
    <div style={{ padding: "30px 48px 80px", maxWidth: 1100, margin: "0 auto", color: "#f1f5f9" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· ชวนเพื่อน</div>
        <h1 style={{ fontSize: "clamp(40px, 6vw, 72px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05, margin: 0 }}>
          ทอความฝัน <span className="xdr-italic-th" style={{ fontStyle: "italic", color: "#c4b5fd" }}>ร่วมกัน</span>
        </h1>
        <p style={{ marginTop: 18, color: "rgba(203,213,225,0.7)", fontSize: 17, fontWeight: 300, maxWidth: 540, margin: "18px auto 0" }}>
          ชวนเพื่อนมาใช้ X-DREAMER · รับเครดิตฟรีทั้งคู่ + ค่าคอมมิชชั่น {stats?.commissionRate || 10}% ตลอดอายุการใช้งาน
        </p>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[1, 2, 3].map(i => (<div key={i} style={{ height: 140, borderRadius: 22, background: "rgba(15,23,42,0.45)", animation: "pulse 1.6s ease-in-out infinite" }} />))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Referral code card */}
          <div style={{
            padding: 32, borderRadius: 22,
            background: `linear-gradient(160deg, hsla(${220 + HUE},60%,22%,0.55), hsla(${280 + HUE},60%,15%,0.55))`,
            border: `1px solid hsla(${220 + HUE},70%,55%,0.4)`,
            backdropFilter: "blur(18px)",
            boxShadow: `0 30px 60px -20px hsla(${220 + HUE},70%,50%,0.35)`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: `hsla(${220 + HUE},60%,40%,0.4)`, display: "grid", placeItems: "center", fontSize: 18, color: `hsl(${220 + HUE},80%,80%)` }}>♢</span>
              <div style={{ fontSize: 14, color: "#fff", fontWeight: 500 }}>รหัสชวนเพื่อนของคุณ</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
              <div style={{ flex: 1, padding: 18, borderRadius: 14, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontFamily: "ui-monospace,monospace", fontWeight: 700, letterSpacing: "0.2em",
                  background: `linear-gradient(120deg, hsl(${160 + HUE},80%,75%), hsl(${280 + HUE},80%,80%))`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  {stats?.referralCode || "---"}
                </div>
              </div>
              <button onClick={copyCode} title="คัดลอกรหัส"
                style={{ width: 56, height: "auto", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: copied ? "#34d399" : "#fff", cursor: "pointer", fontSize: 18 }}>
                {copied ? "✓" : "⎘"}
              </button>
              <button onClick={shareLink} title="แชร์ลิงก์"
                style={{ width: 56, height: "auto", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", fontSize: 18 }}>
                ⎋
              </button>
            </div>
            <p style={{ fontSize: 12, color: "rgba(203,213,225,0.7)", textAlign: "center", marginTop: 14 }}>
              แชร์รหัสนี้ให้เพื่อน · เมื่อเพื่อนสมัครและซื้อเครดิต คุณจะได้รับค่าคอมมิชชั่น {stats?.commissionRate || 10}%
            </p>
          </div>

          {/* Stats — 3 cards */}
          <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              { l: "ชวนแล้ว", v: stats?.totalReferred ?? 0, hue: 200, suffix: " คน" },
              { l: "คอมมิชชั่นรวม", v: stats?.totalCommission ?? 0, hue: 160, suffix: " ✦" },
              { l: "รอดำเนินการ", v: stats?.pendingCommission ?? 0, hue: 30, suffix: " ✦" },
            ].map((s, i) => {
              const h = (s.hue + HUE) % 360;
              return (
                <div key={i} style={{
                  padding: 22, borderRadius: 16, position: "relative", overflow: "hidden",
                  background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
                  backdropFilter: "blur(18px)",
                }}>
                  <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: `radial-gradient(circle, hsla(${h},70%,55%,0.35), transparent 70%)`, filter: "blur(12px)" }} />
                  <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.05em" }}>{s.l}</div>
                  <div style={{ fontSize: 32, fontWeight: 300, color: "#fff", marginTop: 6, letterSpacing: "-0.02em" }}>
                    {s.v.toLocaleString()}<span style={{ fontSize: 14, color: `hsl(${h},70%,75%)`, marginLeft: 4 }}>{s.suffix}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Apply code */}
          <div style={{
            padding: 28, borderRadius: 22,
            background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(18px)",
          }}>
            <div style={{ fontSize: 14, color: "#fff", fontWeight: 500, marginBottom: 6 }}>มีรหัสชวนเพื่อน?</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>กรอกรหัสเพื่อรับเครดิตโบนัส</div>
            <div style={{ display: "flex", gap: 10 }}>
              <input value={applyCode} onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
                placeholder="กรอกรหัสชวนเพื่อน"
                style={{ flex: 1, padding: "12px 16px", borderRadius: 10, background: "rgba(2,6,23,0.5)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", outline: "none" }} />
              <button onClick={handleApplyCode} disabled={!applyCode.trim() || applying}
                style={{ padding: "12px 22px", borderRadius: 10, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: (applying || !applyCode.trim()) ? "not-allowed" : "pointer", opacity: (applying || !applyCode.trim()) ? 0.6 : 1 }}>
                {applying ? "⟳" : "ใช้รหัส"}
              </button>
            </div>
          </div>

          {/* Referrals list */}
          {stats?.referrals && stats.referrals.length > 0 && (
            <div style={{
              padding: 8, borderRadius: 22,
              background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
              backdropFilter: "blur(18px)",
            }}>
              <div style={{ padding: "16px 20px 8px", fontSize: 14, color: "#fff", fontWeight: 500 }}>
                เพื่อนที่ชวนแล้ว <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 6 }}>({stats.referrals.length})</span>
              </div>
              {stats.referrals.map(ref => (
                <div key={ref.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 500 }}>{ref.referredName}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{new Date(ref.joinedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}</div>
                  </div>
                  <div style={{ padding: "4px 12px", borderRadius: 999, background: `hsla(${160 + HUE},70%,40%,0.2)`, color: "#34d399", fontSize: 12, fontWeight: 600 }}>
                    +{ref.totalCommission + ref.bonusCredits} ✦
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* How it works — 3 steps */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 18, textAlign: "center" }}>· วิธีการทำงาน</div>
            <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
              {[
                { n: "01", t: "แชร์รหัส", d: "ส่งรหัสให้คนที่สนใจ", hue: 160 },
                { n: "02", t: "เพื่อนสมัคร", d: "เพื่อนกรอกรหัส ได้เครดิตทั้งคู่", hue: 220 },
                { n: "03", t: "รับคอมมิชชั่น", d: `เมื่อเพื่อนซื้อเครดิต รับ ${stats?.commissionRate || 10}% ทุกครั้ง`, hue: 280 },
              ].map(s => {
                const h = (s.hue + HUE) % 360;
                return (
                  <div key={s.n} style={{ textAlign: "center" }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: 999, margin: "0 auto 18px",
                      background: `radial-gradient(circle at 30% 30%, hsl(${h},80%,65%), hsl(${h + 30},70%,45%))`,
                      boxShadow: `0 0 28px hsla(${h},80%,60%,0.6), inset 0 0 8px rgba(255,255,255,0.3)`,
                      display: "grid", placeItems: "center",
                      fontSize: 14, fontWeight: 700, color: "#fff",
                      border: "1px solid rgba(255,255,255,0.2)",
                    }}>{s.n}</div>
                    <h3 style={{ fontSize: 18, fontWeight: 500, color: "#fff", marginBottom: 8, letterSpacing: "-0.01em" }}>{s.t}</h3>
                    <p style={{ fontSize: 13, lineHeight: 1.5, color: "rgba(203,213,225,0.7)", fontWeight: 300, margin: 0 }}>{s.d}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @media (max-width: 720px) {
          .rp-grid-3 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
