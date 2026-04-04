"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Coins,
  Check,
  Star,
  Zap,
  Crown,
  Sparkles,
  ArrowRight,
  Calculator,
} from "lucide-react";

// These will come from the API (admin-configurable)
const creditPackages = [
  {
    id: 1,
    name: "Starter",
    slug: "starter",
    credits: 100,
    bonusCredits: 0,
    priceThb: 99,
    priceUsd: 2.99,
    badge: null,
    isFeatured: false,
    features: ["100 เครดิต", "ภาพ ~25-33 ภาพ", "วิดีโอ ~5-8 คลิป", "ไม่มีวันหมดอายุ"],
    icon: Coins,
    gradient: "from-slate-500 to-slate-400",
  },
  {
    id: 2,
    name: "Creator",
    slug: "creator",
    credits: 500,
    bonusCredits: 50,
    priceThb: 399,
    priceUsd: 11.99,
    badge: "ยอดนิยม",
    isFeatured: true,
    features: ["500 + 50 โบนัส เครดิต", "ภาพ ~137 ภาพ", "วิดีโอ ~36 คลิป", "ประหยัด 20%", "ไม่มีวันหมดอายุ"],
    icon: Star,
    gradient: "from-primary to-secondary",
  },
  {
    id: 3,
    name: "Pro",
    slug: "pro",
    credits: 1500,
    bonusCredits: 250,
    priceThb: 999,
    priceUsd: 29.99,
    badge: "คุ้มที่สุด",
    isFeatured: false,
    features: ["1,500 + 250 โบนัส เครดิต", "ภาพ ~437 ภาพ", "วิดีโอ ~116 คลิป", "ประหยัด 33%", "ไม่มีวันหมดอายุ"],
    icon: Zap,
    gradient: "from-cyan-500 to-blue-500",
  },
  {
    id: 4,
    name: "Enterprise",
    slug: "enterprise",
    credits: 5000,
    bonusCredits: 1500,
    priceThb: 2499,
    priceUsd: 74.99,
    badge: "สำหรับทีม",
    isFeatured: false,
    features: ["5,000 + 1,500 โบนัส เครดิต", "ภาพ ~1,625 ภาพ", "วิดีโอ ~433 คลิป", "ประหยัด 50%", "ซัพพอร์ตพิเศษ"],
    icon: Crown,
    gradient: "from-amber-500 to-orange-500",
  },
];

const creditCosts = [
  { type: "ภาพ (มาตรฐาน)", credits: "3-4", examples: "Seedream, FLUX Schnell, SD 3.5" },
  { type: "ภาพ (พรีเมียม)", credits: "5-8", examples: "GPT Image 1, FLUX Pro, Image Ultra" },
  { type: "วิดีโอ (5 วินาที)", credits: "12-15", examples: "Seedance, Gen-4 Turbo, Kling" },
  { type: "วิดีโอ (พรีเมียม)", credits: "20-25", examples: "Sora 2, Gen-4.5, Veo 3" },
  { type: "แก้ไขภาพ", credits: "2-5", examples: "Upscale, Inpaint, Background Remove" },
];

export default function PricingPage() {
  const [currency, setCurrency] = useState<"thb" | "usd">("thb");
  const xmanCheckoutUrl = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Header */}
      <motion.div
        className="text-center mb-16"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-light text-sm text-primary-light mb-4">
          <Coins className="w-4 h-4" />
          เติมเครดิต
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          เลือกแพ็กเกจ<span className="gradient-text">ที่ใช่</span>
        </h1>
        <p className="text-muted text-lg max-w-xl mx-auto">
          ซื้อเครดิตใช้สร้างภาพและวิดีโอ AI ไม่มีวันหมดอายุ ใช้ได้ทุก Provider
        </p>

        {/* Currency toggle */}
        <div className="flex items-center gap-2 justify-center mt-6">
          <button
            onClick={() => setCurrency("thb")}
            className={`px-3 py-1 rounded-lg text-sm transition-all ${currency === "thb" ? "bg-primary/20 text-primary-light" : "text-muted"}`}
          >
            ฿ THB
          </button>
          <button
            onClick={() => setCurrency("usd")}
            className={`px-3 py-1 rounded-lg text-sm transition-all ${currency === "usd" ? "bg-primary/20 text-primary-light" : "text-muted"}`}
          >
            $ USD
          </button>
        </div>
      </motion.div>

      {/* Packages */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
        {creditPackages.map((pkg, i) => (
          <motion.div
            key={pkg.id}
            className={`relative glass rounded-2xl p-6 flex flex-col ${
              pkg.isFeatured ? "ring-2 ring-primary/50 shadow-xl shadow-primary/10" : ""
            }`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            {pkg.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-primary to-secondary text-white text-xs font-bold">
                {pkg.badge}
              </div>
            )}

            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${pkg.gradient} flex items-center justify-center mb-4`}>
              <pkg.icon className="w-6 h-6 text-white" />
            </div>

            <h3 className="text-xl font-bold mb-1">{pkg.name}</h3>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-3xl font-bold">
                {currency === "thb" ? `฿${pkg.priceThb}` : `$${pkg.priceUsd}`}
              </span>
            </div>

            <div className="text-sm text-muted mb-4">
              {pkg.credits.toLocaleString()} {pkg.bonusCredits > 0 && `+ ${pkg.bonusCredits.toLocaleString()} โบนัส`} เครดิต
            </div>

            <ul className="space-y-2 mb-6 flex-1">
              {pkg.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

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
          </motion.div>
        ))}
      </div>

      {/* Credit Cost Table */}
      <motion.div
        className="glass rounded-2xl p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
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
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary-light text-xs font-medium">
                      {row.credits}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted">{row.examples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Wallet Integration Note */}
      <motion.div
        className="mt-8 glass rounded-xl p-6 flex items-start gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <Sparkles className="w-6 h-6 text-primary-light shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold mb-1">ใช้ Wallet จาก XMAN Studio ได้</h3>
          <p className="text-sm text-muted">
            หากคุณมี Wallet balance ที่ <a href="https://xman4289.com" className="text-primary-light underline" target="_blank" rel="noopener noreferrer">xman4289.com</a> สามารถใช้จ่ายซื้อเครดิตได้โดยตรงผ่านหน้าชำระเงิน
          </p>
        </div>
      </motion.div>
    </div>
  );
}
