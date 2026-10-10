"use client";

/**
 * /generate/3d — one picture in, one textured 3D model out.
 *
 * Its own route rather than a sixth tab of /generate: there is no prompt to
 * write and no aspect ratio, and the result is a scene to turn around rather
 * than a picture. The model behind it is Hunyuan3D-2.1 on a rented GPU
 * (lib/gpu/catalog.ts); orders, progress and files go through the same
 * /api/generate, /api/uploads and /api/gallery routes as every other render.
 *
 *   left   : the picture (drop, pick or paste), a name, the quality mode, cost
 *   centre : the viewer — progress while a model renders, the model once done
 *   below  : the customer's 3D models, newest first
 *
 * As in the studio, every request lives in a helper outside the component that
 * returns failure as a value: React Compiler cannot compile a component whose
 * try/catch holds a value block, and gives up on the whole component silently.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/components/ui/toast-provider";
import { downloadAs, downloadGeneration } from "@/lib/client-actions";
import {
  ModelViewer,
  type LightPreset,
  type ModelStats,
  type ModelViewerHandle,
  type ViewMode,
} from "@/components/xdreamer/model-viewer";

// ─── types ───────────────────────────────────────────────────────────────

type Status = "pending" | "processing" | "completed" | "failed" | "cancelled";

interface Model3dItem {
  id: number;
  status: Status;
  prompt: string;
  resultUrl: string | null;
  thumbnailUrl: string | null;
  inputImageUrl: string | null;
  creditsUsed: number;
  creditsRefunded: number | boolean | null;
  errorMessage: string | null;
  processingMs: number | null;
  mediaDeleted: boolean;
  daysLeft: number | null;
  remix: { quality?: string } | null;
  createdAt: string;
}

/** What GET /api/generate/[id] says about an order still in the queue. */
interface LiveStatus {
  label: string | null;
  queuePosition: number | null;
  etaLabel: string | null;
  progress: number | null;
  stage: "queued" | "starting" | "rendering" | null;
  phase: string | null;
  paused: boolean;
}

interface Picked {
  /** blob: URL of the chosen file, or the stored URL of a picture used again. */
  preview: string;
  name: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

type Backdrop = "space" | "studio" | "void";
type Filter = "all" | "done" | "active" | "failed";

// ─── constants ───────────────────────────────────────────────────────────

/** MAX_BYTES.image in lib/uploads.ts. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
/** Below this the shape model has little to read; allowed, with a warning. */
const SMALL_SIDE = 512;
const PAGE_SIZE = 12;
const POLL_MS = 4000;
const MAX_NAME = 80;

const VIEW_MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: "textured", label: "พื้นผิว", hint: "สีและวัสดุจริงของโมเดล" },
  { id: "clay", label: "ดินปั้น", hint: "สีเดียว ดูรูปทรงล้วน ๆ" },
  { id: "wire", label: "โครงลวด", hint: "ดูโครงตาข่ายสามเหลี่ยม" },
  { id: "normal", label: "นอร์มอล", hint: "ทิศของพื้นผิว ใช้ตรวจรอยต่อ" },
];
const LIGHTS: { id: LightPreset; label: string }[] = [
  { id: "studio", label: "สตูดิโอ" },
  { id: "sunset", label: "แดดเย็น" },
  { id: "neon", label: "นีออน" },
];
const BACKDROPS: { id: Backdrop; label: string }[] = [
  { id: "space", label: "อวกาศ" },
  { id: "studio", label: "ขาว" },
  { id: "void", label: "ดำ" },
];
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "done", label: "เสร็จแล้ว" },
  { id: "active", label: "กำลังสร้าง" },
  { id: "failed", label: "ไม่สำเร็จ" },
];
const STEPS = ["รอคิว", "เตรียมระบบ", "ปั้นรูปทรงและลงสี", "เก็บรายละเอียด", "บันทึกไฟล์"];
const USE_WITH = ["Blender", "Godot", "Unreal", "Unity (glTFast)", "three.js", "Sketchfab", "PowerPoint"];

const HUE = 70;

// ─── helpers (requests return failures as values) ────────────────────────

async function uploadPicture(file: File): Promise<{ url: string } | { error: string }> {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/uploads?kind=image", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: typeof data.error === "string" ? data.error : "อัปโหลดภาพไม่สำเร็จ ลองใหม่อีกครั้ง" };
    if (typeof data.url !== "string") return { error: "เซิร์ฟเวอร์ไม่ได้ส่งลิงก์ไฟล์กลับมา" };
    return { url: data.url };
  } catch {
    return { error: "อัปโหลดไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" };
  }
}

