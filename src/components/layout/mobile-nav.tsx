"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Sparkles,
  LayoutGrid,
  Coins,
  User,
} from "lucide-react";

const navItems = [
  { href: "/generate", label: "สร้าง", icon: Sparkles },
  { href: "/gallery", label: "แกลเลอรี", icon: LayoutGrid },
  { href: "/pricing", label: "เครดิต", icon: Coins },
  { href: "/profile", label: "โปรไฟล์", icon: User },
];

export function MobileNav() {
  const { data: session } = useSession();
  const pathname = usePathname();

  if (!session) return null;
  // Don't show on admin pages
  if (pathname.startsWith("/admin")) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-border md:hidden safe-bottom">
      <div className="flex items-center justify-around py-2 px-4">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all ${
                isActive ? "text-primary-light" : "text-muted"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "text-primary-light" : ""}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
