"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Coins,
  Check,
  Sparkles,
  ArrowRight,
  Calculator,
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
      <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Badge variant="glass" size="lg" className="mb-4 px-4 py-2">
          <Coins className="w-4 h-4 text-warning" /> เติมเครดิต
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          เลือกแพ็กเกจ<span className="gradient-text">ที่ใช่</span>
        </h1>
        <p className="text-muted text-lg max-w-xl mx-auto">
          ซื้อเครดิตใช้สร้างภาพและวิดีโอ AI ไม่มีวันหมดอายุ ใช้ได้ทุก Provider
        </p>

        <div className="flex items-center gap-1 justify-center mt-6 p-1 rounded-xl neu-inset-sm bg-surface/60 inline-flex">
          <button onClick={() => setCurrency("thb")} className={`px-4 py-1.5 rounded-lg text-sm transition-all cursor-pointer ${currency === "thb" ? "bg-gradient-to-r from-primary to-secondary text-white neu-raised-sm" : "text-muted"}`}>
            ฿ THB
          </button>
          <button onClick={() => setCurrency("usd")} className={`px-4 py-1.5 rounded-lg text-sm transition-all cursor-pointer ${currency === "usd" ? "bg-gradient-to-r from-primary to-secondary text-white neu-raised-sm" : "text-muted"}`}>
            $ USD
          </button>
        </div>
      </motion.div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
          {[1, 2, 3, 4].map((i) => (<div key={i} className="glass rounded-2xl p-6 h-80 animate-shimmer" />))}
        </div>
      ) : (
        <div className={`grid gap-6 mb-20 ${packages.length <= 3 ? "sm:grid-cols-3" : packages.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"}`}>
          {packages.map((pkg, i) => {
            const features = parseFeatures(pkg.features);
            return (
              <motion.div key={pkg.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <Card variant={pkg.isFeatured ? "elevated" : "default"} className={`relative p-6 flex flex-col h-full ${pkg.isFeatured ? "ring-2 ring-primary/40" : ""}`}>
                  {pkg.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge variant="primary" size="default" className="bg-gradient-to-r from-primary to-secondary text-white border-0 whitespace-nowrap">
                        {pkg.badge}
                      </Badge>
                    </div>
                  )}

                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradients[i % gradients.length]} flex items-center justify-center mb-4 neu-raised-sm`}>
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
                    <Link href="/generate">
                      <Button variant="secondary" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                        เริ่มใช้ฟรี
                      </Button>
                    </Link>
                  ) : (
                    <a href={`${xmanCheckoutUrl}/checkout/ai-credits/${pkg.slug}?ref=ai`}>
                      <Button variant={pkg.isFeatured ? "default" : "secondary"} className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                        ซื้อเลย
                      </Button>
                    </a>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {creditCosts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card variant="elevated" className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center neu-raised-sm">
                <Calculator className="w-5 h-5 text-primary-light" />
              </div>
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
                        <Badge variant="primary" size="sm">{row.credits}</Badge>
                      </td>
                      <td className="py-3 px-4 text-muted">{row.examples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
        <Card className="mt-8 p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center shrink-0 neu-raised-sm">
              <Sparkles className="w-5 h-5 text-primary-light" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">ใช้ Wallet จาก XMAN Studio ได้</h3>
              <p className="text-sm text-muted">
                หากคุณมี Wallet balance ที่{" "}
                <a href="https://xman4289.com" className="text-primary-light underline" target="_blank" rel="noopener noreferrer">xman4289.com</a>{" "}
                สามารถใช้จ่ายซื้อเครดิตได้โดยตรงผ่านหน้าชำระเงิน
              </p>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
