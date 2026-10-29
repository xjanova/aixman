"use client";

/**
 * /admin layout — X-DREAMER themed admin shell
 *
 * Sidebar: glass panel with hue-mapped active links + back-to-app link.
 * On phones (≤720px) it folds to a 60px icon rail that ☰ opens out over
 * the page.
 * Main: full-bleed dark surface; AmbientBackground (root layout) supplies
 * the fiber-threads bg automatically.
 *
 * Auth gate preserved — only `admin` / `super_admin` roles allowed.
 */

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, redirect } from "next/navigation";
import { XdrThemeStyles } from "@/components/xdreamer/shared";
import { XdreamerMark } from "@/components/xdreamer/logo";

const HUE = 70;

const adminNav = [
  { href: "/admin", label: "แดชบอร์ด", icon: "◈", exact: true },
  { href: "/admin/users", label: "ผู้ใช้ & เครดิต", icon: "♟" },
  { href: "/admin/generations", label: "ผลงาน", icon: "▧" },
  { href: "/admin/transactions", label: "ประวัติเครดิต", icon: "▤" },
  { href: "/admin/referrals", label: "ชวนเพื่อน", icon: "⇄" },
  { href: "/admin/kie", label: "KIE.ai (หลัก)", icon: "✺" },
  { href: "/admin/providers", label: "Providers", icon: "⚙" },
  { href: "/admin/pools", label: "Account Pools", icon: "▣" },
  { href: "/admin/models", label: "โมเดล AI", icon: "✦" },
  { href: "/admin/gpu", label: "GPU ที่เช่า", icon: "▮" },
  { href: "/admin/workflows", label: "Workflow ComfyUI", icon: "⌬" },
  { href: "/admin/llm", label: "API โมเดลภาษา", icon: "⌘" },
  { href: "/admin/styles", label: "สไตล์", icon: "✤" },
  { href: "/admin/templates", label: "เทมเพลต", icon: "❖" },
  { href: "/admin/packages", label: "แพ็กเกจเครดิต", icon: "✧" },
  { href: "/admin/analytics", label: "สถิติ", icon: "◷" },
  { href: "/admin/settings", label: "ตั้งค่า", icon: "⚛" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  // The phone menu remembers the path it was opened on, so any navigation —
  // a link, or the browser's back button — closes it without an effect.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === pathname;
  const closeMenu = () => setMenuOpenOn(null);

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", border: `3px solid hsla(${220 + HUE},70%,60%,0.2)`, borderTopColor: `hsl(${220 + HUE},70%,60%)`, animation: "spin 1s linear infinite" }} />
        <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const role = (session?.user as { role?: string })?.role;
  if (!session || (role !== "admin" && role !== "super_admin")) {
    redirect("/");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", color: "#f1f5f9" }}>
      <XdrThemeStyles />

      {/* Phones only: tapping the dimmed page closes the opened-out menu. */}
      {menuOpen && <button type="button" className="adm-scrim" aria-label="ปิดเมนู" onClick={closeMenu} />}

      {/* Sidebar. On phones the labels stay in the DOM, visually hidden, so
          every link in the icon rail keeps its name for screen readers. */}
      <aside id="admin-nav" className={menuOpen ? "adm-open" : undefined}
        onKeyDown={(e) => { if (e.key === "Escape") closeMenu(); }}
        style={{
          width: 256, flexShrink: 0, position: "fixed", top: 0, left: 0, bottom: 0,
          background: "rgba(15,23,42,0.65)",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(18px)",
          overflowY: "auto",
          zIndex: 40,
        }}>
        <div className="adm-inner" style={{ padding: 20 }}>
          <button type="button" className="adm-toggle" aria-controls="admin-nav" aria-expanded={menuOpen}
            aria-label={menuOpen ? "ปิดเมนู" : "เปิดเมนู"}
            onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}>
            {menuOpen ? "✕" : "☰"}
          </button>

          <Link href="/" style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#94a3b8",
            marginBottom: 24, textDecoration: "none",
          }}>
            <span aria-hidden="true">←</span><span className="adm-text">กลับหน้าหลัก</span>
          </Link>

          <Link href="/admin" onClick={closeMenu} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28, textDecoration: "none" }}>
            <XdreamerMark size={32} />
            <div className="adm-text">
              <div style={{ fontFamily: "var(--font-unbounded), Inter, sans-serif", fontWeight: 600, letterSpacing: "0.1em", fontSize: 12, color: "#fff" }}>X-DREAMER</div>
              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#a5f3fc", textTransform: "uppercase", marginTop: 2 }}>· admin</div>
            </div>
          </Link>

          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {adminNav.map((item, i) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const h = (160 + i * 25 + HUE) % 360;
              return (
                <Link key={item.href} href={item.href} onClick={closeMenu}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px", borderRadius: 10, fontSize: 13,
                    textDecoration: "none",
                    background: isActive ? `linear-gradient(135deg, hsla(${h},60%,40%,0.25), hsla(${h + 40},60%,35%,0.25))` : "transparent",
                    color: isActive ? "#fff" : "#94a3b8",
                    fontWeight: isActive ? 500 : 400,
                    border: isActive ? `1px solid hsla(${h},70%,55%,0.4)` : "1px solid transparent",
                    transition: "all 200ms",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
                  <span aria-hidden="true" style={{ color: isActive ? `hsl(${h},80%,75%)` : "#64748b", width: 16, display: "inline-block", textAlign: "center" }}>{item.icon}</span>
                  <span className="adm-text">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User chip */}
          <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="adm-chip" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: `conic-gradient(from 180deg, hsl(${160 + HUE},70%,55%), hsl(${220 + HUE},70%,60%), hsl(${280 + HUE},70%,55%), hsl(${160 + HUE},70%,55%))`,
                padding: 2, flexShrink: 0,
              }}>
                <div style={{
                  width: "100%", height: "100%", borderRadius: "50%",
                  background: `linear-gradient(135deg, hsl(${220 + HUE},50%,15%), hsl(${280 + HUE},50%,8%))`,
                  display: "grid", placeItems: "center",
                  fontSize: 13, fontWeight: 600, color: "#fff",
                }}>{(session?.user?.name?.[0] || "A").toUpperCase()}</div>
              </div>
              <div className="adm-text" style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: "#fff", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session?.user?.name || "Admin"}</div>
                <div style={{ fontSize: 10, color: `hsl(${220 + HUE},70%,75%)`, letterSpacing: "0.06em", textTransform: "uppercase" }}>{role}</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content.
          `position: relative` + a z-index is load-bearing, not cosmetic:
          AmbientBackground (root layout) is `fixed inset-0 z-0` and paints an
          OPAQUE dark base. CSS paints positioned elements after non-positioned
          ones, so a static <main> ends up underneath it and every admin page
          renders invisible — present in the DOM, correctly sized, but covered.
          The sidebar only escaped this because it already carries z-index 40.
          `minWidth: 0` matters too: a flex item defaults to min-width:auto, so
          the widest thing on a page (a table, a long key) used to stretch
          <main> past a phone's screen and the right side was cut off. */}
      <main style={{ flex: 1, minWidth: 0, marginLeft: 256, padding: 32, minHeight: "100vh", position: "relative", zIndex: 1 }}>
        {/* A shallow band of artwork at the top only. Admin pages are dense
            tables — a full backdrop would fight them for attention, so this
            fades out well above where the data starts. Sits at z-index 0
            inside main's stacking context (see the note above). */}
        <div className="xdr-admin-backdrop" aria-hidden="true">
          <div className="xdr-admin-backdrop-art">
            <Image src="/showcase/admin-room.jpg" alt="" fill sizes="100vw" style={{ objectFit: "cover" }} />
          </div>
          <div className="xdr-admin-backdrop-scrim" />
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </main>

      <style jsx>{`
        .adm-toggle, .adm-scrim { display: none; }
        @media (max-width: 720px) {
          aside { width: 60px !important; }
          aside.adm-open { width: 256px !important; box-shadow: 24px 0 48px rgba(0,0,0,0.45); }
          main { margin-left: 60px !important; padding: 20px !important; }
          .adm-inner { padding: 14px 8px !important; }
          .adm-toggle {
            display: grid; place-items: center; width: 42px; height: 40px; margin-bottom: 18px;
            border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
            color: #cbd5e1; font-size: 18px; cursor: pointer;
          }
          /* Icon rail: labels leave the layout but keep naming their links. */
          aside:not(.adm-open) .adm-text {
            position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
            overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
          }
          aside:not(.adm-open) .adm-inner :global(a), aside:not(.adm-open) .adm-chip {
            justify-content: center; padding-left: 0 !important; padding-right: 0 !important;
          }
          .adm-scrim {
            display: block; position: fixed; inset: 0; z-index: 39; padding: 0; border: 0;
            background: rgba(3,6,18,0.55); cursor: pointer;
          }
        }
      `}</style>
    </div>
  );
}
