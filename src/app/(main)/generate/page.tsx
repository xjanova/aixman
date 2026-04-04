"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/components/ui/toast-provider";
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
  Coins,
  Clock,
  Check,
  AlertCircle,
} from "lucide-react";

type TabType = "image" | "video" | "edit";

const aspectRatios = [
  { value: "1:1", label: "1:1", w: 1024, h: 1024 },
  { value: "16:9", label: "16:9", w: 1344, h: 768 },
  { value: "9:16", label: "9:16", w: 768, h: 1344 },
  { value: "4:3", label: "4:3", w: 1152, h: 896 },
  { value: "3:2", label: "3:2", w: 1216, h: 832 },
];

interface GenerationResult {
  id: number;
  status: string;
  resultUrl?: string;
  resultUrls?: string[];
  thumbnailUrl?: string;
  creditsUsed: number;
  processingMs?: number;
  error?: string;
}

export default function GeneratePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const {
    models, fetchModels, modelsLoaded,
    styles, fetchStyles, stylesLoaded,
    creditBalance, fetchCredits,
    isGenerating, setIsGenerating,
  } = useAppStore();

  const [tab, setTab] = useState<TabType>("image");
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [inputImagePreview, setInputImagePreview] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (session === null) router.push("/login");
  }, [session, router]);

  // Load data
  useEffect(() => {
    fetchModels();
    fetchStyles();
    fetchCredits();
  }, [fetchModels, fetchStyles, fetchCredits]);

  // Filter models by tab
  const filteredModels = models.filter((m) => m.category === tab);

  // Auto-select first model when tab changes or models load
  useEffect(() => {
    if (filteredModels.length > 0 && (!selectedModelId || !filteredModels.find((m) => m.id === selectedModelId))) {
      const featured = filteredModels.find((m) => m.isFeatured);
      setSelectedModelId(featured?.id ?? filteredModels[0].id);
    }
  }, [tab, modelsLoaded, filteredModels, selectedModelId]);

  const selectedModel = models.find((m) => m.id === selectedModelId);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setInputImage(base64);
      setInputImagePreview(base64);
    };
    reader.readAsDataURL(file);
  };

  // Poll for result
  const pollResult = useCallback(async (generationId: number) => {
    const maxAttempts = 120; // 2 minutes max
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/generate/${generationId}`);
        if (!res.ok) break;
        const data = await res.json();
        if (data.status === "completed") {
          setResult({
            id: data.id,
            status: "completed",
            resultUrl: data.resultUrl,
            resultUrls: data.resultUrls ? (Array.isArray(data.resultUrls) ? data.resultUrls : [data.resultUrl]) : [data.resultUrl],
            thumbnailUrl: data.thumbnailUrl,
            creditsUsed: data.creditsUsed,
            processingMs: data.processingMs,
          });
          setIsGenerating(false);
          fetchCredits();
          toast("success", "สร้างสำเร็จ!", `ใช้ ${data.creditsUsed} เครดิต`);
          return;
        }
        if (data.status === "failed") {
          setResult({ id: data.id, status: "failed", creditsUsed: 0, error: data.errorMessage });
          setIsGenerating(false);
          fetchCredits();
          toast("error", "สร้างไม่สำเร็จ", data.errorMessage || "เกิดข้อผิดพลาด");
          return;
        }
      } catch { break; }
    }
    setIsGenerating(false);
    toast("error", "หมดเวลา", "การสร้างใช้เวลานานเกินไป กรุณาลองใหม่");
  }, [setIsGenerating, fetchCredits, toast]);

  // Generate
  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModelId) return;
    if (isGenerating) return;

    setIsGenerating(true);
    setResult(null);
    setIsFavorited(false);

    const ar = aspectRatios.find((a) => a.value === aspectRatio);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: selectedModelId,
          type: tab,
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          styleId: selectedStyle || undefined,
          inputImage: inputImage || undefined,
          params: {
            width: ar?.w || 1024,
            height: ar?.h || 1024,
            aspectRatio,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setIsGenerating(false);
        toast("error", "เกิดข้อผิดพลาด", data.error || "ไม่สามารถสร้างได้");
        return;
      }

      if (data.status === "completed") {
        setResult(data);
        setIsGenerating(false);
        fetchCredits();
        toast("success", "สร้างสำเร็จ!", `ใช้ ${data.creditsUsed} เครดิต`);
      } else if (data.status === "failed") {
        setResult(data);
        setIsGenerating(false);
        fetchCredits();
        toast("error", "สร้างไม่สำเร็จ", data.error || "เกิดข้อผิดพลาด");
      } else {
        // Still processing — poll
        pollResult(data.id);
      }
    } catch {
      setIsGenerating(false);
      toast("error", "เกิดข้อผิดพลาด", "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    }
  };

  // Download
  const handleDownload = async () => {
    if (!result?.resultUrl) return;
    try {
      const res = await fetch(result.resultUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `xman-ai-${result.id}.${result.resultUrl.includes(".mp4") ? "mp4" : "webp"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("success", "ดาวน์โหลดสำเร็จ");
    } catch {
      toast("error", "ดาวน์โหลดไม่สำเร็จ");
    }
  };

  // Favorite
  const handleFavorite = async () => {
    if (!result?.id) return;
    try {
      if (isFavorited) {
        await fetch("/api/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId: result.id }),
        });
        setIsFavorited(false);
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId: result.id }),
        });
        setIsFavorited(true);
      }
    } catch {}
  };

  // Share
  const handleShare = async () => {
    if (!result?.resultUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "XMAN AI Generation", url: result.resultUrl });
      } catch {}
    } else {
      await navigator.clipboard.writeText(result.resultUrl);
      toast("info", "คัดลอกลิงก์แล้ว");
    }
  };

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Left Panel — Controls */}
          <div className="w-full lg:w-96 shrink-0 space-y-4">

            {/* Tabs */}
            <div className="glass rounded-xl p-1 flex">
              {([
                { key: "image" as TabType, icon: ImageIcon, label: "สร้างภาพ" },
                { key: "video" as TabType, icon: Video, label: "สร้างวิดีโอ" },
                { key: "edit" as TabType, icon: Wand2, label: "แก้ไขภาพ" },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key); setResult(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    tab === t.key
                      ? "bg-gradient-to-r from-primary to-secondary text-white shadow-lg"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Model Selector */}
            <div className="glass rounded-xl p-4" ref={dropdownRef}>
              <label className="text-xs text-muted mb-2 block">โมเดล AI</label>
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-surface-light hover:bg-surface-lighter transition-all"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {selectedModel ? selectedModel.name : "เลือกโมเดล..."}
                  </span>
                  {selectedModel && (
                    <span className="text-xs text-muted shrink-0">
                      {selectedModel.provider.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedModel && (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <Coins className="w-3 h-3" />
                      {selectedModel.creditsPerUnit}
                    </span>
                  )}
                  <ChevronDown className="w-4 h-4 text-muted" />
                </div>
              </button>

              <AnimatePresence>
                {showModelDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-surface border border-border"
                  >
                    {filteredModels.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted">ไม่มีโมเดลสำหรับหมวดนี้</div>
                    ) : (
                      filteredModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { setSelectedModelId(m.id); setShowModelDropdown(false); }}
                          className={`w-full flex items-center justify-between p-3 hover:bg-surface-light transition-all text-left ${
                            selectedModelId === m.id ? "bg-primary/10" : ""
                          }`}
                        >
                          <div>
                            <div className="text-sm font-medium flex items-center gap-2">
                              {m.name}
                              {m.isFeatured && <Sparkles className="w-3 h-3 text-warning" />}
                            </div>
                            <div className="text-xs text-muted">{m.provider.name}{m.subcategory ? ` · ${m.subcategory}` : ""}</div>
                          </div>
                          <span className="flex items-center gap-1 text-xs text-warning shrink-0">
                            <Coins className="w-3 h-3" /> {m.creditsPerUnit}
                          </span>
                        </button>
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Prompt */}
            <div className="glass rounded-xl p-4">
              <label className="text-xs text-muted mb-2 block">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={tab === "video" ? "อธิบายวิดีโอที่ต้องการ..." : "อธิบายภาพที่ต้องการ..."}
                rows={4}
                className="w-full p-3 rounded-lg bg-surface-light text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {/* Style Selector */}
            {stylesLoaded && styles.length > 0 && tab !== "edit" && (
              <div className="glass rounded-xl p-4">
                <label className="text-xs text-muted mb-2 block">สไตล์</label>
                <div className="grid grid-cols-3 gap-2">
                  {styles.slice(0, 12).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStyle(selectedStyle === s.id ? null : s.id)}
                      className={`p-2 rounded-lg text-xs text-center transition-all ${
                        selectedStyle === s.id
                          ? "bg-primary/20 border border-primary/40 text-primary-light"
                          : "bg-surface-light hover:bg-surface-lighter text-muted"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Aspect Ratio (image only) */}
            {tab === "image" && (
              <div className="glass rounded-xl p-4">
                <label className="text-xs text-muted mb-2 block">สัดส่วน</label>
                <div className="flex gap-2">
                  {aspectRatios.map((ar) => (
                    <button
                      key={ar.value}
                      onClick={() => setAspectRatio(ar.value)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                        aspectRatio === ar.value
                          ? "bg-primary/20 border border-primary/40 text-primary-light"
                          : "bg-surface-light hover:bg-surface-lighter text-muted"
                      }`}
                    >
                      {ar.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Image Upload (edit & video) */}
            {(tab === "edit" || tab === "video") && (
              <div className="glass rounded-xl p-4">
                <label className="text-xs text-muted mb-2 block">
                  {tab === "edit" ? "ภาพต้นฉบับ" : "ภาพเริ่มต้น (ไม่บังคับ)"}
                </label>
                {inputImagePreview ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inputImagePreview} alt="Input" className="w-full rounded-lg max-h-48 object-cover" />
                    <button
                      onClick={() => { setInputImage(null); setInputImagePreview(null); }}
                      className="absolute top-2 right-2 p-1 rounded-full bg-black/60 hover:bg-black/80"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-8 rounded-lg border-2 border-dashed border-border hover:border-primary/30 cursor-pointer transition-all">
                    <Upload className="w-8 h-8 text-muted mb-2" />
                    <span className="text-sm text-muted">อัปโหลดภาพ</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                )}
              </div>
            )}

            {/* Advanced Settings */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs text-muted hover:text-foreground transition-all"
            >
              <Settings2 className="w-3.5 h-3.5" />
              ตั้งค่าขั้นสูง
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </button>

            {showAdvanced && (
              <div className="glass rounded-xl p-4">
                <label className="text-xs text-muted mb-2 block">Negative Prompt</label>
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="สิ่งที่ไม่ต้องการในภาพ..."
                  rows={2}
                  className="w-full p-3 rounded-lg bg-surface-light text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim() || !selectedModelId}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-gradient-to-r from-primary via-secondary to-accent text-white font-semibold text-lg disabled:opacity-50 hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-[1.02] disabled:hover:scale-100"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  กำลังสร้าง...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  สร้าง
                  {selectedModel && (
                    <span className="flex items-center gap-1 text-sm opacity-80">
                      ({selectedModel.creditsPerUnit} <Coins className="w-3.5 h-3.5" />)
                    </span>
                  )}
                </>
              )}
            </button>

            {/* Credit Balance */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted">
              <Coins className="w-4 h-4 text-warning" />
              เครดิตคงเหลือ: <span className="font-semibold text-foreground">{creditBalance.toLocaleString()}</span>
            </div>
          </div>

          {/* Right Panel — Result */}
          <div className="flex-1 min-w-0">
            <div className="glass rounded-2xl p-6 min-h-[500px] flex items-center justify-center">
              <AnimatePresence mode="wait">
                {isGenerating ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center"
                  >
                    <div className="relative w-24 h-24 mx-auto mb-6">
                      <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
                      <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                      <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-primary-light animate-pulse" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">กำลังสร้าง...</h3>
                    <p className="text-sm text-muted">
                      {tab === "video" ? "วิดีโออาจใช้เวลา 30-120 วินาที" : "รอสักครู่..."}
                    </p>
                  </motion.div>
                ) : result?.status === "completed" && result.resultUrl ? (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full"
                  >
                    <div className="relative rounded-xl overflow-hidden mb-4">
                      {tab === "video" || result.resultUrl.endsWith(".mp4") ? (
                        <video
                          src={result.resultUrl}
                          controls
                          autoPlay
                          loop
                          className="w-full rounded-xl max-h-[600px] mx-auto"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={result.resultUrl}
                          alt={prompt}
                          className="w-full rounded-xl max-h-[600px] object-contain mx-auto"
                        />
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button onClick={handleDownload} className="flex items-center gap-1.5 px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm transition-all">
                          <Download className="w-4 h-4" /> ดาวน์โหลด
                        </button>
                        <button onClick={handleFavorite} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm transition-all ${isFavorited ? "text-error" : ""}`}>
                          <Heart className={`w-4 h-4 ${isFavorited ? "fill-current" : ""}`} /> {isFavorited ? "บันทึกแล้ว" : "บันทึก"}
                        </button>
                        <button onClick={handleShare} className="flex items-center gap-1.5 px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm transition-all">
                          <Share2 className="w-4 h-4" /> แชร์
                        </button>
                      </div>
                      <button
                        onClick={() => { setResult(null); }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm transition-all"
                      >
                        <RotateCcw className="w-4 h-4" /> สร้างใหม่
                      </button>
                    </div>

                    {/* Generation Info */}
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted">
                      {result.creditsUsed > 0 && (
                        <span className="flex items-center gap-1"><Coins className="w-3 h-3" /> {result.creditsUsed} เครดิต</span>
                      )}
                      {result.processingMs && (
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {(result.processingMs / 1000).toFixed(1)}s</span>
                      )}
                      <span className="flex items-center gap-1"><Check className="w-3 h-3 text-success" /> สำเร็จ</span>
                    </div>
                  </motion.div>
                ) : result?.status === "failed" ? (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center"
                  >
                    <AlertCircle className="w-16 h-16 text-error mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">สร้างไม่สำเร็จ</h3>
                    <p className="text-sm text-muted mb-4">{result.error || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ"}</p>
                    <button
                      onClick={() => setResult(null)}
                      className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
                    >
                      ลองอีกครั้ง
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center"
                  >
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center mx-auto mb-6">
                      {tab === "video" ? (
                        <Video className="w-10 h-10 text-primary-light" />
                      ) : tab === "edit" ? (
                        <Wand2 className="w-10 h-10 text-primary-light" />
                      ) : (
                        <ImageIcon className="w-10 h-10 text-primary-light" />
                      )}
                    </div>
                    <h3 className="text-lg font-semibold mb-2">
                      {tab === "video" ? "สร้างวิดีโอ AI" : tab === "edit" ? "แก้ไขภาพ AI" : "สร้างภาพ AI"}
                    </h3>
                    <p className="text-sm text-muted">
                      เลือกโมเดล พิมพ์ prompt แล้วกดสร้าง
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
