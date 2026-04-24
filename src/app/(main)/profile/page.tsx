"use client";

/**
 * /profile — user dashboard (X-DREAMER themed)
 *
 * Layout follows the X-DREAMER `DashboardPage` reference: hero header,
 * 4 stat cards, recent works grid, usage chart, transaction history.
 *
 * Preserves all features from the previous profile page:
 *   credits info (balance + bought + used + bonus), recent generations,
 *   credit transaction history.
 */

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const HUE = 70;

interface CreditInfo { balance: number; totalBought: number; totalUsed: number; totalBonus: number; }
interface Generation { id: number; type: string; status: string; prompt: string; resultUrl: string | null; thumbnailUrl: string | null; model: { name: string; provider: { name: string } }; creditsUsed: number; createdAt: string; }
interface Transaction { id: number; type: string; amount: number; balanceAfter: number; description: string | null; createdAt: string; }

const transactionTypeLabels: Record<string, string> = {
  purchase: "ซื้อเครดิต", usage: "ใช้เครดิต", bonus: "โบนัส",
  admin_adjust: "ปรับโดยแอดมิน", refund: "คืนเครดิต",
  referral_commission: "ค่าคอมมิชชั่น",
};

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(true);
  const [loadingGens, setLoadingGens] = useState(true);
  const [loadingTxns, setLoadingTxns] = useState(true);

  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/credits").then(r => r.json()).then(data => { setCredits(data); setLoadingCredits(false); }).catch(() => setLoadingCredits(false));
    fetch("/api/gallery?limit=8").then(r => r.json()).then(data => { setGenerations(data.data || []); setLoadingGens(false); }).catch(() => setLoadingGens(false));
    fetch("/api/credits/history").then(r => r.json()).then(data => { setTransactions(data.data || []); setLoadingTxns(false); }).catch(() => setLoadingTxns(false));
  }, [status]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", border: `3px solid hsla(${220 + HUE},70%,60%,0.2)`, borderTopColor: `hsl(${220 + HUE},70%,60%)`, animation: "spin 1s linear infinite" }} />
        <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const user = session?.user;
  const initial = user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "?";
  const usedPct = credits && credits.totalBought > 0 ? Math.min(100, (credits.totalUsed / credits.totalBought) * 100) : 0;

  // Build 4 X-DREAMER stat cards
  const statCards = [
    { l: "เครดิตคงเหลือ", v: credits ? credits.balance.toLocaleString() : "—", d: credits ? `จาก ${credits.totalBought.toLocaleString()} ซื้อมา` : "", hue: 200 },
    { l: "ผลงานทั้งหมด", v: generations.length > 0 ? `${generations.length}+` : "—", d: "ทอด้วยจินตนาการ", hue: 160 },
    { l: "เครดิตที่ใช้", v: credits ? credits.totalUsed.toLocaleString() : "—", d: credits ? `${usedPct.toFixed(0)}% ของที่ซื้อ` : "", hue: 290 },
    { l: "โบนัส", v: credits ? credits.totalBonus.toLocaleString() : "—", d: "จาก referral / promo", hue: 260 },
  ];

  return (
    <div style={{ padding: "30px 48px 80px", maxWidth: 1400, margin: "0 auto", color: "#f1f5f9" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 40, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{
            width: 80, height: 80, borderRadius: "50%",
            background: `conic-gradient(from 180deg, hsl(${160 + HUE},70%,55%), hsl(${220 + HUE},70%,60%), hsl(${280 + HUE},70%,55%), hsl(${160 + HUE},70%,55%))`,
            padding: 3, flexShrink: 0,
          }}>
            <div style={{
              width: "100%", height: "100%", borderRadius: "50%",
              background: `linear-gradient(135deg, hsl(${220 + HUE},50%,15%), hsl(${280 + HUE},50%,8%))`,
              display: "grid", placeItems: "center",
              fontSize: 32, fontWeight: 300, color: `hsl(${220 + HUE},70%,75%)`,
            }}>{initial}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 6 }}>· สวัสดี, {user?.name || "ผู้ทอฝัน"}</div>
            <h1 style={{ fontSize: 42, fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", margin: 0 }}>
              ปราสาทแห่งความคิด <span className="xdr-italic-th" style={{ fontStyle: "italic", color: "#c4b5fd" }}>ของคุณ</span>
            </h1>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{user?.email}</div>
          </div>
        </div>
        <Link href="/generate" style={{
          padding: "12px 22px", borderRadius: 12,
          background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`,
          color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "none",
          boxShadow: `0 12px 30px -10px hsla(${270 + HUE},80%,50%,0.6)`,
        }}>+ เริ่มงานใหม่</Link>
      </div>

      {/* Stat cards (4) */}
      <div className="rp-stat-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 40 }}>
        {statCards.map((s, i) => {
          const h = (s.hue + HUE) % 360;
          return (
            <div key={i} style={{
              padding: 22, borderRadius: 16, position: "relative", overflow: "hidden",
              background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
              backdropFilter: "blur(18px)",
            }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 90, height: 90, background: `radial-gradient(circle, hsla(${h},70%,55%,0.4), transparent 70%)`, filter: "blur(12px)" }} />
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.05em" }}>{s.l}</div>
              <div style={{ fontSize: 36, fontWeight: 300, color: "#fff", marginTop: 6, letterSpacing: "-0.02em" }}>{loadingCredits && s.v === "—" ? "..." : s.v}</div>
              <div style={{ fontSize: 11, color: `hsl(${h},70%,65%)`, marginTop: 4 }}>{s.d}</div>
            </div>
          );
        })}
      </div>

      {/* Main 2-col grid */}
      <div className="rp-dash-main" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 24 }}>
        {/* Recent works */}
        <div style={{
          padding: 24, borderRadius: 20,
          background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(18px)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 15, color: "#fff", fontWeight: 500 }}>ผลงานล่าสุด</div>
            <Link href="/gallery" style={{ fontSize: 12, color: "#a5f3fc", textDecoration: "none" }}>ดูทั้งหมด →</Link>
          </div>
          {loadingGens ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ aspectRatio: "1", borderRadius: 10, background: "rgba(255,255,255,0.04)", animation: "pulse 1.6s ease-in-out infinite" }} />
              ))}
            </div>
          ) : generations.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ width: 70, height: 70, borderRadius: 18, margin: "0 auto 16px", background: `linear-gradient(135deg, hsla(${160 + HUE},60%,20%,0.4), hsla(${280 + HUE},60%,15%,0.4))`, border: "1px solid rgba(255,255,255,0.08)", display: "grid", placeItems: "center", fontSize: 28, color: `hsl(${220 + HUE},70%,75%)` }}>▧</div>
              <p style={{ fontSize: 13, color: "rgba(203,213,225,0.6)", marginBottom: 14 }}>ยังไม่มีผลงาน</p>
              <Link href="/generate" style={{ display: "inline-block", padding: "10px 22px", borderRadius: 10, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`, color: "#fff", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
                ✦ เริ่มสร้าง
              </Link>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {generations.slice(0, 8).map((gen, i) => {
                const hue = (gen.id * 37 + HUE) % 360;
                const h2 = (hue + 60) % 360;
                return (
                  <Link key={gen.id} href="/gallery" style={{
                    aspectRatio: "1", borderRadius: 10, position: "relative", overflow: "hidden",
                    background: `linear-gradient(135deg, hsl(${hue},55%,16%), hsl(${h2},55%,9%))`,
                    border: "1px solid rgba(255,255,255,0.06)",
                    cursor: "pointer", display: "block", textDecoration: "none",
                  }}>
                    {gen.resultUrl || gen.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={gen.thumbnailUrl || gen.resultUrl || ""} alt={gen.prompt}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.85 }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 24, color: "rgba(255,255,255,0.3)" }}>▧</div>
                    )}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 8, background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.7))" }}>
                      <div style={{ fontSize: 9, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        ✦ {gen.creditsUsed} · {gen.model?.name?.slice(0, 10)}
                      </div>
                    </div>
                    <span style={{ display: "none" }}>{i}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: usage breakdown + credit balance highlight */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{
            padding: 24, borderRadius: 20,
            background: `linear-gradient(160deg, hsla(${220 + HUE},60%,22%,0.55), hsla(${280 + HUE},60%,15%,0.55))`,
            border: `1px solid hsla(${220 + HUE},70%,55%,0.4)`,
            backdropFilter: "blur(18px)",
            boxShadow: `0 30px 60px -20px hsla(${220 + HUE},70%,50%,0.35)`,
          }}>
            <div style={{ fontSize: 11, color: "#a5f3fc", letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 10 }}>· เครดิต</div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <div style={{ fontSize: 44, fontWeight: 200, color: "#fff", letterSpacing: "-0.02em" }}>{credits ? credits.balance.toLocaleString() : "—"}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>คงเหลือ</div>
            </div>
            <div style={{ marginTop: 14, height: 5, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${100 - usedPct}%`, height: "100%", background: `linear-gradient(90deg, hsl(${160 + HUE},70%,55%), hsl(${280 + HUE},70%,60%))` }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", marginTop: 6 }}>
              <span>ใช้ไป {usedPct.toFixed(0)}%</span>
              <span>ทั้งหมด {credits ? credits.totalBought.toLocaleString() : "—"}</span>
            </div>
            <Link href="/pricing" style={{ display: "block", textAlign: "center", marginTop: 16, padding: "12px 0", borderRadius: 10, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
              ✦ เติมเครดิต
            </Link>
          </div>

          <div style={{
            padding: 22, borderRadius: 20,
            background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(18px)",
          }}>
            <div style={{ fontSize: 13, color: "#fff", fontWeight: 500, marginBottom: 14 }}>เมนูด่วน</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { href: "/generate", l: "สร้างผลงานใหม่", i: "✦" },
                { href: "/gallery", l: "ดูแกลเลอรี", i: "▧" },
                { href: "/pricing", l: "ซื้อเครดิต", i: "💳" },
                { href: "/referral", l: "ชวนเพื่อน รับเครดิต", i: "♢" },
              ].map(it => (
                <Link key={it.href} href={it.href} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px",
                  borderRadius: 10, background: "rgba(2,6,23,0.4)", border: "1px solid rgba(255,255,255,0.05)",
                  color: "#e2e8f0", textDecoration: "none", fontSize: 13, transition: "background 200ms",
                }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(2,6,23,0.4)"}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "#a5f3fc", width: 16, display: "inline-block" }}>{it.i}</span>{it.l}
                  </span>
                  <span style={{ color: "#475569", fontSize: 14 }}>→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Transaction history */}
      <div style={{ marginTop: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 15, color: "#fff", fontWeight: 500 }}>ประวัติเครดิต</div>
        </div>
        <div style={{
          padding: 8, borderRadius: 18,
          background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(18px)", overflow: "hidden",
        }}>
          {loadingTxns ? (
            <div style={{ padding: 20 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ height: 56, borderRadius: 10, marginBottom: 8, background: "rgba(255,255,255,0.04)", animation: "pulse 1.6s ease-in-out infinite" }} />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, margin: "0 auto 14px", background: "rgba(2,6,23,0.4)", display: "grid", placeItems: "center", fontSize: 24, color: "#475569" }}>📜</div>
              <p style={{ fontSize: 13, color: "rgba(203,213,225,0.5)" }}>ยังไม่มีรายการ</p>
            </div>
          ) : (
            transactions.slice(0, 10).map(txn => {
              const positive = txn.amount > 0;
              return (
                <div key={txn.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 500 }}>{transactionTypeLabels[txn.type] || txn.type}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {txn.description || "—"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", marginLeft: 16, flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: positive ? "#34d399" : "#fca5a5" }}>
                      {positive ? "+" : ""}{txn.amount.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", fontFamily: "ui-monospace,monospace" }}>
                      {new Date(txn.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 1024px) {
          .rp-dash-main { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 720px) {
          .rp-stat-4 { grid-template-columns: repeat(2,1fr) !important; gap: 12px !important; }
        }
      `}</style>
    </div>
  );
}
