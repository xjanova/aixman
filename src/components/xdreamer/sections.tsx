"use client";

/**
 * X-DREAMER landing sections that lead with real generated work.
 *
 * The old landing drew every visual procedurally (SVG thread scribbles,
 * canvas gradients). It looked designed but proved nothing — the one thing
 * a generation platform has to show is its output. These sections put real
 * frames on the page and label each one with the prompt and model that
 * actually produced it.
 */

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { MediaTile, ModeBadge } from "./media";
import {
  FAQ_ITEMS,
  HERO_MEDIA,
  MODE_CARDS,
  PROVIDERS,
  SHOWCASE_ITEMS,
} from "@/lib/showcase";

/** Same base hue shift the rest of the theme uses. */
const HUE = 70;

/** The four works whose prompts cycle through the hero console. */
const HERO_DEMOS = ["temple", "city", "product", "anime"]
  .map((k) => SHOWCASE_ITEMS.find((i) => i.key === k)!)
  .filter(Boolean);

// ─── HERO ──────────────────────────────────────────────────────────────
export function Hero() {
  const [demoIdx, setDemoIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);
  const idxRef = useRef(0);

  // Switching demos clears the console in the same update, so the typing
  // effect below never has to reset state synchronously on mount.
  const goTo = useCallback((next: number) => {
    idxRef.current = next;
    setDemoIdx(next);
    setTyped("");
    setDone(false);
  }, []);

  // Type the current prompt out, then hold before advancing.
  useEffect(() => {
    const target = HERO_DEMOS[demoIdx].prompt;
    let i = 0;
    const typer = setInterval(() => {
      i += 2;
      setTyped(target.slice(0, i));
      if (i >= target.length) {
        clearInterval(typer);
        setDone(true);
      }
    }, 26);
    return () => clearInterval(typer);
  }, [demoIdx]);

  useEffect(() => {
    const id = setInterval(() => goTo((idxRef.current + 1) % HERO_DEMOS.length), 6400);
    return () => clearInterval(id);
  }, [goTo]);

  const active = HERO_DEMOS[demoIdx];

  return (
    <section className="xdr-hero">
      {/* Full-bleed cinematic frame */}
      <div style={{ position: "absolute", inset: 0 }}>
        {/* Still by design — see HERO_MEDIA in @/lib/showcase */}
        <MediaTile
          image={HERO_MEDIA.image}
          alt="ตัวอย่างผลงานที่สร้างด้วย X-DREAMER"
          policy="eager"
          priority
          sizes="100vw"
        />
        {/* Left-to-right scrim keeps the headline legible over the bright helix */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(3,6,18,0.96) 0%, rgba(3,6,18,0.86) 34%, rgba(3,6,18,0.35) 64%, rgba(3,6,18,0.6) 100%)",
          }}
        />
        {/* Vertical scrim blends the frame into the nav and the next section */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(3,6,18,0.9) 0%, rgba(3,6,18,0.25) 22%, rgba(3,6,18,0.45) 62%, #030612 100%)",
          }}
        />
      </div>

      <div className="rp-container xdr-hero-inner">
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 14px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(10px)",
            fontSize: 11,
            letterSpacing: "0.18em",
            color: "#a5f3fc",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "#34d399",
              boxShadow: "0 0 10px #34d399",
              animation: "xdr-pulse 2s infinite",
            }}
          />
          สตูดิโอ AI · พร้อมใช้งานจริง
        </div>

        <h1
          className="rp-hero-h1"
          style={{
            marginTop: 26,
            fontSize: "clamp(52px, 7.6vw, 116px)",
            fontWeight: 300,
            lineHeight: 0.96,
            letterSpacing: "-0.03em",
            color: "#fff",
            textWrap: "balance",
            textShadow: "0 8px 40px rgba(0,0,0,0.6)",
          }}
        >
          ทอ
          <span
            className="xdr-italic-th"
            style={{
              fontStyle: "italic",
              fontWeight: 200,
              background: `linear-gradient(120deg, hsl(${160 + HUE},85%,68%) 0%, hsl(${200 + HUE},88%,72%) 45%, hsl(${270 + HUE},85%,75%) 100%)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {" "}
            ความฝัน{" "}
          </span>
          <br />
          <span style={{ fontWeight: 700 }}>จากเส้นใย</span>
          <span style={{ fontWeight: 200, opacity: 0.62 }}>แห่งความคิด</span>
        </h1>

        <p className="xdr-hero-sub">
          สร้างภาพและวิดีโอจากประโยคเดียว ด้วยโมเดลชั้นนำจาก 9 ผู้ให้บริการ
          ในระบบเครดิตเดียว ไม่ต้องถือหลายซับสคริปชัน
        </p>

        {/* Prompt console — every line here is a prompt that made a real frame below */}
        <div className="xdr-console">
          <div className="xdr-console-head">
            <span className="xdr-console-dot" />
            <span style={{ fontSize: 10, letterSpacing: "0.16em", color: "#64748b" }}>PROMPT</span>
            <span style={{ marginLeft: "auto", fontSize: 10, letterSpacing: "0.1em", color: "#64748b" }}>
              {active.model}
            </span>
          </div>

          <div className="xdr-console-body">
            <p className="xdr-console-text">
              {typed}
              <span className="xdr-caret" style={{ opacity: done ? 0 : 1 }} />
            </p>
            <Link href="/generate" className="xdr-console-cta">
              ทอเลย <span style={{ fontSize: 16 }}>→</span>
            </Link>
          </div>

          <div className="xdr-console-tray">
            {HERO_DEMOS.map((d, i) => (
              <button
                key={d.key}
                onClick={() => goTo(i)}
                aria-label={d.title}
                className="xdr-tray-frame"
                style={{
                  aspectRatio: "1 / 1",
                  borderColor: i === demoIdx ? `hsla(${(d.hue + HUE) % 360},85%,65%,0.75)` : "rgba(255,255,255,0.08)",
                  boxShadow:
                    i === demoIdx
                      ? `0 0 0 1px hsla(${(d.hue + HUE) % 360},85%,65%,0.4), 0 12px 30px -12px hsla(${(d.hue + HUE) % 360},85%,55%,0.7)`
                      : "none",
                  opacity: i === demoIdx ? 1 : 0.55,
                }}
              >
                {/* Above the fold on desktop — load with the hero so the row
                    doesn't pop in a beat after the headline. `sizes` keeps the
                    fetch down to a thumbnail. */}
                <Image src={d.image} alt={d.title} fill sizes="200px" loading="eager" style={{ objectFit: "cover" }} />
                {i === demoIdx && <span className="xdr-tray-live">ผลลัพธ์</span>}
              </button>
            ))}
          </div>
        </div>

        <ul className="xdr-hero-trust">
          {[
            "เครดิตฟรีเมื่อสมัคร",
            "งานล้มเหลว คืนเครดิตอัตโนมัติ",
            "ผลงานเป็นของคุณ ใช้เชิงพาณิชย์ได้",
          ].map((t) => (
            <li key={t}>
              <span style={{ color: "#34d399" }}>✓</span> {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="xdr-hero-credit">
        <span style={{ color: "#a5f3fc" }}>▲</span> ภาพพื้นหลังสร้างด้วย {HERO_MEDIA.model} บนแพลตฟอร์มนี้
      </div>
    </section>
  );
}

// ─── PROVIDER MARQUEE ──────────────────────────────────────────────────
export function ProviderMarquee() {
  const row = [...PROVIDERS, ...PROVIDERS];
  return (
    <section className="xdr-marquee-sec">
      <div className="rp-container">
        <div className="xdr-marquee-label">ขับเคลื่อนด้วยโมเดลจาก</div>
      </div>
      <div className="xdr-marquee" aria-label={PROVIDERS.join(", ")}>
        <div className="xdr-marquee-track">
          {row.map((p, i) => (
            <span key={`${p}-${i}`} className="xdr-marquee-item" aria-hidden={i >= PROVIDERS.length}>
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── STATS BAND ────────────────────────────────────────────────────────
const STATS = [
  { v: "9", l: "ผู้ให้บริการ AI" },
  { v: "17+", l: "โมเดลให้เลือก" },
  { v: "3", l: "โหมด: ภาพ / วิดีโอ / แก้ไข" },
  { v: "1", l: "ระบบเครดิตเดียว" },
];

export function StatsBand() {
  return (
    <section className="rp-container" style={{ paddingTop: 26, paddingBottom: 44 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          padding: "30px 8px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {STATS.map((s, i) => (
          <div key={s.l} style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 38,
                fontWeight: 300,
                letterSpacing: "-0.02em",
                background: `linear-gradient(180deg, #fff 0%, hsl(${(180 + HUE + i * 34) % 360},75%,74%) 100%)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {s.v}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, letterSpacing: "0.04em" }}>{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── MODES ─────────────────────────────────────────────────────────────
export function Modes() {
  return (
    <section className="rp-section" style={{ padding: "110px 48px", maxWidth: 1400, margin: "0 auto" }}>
      <SectionHead
        eyebrow="· สามโหมด"
        titleA="ทุกอย่างที่ต้องใช้"
        emphasis="อยู่ในที่เดียว"
        hue={200}
      />
      <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 22, marginTop: 56 }}>
        {MODE_CARDS.map((m) => {
          const h = (m.hue + HUE) % 360;
          return (
            <Link key={m.key} href={m.href} className="xdr-mode-card" style={{ "--h": String(h) } as React.CSSProperties}>
              <div style={{ position: "relative", aspectRatio: "16 / 10", overflow: "hidden" }}>
                <MediaTile image={m.image} video={m.video} alt={m.title} sizes="(max-width:720px) 100vw, 33vw" />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(180deg, rgba(3,6,18,0.1) 0%, rgba(3,6,18,0.55) 70%, rgba(15,23,42,0.95) 100%)",
                    pointerEvents: "none",
                  }}
                />
                <div style={{ position: "absolute", top: 14, left: 16, fontSize: 10, letterSpacing: "0.2em", color: `hsl(${h},90%,80%)`, textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>
                  {m.eyebrow}
                </div>
              </div>

              <div style={{ padding: "22px 24px 26px" }}>
                <h3 style={{ fontSize: 25, fontWeight: 500, color: "#fff", letterSpacing: "-0.01em", margin: 0 }}>{m.title}</h3>
                <p style={{ fontSize: 14.5, lineHeight: 1.62, color: "rgba(203,213,225,0.72)", fontWeight: 300, marginTop: 12 }}>{m.desc}</p>

                <div style={{ display: "flex", gap: 22, marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  {m.specs.map((s) => (
                    <div key={s.l}>
                      <div style={{ fontSize: 19, fontWeight: 400, color: "#fff", letterSpacing: "-0.01em" }}>{s.k}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.l}</div>
                    </div>
                  ))}
                  <span className="xdr-mode-go" style={{ marginLeft: "auto", alignSelf: "flex-end", color: `hsl(${h},85%,75%)` }}>
                    {m.cta} →
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ─── SHOWCASE WALL ─────────────────────────────────────────────────────
export function ShowcaseWall() {
  return (
    <section className="rp-section" style={{ padding: "110px 48px 130px", maxWidth: 1500, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 24, marginBottom: 20 }}>
        <SectionHead
          eyebrow="· ผลงานจริงจากแพลตฟอร์ม"
          titleA="ทุกภาพนี้"
          emphasis="สร้างที่นี่"
          hue={270}
          tail="พร้อม prompt และโมเดลที่ใช้จริง"
        />
        <Link href="/gallery" className="xdr-pill-link">
          ดูแกลเลอรีทั้งหมด →
        </Link>
      </div>

      <div className="xdr-wall">
        {SHOWCASE_ITEMS.map((item) => {
          const h = (item.hue + HUE) % 360;
          return (
            <figure key={item.key} className="xdr-wall-item" style={{ aspectRatio: item.ratio }}>
              <MediaTile
                image={item.image}
                video={item.video}
                alt={item.title}
                sizes="(max-width:720px) 100vw, (max-width:1180px) 50vw, 33vw"
              />
              <div className="xdr-wall-scrim" />

              <div style={{ position: "absolute", top: 12, left: 12, zIndex: 2 }}>
                <ModeBadge mode={item.mode} hue={h} />
              </div>

              <figcaption className="xdr-wall-cap">
                <div style={{ fontSize: 16, fontWeight: 500, color: "#fff", lineHeight: 1.25 }}>{item.title}</div>
                <p className="xdr-wall-prompt">&ldquo;{item.prompt}&rdquo;</p>
                <div className="xdr-wall-model" style={{ color: `hsl(${h},80%,80%)`, borderColor: `hsla(${h},80%,70%,0.3)` }}>
                  {item.model}
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

// ─── FAQ ───────────────────────────────────────────────────────────────
export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="rp-section" style={{ padding: "110px 48px", maxWidth: 1000, margin: "0 auto" }}>
      <SectionHead eyebrow="· คำถามที่พบบ่อย" titleA="เรื่องที่ควรรู้" emphasis="ก่อนเริ่มจ่าย" hue={160} center />
      <div style={{ marginTop: 52, display: "flex", flexDirection: "column", gap: 10 }}>
        {FAQ_ITEMS.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} className="xdr-faq" style={{ borderColor: isOpen ? "rgba(165,243,252,0.22)" : "rgba(255,255,255,0.08)" }}>
              <button onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} className="xdr-faq-q">
                <span>{f.q}</span>
                <span
                  style={{
                    flexShrink: 0,
                    color: isOpen ? "#a5f3fc" : "#64748b",
                    transform: isOpen ? "rotate(45deg)" : "none",
                    transition: "transform 250ms cubic-bezier(0.4,0,0.2,1), color 250ms",
                    fontSize: 20,
                    lineHeight: 1,
                  }}
                >
                  +
                </span>
              </button>
              <div style={{ display: "grid", gridTemplateRows: isOpen ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
                <div style={{ overflow: "hidden" }}>
                  <p className="xdr-faq-a">{f.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── SHARED SECTION HEADING ────────────────────────────────────────────
function SectionHead({
  eyebrow,
  titleA,
  emphasis,
  hue,
  tail,
  center = false,
}: {
  eyebrow: string;
  /** Plain leading half of the headline */
  titleA: string;
  /** Gradient italic half */
  emphasis: string;
  hue: number;
  tail?: string;
  center?: boolean;
}) {
  const h = (hue + HUE) % 360;
  return (
    <div style={{ maxWidth: 760, textAlign: center ? "center" : "left", marginLeft: center ? "auto" : undefined, marginRight: center ? "auto" : undefined }}>
      <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</div>
      <h2 className="rp-h2" style={{ fontSize: "clamp(38px, 4.6vw, 60px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.06, margin: 0 }}>
        {titleA}{" "}
        <span
          className="xdr-italic-th"
          style={{
            fontStyle: "italic",
            fontWeight: 200,
            background: `linear-gradient(120deg, hsl(${h},85%,72%), hsl(${(h + 55) % 360},85%,78%))`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {emphasis}
        </span>
      </h2>
      {tail && <p style={{ marginTop: 16, fontSize: 15.5, color: "rgba(203,213,225,0.65)", fontWeight: 300 }}>{tail}</p>}
    </div>
  );
}

// ─── SCROLL-REVEAL WRAPPER ─────────────────────────────────────────────
/**
 * Fades a block in as it scrolls into view.
 *
 * Deliberately CSS-only (`animation-timeline: view()`, see `.xdr-reveal` in
 * globals.css) rather than an IntersectionObserver. An observer-driven
 * reveal starts every section at `opacity: 0` and depends on a callback
 * firing to ever show it — if that callback doesn't run, the visitor gets a
 * blank page below the hero. The CSS version can only ever *add* an
 * animation, so a browser without support (or with reduced motion on)
 * simply renders the content normally.
 */
export function Reveal({ children }: { children: React.ReactNode }) {
  return <div className="xdr-reveal">{children}</div>;
}
