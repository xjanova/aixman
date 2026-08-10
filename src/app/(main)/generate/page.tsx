"use client";

/**
 * /generate — AI image/video/edit studio (X-DREAMER themed)
 *
 * Layout follows the X-DREAMER `StudioPage` reference (3-column workspace):
 *   left  : prompt + controls (model, style, aspect, batch, ref-image, advanced)
 *   center: generation canvas (4-frame batch grid + result)
 *   right : reference / credits panel
 *
 * All feature logic from the previous neumorphism page is preserved:
 *   tabs (image/video/edit), model picker, prompt + negative prompt,
 *   style picker, aspect ratio, batch size, img2img + strength, file upload
 *   for edit/video, advanced settings, polling, download, favorite, share,
 *   upscale, credit balance.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/components/ui/toast-provider";

const HUE = 70;

type TabType = "image" | "video" | "edit";

const aspectRatios = [
  { value: "1:1",  label: "1:1",  w: 1024, h: 1024 },
  { value: "16:9", label: "16:9", w: 1344, h: 768 },
  { value: "9:16", label: "9:16", w: 768,  h: 1344 },
  { value: "4:3",  label: "4:3",  w: 1152, h: 896 },
  { value: "3:2",  label: "3:2",  w: 1216, h: 832 },
];

/** Used to warn when a Thai prompt is sent to an English-only model. */
const THAI_CHARS = /\p{Script=Thai}/u;

const PROMPT_TAG_CHIPS = [
  "cinematic lighting", "8k", "volumetric", "aurora", "jade",
  "hyperreal", "studio light", "bokeh", "golden hour",
];

interface GenerationResult {
  id: number;
  status: string;
  resultUrl?: string;
  resultUrls?: string[];
  thumbnailUrl?: string;
  creditsUsed: number;
  processingMs?: number;
  /** Retention window, so the result view can tell the user to download it. */
  expiresAt?: string;
  daysLeft?: number | null;
  error?: string;
}

interface HistoryItem {
  id: number;
  type: string;
  prompt: string;
  resultUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
}

// ─── X-DREAMER UI primitives (local helpers) ───────────────────────────
function Pill({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 14px", borderRadius: 999, fontSize: 13, cursor: "pointer",
      background: active ? `linear-gradient(135deg, hsla(${160 + HUE},70%,55%,0.25), hsla(${270 + HUE},70%,60%,0.25))` : "rgba(255,255,255,0.04)",
      color: active ? "#fff" : "rgba(226,232,240,0.65)",
      border: active ? `1px solid hsla(${220 + HUE},70%,60%,0.5)` : "1px solid rgba(255,255,255,0.08)",
      boxShadow: active ? "inset 0 0 0 1px rgba(255,255,255,0.05)" : "none",
      transition: "all 200ms",
    }}>{children}</button>
  );
}

