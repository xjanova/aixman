"use client";

import { Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/navbar";
import {
  Sparkles,
  Image as ImageIcon,
  Video,
  Wand2,
  Zap,
  Shield,
  Layers,
  ArrowRight,
  Star,
  Globe,
} from "lucide-react";

const HeroScene = dynamic(
  () => import("@/components/three/hero-scene").then((m) => m.HeroScene),
  { ssr: false }
);

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.1 } },
};

const providerList = [
  { name: "BytePlus", desc: "Seedream & Seedance", color: "from-blue-500 to-cyan-400" },
  { name: "OpenAI", desc: "GPT Image & Sora", color: "from-green-500 to-emerald-400" },
  { name: "Stability AI", desc: "Stable Diffusion 3.5", color: "from-purple-500 to-violet-400" },
  { name: "Runway ML", desc: "Gen-4.5 & Veo 3", color: "from-pink-500 to-rose-400" },
  { name: "Replicate", desc: "FLUX & 1000+ Models", color: "from-orange-500 to-amber-400" },
  { name: "fal.ai", desc: "Fast Inference", color: "from-cyan-500 to-teal-400" },
  { name: "Kling AI", desc: "Video Generation", color: "from-red-500 to-pink-400" },
  { name: "Luma AI", desc: "Dream Machine", color: "from-indigo-500 to-purple-400" },
  { name: "Leonardo.ai", desc: "Creative AI", color: "from-yellow-500 to-orange-400" },
];

