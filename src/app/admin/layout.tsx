"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname, redirect } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Database,
  Package,
  Settings,
  BarChart3,
  Layers,
  CreditCard,
  ArrowLeft,
} from "lucide-react";

const adminNav = [
  { href: "/admin", label: "แดชบอร์ด", icon: LayoutDashboard, exact: true },
  { href: "/admin/providers", label: "Providers", icon: Server },
  { href: "/admin/pools", label: "Account Pools", icon: Database },
  { href: "/admin/models", label: "โมเดล AI", icon: Layers },
  { href: "/admin/packages", label: "แพ็กเกจเครดิต", icon: CreditCard },
  { href: "/admin/analytics", label: "สถิติ", icon: BarChart3 },
  { href: "/admin/settings", label: "ตั้งค่า", icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  if (status === "loading") return <div className="min-h-screen bg-background flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const role = (session?.user as { role?: string })?.role;
  if (!session || (role !== "admin" && role !== "super_admin")) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 glass border-r border-border shrink-0 fixed h-full overflow-y-auto">
        <div className="p-4">
          <Link href="/" className="flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="w-4 h-4" />
            กลับหน้าหลัก
          </Link>
          <h2 className="text-lg font-bold gradient-text mb-6">AI Admin</h2>

          <nav className="space-y-1">
            {adminNav.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                    isActive
                      ? "bg-primary/10 text-primary-light font-medium"
                      : "text-muted hover:text-foreground hover:bg-surface-light"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 ml-64 p-6">
        {children}
      </main>
    </div>
  );
}
