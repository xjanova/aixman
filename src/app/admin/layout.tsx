"use client";

/**
 * /admin layout — X-DREAMER themed admin shell
 *
 * Sidebar: glass panel with hue-mapped active links + back-to-app link.
 * Main: full-bleed dark surface; AmbientBackground (root layout) supplies
 * the fiber-threads bg automatically.
 *
 * Auth gate preserved — only `admin` / `super_admin` roles allowed.
 */

import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, redirect } from "next/navigation";
import { XdrThemeStyles } from "@/components/xdreamer/shared";

const HUE = 70;

const adminNav = [
  { href: "/admin", label: "แดชบอร์ด", icon: "◈", exact: true },
  { href: "/admin/providers", label: "Providers", icon: "⚙" },
  { href: "/admin/pools", label: "Account Pools", icon: "▣" },
  { href: "/admin/models", label: "โมเดล AI", icon: "✦" },
  { href: "/admin/packages", label: "แพ็กเกจเครดิต", icon: "✧" },
  { href: "/admin/analytics", label: "สถิติ", icon: "▧" },
  { href: "/admin/settings", label: "ตั้งค่า", icon: "⚛" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

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

      {/* Sidebar */}
      <aside style={{
        width: 256, flexShrink: 0, position: "fixed", top: 0, left: 0, bottom: 0,
        background: "rgba(15,23,42,0.65)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(18px)",
        overflowY: "auto",
        zIndex: 40,
      }}>
        <div style={{ padding: 20 }}>
          <Link href="/" style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#94a3b8",
            marginBottom: 24, textDecoration: "none",
          }}>
            <span>←</span> กลับหน้าหลัก
          </Link>

          <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28, textDecoration: "none" }}>
            <Image src="/xdreamer-logo.png" alt="X-DREAMER" width={32} height={32}
              style={{ borderRadius: 8, objectFit: "cover", boxShadow: `0 0 18px hsla(${270 + HUE},70%,50%,0.45)` }} />
            <div>
              <div style={{ fontFamily: "Inter,sans-serif", fontWeight: 800, letterSpacing: "0.2em", fontSize: 12, color: "#fff" }}>X-DREAMER</div>
              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#a5f3fc", textTransform: "uppercase", marginTop: 2 }}>· admin</div>
            </div>
          </Link>

          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {adminNav.map((item, i) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const h = (160 + i * 25 + HUE) % 360;
              return (
                <Link key={item.href} href={item.href}
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
                  <span style={{ color: isActive ? `hsl(${h},80%,75%)` : "#64748b", width: 16, display: "inline-block", textAlign: "center" }}>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* User chip */}
          <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
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
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: "#fff", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session?.user?.name || "Admin"}</div>
                <div style={{ fontSize: 10, color: `hsl(${220 + HUE},70%,75%)`, letterSpacing: "0.06em", textTransform: "uppercase" }}>{role}</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, marginLeft: 256, padding: 32, minHeight: "100vh" }}>
        {children}
      </main>

      <style jsx>{`
        @media (max-width: 720px) {
          aside { width: 60px !important; }
          main { margin-left: 60px !important; padding: 20px !important; }
        }
      `}</style>
    </div>
  );
}
