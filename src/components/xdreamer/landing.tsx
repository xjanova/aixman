"use client";

/**
 * X-DREAMER Landing.
 *
 * Composition lives here; the media-led sections (hero, provider proof,
 * mode cards, showcase wall, FAQ) live in ./sections.tsx and read their
 * content from @/lib/showcase.
 *
 * Previously every visual on this page was drawn procedurally — canvas
 * gradients and SVG thread scribbles standing in for generated work. That
 * reads as a template. A generation platform's only real proof is its
 * output, so the page now leads with actual frames, each labelled with the
 * prompt and model that produced it.
 *
 * Background fiber-threads are rendered once by the global AmbientBackground
 * in the root layout — this file must not render its own copy.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

import {
  Faq,
  Hero,
  Modes,
  ProviderMarquee,
  Reveal,
  ShowcaseWall,
  StatsBand,
} from "./sections";

const HUE = 70; // base hueShift

const FEATURES = [
  { eyebrow: "01 · FABRIC", title: "เส้นใยเจตจำนง", desc: "ควบคุม prompt ผ่านเส้นใยที่ลากต่อเนื่อง — ปรับแสง, อารมณ์, และเรื่องราวได้แบบ real-time โดยไม่ต้องเริ่มใหม่", hue: 160 },
  { eyebrow: "02 · LOOM", title: "ทอแบบข้ามสื่อ", desc: "เริ่มจากข้อความเป็นภาพ แล้วต่อยอดภาพนั้นเป็นวิดีโอ หรือแก้ไข/ขยายให้คมชัด — ไหลข้ามโมเดลได้เป็นธรรมชาติ", hue: 200 },
  { eyebrow: "03 · DREAM CITADEL", title: "ปราสาทแห่งแนวคิด", desc: "เก็บจินตนาการของคุณเป็นห้องสมุดที่มีชีวิต — แต่ละแนวคิดทอติดกันด้วยเส้นใยความสัมพันธ์ที่ AI มองเห็น", hue: 270 },
];

const STEPS = [
  { n: "01", t: "ทอเส้นใยแรก", d: "เขียน prompt หรือ sketch — ระบบทอเป็นโครงแนวคิด", hue: 160 },
  { n: "02", t: "เลือกผืนผ้า", d: "เลือกโหมด — ภาพ, วิดีโอ, หรือแก้ไข/ขยายภาพ", hue: 200 },
  { n: "03", t: "ปรับผืนผ้า", d: "ลากเส้นใยเพื่อปรับอารมณ์ สี องค์ประกอบ ได้แบบ live", hue: 240 },
  { n: "04", t: "ส่งต่อความฝัน", d: "Export 8K, แชร์ในชุมชน, หรือเก็บในปราสาทส่วนตัว", hue: 280 },
];

type Tier = {
  slug: string;
  name: string;
  price: string;
  note: string;
  feats: string[];
  hue: number;
  pop: boolean;
};

// ─── NAV ────────────────────────────────────────────────────────────────
function Nav() {
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [solid, setSolid] = useState(false);

  // Condense the bar once the hero image has scrolled behind it. Mutating
  // via rAF rather than a scroll-driven setState keeps this off the render
  // path on a page that already runs a canvas background.
  useEffect(() => {
    let raf = 0;
    let last = false;
    const tick = () => {
      const next = window.scrollY > 80;
      if (next !== last) {
        last = next;
        setSolid(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const links = [
    { id: "studio", label: "สตูดิโอ", href: "/generate" },
    { id: "gallery", label: "Gallery", href: "/gallery" },
    { id: "pricing", label: "Pricing", href: "/pricing" },
    { id: "profile", label: "Dashboard", href: "/profile" },
  ];

  return (
    <nav
      className="rp-nav"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        padding: solid ? "13px 48px" : "20px 48px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        backdropFilter: "blur(18px) saturate(1.3)",
        background: solid
          ? "linear-gradient(180deg, rgba(3,6,18,0.92), rgba(3,6,18,0.72))"
          : "linear-gradient(180deg, rgba(3,6,18,0.55), rgba(3,6,18,0))",
        borderBottom: `1px solid rgba(255,255,255,${solid ? 0.07 : 0.02})`,
        transition: "padding 300ms cubic-bezier(0.4,0,0.2,1), background 300ms, border-color 300ms",
      }}
    >
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", cursor: "pointer" }}>
        <Image src="/xdreamer-logo.png" alt="X-DREAMER" width={38} height={38} style={{ borderRadius: 10, objectFit: "cover", boxShadow: "0 0 20px rgba(139,92,246,0.45)" }} />
        <div className="rp-nav-brand" style={{ fontFamily: "var(--font-inter), sans-serif", fontWeight: 900, letterSpacing: "0.22em", fontSize: 14, color: "#fff" }}>X-DREAMER</div>
        <div className="rp-nav-badge" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#94a3b8", padding: "3px 8px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 999, marginLeft: 6 }}>v4 · LIVE</div>
      </Link>
      <div className="rp-nav-links" style={{ display: "flex", gap: 28, fontSize: 14, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>
        {links.map(l => (
          <Link key={l.id} href={l.href} style={{ color: "inherit", textDecoration: "none", cursor: "pointer", paddingBottom: 2, borderBottom: "1px solid transparent" }}>{l.label}</Link>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {session ? (
          <UserMenu name={session.user?.name || "User"} email={session.user?.email || ""} />
        ) : (
          <>
            <Link href="/login" className="rp-nav-cta-ghost" style={{ background: "transparent", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.15)", padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer", textDecoration: "none" }}>เข้าสู่ระบบ</Link>
            <Link href="/login?signup=1" className="rp-nav-cta-primary" style={{ background: "linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%)", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "none", boxShadow: "0 8px 24px -8px rgba(139,92,246,0.6)" }}>เริ่มสร้างฟรี</Link>
          </>
        )}
        <button className="rp-nav-burger" aria-label="เมนู" onClick={() => setMobileOpen(o => !o)}
          style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", fontSize: 18 }}>
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>
      {mobileOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "rgba(8,12,28,0.97)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "12px 18px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
          {links.map(l => (
            <Link key={l.id} href={l.href} onClick={() => setMobileOpen(false)} style={{ padding: "12px 14px", borderRadius: 10, color: "#e2e8f0", textDecoration: "none", fontSize: 15, background: "rgba(255,255,255,0.03)" }}>{l.label}</Link>
          ))}
          {!session && (
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <Link href="/login" onClick={() => setMobileOpen(false)} style={{ flex: 1, textAlign: "center", padding: "12px 14px", borderRadius: 10, color: "#e2e8f0", textDecoration: "none", fontSize: 14, border: "1px solid rgba(255,255,255,0.15)" }}>เข้าสู่ระบบ</Link>
              <Link href="/login?signup=1" onClick={() => setMobileOpen(false)} style={{ flex: 1, textAlign: "center", padding: "12px 14px", borderRadius: 10, color: "#fff", textDecoration: "none", fontSize: 14, background: "linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6)" }}>เริ่มฟรี</Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px 6px 6px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer" }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "conic-gradient(from 180deg, #10b981, #06b6d4, #8b5cf6, #10b981)", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#030612" }}>{(name[0] || "X").toUpperCase()}</div>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
        <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 220, background: "rgba(15,23,42,0.95)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 6, boxShadow: "0 20px 40px -10px rgba(0,0,0,0.5)", zIndex: 60 }}>
          <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 13, color: "#fff", fontWeight: 500 }}>{name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{email}</div>
          </div>
          {[
            { href: "/profile", l: "Dashboard", i: "◈" },
            { href: "/generate", l: "สตูดิโอ", i: "✦" },
            { href: "/gallery", l: "Gallery", i: "▧" },
          ].map(it => (
            <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className="xdr-menu-item">
              <span style={{ color: "#a5f3fc", width: 14, display: "inline-block" }}>{it.i}</span>{it.l}
            </Link>
          ))}
          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "6px 0" }} />
          <button onClick={() => signOut({ callbackUrl: "/" })} className="xdr-menu-item" style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", color: "#fca5a5", fontFamily: "inherit", cursor: "pointer" }}>
            <span style={{ width: 14, display: "inline-block" }}>⎋</span>ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SECTIONS ──────────────────────────────────────────────────────────
function Features() {
  return (
    <section className="rp-section" style={{ position: "relative", padding: "110px 48px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 64, maxWidth: 720 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· สามหลักการ</div>
        <h2 className="rp-h2" style={{ fontSize: "clamp(38px, 4.6vw, 60px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.06 }}>
          เครื่องทอ<span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#6ee7b7" }}> ที่เข้าใจ</span><br />
          ว่าจินตนาการไม่ใช่เส้นตรง
        </h2>
      </div>
      <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
        {FEATURES.map((f, i) => {
          const h1 = (f.hue + HUE) % 360;
          return (
            <div key={i} style={{ position: "relative", padding: 32, borderRadius: 22, background: "rgba(15,23,42,0.45)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(18px)", overflow: "hidden", transition: "all 400ms" }}>
              <svg width="100%" height="120" style={{ position: "absolute", top: -20, left: 0, right: 0, opacity: 0.5 }} viewBox="0 0 400 120" preserveAspectRatio="none">
                {Array.from({ length: 14 }).map((_, j) => {
                  const hh = h1 + j * 4;
                  const sw = 0.5 + (j % 3) * 0.3;
                  const cx = 150 + Math.sin(j) * 50, cy = 40 + j * 3;
                  const sx = -20 + j * 30, ex = 420 - j * 28;
                  return <path key={j} d={`M${sx} 130 Q${cx} ${cy} ${ex} -10`} stroke={`hsl(${hh}, 80%, 65%)`} strokeWidth={sw} fill="none" opacity={0.5} />;
                })}
              </svg>
              <div style={{ position: "relative", marginTop: 90 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.16em", color: `hsl(${h1}, 70%, 70%)`, marginBottom: 14 }}>{f.eyebrow}</div>
                <h3 style={{ fontSize: 28, fontWeight: 500, color: "#fff", marginBottom: 14, letterSpacing: "-0.01em" }}>{f.title}</h3>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: "rgba(203,213,225,0.75)", fontWeight: 300 }}>{f.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="rp-section" style={{ padding: "110px 48px", maxWidth: 1400, margin: "0 auto", position: "relative" }}>
      <div style={{ marginBottom: 60 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· วิธีการทำงาน</div>
        <h2 className="rp-h2" style={{ fontSize: "clamp(38px, 4.6vw, 60px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.06, maxWidth: 720 }}>
          จากความคิด<span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#a5b4fc" }}>...สู่ปราสาท</span><br />
          ในสี่จังหวะ
        </h2>
      </div>
      <div style={{ position: "relative" }}>
        <svg width="100%" height="4" style={{ position: "absolute", top: 22, left: 0, right: 0 }} preserveAspectRatio="none" viewBox="0 0 100 4">
          <line x1="0" y1="2" x2="100" y2="2" stroke="url(#thread-grad)" strokeWidth="0.5" strokeDasharray="0.5 1" />
          <defs>
            <linearGradient id="thread-grad" x1="0" x2="1">
              <stop offset="0%" stopColor={`hsl(${160 + HUE}, 80%, 65%)`} />
              <stop offset="50%" stopColor={`hsl(${220 + HUE}, 80%, 70%)`} />
              <stop offset="100%" stopColor={`hsl(${285 + HUE}, 80%, 70%)`} />
            </linearGradient>
          </defs>
        </svg>
        <div className="rp-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32 }}>
          {STEPS.map((s, i) => {
            const h = (s.hue + HUE) % 360;
            return (
              <div key={i} style={{ position: "relative" }}>
                <div style={{ width: 44, height: 44, borderRadius: 999, background: `radial-gradient(circle at 30% 30%, hsl(${h},80%,65%), hsl(${h + 30},70%,45%))`, boxShadow: `0 0 24px hsla(${h},80%,60%,0.6), inset 0 0 8px rgba(255,255,255,0.3)`, display: "grid", placeItems: "center", fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 24, border: "1px solid rgba(255,255,255,0.2)" }}>{s.n}</div>
                <h3 style={{ fontSize: 22, fontWeight: 500, color: "#fff", marginBottom: 10, letterSpacing: "-0.01em" }}>{s.t}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(203,213,225,0.7)", fontWeight: 300 }}>{s.d}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Pricing({ tiers }: { tiers: Tier[] }) {
  return (
    <section className="rp-section" style={{ padding: "110px 48px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 60 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· แผนการใช้งาน</div>
        <h2 className="rp-h2" style={{ fontSize: "clamp(38px, 4.6vw, 60px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.06 }}>
          เริ่มฟรี — <span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#c4b5fd" }}>จ่ายเมื่อความฝันใหญ่ขึ้น</span>
        </h2>
      </div>
      <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, maxWidth: 1100, margin: "0 auto" }}>
        {tiers.slice(0, 3).map((t, i) => {
          const h = (t.hue + HUE) % 360;
          const isFree = t.price === "ฟรี";
          const href = isFree ? "/login?signup=1" : `https://xman4289.com/checkout/ai-credits/${t.slug}?ref=ai`;
          const label = isFree ? "เริ่มฟรี" : t.pop ? "เริ่มทอเลย" : "เลือกแผนนี้";
          return (
            <div key={i} style={{
              padding: 36, borderRadius: 22, position: "relative",
              background: t.pop
                ? `linear-gradient(160deg, hsla(${h},60%,20%,0.65), hsla(${h + 40},60%,12%,0.65))`
                : "rgba(15,23,42,0.45)",
              border: t.pop ? `1px solid hsla(${h},70%,55%,0.5)` : "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(18px)",
              boxShadow: t.pop ? `0 30px 60px -20px hsla(${h},70%,50%,0.35)` : "none",
            }}>
              {t.pop && (
                <div style={{ position: "absolute", top: -12, left: 24, padding: "4px 12px", borderRadius: 999, background: `linear-gradient(90deg, hsl(${h}, 80%, 60%), hsl(${h + 40}, 80%, 65%))`, fontSize: 11, fontWeight: 600, color: "#fff", letterSpacing: "0.08em" }}>ยอดนิยม</div>
              )}
              <div style={{ fontSize: 14, color: "#a5f3fc", letterSpacing: "0.08em", marginBottom: 18 }}>{t.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 28 }}>
                <div style={{ fontSize: 44, fontWeight: 300, color: "#fff", letterSpacing: "-0.02em" }}>{t.price}</div>
                <div style={{ fontSize: 14, color: "#64748b" }}>{t.note}</div>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 32px" }}>
                {t.feats.map(f => (
                  <li key={f} style={{ fontSize: 14, color: "rgba(226,232,240,0.8)", marginBottom: 10, display: "flex", gap: 10, fontWeight: 300 }}>
                    <span style={{ color: `hsl(${h},80%,70%)`, flexShrink: 0 }}>✦</span> {f}
                  </li>
                ))}
              </ul>
              <a href={href} style={{
                display: "block", textAlign: "center", width: "100%", padding: 14, borderRadius: 12,
                background: t.pop ? `linear-gradient(135deg, hsl(${h},70%,50%), hsl(${h + 40},70%,60%))` : "rgba(255,255,255,0.05)",
                color: "#fff", border: t.pop ? "none" : "1px solid rgba(255,255,255,0.15)",
                fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "none",
              }}>{label}</a>
            </div>
          );
        })}
      </div>
      <p style={{ textAlign: "center", marginTop: 28, fontSize: 13, color: "#64748b" }}>
        ชำระผ่าน XMAN STUDIO · เครดิตแบบจ่ายครั้งเดียวไม่มีวันหมดอายุ ·{" "}
        <Link href="/pricing" style={{ color: "#a5f3fc", textDecoration: "none" }}>ดูทุกแพ็กเกจและตารางค่าเครดิต →</Link>
      </p>
    </section>
  );
}

function FooterCTA() {
  return (
    <section style={{ position: "relative", padding: "150px 48px 80px", textAlign: "center", overflow: "hidden" }}>
      {/* Real frame behind the closing pitch, faded almost to black */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <Image src="/showcase/cta-weave.jpg" alt="" fill priority={false} sizes="100vw" style={{ objectFit: "cover", opacity: 0.5 }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 42%, rgba(3,6,18,0.25) 0%, rgba(3,6,18,0.82) 55%, #030612 100%)" }} />
      </div>

      <div style={{ position: "relative", maxWidth: 900, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(44px, 6.4vw, 88px)", fontWeight: 200, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>
          เริ่มทอความฝัน<br />
          <span className="xdr-italic-th" style={{ fontStyle: "italic", background: `linear-gradient(120deg, hsl(${160 + HUE},80%,70%), hsl(${280 + HUE},80%,75%))`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>ของคุณวันนี้</span>
        </h2>
        <p style={{ marginTop: 26, fontSize: 18, color: "rgba(203,213,225,0.78)", fontWeight: 300 }}>
          เครดิตฟรีต้อนรับเมื่อสมัคร · ไม่ต้องใช้บัตรเครดิต · เริ่มได้ภายใน 30 วินาที
        </p>
        <div style={{ marginTop: 38, display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/login?signup=1" style={{ padding: "16px 32px", borderRadius: 14, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%) 0%, hsl(${220 + HUE},70%,55%) 50%, hsl(${280 + HUE},70%,60%) 100%)`, color: "#fff", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", textDecoration: "none", boxShadow: `0 20px 40px -10px hsla(${220 + HUE},70%,50%,0.6)` }}>สร้างบัญชีฟรี →</Link>
          <Link href="/gallery" style={{ padding: "16px 28px", borderRadius: 14, background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", fontSize: 15, fontWeight: 500, cursor: "pointer", textDecoration: "none", backdropFilter: "blur(10px)" }}>ดู Gallery ทั้งหมด</Link>
        </div>
      </div>

      <div style={{ position: "relative", marginTop: 110, paddingTop: 40, borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 13, maxWidth: 1300, marginLeft: "auto", marginRight: "auto", flexWrap: "wrap", gap: 20 }}>
        <div>© {new Date().getFullYear()} X-DREAMER · ทอด้วย ♥ ในเชียงใหม่ · powered by <a href="https://xman4289.com" style={{ color: "inherit" }}>XMAN STUDIO</a></div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Link href="/pricing" style={{ color: "inherit", textDecoration: "none" }}>Pricing</Link>
          <Link href="/gallery" style={{ color: "inherit", textDecoration: "none" }}>Gallery</Link>
          <Link href="/about" style={{ color: "inherit", textDecoration: "none" }}>เกี่ยวกับ</Link>
          <Link href="/contact" style={{ color: "inherit", textDecoration: "none" }}>ติดต่อ</Link>
          <Link href="/terms" style={{ color: "inherit", textDecoration: "none" }}>ข้อกำหนด</Link>
          <Link href="/privacy" style={{ color: "inherit", textDecoration: "none" }}>ความเป็นส่วนตัว</Link>
        </div>
      </div>
    </section>
  );
}

// ─── ROOT EXPORT ───────────────────────────────────────────────────────
export default function XdreamerLanding({ tiers }: { tiers: Tier[] }) {
  // Toggle "home" body data flag for the global bg layer's hero-boost behavior
  useEffect(() => {
    document.body.dataset.xdrPage = "home";
    return () => { delete document.body.dataset.xdrPage; };
  }, []);

  return (
    <>
      {/* Page-scoped rules. Everything reusable lives in globals.css. */}
      <style jsx global>{`
        html, body { background: #030612; color: #f1f5f9; }
        body { overflow-x: hidden; }
        h1 span[style*="italic"], h2 span[style*="italic"], .xdr-italic-th { padding-bottom:0.15em;padding-right:0.08em;display:inline-block; }
        .xdr-menu-item { display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;font-size:13px;color:#e2e8f0;text-decoration:none;background:transparent;border:none;cursor:pointer;transition:background 150ms; }
        .xdr-menu-item:hover { background:rgba(255,255,255,0.05);color:#fff; }
        .rp-nav-burger { display:none; align-items:center; justify-content:center; }
        @media (max-width:1024px) {
          .rp-nav { padding:14px 20px !important; }
          .rp-nav-links { gap:16px !important;font-size:12px !important; }
          .rp-nav-badge { display:none !important; }
          .rp-nav-brand { font-size:12px !important; }
          .rp-nav-cta-primary, .rp-nav-cta-ghost { padding:8px 14px !important;font-size:12px !important;white-space:nowrap !important; }
          .rp-container { padding:0 24px !important; }
          .rp-grid-4 { grid-template-columns:repeat(2,1fr) !important; }
          .rp-grid-3 { grid-template-columns:repeat(2,1fr) !important; }
        }
        @media (max-width:720px) {
          .rp-nav { padding:14px 18px !important; }
          .rp-nav-links { display:none !important; }
          .rp-nav-burger { display:inline-flex !important; }
          .rp-nav-cta-ghost, .rp-nav-cta-primary { display:none !important; }
          .rp-container { padding:0 18px !important; }
          .rp-grid-4, .rp-grid-3 { grid-template-columns:1fr !important; }
          .rp-hero-h1 { font-size:46px !important; }
          .rp-h2 { font-size:34px !important; }
          .rp-section { padding-left:18px !important;padding-right:18px !important;padding-top:64px !important;padding-bottom:64px !important; }
        }
      `}</style>

      {/* Background fiber-threads + frosted overlay come from the global
          AmbientBackground in the root layout — do not render them here. */}

      <div style={{ position: "relative", zIndex: 1 }}>
        <Nav />
        <Hero />
        <ProviderMarquee />
        <StatsBand />
        <Reveal><Modes /></Reveal>
        <Reveal><ShowcaseWall /></Reveal>
        <Reveal><Features /></Reveal>
        <Reveal><HowItWorks /></Reveal>
        <Reveal><Pricing tiers={tiers} /></Reveal>
        <Reveal><Faq /></Reveal>
        <FooterCTA />
      </div>
    </>
  );
}
