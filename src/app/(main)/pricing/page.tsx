"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Coins,
  Check,
  Sparkles,
  ArrowRight,
  Calculator,
  Loader2,
} from "lucide-react";

interface Package {
  id: number;
  name: string;
  slug: string;
  credits: number;
  bonusCredits: number;
  priceThb: number;
  priceUsd: number;
  badge: string | null;
  isFeatured: boolean;
  features: string | string[];
  sortOrder: number;
}

interface Model {
  id: number;
  name: string;
  category: string;
  creditsPerUnit: number;
  provider: { name: string };
}

const gradients = [
  "from-slate-500 to-slate-400",
  "from-primary to-secondary",
  "from-cyan-500 to-blue-500",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-green-400",
];

export default function PricingPage() {
  const [currency, setCurrency] = useState<"thb" | "usd">("thb");
  const [packages, setPackages] = useState<Package[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const xmanCheckoutUrl = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

  useEffect(() => {
    Promise.all([
      fetch("/api/packages").then((r) => r.json()),
      fetch("/api/models").then((r) => r.json()),
    ])
      .then(([pkgData, modelData]) => {
        setPackages(Array.isArray(pkgData) ? pkgData : pkgData.packages || pkgData);
        setModels(modelData.models || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Build credit cost table from models
  const creditCosts = useMemo(() => {
    const categories: Record<string, { min: number; max: number; examples: string[] }> = {};
    for (const m of models) {
      const key = m.category;
      if (!categories[key]) categories[key] = { min: Infinity, max: 0, examples: [] };
      categories[key].min = Math.min(categories[key].min, m.creditsPerUnit);
      categories[key].max = Math.max(categories[key].max, m.creditsPerUnit);
      if (categories[key].examples.length < 3) categories[key].examples.push(m.name);
    }
    const labels: Record<string, string> = { image: "สร้างภาพ", video: "สร้างวิดีโอ", edit: "แก้ไขภาพ" };
    return Object.entries(categories).map(([cat, data]) => ({
      type: labels[cat] || cat,
      credits: data.min === data.max ? String(data.min) : `${data.min}-${data.max}`,
      examples: data.examples.join(", "),
    }));
  }, [models]);

  const parseFeatures = (f: string | string[]): string[] => {
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f); } catch { return []; }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Header */}
      <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-light text-sm text-primary-light mb-4">
          <Coins className="w-4 h-4" /> เติมเครดิต
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          เลือกแพ็กเกจ<span className="gradient-text">ที่ใช่</span>
        </h1>
        <p className="text-muted text-lg max-w-xl mx-auto">
          ซื้อเครดิตใช้สร้างภาพและวิดีโอ AI ไม่มีวันหมดอายุ ใช้ได้ทุก Provider
        </p>

        <div className="flex items-center gap-2 justify-center mt-6">
          <button onClick={() => setCurrency("thb")} className={`px-3 py-1 rounded-lg text-sm transition-all ${currency === "thb" ? "bg-primary/20 text-primary-light" : "text-muted"}`}>
            ฿ THB
          </button>
          <button onClick={() => setCurrency("usd")} className={`px-3 py-1 rounded-lg text-sm transition-all ${currency === "usd" ? "bg-primary/20 text-primary-light" : "text-muted"}`}>
            $ USD
          </button>
        </div>
      </motion.div>

      {/* Packages */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass rounded-2xl p-6 h-80 animate-shimmer" />
          ))}
        </div>
      ) : (
        <div className={`grid gap-6 mb-20 ${packages.length <= 3 ? "sm:grid-cols-3" : packages.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"}`}>
          {packages.map((pkg, i) => {
            const features = parseFeatures(pkg.features);
            return (
              <motion.div
                key={pkg.id}
                className={`relative glass rounded-2xl p-6 flex flex-col ${pkg.isFeatured ? "ring-2 ring-primary/50 shadow-xl shadow-primary/10" : ""}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                {pkg.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-primary to-secondary text-white text-xs font-bold whitespace-nowrap">
                    {pkg.badge}
                  </div>
                )}

                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradients[i % gradients.length]} flex items-center justify-center mb-4`}>
                  <Coins className="w-6 h-6 text-white" />
                </div>

                <h3 className="text-xl font-bold mb-1">{pkg.name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold">
                    {currency === "thb" ? `฿${Number(pkg.priceThb).toLocaleString()}` : `$${Number(pkg.priceUsd)}`}
                  </span>
                </div>

                <div className="text-sm text-muted mb-4">
                  {pkg.credits.toLocaleString()}{pkg.bonusCredits > 0 ? ` + ${pkg.bonusCredits.toLocaleString()} โบนัส` : ""} เครดิต
                </div>

                <ul className="space-y-2 mb-6 flex-1">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {Number(pkg.priceThb) === 0 ? (
                  <Link href="/generate" className="w-full py-3 rounded-xl font-semibold text-center transition-all flex items-center justify-center gap-2 glass-light hover:bg-surface-light">
                    เริ่มใช้ฟรี <ArrowRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <a
                    href={`${xmanCheckoutUrl}/checkout/ai-credits/${pkg.slug}?ref=ai`}
                    className={`w-full py-3 rounded-xl font-semibold text-center transition-all flex items-center justify-center gap-2 ${
                      pkg.isFeatured
                        ? "bg-gradient-to-r from-primary to-secondary text-white hover:shadow-lg hover:shadow-primary/30"
                        : "glass-light hover:bg-surface-light"
                    }`}
                  >
                    ซื้อเลย <ArrowRight className="w-4 h-4" />
                  </a>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Credit Cost Table */}
      {creditCosts.length > 0 && (
        <motion.div className="glass rounded-2xl p-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <div className="flex items-center gap-3 mb-6">
            <Calculator className="w-6 h-6 text-primary-light" />
            <h2 className="text-2xl font-bold">ตารางเครดิต</h2>
          </div>
          <p className="text-muted mb-6">เครดิตที่ใช้ขึ้นอยู่กับโมเดลและคุณภาพ</p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-muted font-medium">ประเภท</th>
                  <th className="text-center py-3 px-4 text-muted font-medium">เครดิต/ครั้ง</th>
                  <th className="text-left py-3 px-4 text-muted font-medium">ตัวอย่างโมเดล</th>
                </tr>
              </thead>
              <tbody>
                {creditCosts.map((row) => (
                  <tr key={row.type} className="border-b border-border/50 hover:bg-surface-light/30 transition-colors">
                    <td className="py-3 px-4 font-medium">{row.type}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary-light text-xs font-medium">{row.credits}</span>
                    </td>
                    <td className="py-3 px-4 text-muted">{row.examples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Wallet Note */}
      <motion.div className="mt-8 glass rounded-xl p-6 flex items-start gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
        <Sparkles className="w-6 h-6 text-primary-light shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold mb-1">ใช้ Wallet จาก XMAN Studio ได้</h3>
          <p className="text-sm text-muted">
            หากคุณมี Wallet balance ที่{" "}
            <a href="https://xman4289.com" className="text-primary-light underline" target="_blank" rel="noopener noreferrer">xman4289.com</a>{" "}
            สามารถใช้จ่ายซื้อเครดิตได้โดยตรงผ่านหน้าชำระเงิน
          </p>
        </div>
      </motion.div>
    </div>
  );
}