async function fetchLibrary(page: number): Promise<{ items: Model3dItem[]; pages: number } | null> {
  try {
    const res = await fetch(`/api/gallery?type=model3d&limit=${PAGE_SIZE}&page=${page}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { items: (data.data ?? []) as Model3dItem[], pages: Number(data.pages) || 1 };
  } catch {
    return null;
  }
}

type OrderOutcome =
  | { kind: "ok"; id: number; creditsUsed: number }
  | { kind: "rejected"; error: string; needCredits: boolean }
  | { kind: "network" };

async function placeOrder(body: Record<string, unknown>): Promise<OrderOutcome> {
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const raw = typeof data.error === "string" ? data.error : "";
      return { kind: "rejected", error: localizeError(raw), needCredits: res.status === 402 };
    }
    if (typeof data.id !== "number") return { kind: "network" };
    return { kind: "ok", id: data.id, creditsUsed: Number(data.creditsUsed) || 0 };
  } catch {
    return { kind: "network" };
  }
}

type PollOutcome =
  | { kind: "live"; live: LiveStatus }
  | { kind: "settled"; patch: Partial<Model3dItem> & { status: Status } }
  | { kind: "gone" }
  | { kind: "skip" };

async function pollOrder(id: number): Promise<PollOutcome> {
  try {
    const res = await fetch(`/api/generate/${id}`);
    if (res.status === 404) return { kind: "gone" };
    if (!res.ok) return { kind: "skip" };
    const d = await res.json();
    if (d.status === "pending" || d.status === "processing") {
      const g = d.gpu ?? null;
      return {
        kind: "live",
        live: {
          label: typeof g?.label === "string" ? g.label : null,
          queuePosition: typeof g?.queuePosition === "number" ? g.queuePosition : null,
          etaLabel: typeof g?.etaLabel === "string" ? g.etaLabel : null,
          progress: typeof g?.progress === "number" ? g.progress : null,
          stage: g?.stage ?? null,
          phase: typeof g?.phase === "string" ? g.phase : null,
          paused: g?.paused === true,
        },
      };
    }
    return {
      kind: "settled",
      patch: {
        status: d.status as Status,
        resultUrl: d.resultUrl ?? null,
        thumbnailUrl: d.thumbnailUrl ?? null,
        errorMessage: d.errorMessage ?? null,
        creditsRefunded: d.creditsRefunded ?? null,
        processingMs: d.processingMs ?? null,
        mediaDeleted: Boolean(d.mediaDeleted),
        daysLeft: typeof d.daysLeft === "number" ? d.daysLeft : null,
      },
    };
  } catch {
    return { kind: "skip" };
  }
}

/** Natural size of a picture, or null when the browser cannot open it. */
function readPictureSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The server answers some refusals in English; a customer reads Thai. */
function localizeError(message: string): string {
  const credits = /Insufficient credits\. Need (\d+), have (\d+)/i.exec(message);
  if (credits) return `เครดิตไม่พอ — งานนี้ใช้ ${credits[1]} เครดิต แต่มีอยู่ ${credits[2]} เครดิต`;
  if (/Model not available/i.test(message)) return "บริการสร้างโมเดล 3D ปิดชั่วคราว";
  if (/temporarily unavailable/i.test(message)) return "บริการไม่ว่างชั่วคราว ลองใหม่ในอีกสักครู่";
  if (/Generation failed/i.test(message) || !message) return "ส่งงานไม่สำเร็จ ลองใหม่อีกครั้ง";
  return message;
}

function fileProblem(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return "รองรับเฉพาะไฟล์ PNG, JPG และ WebP";
  if (file.size > MAX_IMAGE_BYTES) return `ไฟล์ใหญ่เกิน 12 MB (ไฟล์นี้ ${(file.size / 1048576).toFixed(1)} MB)`;
  if (file.size === 0) return "ไฟล์ว่างเปล่า ลองไฟล์อื่น";
  return null;
}

function baseName(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().slice(0, MAX_NAME);
}

/** A name safe to save a file under on every OS. */
function fileSafe(name: string, id: number): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return clean ? `${clean}-${id}` : `model3d-${id}`;
}

function isActive(s: Status): boolean {
  return s === "pending" || s === "processing";
}

/** Which of STEPS an order in flight has reached. */
function stepOf(live: LiveStatus | undefined): number {
  if (!live || !live.stage || live.stage === "queued") return 0;
  if (live.stage === "starting") return 1;
  switch (live.phase) {
    case "waiting":
    case "loading":
      return 1;
    case "finishing":
      return 3;
    case "saving":
      return 4;
    default:
      return 2;
  }
}

const dateFormat = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFormat.format(d);
}

function bytesLabel(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** The time, for handlers — kept out of the component (see clockNow in the studio). */
function nowIso(): string {
  return new Date().toISOString();
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function canFullscreen(): boolean {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}

// ─── icons ───────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ReactNode> = {
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>,
  rotate: <><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></>,
  focus: <><circle cx="12" cy="12" r="3" /><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /></>,
  grid: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></>,
  expand: <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />,
  shrink: <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />,
  cube: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" /></>,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  dice: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></>,
  spark: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  alert: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  again: <><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" /><path d="M3 21v-5h5" /></>,
};

function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // Read at once, not a second later: the clock stops while nothing is
    // rendering, and coming back to an order would show the stopped time.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [active, intervalMs]);
  return now;
}

// ─── page ────────────────────────────────────────────────────────────────

export default function Model3dPage() {
  const { data: session, status: authStatus } = useSession();
  const { toast } = useToast();
  const { models, fetchModels, modelsLoaded, creditBalance, creditsLoaded, fetchCredits } = useAppStore();

  // The picture
  const [picked, setPicked] = useState<Picked | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const pickSeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The order
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [qualityId, setQualityId] = useState<string | null>(null);
  const [fixedSeed, setFixedSeed] = useState(false);
  const [seed, setSeed] = useState(1234);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<{ message: string; needCredits: boolean } | null>(null);

  // The library
  const [items, setItems] = useState<Model3dItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [libState, setLibState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [live, setLive] = useState<Record<number, LiveStatus>>({});

  // The viewer
  const [viewMode, setViewMode] = useState<ViewMode>("textured");
  const [light, setLight] = useState<LightPreset>("studio");
  const [backdrop, setBackdrop] = useState<Backdrop>("space");
  const [autoRotate, setAutoRotate] = useState(() => !prefersReducedMotion());
  const [grid, setGrid] = useState(false);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenOk] = useState(canFullscreen);
  const viewerRef = useRef<ModelViewerHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // ── data ──
  const model3d = useMemo(() => {
    const list = models.filter((m) => m.category === "model3d");
    return list.find((m) => m.canOrder !== false) ?? list[0] ?? null;
  }, [models]);
  const modes = model3d?.quality ?? [];
  const quality = modes.find((q) => q.id === qualityId) ?? modes.find((q) => q.isDefault) ?? modes[0] ?? null;
  const unitCost = model3d?.creditsPerUnit ?? 0;
  const cost = Math.ceil(unitCost * (quality?.creditsMultiplier ?? 1));
  const blockedReason = !modelsLoaded
    ? null
    : !model3d
      ? "บริการสร้างโมเดล 3D ยังไม่เปิดให้ใช้งาน"
      : model3d.canOrder === false
        ? model3d.unavailableReason ?? model3d.tuningMessage ?? "บริการสร้างโมเดล 3D ยังใช้งานไม่ได้ในขณะนี้"
        : null;
  const adminPreview = model3d?.status === "tuning" && model3d.canOrder !== false;

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const viewerSrc = selected && selected.status === "completed" && selected.resultUrl && !selected.mediaDeleted
    ? `/api/generate/${selected.id}/download`
    : null;
  const activeIds = items.filter((i) => isActive(i.status)).map((i) => i.id);
  const activeKey = activeIds.join(",");
  const selectedLive = selected ? live[selected.id] : undefined;
  const now = useNow(Boolean(selected && isActive(selected.status)));

  const visibleItems = items.filter((i) =>
    filter === "all" ? true
    : filter === "done" ? i.status === "completed"
    : filter === "active" ? isActive(i.status)
    : i.status === "failed" || i.status === "cancelled");

  // ── effects ──
  useEffect(() => {
    if (!session) return;
    if (!modelsLoaded) fetchModels();
    fetchCredits();
  }, [session, modelsLoaded, fetchModels, fetchCredits]);

  // The first page of the library; then the model the link names, or the
  // newest finished one.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    fetchLibrary(1).then((result) => {
      if (!alive) return;
      if (!result) { setLibState("error"); return; }
      setItems(result.items);
      setPages(result.pages);
      setPage(1);
      setLibState("ready");
      const wanted = Number(new URLSearchParams(window.location.search).get("id"));
      const linked = result.items.find((i) => i.id === wanted);
      const first = linked ?? result.items.find((i) => i.status === "completed") ?? result.items[0];
      if (first) setSelectedId((cur) => cur ?? first.id);
    });
    return () => { alive = false; };
  }, [session]);

  // Orders in flight are read every few seconds until they settle.
  useEffect(() => {
    if (!activeKey) return;
    const ids = activeKey.split(",").map(Number);
    let alive = true;
    const run = async () => {
      const results = await Promise.all(ids.map(async (id) => [id, await pollOrder(id)] as const));
      if (!alive) return;
      let settledAny = false;
      for (const [id, r] of results) {
        if (r.kind === "live") {
          setLive((prev) => ({ ...prev, [id]: r.live }));
        } else if (r.kind === "settled") {
          settledAny = true;
          setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...r.patch } : i)));
          if (r.patch.status === "completed") toast("success", "โมเดล 3D เสร็จแล้ว", "เปิดดูและดาวน์โหลดได้เลย");
          else toast("error", "สร้างโมเดลไม่สำเร็จ", r.patch.errorMessage ?? "ลองใหม่อีกครั้ง");
        } else if (r.kind === "gone") {
          setItems((prev) => prev.filter((i) => i.id !== id));
        }
      }
      // A failure refunds; a finished one may have been the last of a balance.
      if (settledAny) fetchCredits();
    };
    run();
    const timer = setInterval(run, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [activeKey, toast, fetchCredits]);

  // A blob: preview is released when it is replaced or the page goes.
  useEffect(() => {
    const url = picked?.preview;
    return () => { if (url?.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, [picked?.preview]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current && stageRef.current !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── actions ──
  const takeFile = useCallback(async (file: File) => {
    setSubmitError(null);
    const problem = fileProblem(file);
    if (problem) { setPickError(problem); return; }
    setPickError(null);
    const seq = ++pickSeq.current;
    const preview = URL.createObjectURL(file);
    const size = await readPictureSize(preview);
    if (seq !== pickSeq.current) { URL.revokeObjectURL(preview); return; }
    if (!size) { URL.revokeObjectURL(preview); setPickError("เปิดไฟล์ภาพนี้ไม่ได้ ลองไฟล์อื่น"); return; }
    setPicked({ preview, name: file.name, width: size.width, height: size.height, bytes: file.size });
    setUploadedUrl(null);
    setUploading(true);
    if (!nameTouched) setName(baseName(file.name));
    const result = await uploadPicture(file);
    if (seq !== pickSeq.current) return;
    setUploading(false);
    if ("error" in result) { setPickError(result.error); return; }
    setUploadedUrl(result.url);
  }, [nameTouched]);

  // Paste a picture anywhere on the page (not into a text field).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      takeFile(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [takeFile]);

  const clearPicture = () => {
    pickSeq.current++;
    setPicked(null);
    setUploadedUrl(null);
    setUploading(false);
    setPickError(null);
  };

  /** Put a past model's picture back in the slot, already uploaded. */
  const reusePicture = (item: Model3dItem) => {
    if (!item.inputImageUrl) return;
    pickSeq.current++;
    setPicked({ preview: item.inputImageUrl, name: item.prompt, width: null, height: null, bytes: null });
    setUploadedUrl(item.inputImageUrl);
    setUploading(false);
    setPickError(null);
    setSubmitError(null);
    if (!nameTouched) setName(item.prompt.slice(0, MAX_NAME));
    const q = item.remix?.quality;
    if (q && modes.some((m) => m.id === q)) setQualityId(q);
    if (window.innerWidth < 1024) document.getElementById("m3d-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const select = (id: number) => {
    setSelectedId(id);
    setStats(null);
    const url = new URL(window.location.href);
    url.searchParams.set("id", String(id));
    window.history.replaceState(null, "", url.toString());
  };

  const submit = async () => {
    if (submittingRef.current || !model3d || !uploadedUrl || blockedReason || uploading) return;
    if (creditsLoaded && creditBalance < cost) {
      setSubmitError({ message: `เครดิตไม่พอ — งานนี้ใช้ ${cost} เครดิต แต่มีอยู่ ${creditBalance} เครดิต`, needCredits: true });
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const title = name.trim().slice(0, MAX_NAME) || "โมเดล 3D";
    const outcome = await placeOrder({
      modelId: model3d.id,
      type: "model3d",
      prompt: title,
      inputImage: uploadedUrl,
      params: { ...(quality ? { quality: quality.id } : {}), ...(fixedSeed ? { seed } : {}) },
    });
    submittingRef.current = false;
    setSubmitting(false);
    if (outcome.kind === "network") {
      setSubmitError({ message: "ส่งงานไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ — ยังไม่ได้หักเครดิต", needCredits: false });
      return;
    }
    if (outcome.kind === "rejected") {
      setSubmitError({ message: outcome.error, needCredits: outcome.needCredits });
      return;
    }
    const item: Model3dItem = {
      id: outcome.id,
      status: "pending",
      prompt: title,
      resultUrl: null,
      thumbnailUrl: null,
      inputImageUrl: uploadedUrl,
      creditsUsed: outcome.creditsUsed,
      creditsRefunded: null,
      errorMessage: null,
      processingMs: null,
      mediaDeleted: false,
      daysLeft: null,
      remix: quality ? { quality: quality.id } : null,
      createdAt: nowIso(),
    };
    setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
    setFilter("all");
    select(item.id);
    fetchCredits();
    toast("success", "ส่งงานแล้ว", "กำลังสร้างโมเดล 3D — ปิดหน้านี้ได้ ผลงานจะรออยู่ในคลัง");
    if (window.innerWidth < 1024) stageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const loadMore = async () => {
    if (loadingMore || page >= pages) return;
    setLoadingMore(true);
    const result = await fetchLibrary(page + 1);
    setLoadingMore(false);
    if (!result) { toast("error", "โหลดเพิ่มไม่สำเร็จ", "ลองใหม่อีกครั้ง"); return; }
    setItems((prev) => [...prev, ...result.items.filter((n) => !prev.some((p) => p.id === n.id))]);
    setPages(result.pages);
    setPage(page + 1);
  };

  const retryLibrary = async () => {
    setLibState("loading");
    const result = await fetchLibrary(1);
    if (!result) { setLibState("error"); return; }
    setItems(result.items);
    setPages(result.pages);
    setPage(1);
    setLibState("ready");
  };

  const downloadModel = async () => {
    if (!selected?.resultUrl) return;
    const ok = await downloadGeneration(selected.id, selected.resultUrl, `${fileSafe(selected.prompt, selected.id)}.glb`);
    if (!ok) toast("error", "ดาวน์โหลดไม่สำเร็จ", "ลองใหม่อีกครั้ง");
  };

  const saveSnapshot = async () => {
    if (!selected) return;
    const blob = await viewerRef.current?.snapshot();
    if (!blob) { toast("error", "ถ่ายภาพไม่สำเร็จ", "ลองใหม่อีกครั้ง"); return; }
    const href = URL.createObjectURL(blob);
    const ok = await downloadAs(href, `${fileSafe(selected.prompt, selected.id)}.png`);
    URL.revokeObjectURL(href);
    if (!ok) toast("error", "บันทึกภาพไม่สำเร็จ", "ลองใหม่อีกครั้ง");
  };

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else el.requestFullscreen().catch(() => toast("error", "เปิดเต็มจอไม่ได้", "เบราว์เซอร์นี้ไม่อนุญาต"));
  };

  // ── render ──
  if (authStatus === "loading") {
    return <div className="m3d-wrap"><div className="m3d-skeleton" /><style>{CSS}</style></div>;
  }
  if (!session) {
    return (
      <div className="m3d-wrap">
        <div className="m3d-gate">
          <Icon name="cube" size={34} />
          <h1>สร้างโมเดล 3D จากภาพเดียว</h1>
          <p>เข้าสู่ระบบเพื่ออัปโหลดภาพและเก็บโมเดลไว้ในคลังของคุณ</p>
          <Link href="/login?callbackUrl=/generate/3d" className="m3d-cta">เข้าสู่ระบบ</Link>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  const smallPicture = picked?.width && picked.height ? Math.min(picked.width, picked.height) < SMALL_SIDE : false;
  const canSubmit = Boolean(model3d && uploadedUrl && !uploading && !submitting && !blockedReason && name.trim().length <= MAX_NAME);
  const buttonLabel = blockedReason ? "ยังสั่งสร้างไม่ได้"
    : !picked ? "เลือกภาพก่อน"
    : uploading ? "กำลังอัปโหลดภาพ…"
    : !uploadedUrl ? "อัปโหลดภาพไม่สำเร็จ"
    : submitting ? "กำลังส่งงาน…"
    : "สร้างโมเดล 3D";
  const elapsed = selected && isActive(selected.status) ? Math.max(0, Math.round((now - new Date(selected.createdAt).getTime()) / 1000)) : 0;
  const step = stepOf(selectedLive);

  return (
    <div className="m3d-wrap">
      {/* Header */}
      <header className="m3d-head">
        <div>
          <Link href="/generate" className="m3d-back"><Icon name="back" size={14} /> สตูดิโอภาพ/วิดีโอ</Link>
          <div className="m3d-eyebrow">
            <span className="m3d-eyebrow-en">3D STUDIO</span>
            {adminPreview && <span className="m3d-eyebrow-th"> · โหมดทดสอบ (แอดมิน)</span>}
          </div>
          <h1 className="m3d-title">
            ภาพเดียว กลายเป็น <em>โมเดล 3D</em>
          </h1>
          <p className="m3d-sub">
            อัปโหลดรูปวัตถุหรือตัวละคร ระบบตัดพื้นหลัง ปั้นรูปทรง และลงสีพื้นผิว PBR ให้อัตโนมัติ
            ได้ไฟล์ GLB พร้อมใช้ในเกม เว็บ งานพรีเซนต์ และพิมพ์ 3D
          </p>
        </div>
        <Link href="/pricing" className="m3d-credits" title="เติมเครดิต">
          ✦ {creditsLoaded ? creditBalance.toLocaleString("th-TH") : "…"} <span>เครดิต</span>
        </Link>
      </header>

      {blockedReason && (
        <div className="m3d-banner" role="status"><Icon name="alert" /> {blockedReason}</div>
      )}

      <div className="m3d-grid">
        {/* ── Controls ── */}
        <aside className="m3d-panel" id="m3d-panel" aria-label="ตั้งค่าการสร้างโมเดล">
          <section>
            <div className="m3d-label"><span className="m3d-num">1</span> ภาพต้นแบบ</div>
            {!picked ? (
              <button
                type="button"
                className="m3d-drop"
                data-over={dragOver ? "true" : "false"}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) takeFile(file);
                }}
              >
                <span className="m3d-drop-icon"><Icon name="upload" size={22} /></span>
                <span className="m3d-drop-title">ลากภาพมาวาง หรือคลิกเพื่อเลือก</span>
                <span className="m3d-drop-sub">PNG · JPG · WebP ไม่เกิน 12 MB · วางจากคลิปบอร์ดได้ (Ctrl+V)</span>
              </button>
            ) : (
              <div className="m3d-picked">
                <div className="m3d-picked-img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={picked.preview} alt="ภาพต้นแบบ" />
                  {uploading && <div className="m3d-picked-veil"><span className="m3d-spin" /> กำลังอัปโหลด…</div>}
                  {!uploading && uploadedUrl && <span className="m3d-picked-ok"><Icon name="check" size={12} /> พร้อม</span>}
                </div>
                <div className="m3d-picked-meta">
                  <span title={picked.name}>{picked.name}</span>
                  <span>
                    {picked.width && picked.height ? `${picked.width}×${picked.height}` : "ภาพเดิมจากคลัง"}
                    {picked.bytes ? ` · ${bytesLabel(picked.bytes)}` : ""}
                  </span>
                </div>
                <div className="m3d-picked-actions">
                  <button type="button" className="m3d-ghost" onClick={() => fileInputRef.current?.click()}>เปลี่ยนภาพ</button>
                  <button type="button" className="m3d-ghost" onClick={clearPicture} aria-label="เอาภาพออก"><Icon name="close" size={14} /></button>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED.join(",")}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) takeFile(file);
              }}
            />
            {pickError && <div className="m3d-error" role="alert"><Icon name="alert" size={14} /> {pickError}</div>}
            {smallPicture && !pickError && (
              <div className="m3d-warn">ภาพค่อนข้างเล็ก ({picked?.width}×{picked?.height}) — รายละเอียดอาจน้อย แนะนำด้านสั้นอย่างน้อย {SMALL_SIDE} px</div>
            )}
            <details className="m3d-tips">
              <summary>เคล็ดลับภาพที่ได้ผลดี</summary>
              <ul>
                <li data-ok="true">วัตถุหรือตัวละครชิ้นเดียว เห็นครบทั้งตัว ไม่ถูกตัดขอบ</li>
                <li data-ok="true">พื้นหลังเรียบหรือโปร่งใส แสงสม่ำเสมอ ไม่มีเงาแข็ง</li>
                <li data-ok="true">ตัวละคร: ท่า T-pose หรือ A-pose หันหน้าตรง ได้ผลดีที่สุด</li>
                <li data-ok="false">หลายชิ้นในภาพเดียว ภาพมืด เบลอ หรือมีตัวหนังสือทับ</li>
              </ul>
            </details>
          </section>

          <section>
            <label className="m3d-label" htmlFor="m3d-name"><span className="m3d-num">2</span> ชื่อโมเดล <small>ไม่บังคับ</small></label>
            <input
              id="m3d-name"
              className="m3d-input"
              value={name}
              maxLength={MAX_NAME}
              placeholder="เช่น หุ่นยนต์ผู้พิทักษ์"
              onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
            />
          </section>

          <section>
            <div className="m3d-label"><span className="m3d-num">3</span> คุณภาพ</div>
            <div className="m3d-modes" role="radiogroup" aria-label="คุณภาพ">
              {(modes.length > 0 ? modes : [null]).map((m) => {
                const id = m?.id ?? "default";
                const active = m ? quality?.id === m.id : true;
                const price = m ? Math.ceil(unitCost * m.creditsMultiplier) : unitCost;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className="m3d-mode"
                    data-active={active ? "true" : "false"}
                    onClick={() => m && setQualityId(m.id)}
                  >
                    <span className="m3d-mode-top">
                      <span className="m3d-mode-name">{m?.label ?? "มาตรฐาน"}</span>
                      <span className="m3d-mode-price">✦ {price}</span>
                    </span>
                    {m?.description && <span className="m3d-mode-desc">{m.description}</span>}
                    {m?.adminOnly && <span className="m3d-mode-badge">ทดสอบ · เห็นเฉพาะแอดมิน</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <button type="button" className="m3d-adv-toggle" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
              ตั้งค่าขั้นสูง <span style={{ transform: showAdvanced ? "rotate(180deg)" : "none" }}>▾</span>
            </button>
            {showAdvanced && (
              <div className="m3d-adv">
                <label className="m3d-check">
                  <input type="checkbox" checked={fixedSeed} onChange={(e) => setFixedSeed(e.target.checked)} />
                  ล็อกค่า seed (สร้างซ้ำให้ได้ผลเหมือนเดิม)
                </label>
                {fixedSeed && (
                  <div className="m3d-seed">
                    <input
                      className="m3d-input"
                      inputMode="numeric"
                      value={seed}
                      aria-label="seed"
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/\D/g, "").slice(0, 10));
                        setSeed(Math.min(n, 2_147_483_647));
                      }}
                    />
                    <button type="button" className="m3d-ghost" onClick={() => setSeed(randomSeed())} aria-label="สุ่ม seed"><Icon name="dice" /></button>
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="m3d-order">
            <div className="m3d-order-line">
              <span>ใช้</span>
              <strong>✦ {cost} เครดิต</strong>
            </div>
            {creditsLoaded && (
              <div className="m3d-order-line m3d-dim">
                <span>คงเหลือหลังสั่ง</span>
                <span>✦ {Math.max(0, creditBalance - cost).toLocaleString("th-TH")}</span>
              </div>
            )}
            <button type="button" className="m3d-cta m3d-go" disabled={!canSubmit} onClick={submit}>
              {submitting || uploading ? <span className="m3d-spin" /> : <Icon name="spark" />}
              {buttonLabel}
            </button>
            {submitError && (
              <div className="m3d-error" role="alert">
                <Icon name="alert" size={14} /> {submitError.message}
                {submitError.needCredits && <Link href="/pricing" className="m3d-link">เติมเครดิต →</Link>}
              </div>
            )}
            <p className="m3d-fineprint">ใช้เวลาราว 3–6 นาทีต่อโมเดล ปิดหน้านี้ได้ระหว่างรอ · สร้างไม่สำเร็จคืนเครดิตอัตโนมัติ</p>
          </div>
        </aside>

        {/* ── Viewer ── */}
        <section className="m3d-main">
          <div ref={stageRef} className="m3d-stage" data-bg={backdrop} data-fullscreen={fullscreen ? "true" : "false"}>
            <ModelViewer
              ref={viewerRef}
              src={viewerSrc}
              mode={viewMode}
              light={light}
              autoRotate={autoRotate}
              grid={grid}
              onStats={setStats}
            />

            {viewerSrc && (
              <>
                <div className="m3d-bar m3d-bar-top">
                  <div className="m3d-seg" role="radiogroup" aria-label="มุมมอง">
                    {VIEW_MODES.map((v) => (
                      <button key={v.id} type="button" role="radio" aria-checked={viewMode === v.id} title={v.hint}
                        data-active={viewMode === v.id ? "true" : "false"} onClick={() => setViewMode(v.id)}>{v.label}</button>
                    ))}
                  </div>
                  <div className="m3d-seg" role="radiogroup" aria-label="แสง">
                    {LIGHTS.map((l) => (
                      <button key={l.id} type="button" role="radio" aria-checked={light === l.id}
                        data-active={light === l.id ? "true" : "false"} onClick={() => setLight(l.id)}>{l.label}</button>
                    ))}
                  </div>
                  <div className="m3d-seg" role="radiogroup" aria-label="ฉากหลัง">
                    {BACKDROPS.map((b) => (
                      <button key={b.id} type="button" role="radio" aria-checked={backdrop === b.id}
                        data-active={backdrop === b.id ? "true" : "false"} onClick={() => setBackdrop(b.id)}>{b.label}</button>
                    ))}
                  </div>
                </div>
                <div className="m3d-bar m3d-bar-side">
                  <button type="button" className="m3d-tool" data-active={autoRotate ? "true" : "false"} onClick={() => setAutoRotate((v) => !v)} title="หมุนอัตโนมัติ" aria-pressed={autoRotate}><Icon name="rotate" /></button>
                  <button type="button" className="m3d-tool" data-active={grid ? "true" : "false"} onClick={() => setGrid((v) => !v)} title="กริดพื้น" aria-pressed={grid}><Icon name="grid" /></button>
                  <button type="button" className="m3d-tool" onClick={() => viewerRef.current?.resetView()} title="กลับมุมเริ่มต้น"><Icon name="focus" /></button>
                  <button type="button" className="m3d-tool" onClick={saveSnapshot} title="บันทึกภาพหน้าจอ (PNG พื้นโปร่งใส)"><Icon name="camera" /></button>
                  {fullscreenOk && (
                    <button type="button" className="m3d-tool" onClick={toggleFullscreen} title={fullscreen ? "ออกจากเต็มจอ" : "เต็มจอ"}><Icon name={fullscreen ? "shrink" : "expand"} /></button>
                  )}
                </div>
              </>
            )}

            {/* Overlays for anything that is not a finished model */}
            {!selected && libState !== "loading" && (
              <div className="m3d-overlay">
                <div className="m3d-empty">
                  <div className="m3d-empty-title">โมเดลของคุณจะปรากฏที่นี่</div>
                  <ol className="m3d-empty-steps">
                    <li><span>1</span> อัปโหลดภาพวัตถุหรือตัวละคร</li>
                    <li><span>2</span> เลือกคุณภาพ แล้วกดสร้าง</li>
                    <li><span>3</span> หมุนดู ตรวจงาน และดาวน์โหลด GLB</li>
                  </ol>
                </div>
              </div>
            )}

            {selected && isActive(selected.status) && (
              <div className="m3d-overlay">
                <div className="m3d-forge">
                  <div className="m3d-forge-pic">
                    {selected.inputImageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={selected.inputImageUrl} alt="" />
                      : <Icon name="image" size={40} />}
                    <span className="m3d-forge-scan" aria-hidden="true" />
                  </div>
                  <div className="m3d-forge-label" aria-live="polite">
                    {selectedLive?.paused ? selectedLive.label : selectedLive?.label ?? "กำลังเตรียมงาน…"}
                    {selectedLive?.stage === "queued" && selectedLive.queuePosition ? ` · คิวที่ ${selectedLive.queuePosition}` : ""}
                  </div>
                  <ol className="m3d-forge-steps">
                    {STEPS.map((s, i) => (
                      <li key={s} data-state={i < step ? "done" : i === step ? "now" : "next"}>
                        <span className="m3d-forge-dot">{i < step ? <Icon name="check" size={11} /> : i + 1}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                  <div className="m3d-meter" aria-hidden="true">
                    <span style={{ width: `${Math.round(Math.min(0.99, selectedLive?.progress ?? (step / STEPS.length)) * 100)}%` }} />
                  </div>
                  <div className="m3d-forge-time">
                    ผ่านไป {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
                    {selectedLive?.etaLabel ? ` · ${selectedLive.etaLabel}` : ""}
                  </div>
                </div>
              </div>
            )}

            {selected && (selected.status === "failed" || selected.status === "cancelled") && (
              <div className="m3d-overlay">
                <div className="m3d-failed" role="alert">
                  <Icon name="alert" size={26} />
                  <div className="m3d-failed-title">{selected.status === "cancelled" ? "ยกเลิกงานนี้แล้ว" : "สร้างโมเดลไม่สำเร็จ"}</div>
                  <div className="m3d-failed-msg">{selected.errorMessage ?? "ลองใหม่อีกครั้ง — ระบบคืนเครดิตให้แล้ว"}</div>
                  {selected.inputImageUrl && (
                    <button type="button" className="m3d-cta" onClick={() => reusePicture(selected)}><Icon name="again" /> ใช้ภาพนี้ลองอีกครั้ง</button>
                  )}
                </div>
              </div>
            )}

            {selected && selected.status === "completed" && (selected.mediaDeleted || !selected.resultUrl) && (
              <div className="m3d-overlay">
                <div className="m3d-failed">
                  <Icon name="alert" size={26} />
                  <div className="m3d-failed-title">ไฟล์โมเดลนี้หมดอายุและถูกลบแล้ว</div>
                  {selected.inputImageUrl && (
                    <button type="button" className="m3d-cta" onClick={() => reusePicture(selected)}><Icon name="again" /> สร้างใหม่จากภาพเดิม</button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Under the stage: what it is and what to do with it */}
          {selected && viewerSrc && (
            <div className="m3d-info">
              <div className="m3d-info-head">
                <div style={{ minWidth: 0 }}>
                  <div className="m3d-info-name" title={selected.prompt}>{selected.prompt || "โมเดล 3D"}</div>
                  <div className="m3d-info-sub">
                    {shortDate(selected.createdAt)}
                    {selected.remix?.quality && modes.find((m) => m.id === selected.remix?.quality) ? ` · ${modes.find((m) => m.id === selected.remix?.quality)?.label}` : ""}
                    {selected.processingMs ? ` · ใช้เวลา ${Math.max(1, Math.round(selected.processingMs / 60000))} นาที` : ""}
                    {typeof selected.daysLeft === "number" ? ` · เก็บไว้อีก ${selected.daysLeft} วัน` : ""}
                  </div>
                </div>
                <div className="m3d-info-actions">
                  {selected.inputImageUrl && (
                    <button type="button" className="m3d-ghost" onClick={() => reusePicture(selected)} title="ใช้ภาพต้นแบบเดิมสร้างอีกครั้ง"><Icon name="again" /> สร้างอีกแบบ</button>
                  )}
                  <button type="button" className="m3d-cta" onClick={downloadModel}><Icon name="download" /> ดาวน์โหลด GLB</button>
                </div>
              </div>
              {stats && (
                <dl className="m3d-stats">
                  <div><dt>สามเหลี่ยม</dt><dd>{stats.triangles.toLocaleString("th-TH")}</dd></div>
                  <div><dt>จุดยอด</dt><dd>{stats.vertices.toLocaleString("th-TH")}</dd></div>
                  <div><dt>พื้นผิว</dt><dd>{stats.textureSize ? `${stats.textureSize}×${stats.textureSize}` : "—"}</dd></div>
                  <div><dt>ขนาดไฟล์</dt><dd>{bytesLabel(stats.bytes)}</dd></div>
                  <div><dt>สัดส่วน ก×ส×ล</dt><dd>{stats.proportions.map((n) => n.toFixed(2)).join(" × ")}</dd></div>
                </dl>
              )}
              <div className="m3d-use">
                <span>นำไปใช้ได้กับ</span>
                {USE_WITH.map((u) => <span key={u} className="m3d-chip">{u}</span>)}
              </div>
              <p className="m3d-fineprint">
                GLB รวมพื้นผิวไว้ในไฟล์เดียว ลากเข้า Blender หรือ Godot ได้ทันที (Unity ใช้แพ็กเกจ glTFast) · จะพิมพ์ 3D ให้ export เป็น STL จาก Blender
                · ตัวละครยังไม่มีกระดูก ใส่ rig ต่อได้ใน Mixamo หรือ Blender
              </p>
            </div>
          )}
        </section>
      </div>

      {/* ── Library ── */}
      <section className="m3d-library" aria-label="โมเดล 3D ของฉัน">
        <div className="m3d-lib-head">
          <h2>โมเดล 3D ของฉัน</h2>
          <div className="m3d-filters" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id}
                data-active={filter === f.id ? "true" : "false"} onClick={() => setFilter(f.id)}>
                {f.label}
                {f.id === "active" && activeIds.length > 0 ? <span className="m3d-count">{activeIds.length}</span> : null}
              </button>
            ))}
          </div>
        </div>

        {libState === "loading" && (
          <div className="m3d-lib-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="m3d-card m3d-card-skel" />)}</div>
        )}
        {libState === "error" && (
          <div className="m3d-lib-empty">
            โหลดคลังผลงานไม่สำเร็จ <button type="button" className="m3d-ghost" onClick={retryLibrary}>ลองอีกครั้ง</button>
          </div>
        )}
        {libState === "ready" && visibleItems.length === 0 && (
          <div className="m3d-lib-empty">
            {items.length === 0 ? "ยังไม่มีโมเดล — เริ่มจากอัปโหลดภาพแรกของคุณด้านบน" : "ไม่มีโมเดลในหมวดนี้"}
          </div>
        )}
        {libState === "ready" && visibleItems.length > 0 && (
          <div className="m3d-lib-grid">
            {visibleItems.map((item) => {
              const thumb = item.thumbnailUrl ?? item.inputImageUrl;
              const itemLive = live[item.id];
              return (
                <button key={item.id} type="button" className="m3d-card" data-selected={item.id === selectedId ? "true" : "false"}
                  onClick={() => select(item.id)} aria-current={item.id === selectedId ? "true" : undefined}>
                  <div className="m3d-card-thumb">
                    {thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumb} alt="" loading="lazy" />
                      : <Icon name="cube" size={30} />}
                    <span className="m3d-card-badge">3D</span>
                    {isActive(item.status) && (
                      <span className="m3d-card-state m3d-card-busy">
                        <span className="m3d-spin" />
                        {itemLive?.progress ? `${Math.round(itemLive.progress * 100)}%` : "กำลังสร้าง"}
                      </span>
                    )}
                    {(item.status === "failed" || item.status === "cancelled") && <span className="m3d-card-state m3d-card-fail">ไม่สำเร็จ</span>}
                  </div>
                  <div className="m3d-card-meta">
                    <span className="m3d-card-name">{item.prompt || "โมเดล 3D"}</span>
                    <span className="m3d-card-date">{shortDate(item.createdAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {libState === "ready" && page < pages && (
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button type="button" className="m3d-ghost" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "กำลังโหลด…" : "โหลดเพิ่ม"}
            </button>
          </div>
        )}
      </section>

      <style>{CSS}</style>
    </div>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────

const CSS = `
.m3d-wrap { max-width: 1380px; margin: 0 auto; padding: 8px 24px 40px; color: #e2e8f0; }
.m3d-skeleton { height: 70vh; border-radius: 22px; background: linear-gradient(110deg, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 70%); background-size: 200% 100%; animation: m3d-shimmer 1.6s linear infinite; }

.m3d-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 4px 0 18px; }
.m3d-back { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: rgba(165,243,252,0.75); text-decoration: none; margin-bottom: 10px; }
.m3d-back:hover { color: #a5f3fc; }
.m3d-eyebrow { font-size: 11px; color: #a5f3fc; margin-bottom: 6px; }
.m3d-eyebrow-en { letter-spacing: 0.22em; }
/* Spacing pulls Thai vowels and tone marks off their consonants. */
.m3d-eyebrow-th { letter-spacing: 0.02em; color: #fbbf24; }
.m3d-title { font-size: clamp(26px, 3.4vw, 40px); font-weight: 700; line-height: 1.15; margin: 0; letter-spacing: -0.01em; }
.m3d-title em { font-style: italic; background: linear-gradient(120deg, hsl(${(160 + HUE) % 360},80%,62%), hsl(${(200 + HUE) % 360},85%,66%), hsl(${(270 + HUE) % 360},80%,72%)); -webkit-background-clip: text; background-clip: text; color: transparent; padding-right: 4px; }
.m3d-sub { margin: 8px 0 0; max-width: 640px; font-size: 14px; line-height: 1.65; color: rgba(203,213,225,0.78); }
.m3d-credits { flex-shrink: 0; display: inline-flex; align-items: baseline; gap: 6px; padding: 9px 14px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 15px; color: #fbbf24; background: hsla(48,90%,60%,0.1); border: 1px solid hsla(48,90%,60%,0.25); }
.m3d-credits span { font-size: 11px; font-weight: 500; color: rgba(251,191,36,0.75); }

.m3d-banner { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-radius: 14px; margin-bottom: 16px; font-size: 13px; color: #fde68a; background: hsla(38,90%,55%,0.1); border: 1px solid hsla(38,90%,55%,0.28); }

.m3d-grid { display: grid; grid-template-columns: 350px minmax(0, 1fr); gap: 20px; align-items: start; }

.m3d-panel { position: sticky; top: 88px; display: flex; flex-direction: column; gap: 20px; padding: 18px; border-radius: 22px;
  background: rgba(10,16,34,0.62); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(18px);
  box-shadow: 0 30px 60px -30px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04); }
.m3d-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.03em; color: #a5f3fc; margin-bottom: 10px; }
.m3d-label small { letter-spacing: 0; font-weight: 400; color: rgba(148,163,184,0.8); font-size: 11px; }
.m3d-num { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; letter-spacing: 0; color: #fff; background: linear-gradient(135deg, #10b981, #06b6d4 55%, #8b5cf6); }

.m3d-drop { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 26px 16px; border-radius: 16px; cursor: pointer; color: #e2e8f0; text-align: center;
  background: radial-gradient(ellipse at 50% 0%, rgba(34,211,238,0.08), transparent 70%), rgba(255,255,255,0.02);
  border: 1.5px dashed rgba(165,243,252,0.28); transition: border-color 180ms, background 180ms, transform 180ms; }
.m3d-drop:hover, .m3d-drop[data-over="true"] { border-color: #22d3ee; background: radial-gradient(ellipse at 50% 0%, rgba(34,211,238,0.16), transparent 70%), rgba(34,211,238,0.04); }
.m3d-drop[data-over="true"] { transform: scale(1.01); }
.m3d-drop:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
.m3d-drop-icon { display: inline-flex; padding: 12px; border-radius: 14px; color: #67e8f9; background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.25); }
.m3d-drop-title { font-size: 14px; font-weight: 600; }
.m3d-drop-sub { font-size: 11.5px; color: rgba(148,163,184,0.9); line-height: 1.5; }

.m3d-picked { display: grid; grid-template-columns: 96px minmax(0,1fr); grid-template-rows: auto auto; gap: 8px 12px; align-items: center; }
.m3d-picked-img { grid-row: span 2; position: relative; width: 96px; height: 96px; border-radius: 14px; overflow: hidden;
  background-color: #1e293b; background-image: linear-gradient(45deg, #263449 25%, transparent 25%), linear-gradient(-45deg, #263449 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #263449 75%), linear-gradient(-45deg, transparent 75%, #263449 75%);
  background-size: 14px 14px; background-position: 0 0, 0 7px, 7px -7px, -7px 0; border: 1px solid rgba(255,255,255,0.1); }
.m3d-picked-img img { width: 100%; height: 100%; object-fit: contain; display: block; }
.m3d-picked-veil { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 10.5px; background: rgba(2,6,23,0.65); }
.m3d-picked-ok { position: absolute; left: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; color: #022c22; background: #34d399; }
.m3d-picked-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 12px; color: rgba(148,163,184,0.9); }
.m3d-picked-meta span:first-child { font-size: 13px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m3d-picked-actions { display: flex; gap: 6px; }

.m3d-tips { margin-top: 10px; font-size: 12px; color: rgba(203,213,225,0.85); }
.m3d-tips summary { cursor: pointer; color: rgba(165,243,252,0.85); list-style: none; }
.m3d-tips summary::-webkit-details-marker { display: none; }
.m3d-tips summary::before { content: "＋ "; }
.m3d-tips[open] summary::before { content: "－ "; }
.m3d-tips ul { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.m3d-tips li { position: relative; padding-left: 20px; line-height: 1.5; }
.m3d-tips li::before { position: absolute; left: 0; top: 0; font-weight: 700; }
.m3d-tips li[data-ok="true"]::before { content: "✓"; color: #34d399; }
.m3d-tips li[data-ok="false"]::before { content: "✕"; color: #fca5a5; }

.m3d-input { width: 100%; padding: 11px 13px; border-radius: 12px; font-size: 14px; color: #f1f5f9; background: rgba(2,6,23,0.55); border: 1px solid rgba(255,255,255,0.1); outline: none; transition: border-color 160ms, box-shadow 160ms; }
.m3d-input:focus { border-color: rgba(34,211,238,0.6); box-shadow: 0 0 0 3px rgba(34,211,238,0.12); }

.m3d-modes { display: flex; flex-direction: column; gap: 8px; }
.m3d-mode { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px 13px; border-radius: 14px; cursor: pointer; color: #e2e8f0;
  background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); transition: border-color 160ms, background 160ms; }
.m3d-mode:hover { border-color: rgba(165,243,252,0.3); }
.m3d-mode[data-active="true"] { background: linear-gradient(135deg, hsla(${(160 + HUE) % 360},70%,50%,0.16), hsla(${(270 + HUE) % 360},70%,60%,0.16)); border-color: hsla(${(220 + HUE) % 360},75%,62%,0.6); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.m3d-mode:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
.m3d-mode-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.m3d-mode-name { font-size: 14px; font-weight: 600; }
.m3d-mode-price { flex-shrink: 0; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: #fbbf24; background: hsla(48,90%,60%,0.13); }
.m3d-mode-desc { font-size: 12px; line-height: 1.5; color: rgba(148,163,184,0.95); }
.m3d-mode-badge { align-self: flex-start; padding: 1px 7px; border-radius: 999px; font-size: 10px; color: #fbbf24; background: hsla(38,90%,55%,0.15); }

.m3d-adv-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0; background: none; border: none; cursor: pointer; font-size: 12.5px; color: rgba(165,243,252,0.85); }
.m3d-adv-toggle span { transition: transform 200ms; }
.m3d-adv { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
.m3d-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: rgba(203,213,225,0.9); cursor: pointer; }
.m3d-check input { accent-color: #22d3ee; width: 15px; height: 15px; }
.m3d-seed { display: flex; gap: 8px; }

.m3d-order { display: flex; flex-direction: column; gap: 8px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.07); }
.m3d-order-line { display: flex; justify-content: space-between; font-size: 13px; }
.m3d-order-line strong { color: #fbbf24; }
.m3d-dim { color: rgba(148,163,184,0.85); font-size: 12px; }

.m3d-cta { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 18px; border-radius: 12px; border: none; cursor: pointer; text-decoration: none;
  font-size: 14px; font-weight: 600; color: #fff; background: linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%);
  box-shadow: 0 10px 28px -10px rgba(139,92,246,0.7); transition: transform 160ms, box-shadow 160ms, opacity 160ms; }
.m3d-cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 32px -10px rgba(139,92,246,0.85); }
.m3d-cta:disabled { cursor: not-allowed; opacity: 0.42; box-shadow: none; }
.m3d-cta:focus-visible, .m3d-ghost:focus-visible, .m3d-tool:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
.m3d-go { width: 100%; padding: 14px 18px; font-size: 15px; margin-top: 4px; }
.m3d-ghost { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border-radius: 10px; cursor: pointer; font-size: 12.5px; color: #e2e8f0;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); transition: background 160ms, border-color 160ms; }
.m3d-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.09); border-color: rgba(165,243,252,0.3); }
.m3d-ghost:disabled { opacity: 0.5; cursor: wait; }
.m3d-link { margin-left: 6px; color: #67e8f9; text-decoration: none; font-weight: 600; white-space: nowrap; }

.m3d-error { display: flex; align-items: flex-start; gap: 6px; flex-wrap: wrap; margin-top: 8px; padding: 9px 11px; border-radius: 10px; font-size: 12.5px; line-height: 1.5; color: #fecaca; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); }
.m3d-warn { margin-top: 8px; padding: 8px 11px; border-radius: 10px; font-size: 12px; line-height: 1.5; color: #fde68a; background: hsla(38,90%,55%,0.08); border: 1px solid hsla(38,90%,55%,0.22); }
.m3d-fineprint { margin: 2px 0 0; font-size: 11.5px; line-height: 1.6; color: rgba(148,163,184,0.8); }

.m3d-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.m3d-stage { position: relative; height: clamp(440px, 66vh, 780px); border-radius: 24px; overflow: hidden; isolation: isolate;
  border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 40px 80px -40px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.05); }
.m3d-stage[data-bg="space"] { background: radial-gradient(ellipse at 50% 30%, rgba(34,211,238,0.12), transparent 60%), radial-gradient(ellipse at 50% 115%, rgba(139,92,246,0.22), transparent 55%), #050a18; }
.m3d-stage[data-bg="studio"] { background: radial-gradient(ellipse at 50% 35%, #ffffff 0%, #e2e8f0 55%, #a7b4c6 100%); }
.m3d-stage[data-bg="void"] { background: #000; }
.m3d-stage[data-fullscreen="true"] { height: 100vh; border-radius: 0; border: none; }

.m3d-bar { position: absolute; z-index: 2; display: flex; gap: 8px; }
.m3d-bar-top { top: 12px; left: 12px; right: 12px; flex-wrap: wrap; }
.m3d-bar-side { right: 12px; bottom: 12px; flex-direction: column; }
.m3d-seg { display: inline-flex; padding: 3px; border-radius: 12px; background: rgba(2,6,23,0.6); border: 1px solid rgba(255,255,255,0.09); backdrop-filter: blur(12px); }
.m3d-seg button { padding: 6px 11px; border-radius: 9px; border: none; cursor: pointer; font-size: 12px; color: rgba(226,232,240,0.7); background: transparent; transition: background 160ms, color 160ms; white-space: nowrap; }
.m3d-seg button:hover { color: #fff; }
.m3d-seg button[data-active="true"] { color: #fff; background: linear-gradient(135deg, hsla(${(160 + HUE) % 360},70%,50%,0.35), hsla(${(270 + HUE) % 360},70%,60%,0.35)); }
.m3d-seg button:focus-visible { outline: 2px solid #22d3ee; outline-offset: -2px; }
.m3d-tool { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 12px; cursor: pointer; color: rgba(226,232,240,0.85);
  background: rgba(2,6,23,0.6); border: 1px solid rgba(255,255,255,0.09); backdrop-filter: blur(12px); transition: color 160ms, border-color 160ms, background 160ms; }
.m3d-tool:hover { color: #fff; border-color: rgba(165,243,252,0.35); }
.m3d-tool[data-active="true"] { color: #67e8f9; border-color: rgba(34,211,238,0.5); background: rgba(8,47,73,0.7); }

.m3d-overlay { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; padding: 20px; pointer-events: none; }
.m3d-overlay > * { pointer-events: auto; }
.m3d-empty { margin-top: 46%; text-align: center; padding: 16px 20px; border-radius: 18px; background: rgba(2,6,23,0.5); border: 1px solid rgba(255,255,255,0.07); backdrop-filter: blur(10px); }
.m3d-empty-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; }
.m3d-empty-steps { list-style: none; margin: 0; padding: 0; display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; font-size: 12.5px; color: rgba(203,213,225,0.85); }
.m3d-empty-steps li { display: flex; align-items: center; gap: 6px; }
.m3d-empty-steps span { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; color: #a5f3fc; border: 1px solid rgba(165,243,252,0.4); }

.m3d-forge { width: min(420px, 100%); display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 22px; border-radius: 22px; text-align: center;
  background: rgba(2,6,23,0.66); border: 1px solid rgba(165,243,252,0.16); backdrop-filter: blur(16px); box-shadow: 0 30px 60px -30px rgba(34,211,238,0.35); }
.m3d-forge-pic { position: relative; width: 150px; height: 150px; border-radius: 18px; overflow: hidden; display: flex; align-items: center; justify-content: center; color: rgba(165,243,252,0.6);
  background: radial-gradient(circle at 50% 60%, rgba(34,211,238,0.18), rgba(2,6,23,0.6)); border: 1px solid rgba(34,211,238,0.3); }
.m3d-forge-pic img { width: 100%; height: 100%; object-fit: contain; filter: saturate(0.9) drop-shadow(0 0 12px rgba(34,211,238,0.35)); animation: m3d-breathe 3.2s ease-in-out infinite; }
.m3d-forge-scan { position: absolute; left: 0; right: 0; height: 40%; top: -40%; background: linear-gradient(180deg, transparent, rgba(103,232,249,0.35), transparent); animation: m3d-scan 2.4s linear infinite; }
.m3d-forge-label { font-size: 14px; font-weight: 600; color: #e2e8f0; min-height: 20px; }
.m3d-forge-steps { list-style: none; margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; gap: 7px; text-align: left; font-size: 12.5px; }
.m3d-forge-steps li { display: flex; align-items: center; gap: 9px; color: rgba(148,163,184,0.7); transition: color 300ms; }
.m3d-forge-steps li[data-state="done"] { color: rgba(110,231,183,0.9); }
.m3d-forge-steps li[data-state="now"] { color: #fff; font-weight: 600; }
.m3d-forge-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; font-size: 10px; border: 1px solid rgba(148,163,184,0.35); flex-shrink: 0; }
.m3d-forge-steps li[data-state="done"] .m3d-forge-dot { color: #022c22; background: #34d399; border-color: #34d399; }
.m3d-forge-steps li[data-state="now"] .m3d-forge-dot { color: #fff; border-color: #22d3ee; box-shadow: 0 0 0 3px rgba(34,211,238,0.18); animation: m3d-pulse 1.6s ease-in-out infinite; }
.m3d-meter { width: 100%; height: 6px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,0.07); }
.m3d-meter span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #10b981, #06b6d4, #8b5cf6); transition: width 900ms ease; }
.m3d-forge-time { font-size: 11.5px; color: rgba(148,163,184,0.85); font-variant-numeric: tabular-nums; }

.m3d-failed { width: min(380px, 100%); display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 22px; border-radius: 20px; text-align: center; color: #fca5a5;
  background: rgba(2,6,23,0.7); border: 1px solid rgba(239,68,68,0.25); backdrop-filter: blur(14px); }
.m3d-failed-title { font-size: 15px; font-weight: 600; color: #fee2e2; }
.m3d-failed-msg { font-size: 12.5px; line-height: 1.6; color: rgba(203,213,225,0.85); }

.m3d-info { padding: 16px 18px; border-radius: 20px; background: rgba(10,16,34,0.62); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(18px); display: flex; flex-direction: column; gap: 12px; }
.m3d-info-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.m3d-info-name { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m3d-info-sub { font-size: 12px; color: rgba(148,163,184,0.9); margin-top: 2px; }
.m3d-info-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.m3d-stats { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 8px; margin: 0; }
.m3d-stats div { padding: 9px 11px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); min-width: 0; }
.m3d-stats dt { font-size: 10.5px; color: rgba(148,163,184,0.85); margin-bottom: 3px; }
.m3d-stats dd { margin: 0; font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m3d-use { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: rgba(148,163,184,0.9); }
.m3d-chip { padding: 3px 9px; border-radius: 999px; font-size: 11.5px; color: #cbd5e1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }

.m3d-library { margin-top: 34px; }
.m3d-lib-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.m3d-lib-head h2 { margin: 0; font-size: 19px; font-weight: 700; }
.m3d-filters { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.m3d-filters button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border-radius: 999px; cursor: pointer; font-size: 12.5px; color: rgba(226,232,240,0.7); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
.m3d-filters button[data-active="true"] { color: #fff; background: linear-gradient(135deg, hsla(${(160 + HUE) % 360},70%,55%,0.25), hsla(${(270 + HUE) % 360},70%,60%,0.25)); border-color: hsla(${(220 + HUE) % 360},70%,60%,0.5); }
.m3d-count { padding: 0 6px; border-radius: 999px; font-size: 10.5px; color: #022c22; background: #67e8f9; }
.m3d-lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 14px; }
.m3d-lib-empty { padding: 28px; border-radius: 18px; text-align: center; font-size: 13.5px; color: rgba(148,163,184,0.9); background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.m3d-card { display: flex; flex-direction: column; padding: 0; border-radius: 16px; overflow: hidden; cursor: pointer; text-align: left; color: #e2e8f0;
  background: rgba(10,16,34,0.6); border: 1px solid rgba(255,255,255,0.07); transition: transform 180ms, border-color 180ms, box-shadow 180ms; }
.m3d-card:hover { transform: translateY(-2px); border-color: rgba(165,243,252,0.3); }
.m3d-card[data-selected="true"] { border-color: #22d3ee; box-shadow: 0 0 0 1px #22d3ee, 0 16px 34px -16px rgba(34,211,238,0.55); }
.m3d-card:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
.m3d-card-skel { height: 220px; cursor: default; background: linear-gradient(110deg, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 70%); background-size: 200% 100%; animation: m3d-shimmer 1.6s linear infinite; }
.m3d-card-thumb { position: relative; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; color: rgba(165,243,252,0.5);
  background: radial-gradient(circle at 50% 65%, rgba(34,211,238,0.12), rgba(2,6,23,0.5)); }
.m3d-card-thumb img { width: 100%; height: 100%; object-fit: contain; padding: 10px; }
.m3d-card-badge { position: absolute; top: 8px; left: 8px; padding: 2px 7px; border-radius: 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #a5f3fc; background: rgba(2,6,23,0.7); border: 1px solid rgba(165,243,252,0.3); }
.m3d-card-state { position: absolute; left: 8px; right: 8px; bottom: 8px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 5px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; backdrop-filter: blur(8px); }
.m3d-card-busy { color: #a5f3fc; background: rgba(8,47,73,0.75); border: 1px solid rgba(34,211,238,0.35); }
.m3d-card-fail { color: #fecaca; background: rgba(69,10,10,0.75); border: 1px solid rgba(239,68,68,0.35); }
.m3d-card-meta { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px 12px; min-width: 0; }
.m3d-card-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m3d-card-date { font-size: 11px; color: rgba(148,163,184,0.85); }

.m3d-spin { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.25); border-top-color: #fff; animation: m3d-rot 0.8s linear infinite; flex-shrink: 0; }

.m3d-gate { max-width: 460px; margin: 60px auto; padding: 34px 28px; border-radius: 24px; text-align: center; color: #a5f3fc;
  background: rgba(10,16,34,0.62); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(18px); display: flex; flex-direction: column; align-items: center; gap: 12px; }
.m3d-gate h1 { margin: 0; font-size: 22px; color: #f1f5f9; }
.m3d-gate p { margin: 0 0 6px; font-size: 14px; color: rgba(203,213,225,0.8); }

@keyframes m3d-rot { to { transform: rotate(360deg); } }
@keyframes m3d-scan { to { top: 100%; } }
@keyframes m3d-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
@keyframes m3d-pulse { 0%, 100% { box-shadow: 0 0 0 3px rgba(34,211,238,0.18); } 50% { box-shadow: 0 0 0 6px rgba(34,211,238,0.06); } }
@keyframes m3d-shimmer { to { background-position: -200% 0; } }

@media (max-width: 1023px) {
  .m3d-grid { grid-template-columns: minmax(0, 1fr); }
  .m3d-panel { position: static; }
  .m3d-stage { height: clamp(380px, 92vw, 620px); }
  .m3d-stats { grid-template-columns: repeat(3, minmax(0,1fr)); }
}
@media (max-width: 640px) {
  .m3d-wrap { padding: 4px 16px 32px; }
  .m3d-head { flex-direction: column; align-items: flex-start; }
  .m3d-bar-top { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; right: 12px; }
  .m3d-bar-top::-webkit-scrollbar { display: none; }
  .m3d-stats { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .m3d-lib-grid { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .m3d-empty { margin-top: 60%; }
  .m3d-empty-steps { flex-direction: column; gap: 6px; align-items: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .m3d-forge-pic img, .m3d-forge-scan, .m3d-forge-steps li[data-state="now"] .m3d-forge-dot, .m3d-skeleton, .m3d-card-skel { animation: none; }
  .m3d-card, .m3d-cta { transition: none; }
}
`;
