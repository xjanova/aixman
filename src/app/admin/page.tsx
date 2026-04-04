"use client";

import { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  Image as ImageIcon,
  Video,
  Users,
  Coins,
  Server,
  AlertCircle,
  Database,
  Loader2,
} from "lucide-react";

interface Stats {
  totalGenerations: number;
  generationsToday: number;
  totalCreditsUsed: number;
  activeUsers: number;
  totalRevenue: number;
  revenueToday: number;
  providerCosts: number;
  activeAccounts: number;
  errorRate: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const runSeed = async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch("/api/admin/seed", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSeedResult(`สำเร็จ: ${data.results.providers} providers, ${data.results.models} models, ${data.results.packages} packages, ${data.results.styles} styles, ${data.results.settings} settings`);
        // Refresh stats
        fetch("/api/admin/stats").then((r) => r.json()).then(setStats).catch(() => {});
      } else {
        setSeedResult(`ผิดพลาด: ${data.error}`);
      }
    } catch {
      setSeedResult("ผิดพลาด: ไม่สามารถเชื่อมต่อ API ได้");
    }
    setSeeding(false);
  };

  const cards = [
    { label: "Generations วันนี้", value: stats?.generationsToday || 0, icon: ImageIcon, color: "text-primary-light" },
    { label: "Generations ทั้งหมด", value: stats?.totalGenerations || 0, icon: BarChart3, color: "text-secondary" },
    { label: "Credits ที่ใช้", value: stats?.totalCreditsUsed || 0, icon: Coins, color: "text-warning" },
    { label: "Active Users", value: stats?.activeUsers || 0, icon: Users, color: "text-success" },
    { label: "รายได้วันนี้ (฿)", value: stats?.revenueToday || 0, icon: TrendingUp, color: "text-green-400" },
    { label: "รายได้ทั้งหมด (฿)", value: stats?.totalRevenue || 0, icon: TrendingUp, color: "text-emerald-400" },
    { label: "ต้นทุน API ($)", value: stats?.providerCosts || 0, icon: Server, color: "text-orange-400" },
    { label: "Error Rate", value: `${stats?.errorRate || 0}%`, icon: AlertCircle, color: "text-error" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">แดชบอร์ด</h1>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted">{card.label}</span>
              <card.icon className={`w-4 h-4 ${card.color}`} />
            </div>
            <div className="text-2xl font-bold">
              {typeof card.value === "number" ? card.value.toLocaleString() : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Seed Data */}
      <div className="glass rounded-xl p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Database className="w-5 h-5 text-accent" />
              ข้อมูลเริ่มต้น (Seed Data)
            </h2>
            <p className="text-sm text-muted mt-1">สร้าง Providers, Models, Packages, Styles, Settings ทั้งหมด</p>
          </div>
          <button
            onClick={runSeed}
            disabled={seeding}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-medium disabled:opacity-50"
          >
            {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            {seeding ? "กำลังสร้าง..." : "สร้างข้อมูลเริ่มต้น"}
          </button>
        </div>
        {seedResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${seedResult.startsWith("สำเร็จ") ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
            {seedResult}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="glass rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">ดำเนินการด่วน</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <a href="/admin/providers" className="p-4 rounded-xl bg-surface-light hover:bg-surface-lighter transition-all text-center">
            <Server className="w-8 h-8 text-primary-light mx-auto mb-2" />
            <span className="text-sm font-medium">จัดการ Providers</span>
          </a>
          <a href="/admin/pools" className="p-4 rounded-xl bg-surface-light hover:bg-surface-lighter transition-all text-center">
            <ImageIcon className="w-8 h-8 text-secondary mx-auto mb-2" />
            <span className="text-sm font-medium">จัดการ Account Pools</span>
          </a>
          <a href="/admin/packages" className="p-4 rounded-xl bg-surface-light hover:bg-surface-lighter transition-all text-center">
            <Coins className="w-8 h-8 text-warning mx-auto mb-2" />
            <span className="text-sm font-medium">จัดการแพ็กเกจ</span>
          </a>
        </div>
      </div>
    </div>
  );
}
