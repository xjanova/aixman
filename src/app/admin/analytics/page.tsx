"use client";

import { useState, useEffect } from "react";
import {
  BarChart3,
  RefreshCw,
  TrendingUp,
  Coins,
  Layers,
  Calendar,
  DollarSign,
  Image as ImageIcon,
} from "lucide-react";

interface DailyGeneration {
  date: string;
  count: number;
}

interface TopModel {
  name: string;
  modelId: string;
  count: number;
  creditsUsed: number;
}

interface CreditSummary {
  totalPurchased: number;
  totalUsed: number;
  totalBonus: number;
  revenue: number;
  cost: number;
  profit: number;
}

interface AnalyticsData {
  dailyGenerations: DailyGeneration[];
  topModels: TopModel[];
  creditSummary: CreditSummary;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = () => {
    setLoading(true);
    fetch("/api/admin/analytics")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const dailyGenerations = data?.dailyGenerations || [];
  const topModels = data?.topModels || [];
  const creditSummary = data?.creditSummary || {
    totalPurchased: 0,
    totalUsed: 0,
    totalBonus: 0,
    revenue: 0,
    cost: 0,
    profit: 0,
  };

  const maxDailyCount = Math.max(...dailyGenerations.map((d) => d.count), 1);
  const maxModelCount = Math.max(...topModels.map((m) => m.count), 1);

  const formatThb = (n: number) =>
    new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      minimumFractionDigits: 0,
    }).format(n);

  const formatUsd = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(n);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric" });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary-light" />
            สถิติและวิเคราะห์
          </h1>
          <p className="text-sm text-muted mt-1">
            ภาพรวมการใช้งานระบบ AI ย้อนหลัง 7 วัน
          </p>
        </div>
        <button
          onClick={fetchAnalytics}
          className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">รายได้ (THB)</span>
                <TrendingUp className="w-4 h-4 text-success" />
              </div>
              <div className="text-2xl font-bold text-success">
                {formatThb(creditSummary.revenue)}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">ต้นทุน API (USD)</span>
                <DollarSign className="w-4 h-4 text-warning" />
              </div>
              <div className="text-2xl font-bold text-warning">
                {formatUsd(creditSummary.cost)}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">กำไร (THB)</span>
                <TrendingUp className="w-4 h-4 text-primary-light" />
              </div>
              <div
                className={`text-2xl font-bold ${
                  creditSummary.profit >= 0 ? "text-success" : "text-error"
                }`}
              >
                {formatThb(creditSummary.profit)}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">เครดิตที่ซื้อ</span>
                <Coins className="w-4 h-4 text-primary-light" />
              </div>
              <div className="text-2xl font-bold">
                {creditSummary.totalPurchased.toLocaleString()}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">เครดิตที่ใช้</span>
                <Coins className="w-4 h-4 text-orange-400" />
              </div>
              <div className="text-2xl font-bold">
                {creditSummary.totalUsed.toLocaleString()}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">โบนัสเครดิต</span>
                <Coins className="w-4 h-4 text-secondary" />
              </div>
              <div className="text-2xl font-bold">
                {creditSummary.totalBonus.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Daily Generations Chart */}
            <div className="glass rounded-xl p-6">
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
                <Calendar className="w-4 h-4 text-primary-light" />
                Generations ต่อวัน (7 วันล่าสุด)
              </h2>
              {dailyGenerations.length === 0 ? (
                <div className="text-center text-muted py-8 text-sm">
                  ยังไม่มีข้อมูล
                </div>
              ) : (
                <div className="space-y-2">
                  {dailyGenerations.map((day) => (
                    <div key={day.date} className="flex items-center gap-3">
                      <span className="text-xs text-muted w-16 shrink-0 text-right">
                        {formatDate(day.date)}
                      </span>
                      <div className="flex-1 h-7 bg-surface-light rounded-lg overflow-hidden relative">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-secondary rounded-lg transition-all duration-500"
                          style={{
                            width: `${Math.max(
                              (day.count / maxDailyCount) * 100,
                              2
                            )}%`,
                          }}
                        />
                        <span className="absolute inset-0 flex items-center px-2 text-xs font-medium">
                          {day.count.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Models Chart */}
            <div className="glass rounded-xl p-6">
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
                <Layers className="w-4 h-4 text-primary-light" />
                Top 5 โมเดลที่ใช้มากสุด
              </h2>
              {topModels.length === 0 ? (
                <div className="text-center text-muted py-8 text-sm">
                  ยังไม่มีข้อมูล
                </div>
              ) : (
                <div className="space-y-3">
                  {topModels.slice(0, 5).map((model, idx) => (
                    <div key={model.modelId}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-surface-lighter flex items-center justify-center text-xs text-muted">
                            {idx + 1}
                          </span>
                          {model.name}
                        </span>
                        <span className="text-xs text-muted flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" />{" "}
                          {model.count.toLocaleString()} |{" "}
                          <Coins className="w-3 h-3 text-warning" />{" "}
                          {model.creditsUsed.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-5 bg-surface-light rounded-lg overflow-hidden">
                        <div
                          className="h-full rounded-lg transition-all duration-500"
                          style={{
                            width: `${Math.max(
                              (model.count / maxModelCount) * 100,
                              2
                            )}%`,
                            background:
                              idx === 0
                                ? "linear-gradient(to right, var(--color-primary), var(--color-secondary))"
                                : idx === 1
                                ? "linear-gradient(to right, var(--color-secondary), var(--color-accent))"
                                : `hsl(${200 + idx * 30}, 60%, 50%)`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Revenue vs Cost Visual */}
          <div className="glass rounded-xl p-6 mt-6">
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <DollarSign className="w-4 h-4 text-primary-light" />
              รายได้ vs ต้นทุน
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted">รายได้ (THB)</span>
                  <span className="text-sm font-bold text-success">
                    {formatThb(creditSummary.revenue)}
                  </span>
                </div>
                <div className="h-8 bg-surface-light rounded-lg overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-lg transition-all duration-500"
                    style={{
                      width: `${
                        creditSummary.revenue > 0
                          ? Math.max(
                              (creditSummary.revenue /
                                Math.max(
                                  creditSummary.revenue,
                                  creditSummary.cost * 35
                                )) *
                                100,
                              5
                            )
                          : 5
                      }%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted">ต้นทุน (USD x35)</span>
                  <span className="text-sm font-bold text-warning">
                    {formatThb(creditSummary.cost * 35)}
                  </span>
                </div>
                <div className="h-8 bg-surface-light rounded-lg overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-lg transition-all duration-500"
                    style={{
                      width: `${
                        creditSummary.cost > 0
                          ? Math.max(
                              ((creditSummary.cost * 35) /
                                Math.max(
                                  creditSummary.revenue,
                                  creditSummary.cost * 35
                                )) *
                                100,
                              5
                            )
                          : 5
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">
                  อัตราส่วนกำไร (Margin)
                </span>
                <span
                  className={`text-lg font-bold ${
                    creditSummary.revenue > 0 &&
                    creditSummary.profit / creditSummary.revenue > 0
                      ? "text-success"
                      : "text-error"
                  }`}
                >
                  {creditSummary.revenue > 0
                    ? `${(
                        (creditSummary.profit / creditSummary.revenue) *
                        100
                      ).toFixed(1)}%`
                    : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