const features = [
  {
    icon: Layers,
    title: "หลากหลาย Provider",
    desc: "เลือกใช้ AI จากผู้ให้บริการชั้นนำกว่า 9 ราย รวมกว่า 50+ โมเดล",
  },
  {
    icon: Zap,
    title: "เร็วทันใจ",
    desc: "ระบบ Account Pool กระจายโหลดอัตโนมัติ ไม่ต้องรอคิวนาน",
  },
  {
    icon: Shield,
    title: "ปลอดภัย & เสถียร",
    desc: "Auto-failover เมื่อ provider ขัดข้อง สลับไปใช้ตัวสำรองทันที",
  },
  {
    icon: Wand2,
    title: "ใช้ง่ายมาก",
    desc: "เลือกสไตล์ พิมพ์ prompt กด Generate เสร็จ! ไม่ต้องมีความรู้ AI",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background bg-grid">
      <Navbar />

      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
        <Suspense fallback={null}>
          <HeroScene />
        </Suspense>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background pointer-events-none" />

        <motion.div
          className="relative z-10 text-center px-4 max-w-4xl mx-auto"
          initial="initial"
          animate="animate"
          variants={stagger}
        >
          <motion.div variants={fadeUp} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-light text-sm text-primary-light mb-6">
              <Sparkles className="w-4 h-4" />
              AI Generation Platform
            </span>
          </motion.div>

          <motion.h1
            className="text-5xl sm:text-6xl md:text-7xl font-bold mb-6 leading-tight"
            variants={fadeUp}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            สร้างสรรค์ผลงาน
            <br />
            <span className="gradient-text">ด้วยพลัง AI</span>
          </motion.h1>

          <motion.p
            className="text-lg sm:text-xl text-muted max-w-2xl mx-auto mb-8"
            variants={fadeUp}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            สร้างภาพและวิดีโอคุณภาพสูงจาก AI ชั้นนำของโลก
            ทุก Provider ในที่เดียว ราคาเป็นมิตร
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4 justify-center"
            variants={fadeUp}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <Link
              href="/generate"
              className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold text-lg hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-105"
            >
              <Wand2 className="w-5 h-5" />
              เริ่มสร้างเลย
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl glass-light font-semibold text-lg hover:bg-surface-light transition-all"
            >
              <Star className="w-5 h-5 text-warning" />
              ดูราคา
            </Link>
          </motion.div>

          <motion.div
            className="flex flex-wrap justify-center gap-8 mt-12 text-center"
            variants={fadeUp}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            {[
              { value: "9+", label: "AI Providers" },
              { value: "50+", label: "โมเดล" },
              { value: "4K", label: "ความละเอียดสูงสุด" },
              { value: "24/7", label: "พร้อมใช้งาน" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-2xl font-bold gradient-text">{stat.value}</div>
                <div className="text-sm text-muted">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              ทำไมต้อง <span className="gradient-text">XMAN AI</span>
            </h2>
            <p className="text-muted text-lg">แพลตฟอร์มที่รวมพลัง AI ชั้นนำของโลกไว้ในที่เดียว</p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                className="glass rounded-2xl p-6 hover:bg-surface-light/50 transition-all group"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-6 h-6 text-primary-light" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Generation Types */}
      <section className="py-24 px-4 bg-surface/50">
        <div className="max-w-6xl mx-auto">
          <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">สร้างได้ <span className="gradient-text">ทุกอย่าง</span></h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: ImageIcon, title: "สร้างภาพ AI", desc: "Text-to-Image คมชัดสูงสุด 4K จาก Seedream, FLUX, DALL-E, Stable Diffusion", gradient: "from-primary to-purple-500", href: "/generate" },
              { icon: Video, title: "สร้างวิดีโอ AI", desc: "Text-to-Video & Image-to-Video จาก Seedance, Sora, Runway Gen-4, Kling, Luma", gradient: "from-secondary to-cyan-400", href: "/generate?type=video" },
              { icon: Wand2, title: "แก้ไขภาพ AI", desc: "Inpainting, Outpainting, Upscale, Background Remove และอื่นๆ", gradient: "from-accent to-pink-400", href: "/generate?type=edit" },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}>
                <Link href={item.href} className="block glass rounded-2xl p-8 hover:bg-surface-light/50 transition-all group h-full">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center mb-6 group-hover:scale-110 group-hover:shadow-xl transition-all`}>
                    <item.icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                  <p className="text-muted">{item.desc}</p>
                  <div className="mt-4 flex items-center gap-1 text-primary-light text-sm font-medium group-hover:gap-2 transition-all">
                    เริ่มสร้าง <ArrowRight className="w-4 h-4" />
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Providers */}
      <section className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              <Globe className="inline w-8 h-8 text-primary-light mr-2 mb-1" />
              รวม AI ชั้นนำ <span className="gradient-text">ของโลก</span>
            </h2>
            <p className="text-muted text-lg">เลือกใช้ได้ตามต้องการ ราคาตรงไปตรงมา</p>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {providerList.map((provider, i) => (
              <motion.div
                key={provider.name}
                className="glass rounded-xl p-4 text-center hover:bg-surface-light/50 transition-all group cursor-default"
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${provider.color} mx-auto mb-3 flex items-center justify-center text-white font-bold text-sm group-hover:scale-110 transition-transform`}>
                  {provider.name.charAt(0)}
                </div>
                <div className="font-semibold text-sm">{provider.name}</div>
                <div className="text-xs text-muted mt-1">{provider.desc}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div className="glass rounded-3xl p-12 relative overflow-hidden" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5" />
            <div className="relative">
              <Sparkles className="w-12 h-12 text-primary-light mx-auto mb-6" />
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">พร้อมสร้างสรรค์แล้วหรือยัง?</h2>
              <p className="text-muted text-lg mb-8">สมัครฟรี รับเครดิตทดลองใช้ เริ่มสร้างภาพและวิดีโอ AI ได้ทันที</p>
              <Link
                href="/generate"
                className="inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold text-lg hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-105"
              >
                <Wand2 className="w-5 h-5" /> เริ่มต้นใช้งาน
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-light" />
            <span>XMAN AI Studio</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="hover:text-foreground transition-colors">ราคา</Link>
            <a href="https://xman4289.com" className="hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer">XMAN Studio</a>
          </div>
          <div>&copy; 2026 XMAN Studio. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
