"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Image as ImageIcon,
  Video,
  Wand2,
  Settings2,
  ChevronDown,
  Loader2,
  Download,
  Heart,
  Share2,
  RotateCcw,
  X,
  Upload,
} from "lucide-react";

type TabType = "image" | "video" | "edit";

interface ModelOption {
  id: number;
  name: string;
  provider: string;
  providerLogo?: string;
  credits: number;
  category: string;
}

// Will be fetched from API, placeholder for now
const demoModels: ModelOption[] = [
  { id: 1, name: "Seedream 5.0 Lite", provider: "BytePlus", credits: 3, category: "image" },
  { id: 2, name: "GPT Image 1", provider: "OpenAI", credits: 5, category: "image" },
  { id: 3, name: "FLUX 1.1 Pro", provider: "Replicate", credits: 4, category: "image" },
  { id: 4, name: "SD 3.5 Large", provider: "Stability AI", credits: 4, category: "image" },
  { id: 5, name: "Seedance 2.0", provider: "BytePlus", credits: 15, category: "video" },
  { id: 6, name: "Sora 2", provider: "OpenAI", credits: 20, category: "video" },
  { id: 7, name: "Gen-4 Turbo", provider: "Runway ML", credits: 12, category: "video" },
  { id: 8, name: "Kling 2.5", provider: "Kling AI", credits: 14, category: "video" },
];

const stylePresets = [
  { id: "none", name: "ไม่มี", emoji: "🎨" },
  { id: "photorealistic", name: "สมจริง", emoji: "📷" },
  { id: "anime", name: "อนิเมะ", emoji: "🎌" },
  { id: "cyberpunk", name: "Cyberpunk", emoji: "🌆" },
  { id: "fantasy", name: "แฟนตาซี", emoji: "🧙" },
  { id: "watercolor", name: "สีน้ำ", emoji: "🖌️" },
  { id: "3d-render", name: "3D Render", emoji: "🎮" },
  { id: "cinematic", name: "ภาพยนตร์", emoji: "🎬" },
  { id: "minimalist", name: "มินิมอล", emoji: "◽" },
];

const aspectRatios = [
  { value: "1:1", label: "1:1", w: 1024, h: 1024 },
  { value: "16:9", label: "16:9", w: 1344, h: 768 },
  { value: "9:16", label: "9:16", w: 768, h: 1344 },
  { value: "4:3", label: "4:3", w: 1152, h: 896 },
  { value: "3:2", label: "3:2", w: 1216, h: 832 },
];

