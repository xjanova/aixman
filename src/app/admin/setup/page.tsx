"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Server,
  Key,
  Package,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";

type Step = 1 | 2 | 3 | 4;

const providerDefaults = [
  { slug: "byteplus", name: "BytePlus", apiKeyLabel: "API Key", hasSecret: false, baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3" },
  { slug: "openai", name: "OpenAI", apiKeyLabel: "API Key", hasSecret: false, baseUrl: "https://api.openai.com/v1" },
  { slug: "replicate", name: "Replicate", apiKeyLabel: "API Token", hasSecret: false, baseUrl: "https://api.replicate.com/v1" },
  { slug: "fal", name: "fal.ai", apiKeyLabel: "API Key", hasSecret: false, baseUrl: "" },
  { slug: "stability", name: "Stability AI", apiKeyLabel: "API Key", hasSecret: false, baseUrl: "https://api.stability.ai" },
  { slug: "runway", name: "Runway ML", apiKeyLabel: "API Secret", hasSecret: false, baseUrl: "https://api.dev.runwayml.com/v1" },
  { slug: "kling", name: "Kling AI", apiKeyLabel: "Access Key", hasSecret: true, baseUrl: "https://api.klingai.com" },
  { slug: "luma", name: "Luma AI", apiKeyLabel: "API Key", hasSecret: false, baseUrl: "https://api.lumalabs.ai/dream-machine/v1" },
  { slug: "leonardo", name: "Leonardo.ai", apiKeyLabel: "API Key", hasSecret: false, baseUrl: "https://cloud.leonardo.ai/api/rest/v1" },
];

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [siteName, setSiteName] = useState("XMAN AI Studio");
  const [siteDesc, setSiteDesc] = useState("AI Image & Video Generation Platform");
  const [selectedProviders, setSelectedProviders] = useState<string[]>(["byteplus", "openai", "replicate"]);
  const [apiKeys, setApiKeys] = useState<Record<string, { key: string; secret?: string }>>({});
  const [encryptionKey, setEncryptionKey] = useState("");

  const toggleProvider = (slug: string) => {
    setSelectedProviders((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const setApiKey = (slug: string, key: string, secret?: string) => {
    setApiKeys((prev) => ({ ...prev, [slug]: { key, secret } }));
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteName,
          siteDesc,
          encryptionKey,
          providers: selectedProviders.map((slug) => ({
            slug,
            apiKey: apiKeys[slug]?.key || "",
            apiSecret: apiKeys[slug]?.secret || "",
          })),
        }),
      });
      router.push("/admin");
    } catch {
      // Error handling
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    { num: 1, label: "ข้อมูลพื้นฐาน", icon: Sparkles },
    { num: 2, label: "เลือก Providers", icon: Server },
    { num: 3, label: "API Keys", icon: Key },
    { num: 4, label: "เสร็จสิ้น", icon: CheckCircle2 },
  ];

  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s.num} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                step >= s.num ? "bg-gradient-to-r from-primary to-secondary text-white" : "bg-surface-light text-muted"
              }`}>
                {step > s.num ? <CheckCircle2 className="w-4 h-4" /> : s.num}
              </div>
              <span className={`text-xs ml-1 hidden sm:block ${step >= s.num ? "text-foreground" : "text-muted"}`}>
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div className={`w-8 h-px mx-2 ${step > s.num ? "bg-primary" : "bg-surface-lighter"}`} />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Basic Info */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-bold mb-6">ตั้งค่าเบื้องต้น</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted mb-1 block">ชื่อเว็บไซต์</label>
                  <input value={siteName} onChange={(e) => setSiteName(e.target.value)} className="w-full p-3 rounded-lg bg-surface-light focus:outline-none focus:ring-1 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="text-sm text-muted mb-1 block">คำอธิบาย</label>
                  <input value={siteDesc} onChange={(e) => setSiteDesc(e.target.value)} className="w-full p-3 rounded-lg bg-surface-light focus:outline-none focus:ring-1 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="text-sm text-muted mb-1 block">Encryption Key (สำหรับเข้ารหัส API keys)</label>
                  <input value={encryptionKey} onChange={(e) => setEncryptionKey(e.target.value)} type="password" placeholder="ขั้นต่ำ 32 ตัวอักษร" className="w-full p-3 rounded-lg bg-surface-light focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  <p className="text-xs text-muted mt-1">ใช้สำหรับเข้ารหัส API keys ในฐานข้อมูล เก็บรักษาให้ดี!</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: Select Providers */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-bold mb-2">เลือก AI Providers</h2>
              <p className="text-muted text-sm mb-6">เลือก provider ที่ต้องการใช้งาน (เพิ่มเติมได้ภายหลัง)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {providerDefaults.map((p) => (
                  <button
                    key={p.slug}
                    onClick={() => toggleProvider(p.slug)}
                    className={`p-4 rounded-xl text-center transition-all ${
                      selectedProviders.includes(p.slug)
                        ? "bg-primary/10 border border-primary/30 text-foreground"
                        : "bg-surface-light text-muted hover:bg-surface-lighter"
                    }`}
                  >
                    <div className="text-2xl mb-1">{p.name.charAt(0)}</div>
                    <div className="text-sm font-medium">{p.name}</div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 3: API Keys */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-bold mb-2">ใส่ API Keys</h2>
              <p className="text-muted text-sm mb-6">ใส่ API key สำหรับ provider ที่เลือก (เว้นว่างได้ ตั้งค่าทีหลัง)</p>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {selectedProviders.map((slug) => {
                  const p = providerDefaults.find((d) => d.slug === slug);
                  if (!p) return null;
                  return (
                    <div key={slug} className="p-4 rounded-xl bg-surface-light">
                      <label className="text-sm font-medium mb-2 block">{p.name}</label>
                      <input
                        type="password"
                        placeholder={p.apiKeyLabel}
                        value={apiKeys[slug]?.key || ""}
                        onChange={(e) => setApiKey(slug, e.target.value, apiKeys[slug]?.secret)}
                        className="w-full p-2.5 rounded-lg bg-surface focus:outline-none focus:ring-1 focus:ring-primary/50 text-sm mb-2"
                      />
                      {p.hasSecret && (
                        <input
                          type="password"
                          placeholder="Secret Key"
                          value={apiKeys[slug]?.secret || ""}
                          onChange={(e) => setApiKey(slug, apiKeys[slug]?.key || "", e.target.value)}
                          className="w-full p-2.5 rounded-lg bg-surface focus:outline-none focus:ring-1 focus:ring-primary/50 text-sm"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Step 4: Complete */}
          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="glass rounded-2xl p-8 text-center">
              <CheckCircle2 className="w-16 h-16 text-success mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-2">พร้อมเริ่มใช้งาน!</h2>
              <p className="text-muted mb-6">ระบบจะสร้าง Providers, Account Pools, และ Models เริ่มต้นให้</p>
              <div className="glass-light rounded-xl p-4 text-left mb-6">
                <h3 className="font-semibold text-sm mb-2">สิ่งที่จะถูกสร้าง:</h3>
                <ul className="text-sm text-muted space-y-1">
                  <li>&#x2022; {selectedProviders.length} Providers</li>
                  <li>&#x2022; {selectedProviders.filter((s) => apiKeys[s]?.key).length} Account Pools (จาก API keys ที่ใส่)</li>
                  <li>&#x2022; โมเดล AI เริ่มต้นสำหรับแต่ละ Provider</li>
                  <li>&#x2022; แพ็กเกจเครดิตเริ่มต้น 4 แพ็กเกจ</li>
                  <li>&#x2022; สไตล์ Preset เริ่มต้น</li>
                </ul>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          {step > 1 ? (
            <button onClick={() => setStep((s) => (s - 1) as Step)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground transition-all">
              <ArrowLeft className="w-4 h-4" /> ย้อนกลับ
            </button>
          ) : <div />}

          {step < 4 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-medium hover:shadow-lg hover:shadow-primary/30 transition-all"
            >
              ถัดไป <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-success to-emerald-400 text-white font-medium hover:shadow-lg transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? "กำลังตั้งค่า..." : "เริ่มต้นใช้งาน"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
