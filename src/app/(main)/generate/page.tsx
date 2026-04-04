"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/components/ui/toast-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Sparkles,
  Image as ImageIcon,
  Video,
  Wand2,
  Settings2,
  ChevronDown,
  ChevronUp,
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
  ZoomIn,
  Layers,
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

  // Image-to-Image states
  const [showRefImage, setShowRefImage] = useState(false);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [refImagePreview, setRefImagePreview] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.75);

  // Batch generation
  const [numOutputs, setNumOutputs] = useState(1);

  // Upscale
  const [isUpscaling, setIsUpscaling] = useState(false);

  useEffect(() => {
    if (session === null) router.push("/login");
  }, [session, router]);

  useEffect(() => {
    fetchModels();
    fetchStyles();
    fetchCredits();
  }, [fetchModels, fetchStyles, fetchCredits]);

  const filteredModels = models.filter((m) => m.category === tab);

  useEffect(() => {
    if (filteredModels.length > 0 && (!selectedModelId || !filteredModels.find((m) => m.id === selectedModelId))) {
      const featured = filteredModels.find((m) => m.isFeatured);
      setSelectedModelId(featured?.id ?? filteredModels[0].id);
    }
  }, [tab, modelsLoaded, filteredModels, selectedModelId]);

  const selectedModel = models.find((m) => m.id === selectedModelId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isRef = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      if (isRef) {
        setRefImage(base64);
        setRefImagePreview(base64);
      } else {
        setInputImage(base64);
        setInputImagePreview(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const pollResult = useCallback(async (generationId: number) => {
    const maxAttempts = 120;
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

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModelId) return;
    if (isGenerating) return;

    setIsGenerating(true);
    setResult(null);
    setIsFavorited(false);

    const ar = aspectRatios.find((a) => a.value === aspectRatio);

    // Use refImage for img2img, inputImage for edit/video
    const imageToSend = tab === "image" ? refImage : inputImage;

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
          inputImage: imageToSend || undefined,
          params: {
            width: ar?.w || 1024,
            height: ar?.h || 1024,
            aspectRatio,
            strength: refImage && tab === "image" ? strength : undefined,
            numOutputs: tab === "image" ? numOutputs : undefined,
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
        pollResult(data.id);
      }
    } catch {
      setIsGenerating(false);
      toast("error", "เกิดข้อผิดพลาด", "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    }
  };

  const handleDownload = async (url?: string) => {
    const downloadUrl = url || result?.resultUrl;
    if (!downloadUrl) return;
    try {
      const res = await fetch(downloadUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `xman-ai-${result?.id || "gen"}.${downloadUrl.includes(".mp4") ? "mp4" : "webp"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast("success", "ดาวน์โหลดสำเร็จ");
    } catch {
      toast("error", "ดาวน์โหลดไม่สำเร็จ");
    }
  };

  const handleFavorite = async () => {
    if (!result?.id) return;
    try {
      if (isFavorited) {
        await fetch("/api/favorites", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: result.id }) });
        setIsFavorited(false);
      } else {
        await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: result.id }) });
        setIsFavorited(true);
      }
    } catch {}
  };

  const handleShare = async () => {
    if (!result?.resultUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: "XMAN AI Generation", url: result.resultUrl }); } catch {}
    } else {
      await navigator.clipboard.writeText(result.resultUrl);
      toast("info", "คัดลอกลิงก์แล้ว");
    }
  };

  const handleUpscale = async () => {
    if (!result?.id) return;
    setIsUpscaling(true);
    try {
      const res = await fetch("/api/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: result.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast("error", "Upscale ไม่สำเร็จ", data.error || "เกิดข้อผิดพลาด");
        setIsUpscaling(false);
        return;
      }
      // If completed immediately
      if (data.status === "completed" && data.resultUrl) {
        setResult(prev => prev ? { ...prev, resultUrl: data.resultUrl } : prev);
        fetchCredits();
        toast("success", "Upscale สำเร็จ!", `ใช้ ${data.creditsUsed} เครดิต`);
      } else {
        // Poll for completion
        const maxAttempts = 60;
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const pollRes = await fetch(`/api/generate/${data.id}`);
          if (!pollRes.ok) break;
          const pollData = await pollRes.json();
          if (pollData.status === "completed") {
            setResult(prev => prev ? { ...prev, resultUrl: pollData.resultUrl } : prev);
            fetchCredits();
            toast("success", "Upscale สำเร็จ!", `ใช้ ${pollData.creditsUsed} เครดิต`);
            break;
          }
          if (pollData.status === "failed") {
            toast("error", "Upscale ไม่สำเร็จ", pollData.errorMessage);
            break;
          }
        }
      }
    } catch {
      toast("error", "Upscale ไม่สำเร็จ");
    }
    setIsUpscaling(false);
  };

  const totalCredits = selectedModel ? selectedModel.creditsPerUnit * numOutputs : 0;

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Left Panel — Controls */}
          <div className="w-full lg:w-96 shrink-0 space-y-4">

            {/* Tabs */}
            <Card className="p-1.5">
              <div className="flex gap-1 neu-inset-sm rounded-xl p-1">
                {([
                  { key: "image" as TabType, icon: ImageIcon, label: "สร้างภาพ" },
                  { key: "video" as TabType, icon: Video, label: "สร้างวิดีโอ" },
                  { key: "edit" as TabType, icon: Wand2, label: "แก้ไขภาพ" },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => { setTab(t.key); setResult(null); setNumOutputs(1); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      tab === t.key
                        ? "bg-gradient-to-r from-primary to-secondary text-white neu-raised-sm shadow-[0_4px_12px_rgba(59,130,246,0.25)]"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <t.icon className="w-4 h-4" />
                    {t.label}
                  </button>
                ))}
              </div>
            </Card>

            {/* Model Selector */}
            <Card className="p-4" ref={dropdownRef}>
              <label className="text-xs text-muted mb-2 block">โมเดล AI</label>
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-surface-light/80 neu-inset-sm hover:bg-surface-lighter/80 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {selectedModel ? selectedModel.name : "เลือกโมเดล..."}
                  </span>
                  {selectedModel && (
                    <span className="text-xs text-muted shrink-0">{selectedModel.provider.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedModel && (
                    <Badge variant="warning" size="sm">
                      <Coins className="w-3 h-3" /> {selectedModel.creditsPerUnit}
                    </Badge>
                  )}
                  <ChevronDown className={`w-4 h-4 text-muted transition-transform ${showModelDropdown ? "rotate-180" : ""}`} />
                </div>
              </button>

              <AnimatePresence>
                {showModelDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="mt-2 max-h-64 overflow-y-auto rounded-xl glass-neu border border-border/30"
                  >
                    {filteredModels.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted">ไม่มีโมเดลสำหรับหมวดนี้</div>
                    ) : (
                      filteredModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { setSelectedModelId(m.id); setShowModelDropdown(false); }}
                          className={`w-full flex items-center justify-between p-3 hover:bg-surface-light/50 transition-all text-left cursor-pointer ${
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
                          <Badge variant="warning" size="sm">
                            <Coins className="w-3 h-3" /> {m.creditsPerUnit}
                          </Badge>
                        </button>
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>

            {/* Prompt */}
            <Card className="p-4">
              <label className="text-xs text-muted mb-2 block">Prompt</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={tab === "video" ? "อธิบายวิดีโอที่ต้องการ..." : "อธิบายภาพที่ต้องการ..."}
                rows={4}
              />
            </Card>

            {/* Style Selector */}
            {stylesLoaded && styles.length > 0 && tab !== "edit" && (
              <Card className="p-4">
                <label className="text-xs text-muted mb-2 block">สไตล์</label>
                <div className="grid grid-cols-3 gap-2">
                  {styles.slice(0, 12).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStyle(selectedStyle === s.id ? null : s.id)}
                      className={`p-2 rounded-lg text-xs text-center transition-all cursor-pointer ${
                        selectedStyle === s.id
                          ? "bg-primary/20 border border-primary/40 text-primary-light neu-raised-sm"
                          : "bg-surface-light/80 neu-inset-sm hover:bg-surface-lighter/80 text-muted"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {/* Aspect Ratio (image only) */}
            {tab === "image" && (
              <Card className="p-4">
                <label className="text-xs text-muted mb-2 block">สัดส่วน</label>
                <div className="flex gap-2">
                  {aspectRatios.map((ar) => (
                    <button
                      key={ar.value}
                      onClick={() => setAspectRatio(ar.value)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        aspectRatio === ar.value
                          ? "bg-primary/20 border border-primary/40 text-primary-light neu-raised-sm"
                          : "bg-surface-light/80 neu-inset-sm hover:bg-surface-lighter/80 text-muted"
                      }`}
                    >
                      {ar.label}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {/* Batch Generation (image only) */}
            {tab === "image" && (
              <Card className="p-4">
                <label className="text-xs text-muted mb-2 block">
                  <Layers className="w-3 h-3 inline mr-1" />
                  จำนวนภาพ
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setNumOutputs(n)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                        numOutputs === n
                          ? "bg-primary/20 border border-primary/40 text-primary-light neu-raised-sm"
                          : "bg-surface-light/80 neu-inset-sm hover:bg-surface-lighter/80 text-muted"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {/* Image-to-Image Reference (image tab only) */}
            {tab === "image" && (
              <Card className="p-4">
                <button
                  onClick={() => setShowRefImage(!showRefImage)}
                  className="flex items-center justify-between w-full text-xs text-muted hover:text-foreground transition-all cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" />
                    Image-to-Image (ภาพอ้างอิง)
                  </span>
                  {showRefImage ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showRefImage && (
                  <div className="mt-3 space-y-3">
                    {refImagePreview ? (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={refImagePreview} alt="Reference" className="w-full rounded-xl max-h-48 object-cover" />
                        <button
                          onClick={() => { setRefImage(null); setRefImagePreview(null); }}
                          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-border/50 neu-inset-sm hover:border-primary/30 cursor-pointer transition-all">
                        <Upload className="w-6 h-6 text-muted mb-2" />
                        <span className="text-xs text-muted">อัปโหลดภาพอ้างอิง</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, true)} />
                      </label>
                    )}

                    <div>
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-muted">ความเข้มอ้างอิง</span>
                        <span className="text-primary-light font-medium">{Math.round(strength * 100)}%</span>
                      </div>
                      <Slider
                        value={[strength]}
                        onValueChange={(v) => setStrength(v[0])}
                        min={0}
                        max={1}
                        step={0.05}
                      />
                      <div className="flex justify-between text-[10px] text-muted mt-1">
                        <span>ยึด prompt มาก</span>
                        <span>ยึดภาพมาก</span>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Image Upload (edit & video) */}
            {(tab === "edit" || tab === "video") && (
              <Card className="p-4">
                <label className="text-xs text-muted mb-2 block">
                  {tab === "edit" ? "ภาพต้นฉบับ" : "ภาพเริ่มต้น (ไม่บังคับ)"}
                </label>
                {inputImagePreview ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inputImagePreview} alt="Input" className="w-full rounded-xl max-h-48 object-cover" />
                    <button
                      onClick={() => { setInputImage(null); setInputImagePreview(null); }}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-border/50 neu-inset-sm hover:border-primary/30 cursor-pointer transition-all">
                    <Upload className="w-6 h-6 text-muted mb-2" />
                    <span className="text-xs text-muted">อัปโหลดภาพ</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e)} />
                  </label>
                )}
              </Card>
            )}

            {/* Advanced Settings */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs text-muted hover:text-foreground transition-all cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5" />
              ตั้งค่าขั้นสูง
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </button>

            {showAdvanced && (
              <Card className="p-4">
                <label className="text-xs text-muted mb-2 block">Negative Prompt</label>
                <Textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="สิ่งที่ไม่ต้องการในภาพ..."
                  rows={2}
                  className="min-h-[60px]"
                />
              </Card>
            )}

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim() || !selectedModelId}
              loading={isGenerating}
              size="xl"
              className="w-full"
              leftIcon={!isGenerating ? <Sparkles className="w-5 h-5" /> : undefined}
            >
              {isGenerating ? "กำลังสร้าง..." : (
                <>
                  สร้าง
                  {selectedModel && (
                    <span className="flex items-center gap-1 text-sm opacity-80">
                      ({totalCredits} <Coins className="w-3.5 h-3.5" />)
                    </span>
                  )}
                </>
              )}
            </Button>

            {/* Credit Balance */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted">
              <Coins className="w-4 h-4 text-warning" />
              เครดิตคงเหลือ: <span className="font-semibold text-foreground">{creditBalance.toLocaleString()}</span>
            </div>
          </div>

          {/* Right Panel — Result */}
          <div className="flex-1 min-w-0">
            <Card variant="elevated" className="p-6 min-h-[500px] flex items-center justify-center">
              <AnimatePresence mode="wait">
                {isGenerating ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
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
                  <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="w-full">
                    {/* Batch results grid */}
                    {result.resultUrls && result.resultUrls.length > 1 ? (
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        {result.resultUrls.map((url, idx) => (
                          <div key={idx} className="relative rounded-xl overflow-hidden group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`Result ${idx + 1}`} className="w-full rounded-xl object-contain" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                              <Button variant="icon" size="icon-sm" onClick={() => handleDownload(url)} className="bg-white/20 backdrop-blur-sm">
                                <Download className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="relative rounded-xl overflow-hidden mb-4">
                        {/* Side-by-side comparison for img2img */}
                        {refImagePreview && tab === "image" ? (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="relative">
                              <div className="absolute top-2 left-2 z-10">
                                <Badge variant="glass" size="sm">ต้นฉบับ</Badge>
                              </div>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={refImagePreview} alt="Original" className="w-full rounded-xl object-contain opacity-70" />
                            </div>
                            <div className="relative">
                              <div className="absolute top-2 left-2 z-10">
                                <Badge variant="success" size="sm">ผลลัพธ์</Badge>
                              </div>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={result.resultUrl} alt={prompt} className="w-full rounded-xl object-contain" />
                            </div>
                          </div>
                        ) : tab === "video" || result.resultUrl.endsWith(".mp4") ? (
                          <video src={result.resultUrl} controls autoPlay loop className="w-full rounded-xl max-h-[600px] mx-auto" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={result.resultUrl} alt={prompt} className="w-full rounded-xl max-h-[600px] object-contain mx-auto" />
                        )}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => handleDownload()} leftIcon={<Download className="w-4 h-4" />}>
                          ดาวน์โหลด
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleFavorite}
                          className={isFavorited ? "text-error" : ""}
                          leftIcon={<Heart className={`w-4 h-4 ${isFavorited ? "fill-current" : ""}`} />}
                        >
                          {isFavorited ? "บันทึกแล้ว" : "บันทึก"}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={handleShare} leftIcon={<Share2 className="w-4 h-4" />}>
                          แชร์
                        </Button>
                        {/* Upscale button */}
                        {tab !== "video" && !result.resultUrl.endsWith(".mp4") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleUpscale}
                            loading={isUpscaling}
                            leftIcon={<ZoomIn className="w-4 h-4" />}
                          >
                            Upscale
                          </Button>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setResult(null)} leftIcon={<RotateCcw className="w-4 h-4" />}>
                        สร้างใหม่
                      </Button>
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
                  <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                    <div className="w-20 h-20 rounded-2xl bg-error/10 flex items-center justify-center mx-auto mb-4 neu-raised-sm">
                      <AlertCircle className="w-10 h-10 text-error" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">สร้างไม่สำเร็จ</h3>
                    <p className="text-sm text-muted mb-4">{result.error || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ"}</p>
                    <Button onClick={() => setResult(null)}>ลองอีกครั้ง</Button>
                  </motion.div>
                ) : (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center mx-auto mb-6 neu-raised-sm">
                      {tab === "video" ? <Video className="w-10 h-10 text-primary-light" /> : tab === "edit" ? <Wand2 className="w-10 h-10 text-primary-light" /> : <ImageIcon className="w-10 h-10 text-primary-light" />}
                    </div>
                    <h3 className="text-lg font-semibold mb-2">
                      {tab === "video" ? "สร้างวิดีโอ AI" : tab === "edit" ? "แก้ไขภาพ AI" : "สร้างภาพ AI"}
                    </h3>
                    <p className="text-sm text-muted">เลือกโมเดล พิมพ์ prompt แล้วกดสร้าง</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