export default function GeneratePage() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<TabType>("image");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<number | null>(null);
  const [selectedStyle, setSelectedStyle] = useState("none");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const filteredModels = demoModels.filter((m) => m.category === activeTab || (activeTab === "edit" && m.category === "image"));
  const currentModel = filteredModels.find((m) => m.id === selectedModel) || filteredModels[0];

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || !session) return;
    setIsGenerating(true);
    setResult(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: currentModel?.id,
          type: activeTab,
          prompt,
          negativePrompt: negativePrompt || undefined,
          params: {
            aspectRatio,
            width: aspectRatios.find((a) => a.value === aspectRatio)?.w,
            height: aspectRatios.find((a) => a.value === aspectRatio)?.h,
          },
          styleId: selectedStyle !== "none" ? selectedStyle : undefined,
        }),
      });

      const data = await res.json();
      if (data.resultUrl) {
        setResult(data.resultUrl);
      }
    } catch {
      // Error handling
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, negativePrompt, session, currentModel, activeTab, aspectRatio, selectedStyle]);

  const tabs = [
    { id: "image" as TabType, label: "สร้างภาพ", icon: ImageIcon },
    { id: "video" as TabType, label: "สร้างวิดีโอ", icon: Video },
    { id: "edit" as TabType, label: "แก้ไขภาพ", icon: Wand2 },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Tab selector */}
      <div className="flex items-center gap-1 p-1 rounded-xl glass-light w-fit mb-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedModel(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/20"
                : "text-muted hover:text-foreground hover:bg-surface-light"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr,400px] gap-6">
        {/* Result Area */}
        <div className="order-2 lg:order-1">
          <div className="glass rounded-2xl p-6 min-h-[500px] flex items-center justify-center relative overflow-hidden">
            <AnimatePresence mode="wait">
              {isGenerating ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center"
                >
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                  </div>
                  <p className="text-muted">กำลังสร้าง{activeTab === "video" ? "วิดีโอ" : "ภาพ"}...</p>
                  <p className="text-xs text-muted/60 mt-1">อาจใช้เวลา 10-120 วินาที</p>
                </motion.div>
              ) : result ? (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full"
                >
                  {activeTab === "video" ? (
                    <video src={result} controls className="w-full rounded-xl max-h-[600px] object-contain mx-auto" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result} alt="Generated" className="w-full rounded-xl max-h-[600px] object-contain mx-auto" />
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center justify-center gap-3 mt-4">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light text-sm hover:bg-surface-light transition-all">
                      <Download className="w-4 h-4" /> ดาวน์โหลด
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light text-sm hover:bg-surface-light transition-all">
                      <Heart className="w-4 h-4" /> บันทึก
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light text-sm hover:bg-surface-light transition-all">
                      <Share2 className="w-4 h-4" /> แชร์
                    </button>
                    <button
                      onClick={() => setResult(null)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light text-sm hover:bg-surface-light transition-all"
                    >
                      <RotateCcw className="w-4 h-4" /> สร้างใหม่
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center"
                >
                  <div className="w-20 h-20 rounded-2xl bg-surface-light flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-8 h-8 text-muted" />
                  </div>
                  <p className="text-muted">พิมพ์ prompt แล้วกด Generate</p>
                  <p className="text-xs text-muted/60 mt-1">ผลลัพธ์จะแสดงที่นี่</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="order-1 lg:order-2 space-y-4">
          {/* Model Selector */}
          <div className="glass rounded-xl p-4">
            <label className="text-xs text-muted uppercase tracking-wider mb-2 block">โมเดล AI</label>
            <div className="relative">
              <button
                onClick={() => setModelMenuOpen(!modelMenuOpen)}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-surface-light hover:bg-surface-lighter transition-all text-left"
              >
                <div>
                  <div className="font-medium text-sm">{currentModel?.name || "เลือกโมเดล"}</div>
                  <div className="text-xs text-muted">{currentModel?.provider} &middot; {currentModel?.credits} เครดิต</div>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {modelMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full left-0 right-0 mt-1 glass rounded-xl p-1 z-20 max-h-60 overflow-y-auto"
                  >
                    {filteredModels.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => { setSelectedModel(model.id); setModelMenuOpen(false); }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left text-sm hover:bg-surface-light transition-all ${
                          model.id === currentModel?.id ? "bg-surface-light" : ""
                        }`}
                      >
                        <div>
                          <div className="font-medium">{model.name}</div>
                          <div className="text-xs text-muted">{model.provider}</div>
                        </div>
                        <span className="text-xs text-primary-light font-medium">{model.credits} cr</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Prompt */}
          <div className="glass rounded-xl p-4">
            <label className="text-xs text-muted uppercase tracking-wider mb-2 block">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={activeTab === "video" ? "อธิบายวิดีโอที่ต้องการ..." : "อธิบายภาพที่ต้องการ..."}
              className="w-full bg-surface-light rounded-lg p-3 text-sm resize-none h-28 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted/50"
            />
          </div>

          {/* Style Presets */}
          <div className="glass rounded-xl p-4">
            <label className="text-xs text-muted uppercase tracking-wider mb-2 block">สไตล์</label>
            <div className="flex flex-wrap gap-2">
              {stylePresets.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedStyle === style.id
                      ? "bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/20"
                      : "bg-surface-light text-muted hover:text-foreground hover:bg-surface-lighter"
                  }`}
                >
                  {style.emoji} {style.name}
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div className="glass rounded-xl p-4">
            <label className="text-xs text-muted uppercase tracking-wider mb-2 block">สัดส่วน</label>
            <div className="flex gap-2">
              {aspectRatios.map((ar) => (
                <button
                  key={ar.value}
                  onClick={() => setAspectRatio(ar.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    aspectRatio === ar.value
                      ? "bg-primary/20 text-primary-light border border-primary/30"
                      : "bg-surface-light text-muted hover:bg-surface-lighter"
                  }`}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          </div>

          {/* Image upload for img2img / img2vid */}
          {(activeTab === "edit" || activeTab === "video") && (
            <div className="glass rounded-xl p-4">
              <label className="text-xs text-muted uppercase tracking-wider mb-2 block">
                ภาพต้นฉบับ {activeTab === "edit" ? "(จำเป็น)" : "(ไม่จำเป็น)"}
              </label>
              <div className="border-2 border-dashed border-border-light rounded-lg p-6 text-center cursor-pointer hover:border-primary/30 transition-all">
                <Upload className="w-8 h-8 text-muted mx-auto mb-2" />
                <p className="text-sm text-muted">คลิกหรือลากไฟล์มาวาง</p>
                <p className="text-xs text-muted/60 mt-1">PNG, JPG, WebP (สูงสุด 10MB)</p>
              </div>
            </div>
          )}

          {/* Advanced Settings */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-muted hover:text-foreground transition-all w-full"
          >
            <Settings2 className="w-4 h-4" />
            ตั้งค่าขั้นสูง
            <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="glass rounded-xl p-4 space-y-3">
                  <div>
                    <label className="text-xs text-muted mb-1 block">Negative Prompt</label>
                    <textarea
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      placeholder="สิ่งที่ไม่ต้องการในภาพ..."
                      className="w-full bg-surface-light rounded-lg p-2.5 text-sm resize-none h-16 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted/50"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating || !session}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold text-lg hover:shadow-xl hover:shadow-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                กำลังสร้าง...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                สร้าง ({currentModel?.credits || 0} เครดิต)
              </>
            )}
          </button>

          {!session && (
            <p className="text-xs text-center text-muted">
              กรุณา <a href="/login" className="text-primary-light underline">เข้าสู่ระบบ</a> เพื่อเริ่มสร้าง
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