function Section({ label, children, grow = false }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <div style={grow ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : undefined}>
      <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#a5f3fc", marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

const ASPECT_RATIO_CSS: Record<string, string> = {
  "1:1": "1/1", "16:9": "16/9", "9:16": "9/16", "4:3": "4/3", "3:2": "3/2",
};

/**
 * Compact control that opens its contents in a floating panel.
 *
 * The studio has to fit one screen without scrolling, and the expensive items
 * were the ones rendered inline as grids — 12 style buttons, 10 template
 * chips, 9 prompt tags. Collapsing those to a single trigger row is what buys
 * the height back. Nothing is removed; it moves one click away.
 */
function Popover({
  id, open, onToggle, label, value, children, align = "left", width = 300,
}: {
  id: string;
  open: string | null;
  onToggle: (id: string | null) => void;
  label: string;
  value?: string;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isOpen = open === id;

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen, onToggle]);

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => onToggle(isOpen ? null : id)}
        style={{
          width: "100%", padding: "9px 12px", borderRadius: 10, cursor: "pointer",
          background: isOpen ? `hsla(${220 + HUE},60%,50%,0.2)` : "rgba(2,6,23,0.5)",
          border: `1px solid ${isOpen ? `hsla(${220 + HUE},70%,60%,0.45)` : "rgba(255,255,255,0.1)"}`,
          color: "#e2e8f0", fontSize: 12, fontFamily: "inherit",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
          {value && <span style={{ color: `hsl(${220 + HUE},70%,78%)`, marginLeft: 6 }}>{value}</span>}
        </span>
        <span style={{ fontSize: 8, opacity: 0.6, flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 200ms" }}>▼</span>
      </button>
      {isOpen && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 6px)",
            [align]: 0, width, maxHeight: 320, overflowY: "auto",
            background: "rgba(15,23,42,0.97)", backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
            padding: 12, zIndex: 40, boxShadow: "0 24px 48px -12px rgba(0,0,0,0.7)",
          } as React.CSSProperties}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Empty-state tile showing a real frame made on this platform.
 *
 * Deliberately NOT used for the generating state — a placeholder standing in
 * for work in progress should stay abstract, or it reads as someone else's
 * output being passed off as yours. These are labelled "ตัวอย่าง" for the
 * same reason.
 */
const STUDIO_SAMPLES: Record<string, { src: string; label: string }[]> = {
  image: [
    { src: "/showcase/portrait.jpg", label: "Seedream 5 Pro" },
    { src: "/showcase/product.jpg", label: "Seedream 5 Pro" },
    { src: "/showcase/temple.jpg", label: "Seedream 5 Pro" },
    { src: "/showcase/coast.jpg", label: "Seedream 5 Pro" },
  ],
  video: [{ src: "/showcase/city.jpg", label: "Kling 2.5" }],
  edit: [{ src: "/showcase/macro.jpg", label: "Seedream 5 Pro" }],
};

function SampleFrame({ src, label, aspect, isVideo = false }: { src: string; label: string; aspect: string; isVideo?: boolean }) {
  return (
    <div className="rp-studio-frame" style={{
      aspectRatio: ASPECT_RATIO_CSS[aspect] || "1/1",
      borderRadius: 14, position: "relative", overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(2,6,23,0.6)",
    }}>
      <Image src={src} alt="" fill sizes="(max-width:900px) 50vw, 320px" style={{ objectFit: "cover", opacity: 0.62 }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(3,6,18,0.35) 0%, rgba(3,6,18,0.2) 45%, rgba(3,6,18,0.9) 100%)" }} />
      <div style={{ position: "absolute", top: 10, left: 12, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.72)", background: "rgba(3,6,18,0.55)", backdropFilter: "blur(6px)", padding: "3px 8px", borderRadius: 999 }}>
        {isVideo ? "▶ ตัวอย่าง" : "ตัวอย่าง"}
      </div>
      <div style={{ position: "absolute", left: 12, bottom: 10, fontSize: 10, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }}>
        {label}
      </div>
    </div>
  );
}

function StudioFrame({ index, seed, aspect, generating }: { index: number; seed: number; aspect: string; generating: boolean }) {
  const hue1 = (140 + index * 35 + HUE + Math.floor(seed * 360)) % 360;
  const hue2 = (hue1 + 60) % 360;
  return (
    <div className="rp-studio-frame" style={{
      aspectRatio: ASPECT_RATIO_CSS[aspect] || "1/1",
      borderRadius: 14, position: "relative", overflow: "hidden",
      background: `linear-gradient(135deg, hsl(${hue1},60%,14%), hsl(${hue2},60%,8%))`,
      border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer",
    }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient id={`xdrSg${index}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${hue1},85%,65%)`} stopOpacity="0.9" />
            <stop offset="100%" stopColor={`hsl(${hue2},85%,70%)`} stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {Array.from({ length: 20 }).map((_, i) => (
          <path key={i}
            d={`M${-5 + i * 6} ${110 + Math.sin(i + seed * 10) * 8} Q${40 + Math.sin(i + seed * 5) * 35} ${50 + Math.cos(i) * 25} ${105 - i * 5} ${-5 + Math.cos(i) * 8}`}
            stroke={`url(#xdrSg${index})`} strokeWidth={0.3 + (i % 4) * 0.25}
            fill="none" opacity={0.45 + (i % 3) * 0.15}
          />
        ))}
      </svg>
      {generating && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", color: "#fff", fontSize: 12, letterSpacing: "0.1em" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 2s linear infinite" }}>⟳</div>
            WEAVING...
          </div>
        </div>
      )}
      <div style={{ position: "absolute", left: 12, bottom: 10, fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: "0.08em", fontFamily: "ui-monospace,monospace" }}>
        #{String(index + 1).padStart(2, "0")} · seed {Math.floor(seed * 99999)}
      </div>
    </div>
  );
}

const xdrInputStyle: React.CSSProperties = {
  width: "100%", padding: 12, borderRadius: 10,
  background: "rgba(2,6,23,0.6)", color: "#f1f5f9",
  border: "1px solid rgba(255,255,255,0.1)",
  fontSize: 13, fontFamily: "inherit", outline: "none",
};

// ─── PAGE ───────────────────────────────────────────────────────────────
export default function GeneratePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const {
    models, fetchModels, modelsLoaded,
    styles, fetchStyles, stylesLoaded,
    templates, fetchTemplates,
    creditBalance, fetchCredits,
    isGenerating, setIsGenerating,
  } = useAppStore();

  const [tab, setTab] = useState<TabType>("image");
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  /** Which compact control panel is open — only ever one at a time. */
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [inputImagePreview, setInputImagePreview] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [refImagePreview, setRefImagePreview] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.75);
  const [numOutputs, setNumOutputs] = useState(1);
  const [isUpscaling, setIsUpscaling] = useState(false);
  // Progress line for GPU-backed models, which rent a machine on demand and can
  // legitimately take many minutes before the first frame is rendered.
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [steps, setSteps] = useState(42);
  const [guidance, setGuidance] = useState(7.5);
  const [seed, setSeed] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => { if (session === null) router.push("/login"); }, [session, router]);
  useEffect(() => { fetchModels(); fetchStyles(); fetchTemplates(); fetchCredits(); }, [fetchModels, fetchStyles, fetchTemplates, fetchCredits]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/gallery?limit=16&page=1");
      if (!res.ok) return;
      const data = await res.json();
      setHistory((data.data ?? []).filter((g: HistoryItem) => g.resultUrl || g.thumbnailUrl));
    } catch {}
  }, []);
  useEffect(() => {
    if (session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchHistory();
    }
  }, [session, fetchHistory]);

  const addPromptTag = (tag: string) => {
    setPrompt((p) => {
      const trimmed = p.trim();
      if (!trimmed) return tag;
      if (trimmed.toLowerCase().includes(tag.toLowerCase())) return trimmed;
      return trimmed.endsWith(",") ? `${trimmed} ${tag}` : `${trimmed}, ${tag}`;
    });
  };

  const filteredModels = models.filter((m) => m.category === tab);

  useEffect(() => {
    const current = filteredModels.find((m) => m.id === selectedModelId);
    // Re-pick when nothing is selected, when the selection left this tab, or
    // when the selected model has since been pulled back for tuning — landing
    // on a model that cannot be ordered would look like a broken button.
    if (filteredModels.length > 0 && (!current || current.canOrder === false)) {
      const orderable = filteredModels.filter((m) => m.canOrder !== false);
      const pool = orderable.length > 0 ? orderable : filteredModels;
      const featured = pool.find((m) => m.isFeatured);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedModelId(featured?.id ?? pool[0].id);
    }
  }, [tab, modelsLoaded, filteredModels, selectedModelId]);

  const selectedModel = models.find((m) => m.id === selectedModelId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowModelDropdown(false);
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
      if (isRef) { setRefImage(base64); setRefImagePreview(base64); }
      else { setInputImage(base64); setInputImagePreview(base64); }
    };
    reader.readAsDataURL(file);
  };

  const pollResult = useCallback(async (generationId: number) => {
    // API-backed providers answer within a few minutes. GPU-backed ones rent a
    // machine first, and on a cold host that means installing ComfyUI and
    // pulling ~42 GB of weights. The server allows warmup + render (60 + 30
    // min by default), so the client has to outlast that or it would declare a
    // timeout on a job that is still perfectly healthy.
    const API_DEADLINE_MS = 4 * 60_000;
    const GPU_DEADLINE_MS = 95 * 60_000;

    const startedAt = Date.now();
    let deadlineMs = API_DEADLINE_MS;
    let sawGpu = false;
    // A transient network blip shouldn't abandon a job the user already paid
    // for; only give up after several consecutive failures.
    let consecutiveErrors = 0;

    while (Date.now() - startedAt < deadlineMs) {
      // Poll gently once the job is known to be a long-running GPU render.
      await new Promise((r) => setTimeout(r, sawGpu ? 5000 : 2000));
      try {
        const res = await fetch(`/api/generate/${generationId}`);
        if (!res.ok) {
          if (res.status === 404 || res.status === 401) break;
          if (++consecutiveErrors >= 5) break;
          continue;
        }
        consecutiveErrors = 0;
        const data = await res.json();

        if (data.gpu) {
          sawGpu = true;
          deadlineMs = GPU_DEADLINE_MS;
          const queued = data.gpu.queuePosition && data.gpu.queuePosition > 1
            ? ` • คิวที่ ${data.gpu.queuePosition}`
            : "";
          // With no history the estimate is a rough baseline, so it is worded
          // as such rather than quoted like a firm figure.
          const eta = data.gpu.etaLabel
            ? ` • ${data.gpu.etaBasis === "baseline" ? "คาดว่า" : "เหลืออีก"} ${data.gpu.etaLabel}`
            : "";
          setProgressNote(`${data.gpu.label}${queued}${eta}`);
        } else if (sawGpu) {
          setProgressNote(null);
        }

        if (data.status === "completed") {
          setResult({
            id: data.id, status: "completed",
            resultUrl: data.resultUrl,
            resultUrls: data.resultUrls ? (Array.isArray(data.resultUrls) ? data.resultUrls : [data.resultUrl]) : [data.resultUrl],
            thumbnailUrl: data.thumbnailUrl,
            creditsUsed: data.creditsUsed, processingMs: data.processingMs,
            expiresAt: data.expiresAt, daysLeft: data.daysLeft,
          });
          setIsGenerating(false); setProgressNote(null); fetchCredits(); fetchHistory();
          toast("success", "สร้างสำเร็จ!", `ใช้ ${data.creditsUsed} เครดิต`);
          return;
        }
        if (data.status === "failed") {
          setResult({ id: data.id, status: "failed", creditsUsed: 0, error: data.errorMessage });
          setIsGenerating(false); setProgressNote(null); fetchCredits();
          toast("error", "สร้างไม่สำเร็จ", data.errorMessage || "เกิดข้อผิดพลาด");
          return;
        }
      } catch {
        if (++consecutiveErrors >= 5) break;
      }
    }

    setIsGenerating(false); setProgressNote(null);
    // The job is still running server-side and the credits are already spent —
    // telling the user to "try again" here would charge them twice for one clip.
    toast(
      "info",
      "ยังสร้างไม่เสร็จ",
      "งานยังทำงานอยู่เบื้องหลัง ผลลัพธ์จะขึ้นในแกลเลอรีเมื่อเสร็จ ไม่ต้องสั่งสร้างใหม่",
    );
    fetchHistory();
  }, [setIsGenerating, fetchCredits, fetchHistory, toast]);

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModelId || isGenerating) return;
    setIsGenerating(true); setResult(null); setIsFavorited(false);
    const ar = aspectRatios.find((a) => a.value === aspectRatio);
    const imageToSend = tab === "image" ? refImage : inputImage;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: selectedModelId, type: tab,
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          styleId: selectedStyle || undefined,
          inputImage: imageToSend || undefined,
          params: {
            width: ar?.w || 1024, height: ar?.h || 1024, aspectRatio,
            strength: refImage && tab === "image" ? strength : undefined,
            numOutputs: tab === "image" ? numOutputs : undefined,
            steps,
            cfgScale: guidance,
            seed: seed ?? undefined,
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
        setResult(data); setIsGenerating(false); fetchCredits(); fetchHistory();
        toast("success", "สร้างสำเร็จ!", `ใช้ ${data.creditsUsed} เครดิต`);
      } else if (data.status === "failed") {
        setResult(data); setIsGenerating(false); fetchCredits();
        toast("error", "สร้างไม่สำเร็จ", data.error || "เกิดข้อผิดพลาด");
      } else { pollResult(data.id); }
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
      a.download = `xdreamer-${result?.id || "gen"}.${downloadUrl.includes(".mp4") ? "mp4" : "webp"}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast("success", "ดาวน์โหลดสำเร็จ");
    } catch { toast("error", "ดาวน์โหลดไม่สำเร็จ"); }
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
      try { await navigator.share({ title: "X-DREAMER Generation", url: result.resultUrl }); } catch {}
    } else {
      await navigator.clipboard.writeText(result.resultUrl);
      toast("info", "คัดลอกลิงก์แล้ว");
    }
  };

  const handleUpscale = async () => {
    if (!result?.id) return;
    setIsUpscaling(true);
    try {
      const res = await fetch("/api/upscale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: result.id }) });
      const data = await res.json();
      if (!res.ok) { toast("error", "Upscale ไม่สำเร็จ", data.error || "เกิดข้อผิดพลาด"); setIsUpscaling(false); return; }
      if (data.status === "completed" && data.resultUrl) {
        setResult(prev => prev ? { ...prev, resultUrl: data.resultUrl } : prev);
        fetchCredits(); toast("success", "Upscale สำเร็จ!", `ใช้ ${data.creditsUsed} เครดิต`);
      } else {
        const maxAttempts = 60;
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const pollRes = await fetch(`/api/generate/${data.id}`);
          if (!pollRes.ok) break;
          const pollData = await pollRes.json();
          if (pollData.status === "completed") {
            setResult(prev => prev ? { ...prev, resultUrl: pollData.resultUrl } : prev);
            fetchCredits(); toast("success", "Upscale สำเร็จ!", `ใช้ ${pollData.creditsUsed} เครดิต`);
            break;
          }
          if (pollData.status === "failed") { toast("error", "Upscale ไม่สำเร็จ", pollData.errorMessage); break; }
        }
      }
    } catch { toast("error", "Upscale ไม่สำเร็จ"); }
    setIsUpscaling(false);
  };

  const totalCredits = selectedModel ? selectedModel.creditsPerUnit * numOutputs : 0;
  if (!session) return null;

  // ─── RENDER ─────────────────────────────────────────────────────────
  return (
    <div className="rp-studio" style={{ color: "#f1f5f9" }}>
      {/* ═══ LEFT — controls ═══ */}
      <aside className="rp-studio-left rp-scroll" style={{ borderRight: "1px solid rgba(255,255,255,0.06)", padding: 18, display: "flex", flexDirection: "column", gap: 12, background: "rgba(15,23,42,0.25)" }}>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: 4, background: "rgba(2,6,23,0.5)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.05)" }}>
          {([
            { key: "image" as TabType, label: "สร้างภาพ", icon: "▧" },
            { key: "video" as TabType, label: "สร้างวิดีโอ", icon: "▶" },
            { key: "edit"  as TabType, label: "แก้ไขภาพ", icon: "✦" },
          ]).map(t => (
            <button key={t.key}
              onClick={() => { setTab(t.key); setResult(null); setNumOutputs(1); }}
              style={{
                flex: 1, padding: "8px 6px", borderRadius: 8, border: "none", cursor: "pointer",
                background: tab === t.key ? `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${270 + HUE},70%,55%))` : "transparent",
                color: tab === t.key ? "#fff" : "rgba(226,232,240,0.6)",
                fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
              <span style={{ fontSize: 12 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* Model Selector */}
        <Section label="โมเดล AI">
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button onClick={() => setShowModelDropdown(!showModelDropdown)}
              style={{ ...xdrInputStyle, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "left" }}>
              <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedModel ? selectedModel.name : "เลือกโมเดล..."}
                </span>
                {selectedModel && <span style={{ fontSize: 11, color: "#94a3b8" }}>· {selectedModel.provider.name}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {selectedModel && (
                  <span style={{ padding: "2px 6px", borderRadius: 6, background: "hsla(48,90%,60%,0.15)", color: "#fbbf24", fontSize: 10, fontWeight: 600 }}>
                    ✦ {selectedModel.creditsPerUnit}
                  </span>
                )}
                <span style={{ fontSize: 9, opacity: 0.6, transform: showModelDropdown ? "rotate(180deg)" : "none", transition: "transform 200ms" }}>▼</span>
              </div>
            </button>
            {showModelDropdown && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 280, overflowY: "auto", background: "rgba(15,23,42,0.95)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, zIndex: 30, boxShadow: "0 20px 40px -10px rgba(0,0,0,0.5)" }}>
                {filteredModels.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>ไม่มีโมเดลสำหรับหมวดนี้</div>
                ) : filteredModels.map(m => {
                  // A model still being proven out stays visible so customers
                  // can see what is coming, but picking it is blocked — the
                  // alternative is letting them spend credits on a render that
                  // cannot be delivered yet.
                  const tuning = m.canOrder === false;
                  return (
                  <button key={m.id} disabled={tuning}
                    title={tuning ? (m.tuningMessage ?? undefined) : undefined}
                    onClick={() => { if (tuning) return; setSelectedModelId(m.id); setShowModelDropdown(false); }}
                    style={{ width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", cursor: tuning ? "not-allowed" : "pointer", textAlign: "left", background: selectedModelId === m.id ? `hsla(${220 + HUE},60%,50%,0.15)` : "transparent", color: "#e2e8f0", borderBottom: "1px solid rgba(255,255,255,0.04)", opacity: tuning ? 0.55 : 1 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                        {m.name}
                        {m.isFeatured && <span style={{ fontSize: 10, color: "#fbbf24" }}>✦</span>}
                        {tuning && (
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 999, background: "hsla(38,90%,55%,0.18)", color: "#fbbf24", fontWeight: 600 }}>
                            กำลังปรับแต่ง
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        {tuning ? "ยังใช้งานไม่ได้ ลองใหม่ภายหลัง" : `${m.provider.name}${m.subcategory ? ` · ${m.subcategory}` : ""}`}
                      </div>
                    </div>
                    <span style={{ padding: "2px 6px", borderRadius: 6, background: "hsla(48,90%,60%,0.15)", color: "#fbbf24", fontSize: 10, fontWeight: 600 }}>✦ {m.creditsPerUnit}</span>
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        </Section>

        {/* Prompt — the only element allowed to grow, so it absorbs whatever
            height the viewport has spare and the rail still fits one screen. */}
        <Section label="Prompt" grow>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder={tab === "video" ? "อธิบายวิดีโอที่ต้องการ..." : "อธิบายภาพที่ต้องการ..."}
            style={{ ...xdrInputStyle, padding: 14, fontSize: 14, lineHeight: 1.5, resize: "none", flex: 1, minHeight: 96 }} />
          {/* The free Pollinations model does not understand Thai — it renders an
              unrelated image instead of failing, so warn before credits are spent. */}
          {selectedModel?.provider.slug === "pollinations" && THAI_CHARS.test(prompt) && (
            <div style={{
              marginTop: 8, padding: "8px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.5,
              background: "hsla(38,90%,55%,0.12)", color: "#fbbf24",
              border: "1px solid hsla(38,90%,55%,0.3)",
            }}>
              โมเดลฟรีอ่านภาษาไทยไม่ออก — จะได้ภาพที่ไม่ตรงกับที่พิมพ์ กรุณาพิมพ์ prompt เป็นภาษาอังกฤษ หรือเลือกโมเดลแบบเสียเครดิต
            </div>
          )}
          {/* Live prompt stats — replaces the right rail's "รายละเอียด prompt"
              card in one line instead of three stacked rows. */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, color: "#64748b", fontFamily: "ui-monospace,monospace" }}>
            <span>{prompt.trim() ? `${prompt.trim().split(/\s+/).length} คำ` : "ยังไม่มี prompt"}</span>
            <span>{prompt.length.toLocaleString()} / 10,000</span>
          </div>
        </Section>

        {/* ── Compact control deck ─────────────────────────────────────
            Everything below is one-line triggers. Each opens upward so a
            panel near the bottom of the rail never pushes the layout. */}
        <div style={{ display: "flex", gap: 6 }}>
          <Popover id="tags" open={openPanel} onToggle={setOpenPanel} label="+ แท็ก" width={286}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PROMPT_TAG_CHIPS.map((t) => {
                const already = prompt.toLowerCase().includes(t.toLowerCase());
                return (
                  <button key={t} type="button" onClick={() => addPromptTag(t)}
                    style={{
                      padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                      background: already ? `hsla(${220 + HUE},60%,50%,0.18)` : "rgba(255,255,255,0.05)",
                      color: already ? "#a5f3fc" : "#94a3b8",
                      border: already ? `1px solid hsla(${220 + HUE},70%,60%,0.4)` : "1px solid rgba(255,255,255,0.1)",
                    }}>+ {t}</button>
                );
              })}
            </div>
          </Popover>

          {templates.length > 0 && tab !== "edit" && (
            <Popover id="templates" open={openPanel} onToggle={setOpenPanel} label="เทมเพลต" width={286}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {templates.slice(0, 10).map(t => (
                  <button key={t.id} type="button" title={t.description || t.prompt}
                    onClick={() => { setPrompt(t.prompt); setNegativePrompt(t.negativePrompt || ""); setOpenPanel(null); }}
                    style={{
                      padding: "6px 11px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                      background: "rgba(255,255,255,0.05)", color: "#cbd5e1",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}>
                    {t.isFeatured ? "★ " : ""}{t.name}
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        {/* Negative Prompt */}
        {tab !== "edit" && (
          <input value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="Negative prompt — blurry, low quality, text..."
            style={{ ...xdrInputStyle, fontSize: 12, padding: "9px 12px" }} />
        )}

        {/* Style + aspect on one row */}
        <div style={{ display: "flex", gap: 6 }}>
          {stylesLoaded && styles.length > 0 && tab !== "edit" && (
            <Popover id="style" open={openPanel} onToggle={setOpenPanel} label="สไตล์"
              value={selectedStyle ? (styles.find(s => s.id === selectedStyle)?.name ?? "") : "—"} width={286}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                {styles.slice(0, 12).map(s => (
                  <button key={s.id} onClick={() => setSelectedStyle(selectedStyle === s.id ? null : s.id)}
                    style={{
                      padding: "7px 6px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                      background: selectedStyle === s.id ? `hsla(${220 + HUE},60%,50%,0.25)` : "rgba(255,255,255,0.04)",
                      color: selectedStyle === s.id ? "#fff" : "#94a3b8",
                      border: selectedStyle === s.id ? `1px solid hsla(${220 + HUE},70%,60%,0.5)` : "1px solid rgba(255,255,255,0.08)",
                    }}>{s.name}</button>
                ))}
              </div>
            </Popover>
          )}

          {tab === "image" && (
            <Popover id="aspect" open={openPanel} onToggle={setOpenPanel} label="สัดส่วน" value={aspectRatio} width={220} align="right">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                {aspectRatios.map(ar => (
                  <button key={ar.value} onClick={() => { setAspectRatio(ar.value); setOpenPanel(null); }}
                    style={{
                      padding: "8px 0", borderRadius: 8, fontSize: 12, cursor: "pointer",
                      background: aspectRatio === ar.value ? `hsla(${220 + HUE},60%,50%,0.25)` : "rgba(255,255,255,0.04)",
                      color: aspectRatio === ar.value ? "#fff" : "#94a3b8",
                      border: aspectRatio === ar.value ? `1px solid hsla(${220 + HUE},70%,60%,0.5)` : "1px solid rgba(255,255,255,0.08)",
                    }}>{ar.label}</button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        {/* Count + advanced + reference on one row */}
        <div style={{ display: "flex", gap: 6 }}>
          {tab === "image" && (
            <Popover id="count" open={openPanel} onToggle={setOpenPanel} label="จำนวน" value={String(numOutputs)} width={200}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                {[1, 2, 3, 4].map(n => (
                  <button key={n} onClick={() => { setNumOutputs(n); setOpenPanel(null); }}
                    style={{
                      padding: "8px 0", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 600,
                      background: numOutputs === n ? `hsla(${220 + HUE},60%,50%,0.25)` : "rgba(255,255,255,0.04)",
                      color: numOutputs === n ? "#fff" : "#94a3b8",
                      border: numOutputs === n ? `1px solid hsla(${220 + HUE},70%,60%,0.5)` : "1px solid rgba(255,255,255,0.08)",
                    }}>{n}</button>
                ))}
              </div>
            </Popover>
          )}

          {/* Reference image — functional, so it stays a first-class control
              rather than moving behind a panel. */}
          <Popover id="ref" open={openPanel} onToggle={setOpenPanel} label="ภาพอ้างอิง"
            value={refImagePreview ? "1" : "—"} width={286} align="right">
            {refImagePreview ? (
              <div style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={refImagePreview} alt="Reference" style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)" }} />
                <button onClick={() => { setRefImage(null); setRefImagePreview(null); }}
                  style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>×</button>
                {tab === "image" && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                      <span>ความเข้มอ้างอิง</span>
                      <span style={{ color: `hsl(${220 + HUE},70%,75%)`, fontFamily: "ui-monospace,monospace" }}>{Math.round(strength * 100)}%</span>
                    </div>
                    <input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(+e.target.value)}
                      style={{ width: "100%", accentColor: `hsl(${220 + HUE},70%,60%)` }} />
                  </div>
                )}
              </div>
            ) : (
              <label style={{ display: "grid", placeItems: "center", height: 120, borderRadius: 10, border: "1.5px dashed rgba(255,255,255,0.15)", background: "rgba(2,6,23,0.3)", color: "#64748b", fontSize: 12, cursor: "pointer", textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>↑</div>
                  ลาก &amp; วางภาพ ที่นี่
                </div>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageUpload(e, true)} />
              </label>
            )}
          </Popover>
        </div>

        {/* Image upload (edit/video) */}
        {(tab === "edit" || tab === "video") && (
          <Section label={tab === "edit" ? "ภาพต้นฉบับ" : "ภาพเริ่มต้น (ไม่บังคับ)"}>
            {inputImagePreview ? (
              <div style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={inputImagePreview} alt="Input" style={{ width: "100%", borderRadius: 10, maxHeight: 180, objectFit: "cover" }} />
                <button onClick={() => { setInputImage(null); setInputImagePreview(null); }}
                  style={{ position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", cursor: "pointer", fontSize: 14 }}>×</button>
              </div>
            ) : (
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, borderRadius: 12, border: "1.5px dashed rgba(255,255,255,0.15)", background: "rgba(2,6,23,0.3)", color: "#64748b", fontSize: 12, cursor: "pointer" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>↑</div>
                อัปโหลดภาพ
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageUpload(e)} />
              </label>
            )}
          </Section>
        )}

        {/* Advanced + tips on one row. The tips used to be four stacked cards
            in the right rail; they are reference material, not controls. */}
        <div style={{ display: "flex", gap: 6 }}>
          {tab !== "video" && (
            <Popover id="advanced" open={openPanel} onToggle={setOpenPanel} label="⚙ ขั้นสูง" width={286}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                    <span>Steps</span>
                    <span style={{ fontFamily: "ui-monospace,monospace", color: "#e2e8f0" }}>{steps}</span>
                  </div>
                  <input type="range" min={10} max={80} step={1} value={steps} onChange={(e) => setSteps(+e.target.value)}
                    style={{ width: "100%", accentColor: `hsl(${220 + HUE},70%,60%)` }} />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                    <span>Guidance</span>
                    <span style={{ fontFamily: "ui-monospace,monospace", color: "#e2e8f0" }}>{guidance.toFixed(1)}</span>
                  </div>
                  <input type="range" min={1} max={20} step={0.5} value={guidance} onChange={(e) => setGuidance(+e.target.value)}
                    style={{ width: "100%", accentColor: `hsl(${220 + HUE},70%,60%)` }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Seed</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="number" value={seed ?? ""} onChange={(e) => setSeed(e.target.value ? +e.target.value : null)}
                      placeholder="auto" style={{ ...xdrInputStyle, flex: 1, padding: 10, fontFamily: "ui-monospace,monospace" }} />
                    <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 99999))}
                      style={{ padding: "0 12px", borderRadius: 10, background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}>↻</button>
                  </div>
                </div>
              </div>
            </Popover>
          )}

          <Popover id="tips" open={openPanel} onToggle={setOpenPanel} label="? คำแนะนำ" width={300} align="right">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                "ระบุ subject และอารมณ์ให้ชัด เช่น 'หญิงสาวยืนกลางทุ่งดอกไม้ โทนสีพาสเทล'",
                "เพิ่ม style keywords เช่น cinematic, hyperreal, jade tones, volumetric",
                "ใช้ aspect 16:9 สำหรับ wallpaper, 9:16 สำหรับโซเชียล",
                "img2img: ความเข้ม 0.5–0.7 = balance, > 0.8 = ตามภาพอ้างอิงมาก",
              ].map((tip, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: `hsl(${(160 + i * 30 + HUE) % 360},70%,70%)`, flexShrink: 0 }}>✦</span>
                  <span style={{ fontSize: 12, color: "rgba(203,213,225,0.78)", lineHeight: 1.5 }}>{tip}</span>
                </div>
              ))}
            </div>
          </Popover>
        </div>

        {/* Every model in this tab may still be unproven, in which case
            auto-select lands on one anyway. Say why the button is dead rather
            than letting it look broken. */}
        {selectedModel?.canOrder === false && (
          <div style={{
            marginTop: 12, padding: "10px 12px", borderRadius: 10, fontSize: 12,
            background: "hsla(38,90%,55%,0.12)", color: "#fbbf24",
            border: "1px solid hsla(38,90%,55%,0.25)",
          }}>
            {selectedModel.tuningMessage ?? "โมเดลนี้กำลังปรับแต่งอยู่ ยังใช้งานไม่ได้ กรุณาลองใหม่ภายหลัง"}
          </div>
        )}

        {/* Generate Button */}
        <button onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim() || !selectedModelId || selectedModel?.canOrder === false}
          style={{
            marginTop: "auto", padding: 16, borderRadius: 12,
            background: `linear-gradient(135deg, hsl(${160 + HUE},70%,45%), hsl(${280 + HUE},70%,55%))`,
            color: "#fff", border: "none", fontSize: 15, fontWeight: 600,
            cursor: (isGenerating || !prompt.trim() || !selectedModelId) ? "not-allowed" : "pointer",
            opacity: (isGenerating || !prompt.trim() || !selectedModelId) ? 0.6 : 1,
            boxShadow: `0 10px 24px -8px hsla(${270 + HUE},70%,50%,0.55)`,
          }}>
          {isGenerating ? "⟳ กำลังทอ..." : (
            <>ทอ ✦ {tab === "image" && numOutputs > 1 ? `${numOutputs} ภาพ · ` : ""}{totalCredits || "—"} credits</>
          )}
        </button>

        {/* Credit balance — absorbs the right rail's credits card, including
            its top-up link, into a single line. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "#94a3b8" }}>
          <span style={{ color: "#fbbf24" }}>✦</span>
          เครดิต <span style={{ fontWeight: 600, color: "#f1f5f9" }}>{creditBalance.toLocaleString()}</span>
          <a href="/pricing" style={{ color: "#a5f3fc", textDecoration: "none", borderBottom: "1px dotted rgba(165,243,252,0.4)" }}>+ เติม</a>
        </div>
      </aside>

      {/* ═══ CENTER — canvas / result ═══ */}
      <main className="rp-studio-center rp-scroll" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill active>
              {tab === "image" ? `ภาพ ${numOutputs} ใบ` : tab === "video" ? "วิดีโอ" : "แก้ไขภาพ"}
            </Pill>
            <Pill onClick={() => { setSeed(Math.floor(Math.random() * 99999)); if (prompt.trim() && selectedModelId) handleGenerate(); }}>Variations</Pill>
            {tab === "image" && (
              <Pill onClick={() => result?.id && handleUpscale()}>{isUpscaling ? "⟳ Upscale" : "Upscale"}</Pill>
            )}
            <Pill onClick={() => { window.location.href = "/gallery"; }}>History</Pill>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontFamily: "ui-monospace,monospace" }}>
            session · {session?.user?.name?.toLowerCase().replace(/\s+/g, "_") || "weaver"}
          </div>
        </div>

        {/* Result canvas — the only element that flexes, so the workspace
            fills the viewport exactly instead of overflowing it. */}
        <div className="rp-studio-canvas rp-scroll" style={{
          borderRadius: 18, padding: 20,
          background: "rgba(15,23,42,0.45)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(18px)",
        }}>
          {isGenerating ? (
            <div style={{ width: "100%" }}>
              {tab === "image" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
                  {Array.from({ length: Math.max(numOutputs, 1) }).map((_, i) => (
                    <StudioFrame key={i} index={i} seed={(i + 1) * 0.137} aspect={aspectRatio} generating={true} />
                  ))}
                  {numOutputs < 4 && Array.from({ length: 4 - numOutputs }).map((_, i) => (
                    <StudioFrame key={`pad${i}`} index={numOutputs + i} seed={(numOutputs + i + 1) * 0.137} aspect={aspectRatio} generating={false} />
                  ))}
                </div>
              ) : (
                <div style={{ aspectRatio: tab === "video" ? "16/9" : ASPECT_RATIO_CSS[aspectRatio] || "1/1", maxHeight: 520, margin: "0 auto" }}>
                  <StudioFrame index={0} seed={0.42} aspect={tab === "video" ? "16:9" : aspectRatio} generating={true} />
                </div>
              )}
              <p style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", marginTop: 20, textAlign: "center" }}>
                {progressNote
                  ? progressNote
                  : tab === "video" ? "วิดีโออาจใช้เวลา 30-120 วินาที..." : "กำลังทอ... รอสักครู่"}
              </p>
              {progressNote && (
                <p style={{ fontSize: 11, color: "rgba(203,213,225,0.45)", marginTop: 6, textAlign: "center" }}>
                  โมเดลนี้รันบน GPU ที่เช่ามาเอง • คลิปแรกอาจรอ 20-40 นาที (ต้องบูตเครื่องและโหลดโมเดล)
                  ปิดหน้านี้ได้ ผลลัพธ์จะขึ้นในแกลเลอรี
                </p>
              )}
            </div>
          ) : result?.status === "completed" && result.resultUrl ? (
            <div style={{ width: "100%" }}>
              {result.resultUrls && result.resultUrls.length > 1 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 16 }}>
                  {result.resultUrls.map((url, i) => (
                    <div key={i} style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Result ${i + 1}`} style={{ width: "100%", display: "block", objectFit: "contain" }} />
                      <button onClick={() => handleDownload(url)}
                        style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 8, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", fontSize: 13 }}>↓</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 16, border: "1px solid rgba(255,255,255,0.06)" }}>
                  {refImagePreview && tab === "image" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", top: 8, left: 8, zIndex: 2, padding: "3px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", fontSize: 10, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>ต้นฉบับ</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={refImagePreview} alt="Original" style={{ width: "100%", borderRadius: 12, opacity: 0.7, objectFit: "contain" }} />
                      </div>
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", top: 8, left: 8, zIndex: 2, padding: "3px 8px", borderRadius: 999, background: `hsla(${160 + HUE},70%,50%,0.3)`, backdropFilter: "blur(8px)", fontSize: 10, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>ผลลัพธ์</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={result.resultUrl} alt={prompt} style={{ width: "100%", borderRadius: 12, objectFit: "contain" }} />
                      </div>
                    </div>
                  ) : tab === "video" || result.resultUrl.endsWith(".mp4") ? (
                    <video src={result.resultUrl} controls autoPlay loop style={{ width: "100%", borderRadius: 12, maxHeight: 600, margin: "0 auto", display: "block" }} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.resultUrl} alt={prompt} style={{ width: "100%", borderRadius: 12, maxHeight: 600, objectFit: "contain", margin: "0 auto", display: "block" }} />
                  )}
                </div>
              )}

              {/* Action toolbar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Pill onClick={() => handleDownload()}>↓ ดาวน์โหลด</Pill>
                  <Pill active={isFavorited} onClick={handleFavorite}>{isFavorited ? "♥ บันทึกแล้ว" : "♡ บันทึก"}</Pill>
                  <Pill onClick={handleShare}>⎋ แชร์</Pill>
                  {tab !== "video" && !result.resultUrl.endsWith(".mp4") && (
                    <Pill onClick={handleUpscale}>{isUpscaling ? "⟳ Upscaling..." : "⤢ Upscale"}</Pill>
                  )}
                </div>
                <Pill onClick={() => setResult(null)}>↻ สร้างใหม่</Pill>
              </div>

              {/* Retention notice — stated at the moment of delivery, because a
                  customer who is never told the window will lose work they
                  assumed was permanent. */}
              {result.daysLeft != null && (
                <div style={{
                  marginTop: 12, padding: "8px 12px", borderRadius: 10, fontSize: 12,
                  background: result.daysLeft <= 3 ? "rgba(248,113,113,0.12)" : "rgba(148,163,184,0.10)",
                  color: result.daysLeft <= 3 ? "#fca5a5" : "rgba(203,213,225,0.85)",
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                }}>
                  <span>
                    {result.daysLeft <= 0
                      ? "ไฟล์นี้หมดอายุแล้ว"
                      : `เก็บไฟล์ไว้อีก ${result.daysLeft} วัน — กรุณาดาวน์โหลดเก็บไว้`}
                  </span>
                  {result.expiresAt && (
                    <span style={{ opacity: 0.7 }}>
                      (ถึง {new Date(result.expiresAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })})
                    </span>
                  )}
                </div>
              )}

              {/* Generation info */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, fontSize: 11, color: "#64748b" }}>
                {result.creditsUsed > 0 && <span>✦ {result.creditsUsed} เครดิต</span>}
                {result.processingMs && <span>⌚ {(result.processingMs / 1000).toFixed(1)}s</span>}
                <span style={{ color: "#34d399" }}>✓ สำเร็จ</span>
              </div>
            </div>
          ) : result?.status === "failed" ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 80, height: 80, borderRadius: 20, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", display: "grid", placeItems: "center", margin: "0 auto 18px", fontSize: 36, color: "#fca5a5" }}>!</div>
              <h3 style={{ fontSize: 22, fontWeight: 300, margin: "0 0 8px", color: "#fff" }}>สร้างไม่สำเร็จ</h3>
              <p style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", marginBottom: 18 }}>{result.error || "เกิดข้อผิดพลาด"}</p>
              <button onClick={() => setResult(null)}
                style={{ padding: "10px 22px", borderRadius: 10, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`, color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                ลองอีกครั้ง
              </button>
            </div>
          ) : (
            <div style={{ width: "100%" }}>
              {tab === "image" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
                  {STUDIO_SAMPLES.image.map((s) => (
                    <SampleFrame key={s.src} src={s.src} label={s.label} aspect={aspectRatio} />
                  ))}
                </div>
              ) : (
                <div style={{ aspectRatio: tab === "video" ? "16/9" : ASPECT_RATIO_CSS[aspectRatio] || "1/1", maxHeight: 520, margin: "0 auto" }}>
                  {(STUDIO_SAMPLES[tab] || STUDIO_SAMPLES.edit).map((s) => (
                    <SampleFrame key={s.src} src={s.src} label={s.label} aspect={tab === "video" ? "16:9" : aspectRatio} isVideo={tab === "video"} />
                  ))}
                </div>
              )}
              <p style={{ fontSize: 13, color: "rgba(203,213,225,0.55)", marginTop: 20, textAlign: "center" }}>
                ตัวอย่างผลงานที่สร้างบนแพลตฟอร์มนี้ — เลือกโมเดล พิมพ์ prompt แล้วกด <span style={{ color: "#a5f3fc" }}>ทอ</span> เพื่อเริ่มสร้าง{tab === "video" ? "วิดีโอ" : tab === "edit" ? "การแก้ไข" : "ภาพ"}ของคุณเอง
              </p>
            </div>
          )}
        </div>

        {/* History strip — recent generations */}
        {history.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" }}>· รุ่นก่อนหน้า (history)</div>
              <a href="/gallery" style={{ fontSize: 11, color: "#a5f3fc", textDecoration: "none", letterSpacing: "0.05em" }}>ดูทั้งหมด →</a>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 8 }}>
              {history.slice(0, 16).map((g) => {
                const src = g.thumbnailUrl || g.resultUrl;
                const isVideo = g.type === "video" || g.resultUrl?.endsWith(".mp4");
                return (
                  <button key={g.id} type="button" title={g.prompt}
                    onClick={() => {
                      setPrompt(g.prompt);
                      setTab((g.type as TabType) ?? "image");
                      document.querySelector(".rp-studio-center")?.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    style={{
                      aspectRatio: "1",
                      borderRadius: 8,
                      padding: 0,
                      overflow: "hidden",
                      position: "relative",
                      border: "1px solid rgba(255,255,255,0.05)",
                      cursor: "pointer",
                      background: `linear-gradient(135deg, hsl(${(g.id * 23 + HUE) % 360}, 50%, 15%), hsl(${(g.id * 23 + 60 + HUE) % 360}, 50%, 8%))`,
                    }}>
                    {src && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    )}
                    {isVideo && (
                      <span style={{ position: "absolute", bottom: 4, right: 4, fontSize: 9, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "2px 5px", borderRadius: 4 }}>▶</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        /* Visible scrollbar for any pane that does overflow */
        .rp-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(165,243,252,0.25) transparent;
          scrollbar-gutter: stable;
        }
        .rp-scroll::-webkit-scrollbar { width: 8px; }
        .rp-scroll::-webkit-scrollbar-track { background: rgba(2,6,23,0.4); }
        .rp-scroll::-webkit-scrollbar-thumb {
          background: rgba(165,243,252,0.18);
          border-radius: 4px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .rp-scroll::-webkit-scrollbar-thumb:hover { background: rgba(165,243,252,0.35); }
        /* ── Viewport-locked studio ──────────────────────────────────
           The whole workspace is exactly one screen: nothing scrolls the
           document, and the canvas takes whatever height is left over.

           overflow:auto on the rails rather than hidden is deliberate.
           On a short window (a 768px-tall laptop) the controls genuinely
           cannot all fit, and clipping them would make them unreachable —
           the same "everything disappeared" failure this layout was
           rebuilt to avoid. Instead they fall back to a visible custom
           scrollbar, which normal-height screens never see. */
        .rp-studio {
          display: grid;
          grid-template-columns: 336px 1fr;
          height: calc(100dvh - 80px);
          overflow: hidden;
        }
        .rp-studio-left {
          min-height: 0;
          overflow-y: auto;
        }
        /* Flex items shrink by default, so on a short window every control
           squashed below its own height — a 20px-tall Generate button rather
           than a scrollbar. Pin them, and let the prompt (which carries an
           inline flex:1, and inline wins over this rule) be the only thing
           that gives. Past its min-height the rail scrolls instead. */
        .rp-studio-left > * { flex-shrink: 0; }
        .rp-studio-center {
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        /* The canvas block is the flexible one; header + history keep their
           natural height so they are always on screen. */
        .rp-studio-canvas {
          flex: 1;
          min-height: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        @media (max-width: 1180px) {
          .rp-studio { grid-template-columns: 300px 1fr; }
        }
        @media (max-width: 860px) {
          /* Below this the two-pane workspace stops being usable — let the
             page breathe and scroll normally instead of squeezing both. */
          .rp-studio {
            grid-template-columns: 1fr;
            height: auto;
            overflow: visible;
          }
          .rp-studio-left {
            overflow: visible;
            border-right: none !important;
            border-bottom: 1px solid rgba(255,255,255,0.06) !important;
          }
          .rp-studio-center { overflow: visible; }
          .rp-studio-canvas { overflow: visible; min-height: 320px; }
        }
      `}</style>
    </div>
  );
}
