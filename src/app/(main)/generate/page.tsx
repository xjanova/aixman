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
import { creditsForDuration } from "@/lib/pricing";
import { downloadGeneration, extensionOf, saveFavorite } from "@/lib/client-actions";
import { nextQueueProgress, shownFraction, type QueueProgress, type QueueReading } from "@/lib/queue-progress";
import { AUDIO_EXT, AudioCover, AudioResult } from "@/components/xdreamer/audio";

const HUE = 70;

type TabType = "image" | "video" | "edit" | "lipsync" | "audio";

/**
 * Lip-sync models are `category: 'video'` on the server — a clip is what comes
 * out — but they are driven by an uploaded voice track rather than a prompt, so
 * the studio gives them their own tab and keeps them out of the video one.
 * The server-side marker for that split is the subcategory.
 *
 * The suffix says what the model animates, which is what decides whether the
 * second upload slot asks for a clip or a still. It is data rather than a list
 * of model ids here so that adding a third lip-sync model is a seed change.
 */
const LIPSYNC_VIDEO = "lipsync";
const LIPSYNC_PORTRAIT = "lipsync-portrait";
const isLipsyncModel = (subcategory?: string | null) =>
  subcategory === LIPSYNC_VIDEO || subcategory === LIPSYNC_PORTRAIT;

const aspectRatios = [
  { value: "1:1",  label: "1:1",  w: 1024, h: 1024 },
  { value: "16:9", label: "16:9", w: 1344, h: 768 },
  { value: "9:16", label: "9:16", w: 768,  h: 1344 },
  { value: "4:3",  label: "4:3",  w: 1152, h: 896 },
  { value: "3:2",  label: "3:2",  w: 1216, h: 832 },
];

/**
 * The ratios the video providers accept. Kling, Luma and Replicate take an
 * `aspect_ratio` string and none of them know 4:3 or 3:2, so offering those
 * would just get silently coerced somewhere upstream.
 */
const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"];

/** Clip lengths, filtered per model against `ai_models.max_duration`. */
const VIDEO_DURATIONS = [5, 10, 15, 20];

/** Song lengths, filtered the same way against the music model's ceiling. */
const AUDIO_DURATIONS = [30, 60, 120, 180, 240, 300];

/** Style words a music model understands — the image chips mean nothing to it. */
const MUSIC_TAG_CHIPS = [
  "thai pop", "luk thung", "lo-fi", "acoustic guitar", "piano", "female vocal",
  "male vocal", "upbeat", "chill", "cinematic", "EDM", "rock",
];

/**
 * Section markers a music model reads. Typed by hand they are easy to get
 * subtly wrong (`[verse 1]`, `(chorus)`), and a marker the model does not
 * recognise is sung as if it were a line of the song.
 */
const SECTION_TAGS = ["[Verse]", "[Chorus]", "[Bridge]", "[Outro]"];

/** One-tap starting points for the music tab, shown before the first song. */
const MUSIC_STARTERS = [
  "ป๊อปไทยสดใส เสียงร้องหญิง กีตาร์โปร่ง จังหวะเร็ว",
  "ลูกทุ่งอีสานสนุกๆ แคน พิณ เสียงร้องชาย",
  "lo-fi ชิลๆ เปียโน ฝนตก ฟังตอนทำงาน",
  "ดนตรีประกอบโฆษณา สร้างแรงบันดาลใจ ออร์เคสตรา",
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

/** The fields of GET /api/generate/[id] this page reads while polling. */
interface GenerationStatus {
  id: number;
  status: string;
  resultUrl?: string;
  resultUrls?: string[] | string | null;
  thumbnailUrl?: string;
  creditsUsed: number;
  processingMs?: number;
  expiresAt?: string;
  daysLeft?: number | null;
  errorMessage?: string | null;
  gpu?: QueueReading | null;
}

// ─── X-DREAMER UI primitives (local helpers) ───────────────────────────
function Pill({ active, children, onClick, disabled, title }: { active?: boolean; children: React.ReactNode; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      padding: "8px 14px", borderRadius: 999, fontSize: 13, cursor: disabled ? "not-allowed" : "pointer",
      // Dimmed rather than hidden, with the reason in the tooltip.
      opacity: disabled ? 0.38 : 1,
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

/**
 * Longest input these endpoints are priced for.
 *
 * LatentSync costs a flat $0.20 up to 40 seconds of **output**, and the output
 * length follows the voice track rather than the source clip. Past that it is
 * $0.005 per second, against a credit price that does not move — so a
 * ten-minute recording would cost several dollars and earn the same 36 credits.
 */
const MAX_INPUT_SECONDS = 40;

/**
 * Read a media file's duration in the browser, before it is uploaded.
 *
 * This is a courtesy check, not the billing control: a determined caller can
 * skip the page entirely. It exists because the honest failure mode — someone
 * picks a twenty-minute recording, waits for a 25 MB upload, and only then
 * finds out — is the common one, and the server genuinely cannot tell without
 * decoding the file. Anything unreadable resolves to null and is allowed
 * through rather than blocking a valid file we simply could not parse.
 */
function probeDuration(file: File, kind: "audio" | "video"): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "audio" ? "audio" : "video");
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => { URL.revokeObjectURL(url); resolve(value); };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    // A file the browser cannot decode would otherwise never settle this promise.
    setTimeout(() => done(null), 10_000);
    el.src = url;
  });
}

/**
 * POST one file to `/api/uploads` and report either its URL or a message.
 *
 * Outside the component deliberately: it owns the try/catch that the caller
 * cannot have (see `handleMediaUpload`), and errors come back as a value so
 * the caller needs no error handling of its own.
 */
