"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useAppStore } from "@/lib/store/app-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
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
  const { creditBalance, fetchCredits } = useAppStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (session) fetchCredits();
  }, [session, fetchCredits]);
  const isAdmin = (session?.user as { role?: string })?.role === "admin" || (session?.user as { role?: string })?.role === "super_admin";

  const navLinks = [
    { href: "/generate", label: "สร้างภาพ", icon: ImageIcon },
    { href: "/generate?type=video", label: "สร้างวิดีโอ", icon: Video },
    { href: "/gallery", label: "แกลเลอรี", icon: LayoutGrid },
    { href: "/pricing", label: "เครดิต", icon: CreditCard },
  ];

  return (
    <nav className="glass-neu sticky top-0 z-50 border-b border-border/50">
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
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-light/50 transition-all"
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
                <Link href="/pricing">
                  <Badge variant="glass" size="lg" className="cursor-pointer hover:border-primary/30 transition-all">
                    <Coins className="w-4 h-4 text-warning" />
                    <span className="font-medium">{creditBalance.toLocaleString()}</span>
                  </Badge>
                </Link>

                {/* User dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-surface-light/50 transition-all cursor-pointer">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-bold text-white neu-raised-sm">
                        {session.user?.name?.charAt(0)?.toUpperCase() || "U"}
                      </div>
                      <span className="text-sm hidden lg:block">{session.user?.name}</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="flex items-center gap-2 cursor-pointer">
                        <User className="w-4 h-4" />
                        โปรไฟล์
                      </Link>
                    </DropdownMenuItem>
                    {isAdmin && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin" className="flex items-center gap-2 cursor-pointer">
                          <Settings className="w-4 h-4" />
                          แอดมิน
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => signOut()}
                      className="text-error hover:text-error cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      ออกจากระบบ
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Link href="/login">
                <Button size="sm">เข้าสู่ระบบ</Button>
              </Link>
            )}

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden glass-neu border-t border-border/50">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted hover:text-foreground hover:bg-surface-light/50 transition-all"
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
