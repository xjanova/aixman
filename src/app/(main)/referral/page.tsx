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

import { PageHero } from "@/components/xdreamer/page-hero";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast-provider";
import { loginHref } from "@/lib/safe-callback";
import { useLocale, useT } from "@/lib/i18n/client";
import { formatDate, formatNumber, type Translate } from "@/lib/i18n/locale";

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

/*
 * Network calls live outside the component and return failures as values:
 * React Compiler gives up on a whole component whose try/catch contains a
 * value block (`||`, `??`, `?.`, a ternary), silently — see the note above
 * `fetchAnalytics` in admin/gpu/page.tsx and `react-hooks/todo` in
 * eslint.config.mjs.
 */

async function postReferralCode(
  code: string,
  t: Translate,
): Promise<{ status: "applied" | "rejected"; message: string } | { status: "error" }> {
  try {
    const res = await fetch("/api/referral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const data = await res.json();
    return res.ok
      ? { status: "applied", message: data.message || t("ใช้รหัสสำเร็จ!", "Code applied!") }
      : { status: "rejected", message: data.error || t("ไม่สามารถใช้รหัสได้", "This code can't be used.") };
  } catch {
    return { status: "error" };
  }
}

async function fetchReferralStats(): Promise<{ ok: true; stats: ReferralStats } | { ok: false }> {
  try {
    const res = await fetch("/api/referral");
    return { ok: true, stats: (await res.json()) as ReferralStats };
  } catch {
    return { ok: false };
  }
}

export default function ReferralPage() {
  const t = useT();
  const { locale } = useLocale();
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyCode, setApplyCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (session === null) router.push(loginHref()); }, [session, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/referral").then(r => r.json()).then(data => { setStats(data); setLoading(false); }).catch(() => setLoading(false));
  }, [session]);

  const copyCode = async () => {
    if (!stats?.referralCode) return;
    await navigator.clipboard.writeText(stats.referralCode);
    setCopied(true);
    toast("success", t("คัดลอกรหัสแล้ว!", "Code copied!"));
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!stats?.referralCode) return;
    const url = `${window.location.origin}?ref=${stats.referralCode}`;
    if (navigator.share) {
      const title = t("X-DREAMER · ชวนเพื่อนรับเครดิตฟรี!", "X-DREAMER · Invite friends, get free credits!");
      try { await navigator.share({ title, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast("success", t("คัดลอกลิงก์แล้ว!", "Link copied!"));
    }
  };

  const handleApplyCode = async () => {
    if (!applyCode.trim()) return;
    setApplying(true);
    const result = await postReferralCode(applyCode.trim(), t);
    if (result.status === "error") toast("error", t("เกิดข้อผิดพลาด", "Something went wrong."));
    else if (result.status === "rejected") toast("error", result.message);
    else {
      toast("success", result.message);
      setApplyCode("");
      const refreshed = await fetchReferralStats();
      if (refreshed.ok) setStats(refreshed.stats);
      else toast("error", t("เกิดข้อผิดพลาด", "Something went wrong."));
    }
    setApplying(false);
  };

  if (!session) return null;

  return (
    <>
      <PageHero
        image="/showcase/referral-art.jpg"
        eyebrow={t("· ชวนเพื่อน", "· Invite friends")}
        title={t("ทอความฝัน", "Weave dreams")}
        emphasis={t("ร่วมกัน", "together")}
        hue={300}
        sub={t(
          `ชวนเพื่อนมาใช้ X-DREAMER · รับเครดิตฟรีทั้งคู่ + ค่าคอมมิชชั่น ${stats?.commissionRate || 10}% ตลอดอายุการใช้งาน`,
          `Invite friends to X-DREAMER · You both get free credits, plus ${stats?.commissionRate || 10}% commission for life`,
        )}
      />

      <div style={{ padding: "0 48px 80px", maxWidth: 1100, margin: "0 auto", color: "#f1f5f9" }}>

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
              <div style={{ fontSize: 14, color: "#fff", fontWeight: 500 }}>{t("รหัสชวนเพื่อนของคุณ", "Your referral code")}</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
              <div style={{ flex: 1, padding: 18, borderRadius: 14, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontFamily: "ui-monospace,monospace", fontWeight: 700, letterSpacing: "0.2em",
                  background: `linear-gradient(120deg, hsl(${160 + HUE},80%,75%), hsl(${280 + HUE},80%,80%))`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  {stats?.referralCode || "---"}
                </div>
              </div>
              <button onClick={copyCode} title={t("คัดลอกรหัส", "Copy code")} aria-label={t("คัดลอกรหัส", "Copy code")}
                style={{ width: 56, height: "auto", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: copied ? "#34d399" : "#fff", cursor: "pointer", fontSize: 18 }}>
                {copied ? "✓" : "⎘"}
              </button>
              <button onClick={shareLink} title={t("แชร์ลิงก์", "Share link")} aria-label={t("แชร์ลิงก์", "Share link")}
                style={{ width: 56, height: "auto", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", fontSize: 18 }}>
                ⎋
              </button>
            </div>
            <p style={{ fontSize: 12, color: "rgba(203,213,225,0.7)", textAlign: "center", marginTop: 14 }}>
              {t(
                `แชร์รหัสนี้ให้เพื่อน · เมื่อเพื่อนสมัครและซื้อเครดิต คุณจะได้รับค่าคอมมิชชั่น ${stats?.commissionRate || 10}%`,
                `Share this code with friends · When they sign up and buy credits, you earn ${stats?.commissionRate || 10}% commission`,
              )}
            </p>
          </div>

          {/* Stats — 3 cards */}
          <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              {
                l: t("ชวนแล้ว", "Invited"),
                v: stats?.totalReferred ?? 0,
                hue: 200,
                suffix: t(" คน", (stats?.totalReferred ?? 0) === 1 ? " friend" : " friends"),
              },
              { l: t("คอมมิชชั่นรวม", "Total commission"), v: stats?.totalCommission ?? 0, hue: 160, suffix: " ✦" },
              { l: t("รอดำเนินการ", "Pending"), v: stats?.pendingCommission ?? 0, hue: 30, suffix: " ✦" },
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
                    {formatNumber(s.v, locale)}<span style={{ fontSize: 14, color: `hsl(${h},70%,75%)`, marginLeft: 4 }}>{s.suffix}</span>
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
            <div style={{ fontSize: 14, color: "#fff", fontWeight: 500, marginBottom: 6 }}>{t("มีรหัสชวนเพื่อน?", "Have a referral code?")}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>{t("กรอกรหัสเพื่อรับเครดิตโบนัส", "Enter it to get bonus credits")}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <input value={applyCode} onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
                placeholder={t("กรอกรหัสชวนเพื่อน", "Enter a referral code")}
                style={{ flex: 1, padding: "12px 16px", borderRadius: 10, background: "rgba(2,6,23,0.5)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", outline: "none" }} />
              <button onClick={handleApplyCode} disabled={!applyCode.trim() || applying}
                style={{ padding: "12px 22px", borderRadius: 10, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: (applying || !applyCode.trim()) ? "not-allowed" : "pointer", opacity: (applying || !applyCode.trim()) ? 0.6 : 1 }}>
                {applying ? "⟳" : t("ใช้รหัส", "Apply")}
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
                {t("เพื่อนที่ชวนแล้ว", "Friends you've invited")} <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 6 }}>({stats.referrals.length})</span>
              </div>
              {stats.referrals.map(ref => (
                <div key={ref.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 500 }}>{ref.referredName}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{formatDate(ref.joinedAt, locale, { day: "numeric", month: "short", year: "2-digit" })}</div>
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
            <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 18, textAlign: "center" }}>{t("· วิธีการทำงาน", "· How it works")}</div>
            <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
              {[
                { n: "01", t: t("แชร์รหัส", "Share your code"), d: t("ส่งรหัสให้คนที่สนใจ", "Send it to anyone who's interested"), hue: 160 },
                { n: "02", t: t("เพื่อนสมัคร", "Your friend joins"), d: t("เพื่อนกรอกรหัส ได้เครดิตทั้งคู่", "They enter your code and you both get credits"), hue: 220 },
                {
                  n: "03",
                  t: t("รับคอมมิชชั่น", "Earn commission"),
                  d: t(
                    `เมื่อเพื่อนซื้อเครดิต รับ ${stats?.commissionRate || 10}% ทุกครั้ง`,
                    `Get ${stats?.commissionRate || 10}% every time they buy credits`,
                  ),
                  hue: 280,
                },
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
    </>
  );
}