async function uploadMedia(
  file: File,
  kind: "audio" | "video" | "image",
): Promise<{ url?: string; error?: string }> {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/uploads?kind=${kind}`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "ลองใหม่อีกครั้ง" };
    if (typeof data.url !== "string") return { error: "เซิร์ฟเวอร์ไม่ได้ส่งลิงก์ไฟล์กลับมา" };
    return { url: data.url };
  } catch {
    return { error: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้" };
  }
}

type ResolutionPreset = { id: string; label: string; aspects: string[]; isDefault?: boolean };

/**
 * The resolution preset an order uses: the customer's pick while this aspect
 * still offers it, else the model's default for that aspect.
 *
 * Display only. `handleGenerate` sends the raw pick and lets the server apply
 * the same fallback: computing from `selectedModel` inside the handler made
 * React Compiler classify it as render-time code (a false `react-hooks/purity`
 * error on its `Date.now()`), and a component with a compiler error loses
 * auto-memoization entirely.
 */
function pickResolution(
  presets: ResolutionPreset[] | null | undefined,
  aspect: string,
  chosen: string | null,
): ResolutionPreset | null {
  const offered = (presets ?? []).filter((r) => r.aspects.includes(aspect));
  return offered.find((r) => r.id === chosen) ?? offered.find((r) => r.isDefault) ?? offered[0] ?? null;
}

/*
 * Like `uploadMedia`, the helpers below own every try/catch this page needs
 * and return failures as values. React Compiler cannot compile a component
 * whose try/catch contains a value block (`||`, `??`, `?.`, a ternary) or a
 * `throw`, and gives up on the whole component silently when it meets one —
 * see lib/client-actions.ts and `react-hooks/todo` in eslint.config.mjs.
 */

/** Recent finished generations for the history strip, or null on failure. */
async function fetchHistoryItems(): Promise<HistoryItem[] | null> {
  try {
    const res = await fetch("/api/gallery?limit=16&page=1");
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data ?? []).filter((g: HistoryItem) => g.resultUrl || g.thumbnailUrl);
  } catch {
    return null;
  }
}

/** One status read for a generation; `status` is null when the request failed. */
async function readGeneration(
  generationId: number,
): Promise<{ ok: true; data: GenerationStatus } | { ok: false; status: number | null }> {
  try {
    const res = await fetch(`/api/generate/${generationId}`);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as GenerationStatus };
  } catch {
    return { ok: false, status: null };
  }
}

/** POST an order. `network` covers an unreachable server and a non-JSON answer. */
async function postGeneration(
  body: Record<string, unknown>,
): Promise<{ kind: "ok"; data: GenerationResult } | { kind: "rejected"; error: string } | { kind: "network" }> {
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { kind: "rejected", error: data.error || "ไม่สามารถสร้างได้" };
    return { kind: "ok", data: data as GenerationResult };
  } catch {
    return { kind: "network" };
  }
}

type UpscaleOutcome =
  | { kind: "done"; resultUrl: string; creditsUsed: number }
  | { kind: "rejected"; error: string }
  | { kind: "failed"; error?: string }
  /** Polling ended without an answer — nothing to tell the customer. */
  | { kind: "gave-up" }
  | { kind: "network" };

/** Start an upscale and, unless it finished at once, poll it (60 × 3 s). */
async function runUpscale(generationId: number): Promise<UpscaleOutcome> {
  try {
    const res = await fetch("/api/upscale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId }) });
    const data = await res.json();
    if (!res.ok) return { kind: "rejected", error: data.error || "เกิดข้อผิดพลาด" };
    if (data.status === "completed" && data.resultUrl) {
      return { kind: "done", resultUrl: data.resultUrl, creditsUsed: data.creditsUsed };
    }
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(`/api/generate/${data.id}`);
      if (!pollRes.ok) return { kind: "gave-up" };
      const pollData = await pollRes.json();
      if (pollData.status === "completed") {
        return { kind: "done", resultUrl: pollData.resultUrl, creditsUsed: pollData.creditsUsed };
      }
      if (pollData.status === "failed") return { kind: "failed", error: pollData.errorMessage };
    }
    return { kind: "gave-up" };
  } catch {
    return { kind: "network" };
  }
}

/**
 * Picker for a file that lives on the server rather than in the page.
 *
 * The image pickers elsewhere show a thumbnail because they hold the bytes as
 * a data URL. These do not: audio and video are uploaded on selection and only
 * the URL is kept, so what can honestly be shown is the filename and whether
 * the upload finished. Showing a player here would mean re-downloading a file
 * the customer already has.
 */
function FilePick({
  value, busy, accept, hint, onPick, onClear,
}: {
  value: string | null;
  busy: boolean;
  accept: string;
  hint: string;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  if (busy) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 18, borderRadius: 12, border: "1.5px dashed rgba(255,255,255,0.15)", background: "rgba(2,6,23,0.3)", color: "#94a3b8", fontSize: 12 }}>
        กำลังอัปโหลด…
      </div>
    );
  }

  if (value) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(2,6,23,0.45)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <span style={{ fontSize: 14 }}>✓</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
        <button onClick={onClear} aria-label="เอาไฟล์ออก"
          style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
    );
  }

  return (
    <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, borderRadius: 12, border: "1.5px dashed rgba(255,255,255,0.15)", background: "rgba(2,6,23,0.3)", color: "#64748b", fontSize: 12, cursor: "pointer" }}>
      <div style={{ fontSize: 22, marginBottom: 4 }}>↑</div>
      {hint}
      <input type="file" accept={accept} style={{ display: "none" }} onChange={onPick} />
    </label>
  );
}

const ASPECT_RATIO_CSS: Record<string, string> = {
  "1:1": "1/1", "16:9": "16/9", "9:16": "9/16", "4:3": "4/3", "3:2": "3/2",
};

/** "16:9" → 1.78; anything unparseable is square. */
function aspectNumber(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 1;
}

/**
 * Tallest the in-progress frame may be: `--gen-frame-h`, set on the canvas in
 * the page styles. On desktop the canvas is a size container and the value is
 * its own height less the status block under the frame — the canvas shares one
 * screen with the header and the history strip, so the viewport height says
 * little about the room actually left. A 2×2 grid of full-width squares (what
 * the image tab used to draw, three of them empty) was ~1,500 px tall and hid
 * the queue animation at its centre off the top of the canvas.
 */
const GENERATING_FRAME_MAX_H = "var(--gen-frame-h, min(460px, 44vh))";

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
    <div ref={ref} style={{ position: "relative", flex: "1 1 132px", minWidth: "min(124px, 100%)" }}>
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

/** A clock for components whose display moves between polls. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Rotating captions while a result is being made — flavour, not status. */
const CREATING_TIPS: Record<string, string[]> = {
  video: ["กำลังจัดแสงและมุมกล้อง…", "กำลังวาดเฟรมทีละภาพ…", "กำลังใส่เสียงประกอบ…", "กำลังเก็บรายละเอียดการเคลื่อนไหว…"],
  image: ["กำลังเรียงองค์ประกอบภาพ…", "กำลังลงสีและแสงเงา…", "กำลังเก็บรายละเอียดให้คมชัด…"],
  edit: ["กำลังอ่านภาพต้นฉบับ…", "กำลังแก้ไขตามที่สั่ง…", "กำลังเกลี่ยรอยต่อให้เนียน…"],
  lipsync: ["กำลังฟังเสียงพูด…", "กำลังขยับปากให้ตรงจังหวะ…", "กำลังเก็บรายละเอียดใบหน้า…"],
  audio: ["กำลังแต่งทำนอง…", "กำลังเรียบเรียงดนตรี…", "กำลังใส่เสียงร้อง…", "กำลังมิกซ์เสียง…"],
};

/** The animated centre of a frame while its result is being made. */
function GeneratingOverlay({ progress }: { progress: QueueProgress | null }) {
  const place = progress?.stage === "queued" ? progress.position ?? 0 : 0;
  const now = useNow(500);
  const fraction = progress?.stage === "rendering" ? shownFraction(progress, now) : null;
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,0.45)", backdropFilter: "blur(3px)", overflow: "hidden", display: "grid", placeItems: "center" }}>
      {/* A soft band of light sweeping down the frame. */}
      <div className="xdr-motion" style={{ position: "absolute", left: 0, right: 0, top: 0, height: "45%", background: "linear-gradient(180deg, transparent, hsla(190,90%,70%,0.12), transparent)", animation: "xdr-scan 3.2s linear infinite" }} />
      {/* Sparks rising from the bottom edge. */}
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className="xdr-motion" style={{
          position: "absolute", bottom: 8, left: `${6 + i * 9.5}%`, width: 3, height: 3, borderRadius: 999,
          background: `hsl(${180 + i * 16},90%,75%)`, boxShadow: `0 0 8px hsl(${180 + i * 16},90%,70%)`,
          animation: `xdr-rise ${3 + (i % 4) * 0.6}s ease-out ${i * 0.35}s infinite`, opacity: 0,
        }} />
      ))}
      <div style={{ position: "relative", width: 128, height: 128, display: "grid", placeItems: "center" }}>
        <div className="xdr-motion" style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: "conic-gradient(from 0deg, hsl(180,90%,60%), hsl(265,90%,66%), hsl(320,90%,66%), hsl(180,90%,60%))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))",
          animation: "xdr-spin 2.4s linear infinite",
        }} />
        <div className="xdr-motion" style={{
          position: "absolute", inset: 20, borderRadius: "50%",
          background: "radial-gradient(circle, hsla(200,95%,70%,0.55), hsla(270,90%,60%,0.16) 60%, transparent 72%)",
          animation: "xdr-core 2.2s ease-in-out infinite",
        }} />
        <div style={{ position: "relative", textAlign: "center", color: "#fff" }}>
          {place > 0 ? (
            <>
              <div style={{ fontSize: 10, letterSpacing: "0.18em", opacity: 0.75 }}>คิวที่</div>
              {/* Keyed on the number, so each step down replays the pop. */}
              <div key={place} className="xdr-motion" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.05, animation: "xdr-pop 450ms ease-out" }}>{place}</div>
            </>
          ) : fraction != null ? (
            <>
              <div style={{ fontSize: 10, letterSpacing: "0.18em", opacity: 0.75 }}>กำลังสร้าง</div>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
                {Math.floor(fraction * 100)}<span style={{ fontSize: 16, opacity: 0.8 }}>%</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.04em" }}>
              {progress?.paused ? "หยุดชั่วคราว" : "กำลังสร้าง"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Queue place, the honest ETA and a moving bar, under the frame(s). */
function GeneratingStatus({ progress, tab, startedAt }: { progress: QueueProgress | null; tab: string; startedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    const tipTimer = setInterval(() => setTip((i) => i + 1), 4000);
    return () => { clearInterval(clockTimer); clearInterval(tipTimer); };
  }, []);

  const tips = CREATING_TIPS[tab] ?? CREATING_TIPS.image;
  const elapsed = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
  // What was left at the last reading, less the time since — so the bar and
  // the countdown move every second, not only when a poll lands.
  const remaining = progress?.etaSeconds != null ? Math.max(0, progress.etaSeconds - (now - progress.at) / 1000) : null;
  // Once it is this customer's turn the bar starts over as the render's own
  // progress — that turn is the moment worth seeing — and until then it
  // spans the whole wait.
  const render = progress?.stage === "rendering" ? shownFraction(progress, now) : null;
  const fraction = render ?? (remaining != null ? Math.min(0.97, elapsed / Math.max(1, elapsed + remaining)) : null);
  const queued = progress?.stage === "queued";

  const headline = progress
    ? `${progress.label}${queued && (progress.position ?? 0) > 1 ? ` • คิวที่ ${progress.position}` : ""}${render != null ? ` ${Math.floor(render * 100)}%` : ""}`
    : "กำลังสร้างผลงานของคุณ";
  const eta = progress?.etaLabel
    ? `${progress.basis === "baseline" ? "คาดว่าใช้เวลา" : "เหลืออีก"} ${progress.etaLabel}`
    : !progress
      ? tab === "video" ? "วิดีโอมักใช้เวลา 30-120 วินาที" : "รอสักครู่"
      : null;

  return (
    <div style={{ maxWidth: 460, margin: "20px auto 0", textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{headline}</div>
      {eta && <div style={{ fontSize: 12, color: "rgba(203,213,225,0.7)", marginTop: 4 }}>{eta}</div>}
      <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginTop: 12 }}>
        <div className="xdr-motion" style={{
          height: "100%", borderRadius: 999,
          width: fraction != null ? `${Math.max(4, fraction * 100)}%` : "38%",
          background: "linear-gradient(90deg, hsl(180,85%,55%), hsl(265,85%,65%), hsl(320,85%,65%), hsl(180,85%,55%))",
          backgroundSize: "200% 100%",
          animation: "xdr-bar 2.4s linear infinite",
          transition: "width 900ms ease",
          // No estimate (a direct provider): an indeterminate bar that drifts.
          marginLeft: fraction != null ? 0 : `${(tip % 3) * 30}%`,
        }} />
      </div>
      <div key={tip} className="xdr-motion" style={{ fontSize: 12, color: "rgba(165,243,252,0.75)", marginTop: 10, animation: "xdr-fade-in 500ms ease-out" }}>
        {queued ? "ระบบจะเริ่มสร้างให้อัตโนมัติเมื่อถึงคิวของคุณ" : tips[tip % tips.length]}
      </div>
      {progress && (
        <div style={{ fontSize: 11, color: "rgba(203,213,225,0.45)", marginTop: 6 }}>
          ปิดหน้านี้ได้ ผลงานจะเข้าแกลเลอรีเมื่อเสร็จ
        </div>
      )}
    </div>
  );
}

function StudioFrame({ index, seed, aspect, generating, progress = null }: { index: number; seed: number; aspect: string; generating: boolean; progress?: QueueProgress | null }) {
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
      {generating && <GeneratingOverlay progress={progress} />}
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
  // Queue place and ETA for queued (in-house) models, which can legitimately
  // wait minutes before their turn comes; null for direct providers.
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  /** When the current generation started, for the progress bar. */
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null);
  const [steps, setSteps] = useState(42);
  const [guidance, setGuidance] = useState(7.5);
  const [seed, setSeed] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  /**
   * Video only. Every provider already switches endpoint on whether an image
   * was supplied — `kling.ts` picks image2video over text2video, `runway.ts`
   * picks /image_to_video over /text_to_video — so the two modes have always
   * existed on the server. The studio just never gave anyone a way to say
   * which one they wanted.
   */
  const [videoMode, setVideoMode] = useState<"t2v" | "i2v">("t2v");
  /**
   * Lip-sync inputs. Unlike every other upload in this page these are stored
   * as URLs, not base64: a voice track and a clip are megabytes, and both
   * routes that consume them (fal fetches `audio_url`, a rented worker curls
   * the file down) want a URL anyway. `/api/uploads` returns one.
   */
  const [inputAudio, setInputAudio] = useState<string | null>(null);
  const [inputAudioName, setInputAudioName] = useState<string | null>(null);
  const [sourceVideo, setSourceVideo] = useState<string | null>(null);
  const [sourceVideoName, setSourceVideoName] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"audio" | "video" | "image" | null>(null);
  /**
   * The frame a video must end on, for models that take one (first-and-last-
   * frame mode). Uploaded to R2 like the lip-sync inputs, so this is a URL:
   * the server reads it for the rented worker and only accepts our own links.
   */
  const [inputImageEnd, setInputImageEnd] = useState<string | null>(null);
  /** Resolution preset id, for models that offer presets; null = model default. */
  const [resolution, setResolution] = useState<string | null>(null);
  /** Clip length in seconds. Was never sent, so every clip came out at the
   *  provider default regardless of what the model could do. */
  const [duration, setDuration] = useState(5);
  /** Song lyrics for the music tab; empty asks for an instrumental. */
  const [lyrics, setLyrics] = useState("");
  const [songTitle, setSongTitle] = useState("");
  /**
   * Instrumental switch. Separate from "lyrics are empty" on purpose: a
   * customer who wrote a verse and then wants to hear the backing track should
   * get one without losing what they typed.
   */
  const [instrumental, setInstrumental] = useState(false);

  useEffect(() => { if (session === null) router.push("/login"); }, [session, router]);
  useEffect(() => { fetchModels(); fetchStyles(); fetchTemplates(); fetchCredits(); }, [fetchModels, fetchStyles, fetchTemplates, fetchCredits]);

  const fetchHistory = useCallback(async () => {
    const items = await fetchHistoryItems();
    if (items) setHistory(items);
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

  const inTab = (m: (typeof models)[number], key: TabType) =>
    key === "lipsync"
      ? isLipsyncModel(m.subcategory)
      : // Lip-sync models are stored under 'video' but belong to their own tab;
        // leaving them in this list would offer a model whose required inputs
        // the video controls cannot supply.
        m.category === key && !isLipsyncModel(m.subcategory);
  const filteredModels = models.filter((m) => inTab(m, tab));
  /**
   * Why a whole tab is unusable right now (no model in it can be ordered —
   * provider not connected, keys failing, switched off), or null. The tab is
   * dimmed with the reason rather than letting someone write a prompt for it.
   */
  const tabBlockedReason = (key: TabType): string | null => {
    if (!modelsLoaded) return null;
    const inThisTab = models.filter((m) => inTab(m, key));
    if (inThisTab.length === 0) return "ยังไม่มีโมเดลในหมวดนี้";
    if (inThisTab.some((m) => m.canOrder !== false)) return null;
    return inThisTab[0].unavailableReason ?? inThisTab[0].tuningMessage ?? "ยังใช้งานไม่ได้ในขณะนี้";
  };


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

  // Tell the server someone is here with this model selected, so a machine
  // that just finished a render waits a little instead of closing under a
  // customer about to order again. Sent for any model and only while the tab
  // is visible; the server ignores models it has nothing to keep warm for.
  useEffect(() => {
    if (!session || !selectedModelId) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/studio/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: selectedModelId }),
      }).catch(() => undefined);
    };
    ping();
    const t = setInterval(ping, 30_000);
    // Coming back to the tab counts at once, not up to 30 s later.
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [session, selectedModelId]);

  /**
   * Outputs this order will actually yield. A rented-GPU model renders one per
   * job, and the count only ever reaches the server from the image tab.
   */
  const outputs = tab === "image" ? Math.min(numOutputs, selectedModel?.maxOutputs ?? numOutputs) : 1;
  /** One output's price — the same formula GenerationService charges with. */
  const creditsFor = (seconds: number | null) =>
    selectedModel ? creditsForDuration(selectedModel.creditsPerUnit, selectedModel.durationCurve, seconds) : 0;

  /** Which second file the chosen lip-sync model animates — a clip, or a still. */
  const lipsyncNeeds: "image" | "video" =
    selectedModel?.subcategory === LIPSYNC_PORTRAIT ? "image" : "video";
  /** The still the portrait models animate reuses the existing image picker. */
  const lipsyncSource = lipsyncNeeds === "image" ? inputImage : sourceVideo;

  /** Lengths this model can actually produce. Always offers at least 5s. */
  const durationChoices = (() => {
    const base = tab === "audio" ? AUDIO_DURATIONS : VIDEO_DURATIONS;
    const max = selectedModel?.maxDuration ?? (tab === "audio" ? 240 : 10);
    const fits = base.filter((d) => d <= max);
    return fits.length > 0 ? fits : [base[0]];
  })();

  useEffect(() => {
    if (tab !== "video" && tab !== "audio") return;
    // The image tab's 4:3 and 3:2 mean nothing to a video provider, and the
    // preview used to render 16:9 while the request still carried whatever the
    // image tab had left behind — the frame you saw was not the frame you
    // ordered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "video" && !VIDEO_ASPECTS.includes(aspectRatio)) setAspectRatio("16:9");
    // Song and clip lengths live on different scales: a 5 s song, or a 30 s
    // clip carried over from the music tab, is never what was meant.
    if (!durationChoices.includes(duration)) setDuration(durationChoices[0]);
  }, [tab, aspectRatio, duration, durationChoices]);

  /** Resolution presets this model offers for the chosen aspect ratio. */
  const resolutionChoices =
    tab === "video" ? (selectedModel?.video?.resolutions ?? []).filter((r) => r.aspects.includes(aspectRatio)) : [];
  /** The preset in force: the customer's pick if still offered, else the default. */
  const activeResolution = tab === "video" ? pickResolution(selectedModel?.video?.resolutions, aspectRatio, resolution) : null;
  /** Whether this model can end on a chosen frame (first-and-last-frame mode). */
  const offersLastFrame = tab === "video" && videoMode === "i2v" && selectedModel?.video?.lastFrame === true;

  /** An image→video run has nothing to animate without its first frame. */
  const missingStartFrame = tab === "video" && videoMode === "i2v" && !inputImage;

  /** Lip-sync needs both halves: the voice, and the thing that speaks it. */
  const missingLipsyncInput = tab === "lipsync" && (!inputAudio || !lipsyncSource);

  /** Music controls this model offers; null for API music models and every other tab. */
  const musicOpts = tab === "audio" ? selectedModel?.music ?? null : null;
  /** A cover has nothing to cover until the customer uploads the song. */
  const missingSourceSong = musicOpts?.sourceSong === true && !inputAudio;

  /**
   * One source of truth for whether the button can fire. It used to be spelled
   * out three times — in `disabled`, in `cursor` and in `opacity` — and the
   * three had already drifted: `disabled` checked `canOrder`, the other two did
   * not, so a model pulled back for tuning still rendered as clickable.
   */
  const cannotSubmit =
    isGenerating ||
    !selectedModelId ||
    selectedModel?.canOrder === false ||
    (tab !== "lipsync" && !prompt.trim()) ||
    missingStartFrame ||
    missingLipsyncInput ||
    missingSourceSong ||
    // An order placed mid-upload would go out without the end frame.
    uploading === "image" ||
    // …or, on a cover, without the song itself.
    (musicOpts?.sourceSong === true && uploading === "audio");

  /**
   * Whether /api/upscale would find a model it can run — the same match it
   * auto-selects with, restricted to models that can be ordered right now.
   */
  const upscaleAvailable = models.some((m) =>
    m.canOrder !== false &&
    (m.subcategory === "upscale" || /upscale|esrgan/i.test(m.name) || /upscale|esrgan/i.test(m.modelId))
  );

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

  /**
   * Send a lip-sync input to R2 and keep the URL it comes back with.
   *
   * Deliberately not the base64 path `handleImageUpload` uses: a voice track is
   * megabytes and a clip tens of them, and inlining that into the generation
   * request would carry it through JSON twice before a provider ever sees it.
   *
   * The network work lives in `uploadMedia` outside the component, and there is
   * no `try/finally` here, on purpose. React Compiler cannot compile a function
   * containing `finally` and responds by silently giving up on the **whole**
   * component — this page loses its auto-memoization and every compiler-based
   * lint rule stops running on it, with no diagnostic to say so. The only
   * visible symptom is that the `set-state-in-effect` suppressions above start
   * reporting as unused. Reintroducing a `finally` anywhere in this component
   * will bring that back.
   */
  const handleMediaUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "audio" | "video",
    // Lip-sync is billed on the length of the voice track, so its ceiling is
    // tight. A song to cover is priced on the length *ordered*, not the length
    // uploaded, and a chorus alone is not a song — the cover panel passes the
    // model's own maximum instead.
    maxSeconds: number = MAX_INPUT_SECONDS,
  ) => {
    const file = e.target.files?.[0];
    // Clearing the picker lets the same file be chosen again after a failure —
    // without it the change event never fires a second time.
    e.target.value = "";
    if (!file) return;

    setUploading(kind);

    const seconds = await probeDuration(file, kind);
    if (seconds !== null && seconds > maxSeconds) {
      setUploading(null);
      toast(
        "error",
        "ไฟล์ยาวเกินไป",
        `รองรับไม่เกิน ${maxSeconds} วินาที (ไฟล์นี้ ${Math.round(seconds)} วินาที) กรุณาตัดให้สั้นลงก่อน`,
      );
      return;
    }

    const result = await uploadMedia(file, kind);
    setUploading(null);

    if (result.error) {
      toast("error", "อัปโหลดไม่สำเร็จ", result.error);
      return;
    }
    if (kind === "audio") { setInputAudio(result.url!); setInputAudioName(file.name); }
    else { setSourceVideo(result.url!); setSourceVideoName(file.name); }
  };

  /** Last frame → R2. No try/finally, for the same reason as handleMediaUpload. */
  const handleEndFrameUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading("image");
    const result = await uploadMedia(file, "image");
    setUploading(null);
    if (result.error) {
      toast("error", "อัปโหลดไม่สำเร็จ", result.error);
      return;
    }
    setInputImageEnd(result.url!);
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
    let rendering = false;
    // A transient network blip shouldn't abandon a job the user already paid
    // for; only give up after several consecutive failures.
    let consecutiveErrors = 0;

    while (Date.now() - startedAt < deadlineMs) {
      // Poll gently while a GPU job waits in the queue; closer while it renders,
      // where each reading moves the percentage the customer is watching.
      await new Promise((r) => setTimeout(r, rendering ? 3000 : sawGpu ? 5000 : 2000));
      const read = await readGeneration(generationId);
      if (!read.ok) {
        // An unreachable server or a garbled answer counts as a blip, like
        // any other non-OK status; only 404/401 mean the job is not ours.
        if (read.status === 404 || read.status === 401) break;
        if (++consecutiveErrors >= 5) break;
        continue;
      }
      consecutiveErrors = 0;
      const data = read.data;

      if (data.gpu) {
        const gpu = data.gpu;
        sawGpu = true;
        rendering = gpu.stage === "rendering";
        deadlineMs = GPU_DEADLINE_MS;
        const at = Date.now();
        setProgress((prev) => nextQueueProgress(prev, gpu, at));
      } else if (sawGpu) {
        setProgress(null);
      }

      if (data.status === "completed") {
        setResult({
          id: data.id, status: "completed",
          resultUrl: data.resultUrl,
          resultUrls: data.resultUrls
            ? (Array.isArray(data.resultUrls) ? data.resultUrls : [data.resultUrl as string])
            : [data.resultUrl as string],
          thumbnailUrl: data.thumbnailUrl,
          creditsUsed: data.creditsUsed, processingMs: data.processingMs,
          expiresAt: data.expiresAt, daysLeft: data.daysLeft,
        });
        setIsGenerating(false); setProgress(null); fetchCredits(); fetchHistory();
        toast("success", "สร้างสำเร็จ!", `ใช้ ${data.creditsUsed} เครดิต`);
        return;
      }
      if (data.status === "failed") {
        setResult({ id: data.id, status: "failed", creditsUsed: 0, error: data.errorMessage ?? undefined });
        setIsGenerating(false); setProgress(null); fetchCredits();
        toast("error", "สร้างไม่สำเร็จ", data.errorMessage || "เกิดข้อผิดพลาด");
        return;
      }
    }

    setIsGenerating(false); setProgress(null);
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
    // Lip-sync is driven by the uploaded voice, not by text, so it is the one
    // mode that may legitimately run with an empty prompt.
    if (!selectedModelId || isGenerating) return;
    if (tab !== "lipsync" && !prompt.trim()) return;
    if (missingStartFrame) {
      toast("error", "ยังไม่ได้เลือกภาพเริ่มต้น", "โหมดภาพ → วิดีโอ ต้องอัปโหลดภาพก่อน");
      return;
    }
    if (missingLipsyncInput) {
      toast(
        "error",
        "ยังใส่ไฟล์ไม่ครบ",
        !inputAudio
          ? "ต้องอัปโหลดไฟล์เสียงที่จะให้พูด"
          : lipsyncNeeds === "image"
            ? "ต้องอัปโหลดรูปหน้าคนที่จะให้พูด"
            : "ต้องอัปโหลดคลิปต้นฉบับที่จะพากย์ทับ",
      );
      return;
    }
    if (missingSourceSong) {
      toast("error", "ยังไม่ได้อัปโหลดเพลงต้นฉบับ", "โหมดคัฟเวอร์ต้องมีเพลงให้ AI ถอดทำนองก่อน");
      return;
    }
    setIsGenerating(true); setResult(null); setIsFavorited(false);
    setProgress(null); setGenStartedAt(Date.now());
    const ar = aspectRatios.find((a) => a.value === aspectRatio);
    // On video the mode decides: text→video must not smuggle a start frame in,
    // or the provider silently switches endpoint behind the customer's back.
    const imageToSend =
      tab === "image" ? refImage : tab === "audio" || (tab === "video" && videoMode === "t2v") ? null : inputImage;
    // The music tab hides the picture controls, but their state lives on — an
    // image tab's negative prompt reaching the music model would be sung as
    // the lyrics, and its image style appended to the song's description.
    const music = tab === "audio";
    // The song keeps the name it was made under, not whatever is typed next.
    if (music) setSongTitle(prompt.trim());
    const sent = await postGeneration({
      modelId: selectedModelId,
      // Lip-sync has no generation type of its own on the server: what it
      // produces is a clip, and the tab exists only to give it the right
      // controls here.
      type: tab === "lipsync" ? "video" : tab,
      prompt: prompt.trim(),
      negativePrompt: music ? undefined : negativePrompt.trim() || undefined,
      styleId: music ? undefined : selectedStyle || undefined,
      inputImage: tab === "lipsync" && lipsyncNeeds === "video" ? undefined : imageToSend || undefined,
      // A cover reads the same field as lip-sync: both are "a track the server
      // fetches from our bucket and hands to the model".
      inputAudio: tab === "lipsync" || musicOpts?.sourceSong ? inputAudio ?? undefined : undefined,
      inputVideo: tab === "lipsync" ? sourceVideo ?? undefined : undefined,
      // Only alongside a first frame: an end frame on its own is not a mode
      // this studio offers. A model without first-and-last-frame mode never
      // shows the picker, and ignores the field if it is sent.
      inputImageEnd: tab === "video" && videoMode === "i2v" && imageToSend ? inputImageEnd ?? undefined : undefined,
      params: {
        width: ar?.w || 1024, height: ar?.h || 1024, aspectRatio,
        // The customer's pick as-is. The server falls back to the model's
        // default when it is absent or not offered for the frame shape
        // (h3RenderPlan), which is the same preset the popover shows as chosen.
        resolution: resolution ?? undefined,
        strength: refImage && tab === "image" ? strength : undefined,
        numOutputs: tab === "image" ? outputs : undefined,
        // Every video adapter reads `duration`; none of them read steps or
        // cfgScale. Sending diffusion knobs to a video endpoint is noise at
        // best and a rejected request at worst.
        //
        // Lip-sync sends none of the three. Its length is set by the voice
        // track, and the adapter derives the frame count from the model
        // row's own ceiling rather than from anything chosen here.
        duration: tab === "video" || music ? duration : undefined,
        // The music model is a distilled turbo with its own fixed step count.
        steps: tab === "video" || tab === "lipsync" || music ? undefined : steps,
        cfgScale: tab === "video" || tab === "lipsync" || music ? undefined : guidance,
        seed: seed ?? undefined,
        // Instrumental wins over whatever is in the box, and is expressed by
        // sending no lyrics at all — which is exactly what the models read as
        // "no vocal".
        lyrics: music && !instrumental ? lyrics.trim() || undefined : undefined,
      },
    });
    if (sent.kind === "network") {
      setIsGenerating(false);
      toast("error", "เกิดข้อผิดพลาด", "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
      return;
    }
    if (sent.kind === "rejected") {
      setIsGenerating(false);
      toast("error", "เกิดข้อผิดพลาด", sent.error);
      return;
    }
    const data = sent.data;
    if (data.status === "completed") {
      setResult(data); setIsGenerating(false); fetchCredits(); fetchHistory();
      toast("success", "สร้างสำเร็จ!", `ใช้ ${data.creditsUsed} เครดิต`);
    } else if (data.status === "failed") {
      setResult(data); setIsGenerating(false); fetchCredits();
      toast("error", "สร้างไม่สำเร็จ", data.error || "เกิดข้อผิดพลาด");
    } else { pollResult(data.id); }
  };

  const handleDownload = async (url?: string) => {
    const downloadUrl = url || result?.resultUrl;
    if (!downloadUrl || !result?.id) return;
    const filename = `xdreamer-${result.id}.${extensionOf(downloadUrl, "webp")}`;
    const ok = await downloadGeneration(result.id, downloadUrl, filename, url ? result.resultUrls?.indexOf(url) ?? -1 : -1);
    if (ok) toast("success", "ดาวน์โหลดสำเร็จ");
    else toast("error", "ดาวน์โหลดไม่สำเร็จ");
  };

  const handleFavorite = async () => {
    if (!result?.id) return;
    const next = !isFavorited;
    if (await saveFavorite(result.id, next)) setIsFavorited(next);
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
    const outcome = await runUpscale(result.id);
    if (outcome.kind === "done") {
      const upscaledUrl = outcome.resultUrl;
      setResult(prev => prev ? { ...prev, resultUrl: upscaledUrl } : prev);
      fetchCredits(); toast("success", "Upscale สำเร็จ!", `ใช้ ${outcome.creditsUsed} เครดิต`);
    } else if (outcome.kind === "rejected" || outcome.kind === "failed") {
      toast("error", "Upscale ไม่สำเร็จ", outcome.error);
    } else if (outcome.kind === "network") {
      toast("error", "Upscale ไม่สำเร็จ");
    }
    setIsUpscaling(false);
  };

  const totalCredits = creditsFor(tab === "video" || tab === "audio" ? duration : null) * outputs;
  /** A song has no picture shape; its in-progress frame is square. */
  const frameAspect = tab === "audio" ? "1:1" : aspectRatio;
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
            { key: "lipsync" as TabType, label: "ลิปซิงค์", icon: "♪" },
            { key: "audio" as TabType, label: "สร้างเพลง", icon: "♫" },
          ]).map(t => {
            const blocked = tabBlockedReason(t.key);
            return (
            <button key={t.key}
              disabled={blocked !== null && tab !== t.key}
              title={blocked ?? undefined}
              onClick={() => {
                setTab(t.key); setResult(null); setNumOutputs(1);
                // The audio upload is shared between lip-sync and the cover
                // panel, and their limits differ by a factor of six: a four
                // minute song accepted for a cover must not still be sitting
                // there when the customer opens lip-sync, where the bill
                // follows the track's length.
                if (t.key !== tab) { setInputAudio(null); setInputAudioName(null); }
              }}
              style={{
                flex: 1, padding: "8px 6px", borderRadius: 8, border: "none",
                cursor: blocked !== null && tab !== t.key ? "not-allowed" : "pointer",
                background: tab === t.key ? `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${270 + HUE},70%,55%))` : "transparent",
                color: tab === t.key ? "#fff" : "rgba(226,232,240,0.6)",
                // Dimmed, not hidden: the customer can see it exists, and the
                // tooltip says why it is not available right now.
                opacity: blocked !== null && tab !== t.key ? 0.38 : 1,
                fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
              <span style={{ fontSize: 12 }}>{t.icon}</span>{t.label}
            </button>
            );
          })}
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
                  // A model that cannot be ordered right now — still being
                  // proven out, or its provider not connected / failing —
                  // stays visible, dimmed, with the reason. Picking it is
                  // blocked: the alternative is letting a customer spend
                  // credits on a render that cannot be delivered.
                  const blocked = m.canOrder === false;
                  const reason = m.unavailableReason ?? m.tuningMessage ?? "ยังใช้งานไม่ได้ ลองใหม่ภายหลัง";
                  return (
                  <button key={m.id} disabled={blocked}
                    title={blocked ? reason : undefined}
                    onClick={() => { if (blocked) return; setSelectedModelId(m.id); setShowModelDropdown(false); }}
                    style={{ width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", cursor: blocked ? "not-allowed" : "pointer", textAlign: "left", background: selectedModelId === m.id ? `hsla(${220 + HUE},60%,50%,0.15)` : "transparent", color: "#e2e8f0", borderBottom: "1px solid rgba(255,255,255,0.04)", opacity: blocked ? 0.45 : 1 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                        {m.name}
                        {m.isFeatured && <span style={{ fontSize: 10, color: "#fbbf24" }}>✦</span>}
                        {blocked && (
                          <span style={{
                            fontSize: 9, padding: "1px 6px", borderRadius: 999, fontWeight: 600,
                            background: m.status === "tuning" ? "hsla(38,90%,55%,0.18)" : "rgba(148,163,184,0.18)",
                            color: m.status === "tuning" ? "#fbbf24" : "#cbd5e1",
                          }}>
                            {m.status === "tuning" ? "กำลังปรับแต่ง" : "ยังใช้ไม่ได้"}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        {blocked ? reason : `${m.provider.name}${m.subcategory ? ` · ${m.subcategory}` : ""}`}
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
        <Section label={tab === "lipsync" ? "Prompt (ไม่บังคับ)" : tab === "audio" ? "สไตล์เพลง" : "Prompt"} grow>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              tab === "lipsync"
                ? lipsyncNeeds === "image"
                  ? "อธิบายท่าทาง/บรรยากาศเพิ่มได้ เช่น พิธีกรยิ้มแย้ม พูดกับกล้อง..."
                  : "ไม่ต้องใส่ก็ได้ — เสียงที่อัปโหลดเป็นตัวกำหนดผลลัพธ์"
                : tab === "video"
                  ? "อธิบายวิดีโอที่ต้องการ..."
                  : tab === "audio"
                    ? "แนวเพลง อารมณ์ เครื่องดนตรี เสียงร้อง เช่น ป๊อปไทยสดใส เสียงร้องหญิง กีตาร์โปร่ง จังหวะเร็ว"
                    : "อธิบายภาพที่ต้องการ..."
            }
            style={{ ...xdrInputStyle, padding: 14, fontSize: 14, lineHeight: 1.5, resize: "none", flex: 1, minHeight: tab === "audio" ? 72 : 96 }} />
          {/* Lyrics are their own field: the music model sings exactly this.
              Left empty — or with the instrumental switch on — the song has no
              vocal, which beats a voice humming invented syllables. */}
          {tab === "audio" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "#94a3b8", marginRight: 2 }}>เนื้อเพลง</span>
                {SECTION_TAGS.map((tag) => (
                  <button key={tag} type="button" disabled={instrumental}
                    onClick={() => setLyrics((l) => `${l.replace(/\s*$/, "")}${l.trim() ? "\n\n" : ""}${tag}\n`.slice(0, 3000))}
                    style={{
                      padding: "3px 8px", borderRadius: 7, fontSize: 10.5,
                      cursor: instrumental ? "default" : "pointer", opacity: instrumental ? 0.4 : 1,
                      background: "hsla(265,60%,60%,0.12)", color: "#c4b5fd",
                      border: "1px solid hsla(265,60%,60%,0.28)",
                      fontFamily: "ui-monospace,monospace",
                    }}>
                    {tag}
                  </button>
                ))}
                <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#94a3b8", cursor: "pointer" }}>
                  <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />
                  เพลงบรรเลง (ไม่มีเสียงร้อง)
                </label>
              </div>
              <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value.slice(0, 3000))}
                disabled={instrumental}
                placeholder={"[Verse]\nเขียนเนื้อร้องที่นี่\n\n[Chorus]\nท่อนฮุกที่อยากให้ติดหู"}
                style={{
                  ...xdrInputStyle, marginTop: 6, padding: 12, fontSize: 13, lineHeight: 1.5,
                  resize: "none", height: 110, opacity: instrumental ? 0.45 : 1,
                }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10.5, color: "#64748b" }}>
                <span>{instrumental ? "โหมดบรรเลง — เนื้อร้องที่พิมพ์ไว้จะถูกเก็บไว้เฉย ๆ" : "วงเล็บเหลี่ยมบอกโมเดลว่าเป็นท่อนอะไร"}</span>
                <span style={{ fontFamily: "ui-monospace,monospace" }}>{lyrics.length.toLocaleString()} / 3,000</span>
              </div>
            </>
          )}
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <Popover id="tags" open={openPanel} onToggle={setOpenPanel} label="+ แท็ก" width={286}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(tab === "audio" ? MUSIC_TAG_CHIPS : PROMPT_TAG_CHIPS).map((t) => {
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

          {/* The templates, the negative prompt, the image styles, the aspect
              and the reference image are all about pictures — none of them
              reaches a music model, so the music tab does not offer them. */}
          {templates.length > 0 && tab !== "edit" && tab !== "audio" && (
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
        {tab !== "edit" && tab !== "audio" && (
          <input value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="Negative prompt — blurry, low quality, text..."
            style={{ ...xdrInputStyle, fontSize: 12, padding: "9px 12px" }} />
        )}

        {/* Style + aspect on one row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {stylesLoaded && styles.length > 0 && tab !== "edit" && tab !== "audio" && (
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

          {/* Lip-sync has no aspect to choose: the result keeps the shape of the
              clip or the portrait it was given. */}
          {tab !== "edit" && tab !== "lipsync" && tab !== "audio" && (
            <Popover id="aspect" open={openPanel} onToggle={setOpenPanel} label="สัดส่วน" value={aspectRatio} width={220} align="right">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                {aspectRatios
                  .filter(ar => tab !== "video" || VIDEO_ASPECTS.includes(ar.value))
                  .map(ar => (
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

          {/* Clip length. `ai_models.max_duration` is the ceiling — offering a
              20s option on a model that tops out at 5 just buys a failed job. */}
          {(tab === "video" || tab === "audio") && (
            <Popover id="duration" open={openPanel} onToggle={setOpenPanel} label="ความยาว"
              value={`${duration}s`} width={200} align="right">
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(durationChoices.length, 4)},1fr)`, gap: 6 }}>
                {durationChoices.map(d => (
                  <button key={d} onClick={() => { setDuration(d); setOpenPanel(null); }}
                    style={{
                      padding: "8px 0", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 600,
                      background: duration === d ? `hsla(${220 + HUE},60%,50%,0.25)` : "rgba(255,255,255,0.04)",
                      color: duration === d ? "#fff" : "#94a3b8",
                      border: duration === d ? `1px solid hsla(${220 + HUE},70%,60%,0.5)` : "1px solid rgba(255,255,255,0.08)",
                    }}>
                    {d}s
                    {/* Priced by length: say so before the order, not on the receipt. */}
                    {selectedModel?.durationCurve && (
                      <span style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#fbbf24", marginTop: 2 }}>✦ {creditsFor(d)}</span>
                    )}
                  </button>
                ))}
              </div>
            </Popover>
          )}

          {/* Resolution presets — only where the model offers a real choice for
              this aspect ratio (H3: 768p / 720p / 544p on 16:9). */}
          {resolutionChoices.length > 1 && (
            <Popover id="resolution" open={openPanel} onToggle={setOpenPanel} label="ความละเอียด"
              value={activeResolution?.id ?? "—"} width={220} align="right">
              <div style={{ display: "grid", gap: 6 }}>
                {resolutionChoices.map(r => (
                  <button key={r.id} onClick={() => { setResolution(r.id); setOpenPanel(null); }}
                    style={{
                      padding: "8px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer", textAlign: "left", fontWeight: 600,
                      background: activeResolution?.id === r.id ? `hsla(${220 + HUE},60%,50%,0.25)` : "rgba(255,255,255,0.04)",
                      color: activeResolution?.id === r.id ? "#fff" : "#94a3b8",
                      border: activeResolution?.id === r.id ? `1px solid hsla(${220 + HUE},70%,60%,0.5)` : "1px solid rgba(255,255,255,0.08)",
                    }}>{r.label}</button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        {/* Count + advanced + reference on one row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {/* Hidden when the model yields one output per order — offering 4
              would take payment for images it never renders. */}
          {tab === "image" && selectedModel?.maxOutputs !== 1 && (
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
              rather than moving behind a panel.

              Hidden on video. handleGenerate only ever forwards refImage on the
              image tab, so a video customer could drop an image in here, see it
              accepted, press generate, and get a text-only clip — the upload was
              discarded without a word. The video start frame is its own control
              below, wired to the mode selector. */}
          {tab !== "video" && tab !== "audio" && (
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
          )}
        </div>

        {/* Text→video or image→video.
            The providers have always supported both; this is the control that
            says which one, instead of leaving it to be inferred from whether an
            upload happens to be present. */}
        {tab === "video" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {([
              { key: "t2v" as const, label: "ข้อความ → วิดีโอ", hint: "เริ่มจากคำอธิบายล้วน" },
              { key: "i2v" as const, label: "ภาพ → วิดีโอ", hint: "ทำให้ภาพที่มีอยู่เคลื่อนไหว" },
            ]).map((m) => (
              <button key={m.key} onClick={() => setVideoMode(m.key)}
                style={{
                  flex: "1 1 140px", minWidth: "min(132px, 100%)", padding: "9px 10px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                  background: videoMode === m.key
                    ? `linear-gradient(135deg, hsla(${160 + HUE},70%,50%,0.22), hsla(${270 + HUE},70%,55%,0.28))`
                    : "rgba(255,255,255,0.04)",
                  color: videoMode === m.key ? "#fff" : "#94a3b8",
                  border: videoMode === m.key
                    ? `1px solid hsla(${220 + HUE},70%,60%,0.5)`
                    : "1px solid rgba(255,255,255,0.08)",
                }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 2 }}>{m.hint}</div>
              </button>
            ))}
          </div>
        )}

        {/* Image upload — the edit source, or the video start frame when the
            mode calls for one. */}
        {(tab === "edit" ||
          (tab === "video" && videoMode === "i2v") ||
          (tab === "lipsync" && lipsyncNeeds === "image")) && (
          <Section
            label={
              tab === "edit" ? "ภาพต้นฉบับ" : tab === "lipsync" ? "รูปหน้าคนที่จะให้พูด" : "ภาพเริ่มต้น"
            }
          >
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

        {/* The frame the clip should end on — first-and-last-frame models only.
            Optional: without it the model decides where the motion goes. */}
        {offersLastFrame && (
          <Section label="ภาพสุดท้าย (ไม่บังคับ)">
            {inputImageEnd ? (
              <div style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={inputImageEnd} alt="End frame" style={{ width: "100%", borderRadius: 10, maxHeight: 180, objectFit: "cover" }} />
                <button onClick={() => setInputImageEnd(null)}
                  style={{ position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", cursor: "pointer", fontSize: 14 }}>×</button>
              </div>
            ) : (
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, borderRadius: 12, border: "1.5px dashed rgba(255,255,255,0.15)", background: "rgba(2,6,23,0.3)", color: "#64748b", fontSize: 12, cursor: uploading === "image" ? "wait" : "pointer" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{uploading === "image" ? "…" : "↑"}</div>
                {uploading === "image" ? "กำลังอัปโหลด…" : "อัปโหลดภาพที่ต้องการให้คลิปจบ"}
                <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
                  disabled={uploading === "image"} onChange={handleEndFrameUpload} />
              </label>
            )}
          </Section>
        )}

        {/* Lip-sync inputs. Both are uploaded to R2 first and only their URLs
            travel with the request, so what is held here is a link and a
            filename rather than the bytes. */}
        {tab === "lipsync" && lipsyncNeeds === "video" && (
          <Section label="คลิปต้นฉบับที่จะพากย์ทับ">
            <FilePick
              value={sourceVideoName}
              busy={uploading === "video"}
              accept="video/mp4,video/webm,video/quicktime"
              hint="อัปโหลดคลิป (MP4 / WebM)"
              onPick={(e) => handleMediaUpload(e, "video")}
              onClear={() => { setSourceVideo(null); setSourceVideoName(null); }}
            />
            <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
              คลิปควรเห็นหน้าชัดและยาวไม่เกิน 40 วินาที · เสียงเดิมในคลิปจะถูกแทนที่ทั้งหมด
            </div>
          </Section>
        )}

        {tab === "lipsync" && (
          <Section label="ไฟล์เสียงที่จะให้พูด">
            <FilePick
              value={inputAudioName}
              busy={uploading === "audio"}
              accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,audio/x-m4a"
              hint="อัปโหลดเสียง (MP3 / WAV / M4A)"
              onPick={(e) => handleMediaUpload(e, "audio")}
              onClear={() => { setInputAudio(null); setInputAudioName(null); }}
            />
            <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
              พูดภาษาอะไรก็ได้รวมถึงไทย — โมเดลอ่านคลื่นเสียงเป็นรูปปาก ไม่ได้อ่านภาษา
            </div>
          </Section>
        )}

        {/* Cover mode: the model transcribes this song's melody and sings it
            again in the style above. The upload path is the lip-sync one, so
            the same size and length limits apply. */}
        {musicOpts?.sourceSong && (
          <Section label="เพลงต้นฉบับที่จะคัฟเวอร์">
            <FilePick
              value={inputAudioName}
              busy={uploading === "audio"}
              accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,audio/x-m4a"
              hint={`อัปโหลดเพลง MP3 (ไม่เกิน ${Math.round((musicOpts.maxDuration ?? 240) / 60)} นาที, 12 MB)`}
              onPick={(e) => handleMediaUpload(e, "audio", musicOpts.maxDuration ?? 240)}
              onClear={() => { setInputAudio(null); setInputAudioName(null); }}
            />
            <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
              AI ถอดเฉพาะ<strong style={{ color: "#94a3b8" }}>ทำนอง</strong>ออกมาแล้วร้องใหม่ทั้งเพลง — เสียงร้องเดิมไม่ได้ถูกนำมาใช้
              ถ้าอยากได้คำร้องเดิม ให้พิมพ์ลงช่องเนื้อเพลง · WAV/FLAC ทั้งเพลงมักเกิน 12 MB ให้แปลงเป็น MP3 ก่อน
            </div>
          </Section>
        )}

        {/* Advanced + tips on one row. The tips used to be four stacked cards
            in the right rail; they are reference material, not controls. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {/* Video keeps this panel too — steps and guidance mean nothing to a
              video endpoint, but seed does, and locking the whole panel away
              took reproducible clips with it. */}
          <Popover id="advanced" open={openPanel} onToggle={setOpenPanel} label="⚙ ขั้นสูง" width={286}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* The music model is a distilled turbo: its step count is
                    fixed server-side, and more steps only slow it and smear it. */}
                {tab !== "video" && tab !== "audio" && (
                <>
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
                </>
                )}
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

          <Popover id="tips" open={openPanel} onToggle={setOpenPanel} label="? คำแนะนำ" width={300} align="right">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(tab === "audio" ? [
                "บอกแนวเพลง อารมณ์ และเครื่องดนตรี เช่น 'ลูกทุ่งอีสานสนุกๆ แคน พิณ เสียงร้องชาย'",
                "ใส่จังหวะช่วยได้มาก เช่น 90 BPM (ช้าๆ) หรือ 128 BPM (เต้นได้)",
                "เนื้อเพลงแบ่งท่อนด้วย [verse] [chorus] [bridge] — ประโยคสั้นร้องชัดกว่า",
                "เว้นเนื้อเพลงว่างไว้ = เพลงบรรเลง เหมาะกับดนตรีประกอบคลิป",
              ] : [
                "ระบุ subject และอารมณ์ให้ชัด เช่น 'หญิงสาวยืนกลางทุ่งดอกไม้ โทนสีพาสเทล'",
                "เพิ่ม style keywords เช่น cinematic, hyperreal, jade tones, volumetric",
                "ใช้ aspect 16:9 สำหรับ wallpaper, 9:16 สำหรับโซเชียล",
                "img2img: ความเข้ม 0.5–0.7 = balance, > 0.8 = ตามภาพอ้างอิงมาก",
              ]).map((tip, i) => (
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
            {selectedModel.unavailableReason ?? selectedModel.tuningMessage ?? "โมเดลนี้ยังใช้งานไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง"}
          </div>
        )}

        {missingStartFrame && (
          <div style={{
            marginTop: 12, padding: "10px 12px", borderRadius: 10, fontSize: 12,
            background: "hsla(38,90%,55%,0.12)", color: "#fbbf24",
            border: "1px solid hsla(38,90%,55%,0.25)",
          }}>
            โหมด “ภาพ → วิดีโอ” ต้องอัปโหลดภาพเริ่มต้นก่อน
          </div>
        )}

        {missingLipsyncInput && (
          <div style={{
            marginTop: 12, padding: "10px 12px", borderRadius: 10, fontSize: 12,
            background: "hsla(38,90%,55%,0.12)", color: "#fbbf24",
            border: "1px solid hsla(38,90%,55%,0.25)",
          }}>
            {!inputAudio
              ? "ต้องอัปโหลดไฟล์เสียงที่จะให้พูดก่อน"
              : lipsyncNeeds === "image"
                ? "ต้องอัปโหลดรูปหน้าคนที่จะให้พูดก่อน"
                : "ต้องอัปโหลดคลิปต้นฉบับที่จะพากย์ทับก่อน"}
          </div>
        )}

        {/* Generate Button */}
        <button onClick={handleGenerate}
          disabled={cannotSubmit}
          style={{
            marginTop: "auto", padding: 16, borderRadius: 12,
            background: `linear-gradient(135deg, hsl(${160 + HUE},70%,45%), hsl(${280 + HUE},70%,55%))`,
            color: "#fff", border: "none", fontSize: 15, fontWeight: 600,
            cursor: cannotSubmit ? "not-allowed" : "pointer",
            opacity: cannotSubmit ? 0.6 : 1,
            boxShadow: `0 10px 24px -8px hsla(${270 + HUE},70%,50%,0.55)`,
          }}>
          {isGenerating ? (
            progress?.stage === "queued" && (progress.position ?? 0) > 0 ? `⟳ รอคิว • คิวที่ ${progress.position}`
              : progress?.stage === "rendering" && progress.fraction != null ? `⟳ กำลังทอ... ${Math.floor((shownFraction(progress, progress.at) ?? 0) * 100)}%`
              : "⟳ กำลังทอ..."
          ) : (
            <>ทอ ✦ {outputs > 1 ? `${outputs} ภาพ · ` : ""}{totalCredits || "—"} credits</>
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
              {tab === "image" ? `ภาพ ${outputs} ใบ` : tab === "video" ? "วิดีโอ" : tab === "lipsync" ? "ลิปซิงค์" : tab === "audio" ? "เพลง" : "แก้ไขภาพ"}
            </Pill>
            {/* Variations is just another order, so it follows the button's rule. */}
            <Pill disabled={cannotSubmit}
              title={cannotSubmit && selectedModel?.canOrder === false ? (selectedModel.unavailableReason ?? undefined) : undefined}
              onClick={() => { if (cannotSubmit) return; setSeed(Math.floor(Math.random() * 99999)); handleGenerate(); }}>Variations</Pill>
            {tab === "image" && (
              <Pill disabled={!upscaleAvailable}
                title={upscaleAvailable ? undefined : "Upscale ยังไม่เปิดให้บริการ"}
                onClick={() => upscaleAvailable && result?.id && handleUpscale()}>{isUpscaling ? "⟳ Upscale" : "Upscale"}</Pill>
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
              {/* Width follows the height cap, so the frame keeps its shape and
                  always fits: one frame per output that is actually coming —
                  a 2×2 grid fills the same box as a single frame. */}
              <div style={{ width: `min(100%, calc(${GENERATING_FRAME_MAX_H} * ${aspectNumber(frameAspect)}))`, margin: "0 auto" }}>
                {tab === "image" && outputs > 1 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
                    {Array.from({ length: outputs }).map((_, i) => (
                      <StudioFrame key={i} index={i} seed={(i + 1) * 0.137} aspect={frameAspect} generating={true} progress={progress} />
                    ))}
                  </div>
                ) : (
                  <StudioFrame index={0} seed={0.42} aspect={frameAspect} generating={true} progress={progress} />
                )}
              </div>
              <GeneratingStatus progress={progress} tab={tab} startedAt={genStartedAt} />
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
                  ) : AUDIO_EXT.test(result.resultUrl) ? (
                    <AudioResult src={result.resultUrl} title={songTitle || "เพลงของคุณ"} />
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
                  {tab !== "video" && !result.resultUrl.endsWith(".mp4") && !AUDIO_EXT.test(result.resultUrl) && (
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
              {tab === "audio" ? (
                // No sample songs to show yet — offer starting points instead,
                // one tap to put a description in the prompt.
                <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
                  <div style={{ fontSize: 44, marginBottom: 8, color: "#c4b5fd" }}>♫</div>
                  <h3 style={{ fontSize: 22, fontWeight: 300, color: "#fff", margin: "0 0 6px" }}>สร้างเพลงของคุณเอง</h3>
                  <p style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", margin: "0 0 18px" }}>
                    บอกแนวเพลงกับอารมณ์ ใส่เนื้อเพลงเองได้ หรือเว้นว่างไว้เป็นเพลงบรรเลง
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {MUSIC_STARTERS.map((s) => (
                      <button key={s} type="button" onClick={() => setPrompt(s)}
                        style={{ padding: "8px 14px", borderRadius: 999, fontSize: 12, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#cbd5e1", border: "1px solid rgba(255,255,255,0.12)" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : tab === "image" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
                  {STUDIO_SAMPLES.image.map((s) => (
                    <SampleFrame key={s.src} src={s.src} label={s.label} aspect={aspectRatio} />
                  ))}
                </div>
              ) : (
                <div style={{ aspectRatio: ASPECT_RATIO_CSS[aspectRatio] || "1/1", maxHeight: 520, margin: "0 auto" }}>
                  {(STUDIO_SAMPLES[tab] || STUDIO_SAMPLES.edit).map((s) => (
                    <SampleFrame key={s.src} src={s.src} label={s.label} aspect={aspectRatio} isVideo={tab === "video"} />
                  ))}
                </div>
              )}
              <p style={{ fontSize: 13, color: "rgba(203,213,225,0.55)", marginTop: 20, textAlign: "center" }}>
                {tab === "audio" ? "" : "ตัวอย่างผลงานที่สร้างบนแพลตฟอร์มนี้ — "}เลือกโมเดล พิมพ์ prompt แล้วกด <span style={{ color: "#a5f3fc" }}>ทอ</span> เพื่อเริ่มสร้าง{tab === "video" ? "วิดีโอ" : tab === "edit" ? "การแก้ไข" : tab === "audio" ? "เพลง" : "ภาพ"}ของคุณเอง
              </p>
            </div>
          )}
        </div>

        {/* History strip — recent generations. Stepped aside while a result
            is being made: its two rows took ~420px of a one-screen layout and
            left the canvas too short to show the queue and its animation. It
            comes back, with the new result in it, when the job settles. */}
        {history.length > 0 && !isGenerating && (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" }}>· รุ่นก่อนหน้า (history)</div>
              <a href="/gallery" style={{ fontSize: 11, color: "#a5f3fc", textDecoration: "none", letterSpacing: "0.05em" }}>ดูทั้งหมด →</a>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 8 }}>
              {history.slice(0, 16).map((g) => {
                const src = g.thumbnailUrl || g.resultUrl;
                const isVideo = g.type === "video" || g.resultUrl?.endsWith(".mp4");
                // A provider that hands back a real poster image keeps <img>.
                const srcIsVideo = isVideo && !/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(src ?? "");
                // A song has nothing to draw; it gets a note on its own colour.
                const isAudio = g.type === "audio" || AUDIO_EXT.test(src ?? "");
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
                    {/* A video's thumbnail is the video itself (rented-GPU jobs
                        store the mp4 there), and <img> draws that as a broken
                        icon. #t=0.1 makes the browser paint the first frame. */}
                    {isAudio && (
                      <AudioCover seed={g.prompt} bars={6} label={false} style={{ position: "absolute", inset: 0 }} />
                    )}
                    {src && !isAudio && srcIsVideo && (
                      <video src={`${src}#t=0.1`} muted playsInline preload="metadata"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
                    )}
                    {src && !isAudio && !srcIsVideo && (
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
          /* "safe": content taller than the canvas starts at the top instead
             of being centred past both edges. With plain center + hidden,
             anything too tall lost its top and bottom with no way to reach
             them — which is how the queue animation went missing. */
          align-items: safe center;
          justify-content: safe center;
          overflow-x: hidden;
          overflow-y: auto;
          /* Its height comes from the layout, never from its content, so it
             can be a size container: the in-progress frame sizes itself from
             the room left here (less ~170px for the status block and padding). */
          container-type: size;
          --gen-frame-h: min(460px, max(160px, calc(100cqh - 170px)));
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
          /* Here the canvas grows with its content, which a size container
             cannot do — fall back to the viewport for the frame cap. */
          .rp-studio-canvas {
            overflow: visible; min-height: 320px;
            container-type: normal;
            --gen-frame-h: min(460px, 44vh);
          }
        }
      `}</style>
    </div>
  );
}
