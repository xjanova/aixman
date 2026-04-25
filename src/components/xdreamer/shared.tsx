"use client";

/**
 * X-DREAMER shared primitives
 *
 * Reusable components that the X-DREAMER theme depends on:
 *   - FiberThreads     : canvas-based animated background (fiber bezier curves)
 *   - XdrThemeStyles   : global stylesheet (animations, body font, responsive)
 *   - XdrNav           : top nav (fixed, glass-blur, with auth-aware actions)
 *
 * Used by both the landing page (`src/components/xdreamer/landing.tsx`)
 * and the (main) app layout (`src/app/(main)/layout.tsx`) so every route
 * shares the same identity.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export const HUE = 70;

// ─── FIBER THREADS CANVAS ──────────────────────────────────────────────
export function FiberThreads({
  density = 70,
  speed = 1,
  hueShift = HUE,
  opacity = 0.55,
  interactive = true,
}: {
  density?: number; speed?: number; hueShift?: number; opacity?: number; interactive?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palettes = useMemo(() => {
    const base: [number, number, number][] = [
      [160, 85, 55], [180, 80, 60], [210, 90, 65],
      [250, 75, 68], [275, 70, 65], [295, 65, 68],
    ];
    return base.map(([h, s, l]) => [(h + hueShift) % 360, s, l] as [number, number, number]);
  }, [hueShift]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let visible = true;
    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const mouse = { x: -9999, y: -9999, active: false };
    let threads: {
      x0: number; y0: number; cx1: number; cy1: number; cx2: number; cy2: number;
      x1: number; y1: number; f1: number; f2: number; f3: number; phase: number;
      thick: number; hue: number; sat: number; lit: number; alpha: number;
    }[] = [];

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      w = rect.width; h = rect.height;
      if (w === 0 || h === 0) return;
      canvas!.width = w * dpr; canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawn();
    }
    function spawn() {
      threads = [];
      for (let i = 0; i < density; i++) {
        const p = palettes[Math.floor(Math.random() * palettes.length)];
        threads.push({
          x0: Math.random() * w, y0: Math.random() * h,
          cx1: Math.random() * w, cy1: Math.random() * h,
          cx2: Math.random() * w, cy2: Math.random() * h,
          x1: Math.random() * w, y1: Math.random() * h,
          f1: 0.0004 + Math.random() * 0.0008,
          f2: 0.0003 + Math.random() * 0.0007,
          f3: 0.0002 + Math.random() * 0.0006,
          phase: Math.random() * Math.PI * 2,
          thick: 0.3 + Math.random() * 1.4,
          hue: p[0], sat: p[1], lit: p[2],
          alpha: 0.25 + Math.random() * 0.55,
        });
      }
    }
    function onMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    }
    function onLeave() { mouse.active = false; }

    resize();
    window.addEventListener("resize", resize);
    if (interactive) {
      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseleave", onLeave);
    }
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 });
    io.observe(canvas);

    const t0 = performance.now();
    let lastFrame = 0;
    const frameMs = 1000 / 30;
    function draw(now: number) {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      if (now - lastFrame < frameMs) return;
      lastFrame = now;
      const t = (now - t0) * speed;
      ctx!.globalCompositeOperation = "source-over";
      ctx!.fillStyle = "rgba(3,6,18,0.08)";
      ctx!.fillRect(0, 0, w, h);
      ctx!.globalCompositeOperation = "lighter";

      for (const th of threads) {
        const a = Math.sin(t * th.f1 + th.phase);
        const b = Math.cos(t * th.f2 + th.phase * 1.3);
        const c = Math.sin(t * th.f3 + th.phase * 0.7);
        const d = Math.cos(t * th.f1 + th.phase * 2.1);
        let cx1 = th.cx1 + c * 200, cy1 = th.cy1 + d * 200;
        let cx2 = th.cx2 + b * 200, cy2 = th.cy2 + a * 200;
        const x0 = th.x0 + a * 120, y0 = th.y0 + b * 120;
        const x1 = th.x1 + d * 120, y1 = th.y1 + c * 120;
        if (mouse.active && interactive) {
          const dx = mouse.x - (cx1 + cx2) / 2;
          const dy = mouse.y - (cy1 + cy2) / 2;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          const pull = Math.max(0, 180 - dist) / 180;
          cx1 += dx * pull * 0.35; cy1 += dy * pull * 0.35;
          cx2 += dx * pull * 0.25; cy2 += dy * pull * 0.25;
        }
        const g = ctx!.createLinearGradient(x0, y0, x1, y1);
        const h1 = th.hue, h2 = (th.hue + 40) % 360;
        g.addColorStop(0, `hsla(${h1},${th.sat}%,${th.lit}%,0)`);
        g.addColorStop(0.15, `hsla(${h1},${th.sat}%,${th.lit}%,${th.alpha * opacity})`);
        g.addColorStop(0.5, `hsla(${(h1 + 20) % 360},${th.sat}%,${th.lit + 5}%,${th.alpha * opacity * 1.1})`);
        g.addColorStop(0.85, `hsla(${h2},${th.sat}%,${th.lit}%,${th.alpha * opacity})`);
        g.addColorStop(1, `hsla(${h2},${th.sat}%,${th.lit}%,0)`);
        ctx!.strokeStyle = g;
        ctx!.lineWidth = th.thick;
        ctx!.beginPath();
        ctx!.moveTo(x0, y0);
        ctx!.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
        ctx!.stroke();
      }
    }
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, [density, speed, palettes, interactive, opacity]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────────
export function XdrThemeStyles() {
  // Inject once globally — keyframes, font cascade, responsive helpers, italic fix
  return (
    <style jsx global>{`
      html, body {
        background: #030612;
        color: #f1f5f9;
        /* Use the next/font CSS variables loaded in root layout — string
           literals would skip the actually-loaded webfont and fall back
           to system Thai (heavier glyphs). */
        font-family: var(--font-noto-sans-thai), var(--font-inter), system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      body { overflow-x: hidden; }
      @keyframes pulse { 0%,100% {opacity:1;} 50% {opacity:0.5;} }
      @keyframes blink { 0%,50% {opacity:1;} 50.01%,100% {opacity:0;} }
      @keyframes floatY { 0%,100% {transform:translateY(0);} 50% {transform:translateY(-12px);} }
      @keyframes bannerIn { from {opacity:0;transform:translateX(20px);} to {opacity:1;transform:translateX(0);} }
      h1 span[style*="italic"], h2 span[style*="italic"], .xdr-italic-th { padding-bottom:0.15em;padding-right:0.08em;display:inline-block; }
      .xdr-menu-item { display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;font-size:13px;color:#e2e8f0;text-decoration:none;background:transparent;border:none;cursor:pointer;transition:background 150ms; }
      .xdr-menu-item:hover { background:rgba(255,255,255,0.05);color:#fff; }
      @media (max-width:1024px) {
        .rp-nav { padding:14px 20px !important; }
        .rp-nav-links { gap:16px !important;font-size:12px !important; }
        .rp-nav-badge { display:none !important; }
        .rp-nav-brand { font-size:12px !important; }
        .rp-nav-cta-primary, .rp-nav-cta-ghost { padding:8px 14px !important;font-size:12px !important;white-space:nowrap !important; }
        .rp-hero-logo-wrap { position:static !important;flex-direction:row !important;justify-content:flex-end !important;margin-bottom:24px !important; }
        .rp-hero-logo { width:80px !important;height:80px !important;border-radius:18px !important; }
        .rp-container { padding:0 24px !important; }
        .rp-grid-4 { grid-template-columns:repeat(2,1fr) !important; }
        .rp-grid-3 { grid-template-columns:repeat(2,1fr) !important; }
      }
      @media (max-width:720px) {
        .rp-nav { padding:14px 18px !important; }
        .rp-nav-links { display:none !important; }
        .rp-hero-logo-wrap { position:static !important;margin:0 auto 24px !important; }
        .rp-hero-logo { width:100px !important;height:100px !important; }
        .rp-container { padding:0 18px !important; }
        .rp-grid-4, .rp-grid-3 { grid-template-columns:1fr !important; }
        .rp-prompt-row { flex-wrap:wrap !important; }
        .rp-gen-tray { grid-template-columns:repeat(2,1fr) !important; }
        .rp-hero-h1 { font-size:48px !important; }
        .rp-h2 { font-size:36px !important; }
        .rp-mode-tabs { flex-wrap:wrap !important; }
        .rp-section { padding-left:18px !important;padding-right:18px !important;padding-top:64px !important;padding-bottom:64px !important; }
      }
      @media (max-width:900px) {
        .rp-banner { height:auto !important;min-height:520px; }
        .rp-banner-content { grid-template-columns:1fr !important;padding:40px 28px !important; }
      }
    `}</style>
  );
}

// ─── NAV ────────────────────────────────────────────────────────────────
export function XdrNav({ creditsLabel }: { creditsLabel?: string }) {
  const { data: session } = useSession();
  const links = [
    { id: "studio", label: "สตูดิโอ", href: "/generate" },
    { id: "gallery", label: "Gallery", href: "/gallery" },
    { id: "pricing", label: "Pricing", href: "/pricing" },
    { id: "profile", label: "Dashboard", href: "/profile" },
  ];
  return (
    <nav className="rp-nav" style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
      padding: "20px 48px", display: "flex", alignItems: "center", justifyContent: "space-between",
      backdropFilter: "blur(18px) saturate(1.3)",
      background: "linear-gradient(180deg, rgba(3,6,18,0.65), rgba(3,6,18,0.25))",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
    }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", cursor: "pointer" }}>
        <Image src="/xdreamer-logo.png" alt="X-DREAMER" width={38} height={38} style={{ borderRadius: 10, objectFit: "cover", boxShadow: "0 0 20px rgba(139,92,246,0.45)" }} />
        <div className="rp-nav-brand" style={{ fontFamily: "Inter, sans-serif", fontWeight: 900, letterSpacing: "0.22em", fontSize: 14, color: "#fff" }}>X-DREAMER</div>
        <div className="rp-nav-badge" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#94a3b8", padding: "3px 8px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 999, marginLeft: 6 }}>v4 · LIVE</div>
      </Link>
      <div className="rp-nav-links" style={{ display: "flex", gap: 28, fontSize: 14, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>
        {links.map(l => (
          <Link key={l.id} href={l.href} style={{ color: "inherit", textDecoration: "none", cursor: "pointer", paddingBottom: 2, borderBottom: "1px solid transparent" }}>{l.label}</Link>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {creditsLabel && (
          <Link href="/pricing" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, background: "rgba(165,243,252,0.08)", border: "1px solid rgba(165,243,252,0.2)", color: "#a5f3fc", fontSize: 12, textDecoration: "none" }}>
            <span style={{ fontSize: 11 }}>✦</span>{creditsLabel}
          </Link>
        )}
        {session ? (
          <UserMenu name={session.user?.name || "User"} email={session.user?.email || ""} />
        ) : (
          <>
            <Link href="/login" className="rp-nav-cta-ghost" style={{ background: "transparent", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.15)", padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer", textDecoration: "none" }}>เข้าสู่ระบบ</Link>
            <Link href="/login?signup=1" className="rp-nav-cta-primary" style={{ background: "linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%)", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "none", boxShadow: "0 8px 24px -8px rgba(139,92,246,0.6)" }}>เริ่มสร้างฟรี</Link>
          </>
        )}
      </div>
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
            { href: "/referral", l: "Referral", i: "♢" },
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

// ─── PAGE SHELL ────────────────────────────────────────────────────────
// Wraps an inner-app page (generate, gallery, pricing, profile, etc.)
// with X-DREAMER background + nav + safe top padding for fixed nav.
export function XdrPageShell({ children, creditsLabel }: { children: React.ReactNode; creditsLabel?: string }) {
  return (
    <>
      <XdrThemeStyles />
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", opacity: 0.4 }}>
        <FiberThreads density={50} speed={0.7} hueShift={HUE} opacity={0.45} interactive={false} />
      </div>
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 30%, rgba(3,6,18,0.5) 0%, rgba(3,6,18,0.85) 60%, rgba(3,6,18,0.95) 100%)" }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <XdrNav creditsLabel={creditsLabel} />
        <div style={{ paddingTop: 80 }}>{children}</div>
      </div>
    </>
  );
}
