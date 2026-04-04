"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useAppStore } from "@/lib/store/app-store";
import {
  Sparkles,
  Image as ImageIcon,
  Video,
  LayoutGrid,
  CreditCard,
  User,
  LogOut,
  Menu,
  X,
  Coins,
  Settings,
} from "lucide-react";

export function Navbar() {
  const { data: session } = useSession();
  const { creditBalance } = useAppStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = (session?.user as { role?: string })?.role === "admin" || (session?.user as { role?: string })?.role === "super_admin";

  const navLinks = [
    { href: "/generate", label: "สร้างภาพ", icon: ImageIcon },
    { href: "/generate?type=video", label: "สร้างวิดีโอ", icon: Video },
    { href: "/gallery", label: "แกลเลอรี", icon: LayoutGrid },
    { href: "/pricing", label: "เครดิต", icon: CreditCard },
  ];

  return (
    <nav className="glass sticky top-0 z-50 border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <Image
              src="/logo.webp"
              alt="XMAN AI"
              width={32}
              height={32}
              className="rounded-lg group-hover:shadow-lg group-hover:shadow-primary/30 transition-shadow"
            />
            <span className="text-lg font-bold gradient-text hidden sm:block">
              XMAN AI
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-light transition-all"
              >
                <link.icon className="w-4 h-4" />
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {session ? (
              <>
                {/* Credits badge */}
                <Link
                  href="/pricing"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-light text-sm hover:bg-surface-light transition-all"
                >
                  <Coins className="w-4 h-4 text-warning" />
                  <span className="font-medium">{creditBalance.toLocaleString()}</span>
                </Link>

                {/* User menu */}
                <div className="relative group">
                  <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-light transition-all">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-bold text-white">
                      {session.user?.name?.charAt(0)?.toUpperCase() || "U"}
                    </div>
                    <span className="text-sm hidden lg:block">{session.user?.name}</span>
                  </button>
                  <div className="absolute right-0 top-full mt-1 w-48 glass rounded-xl p-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                    <Link href="/profile" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-light">
                      <User className="w-4 h-4" />
                      โปรไฟล์
                    </Link>
                    {isAdmin && (
                      <Link href="/admin" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-light">
                        <Settings className="w-4 h-4" />
                        แอดมิน
                      </Link>
                    )}
                    <button
                      onClick={() => signOut()}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-error hover:bg-surface-light"
                    >
                      <LogOut className="w-4 h-4" />
                      ออกจากระบบ
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium hover:shadow-lg hover:shadow-primary/30 transition-all"
              >
                เข้าสู่ระบบ
              </Link>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-surface-light"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden glass border-t border-border">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-light transition-all"
              >
                <link.icon className="w-5 h-5" />
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
