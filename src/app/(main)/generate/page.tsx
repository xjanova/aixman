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
import {
  composeMusicTags,
  musicComplexity,
  MUSIC_AGES,
  MUSIC_BPM_MAX,
  MUSIC_BPM_MIN,
  MUSIC_COMPLEXITY_DEFAULT,
  MUSIC_GENRES,
  MUSIC_INSTRUMENTS,
  MUSIC_LANGUAGES,
  MUSIC_MOODS,
  MUSIC_TIMBRES,
  MUSIC_VARIANCE_DEFAULT,
  MUSIC_VARIANCE_MAX,
  MUSIC_VARIANCE_MIN,
  MUSIC_VOCALS,
  type MusicStyleParams,
} from "@/lib/music-style";
import { downloadGeneration, extensionOf, saveFavorite } from "@/lib/client-actions";
import { nextQueueProgress, shownFraction, type QueueProgress, type QueueReading } from "@/lib/queue-progress";
import { AUDIO_EXT, AudioCover, AudioResult } from "@/components/xdreamer/audio";
import { AudioWave } from "@/components/xdreamer/audio-wave";

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
  // Portrait photo shapes — the ones social posts and prints actually use.
  // SDXL-standard buckets, so providers that want multiples of 64 accept them.
  { value: "3:4",  label: "3:4",  w: 896,  h: 1152 },
  { value: "2:3",  label: "2:3",  w: 832,  h: 1216 },
];

/**
 * Building blocks for a picture prompt, grouped by what they control. Each
 * inserts the English phrase image models were trained on; the Thai label is
 * only there to be read.
 */
const IMAGE_BUILDER: { label: string; items: { th: string; en: string }[] }[] = [
  { label: "สไตล์ภาพ", items: [
    { th: "ภาพถ่ายสมจริง", en: "photorealistic photograph" },
    { th: "ภาพนิ่งจากหนัง", en: "cinematic film still" },
    { th: "อนิเมะ", en: "anime illustration, clean line art" },
    { th: "3D เรนเดอร์", en: "3D render, soft global illumination" },
    { th: "สีน้ำ", en: "watercolor painting" },
    { th: "สีน้ำมัน", en: "oil painting, visible brush strokes" },
    { th: "ไอโซเมตริก", en: "isometric illustration" },
    { th: "โปสเตอร์", en: "graphic poster design, bold typography" },
  ] },
  { label: "แสง", items: [
    { th: "โกลเด้นอาวร์", en: "golden hour sunlight" },
    { th: "ไฟสตูดิโอนุ่ม", en: "soft studio softbox lighting" },
    { th: "นีออนยามค่ำ", en: "neon-lit night, reflections on wet street" },
    { th: "แสงขอบ", en: "dramatic rim light" },
    { th: "ลำแสงทะลุหมอก", en: "volumetric god rays through haze" },
    { th: "โทนมืดดราม่า", en: "moody low-key lighting" },
  ] },
  { label: "มุมกล้อง / เลนส์", items: [
    { th: "พอร์ตเทรต 85mm", en: "close-up portrait, 85mm lens, shallow depth of field" },
    { th: "มุมกว้าง 24mm", en: "wide-angle 24mm shot" },
    { th: "มาโคร", en: "macro shot, extreme detail" },
    { th: "มุมสูงโดรน", en: "aerial drone view" },
    { th: "มุมต่ำ", en: "low-angle hero shot" },
    { th: "มุมบนวางราบ", en: "top-down flat lay" },
  ] },
  { label: "สีและบรรยากาศ", items: [
    { th: "พาสเทล", en: "soft pastel palette" },
    { th: "สีสด", en: "vibrant saturated colors" },
    { th: "ขาวดำ", en: "black and white, high contrast" },
    { th: "ทีลแอนด์ออเรนจ์", en: "teal and orange color grade" },
    { th: "โทนฟิล์ม", en: "warm analog film tones, subtle grain" },
  ] },
  { label: "ความคมชัด", items: [
    { th: "รายละเอียดสูง", en: "highly detailed" },
    { th: "โฟกัสคม", en: "sharp focus" },
    { th: "8K", en: "8k" },
    { th: "HDR", en: "HDR" },
  ] },
];

/**
 * The same for a clip, as whole sentences: video models read camera direction
 * as an action in the description ("The camera pushes in…"), and the camera
 * vocabulary is the one MiniMax's prompting guide for H3 defines.
 */
const VIDEO_BUILDER: { label: string; items: { th: string; en: string }[] }[] = [
  { label: "การเคลื่อนกล้อง", items: [
    { th: "ดันเข้าช้าๆ", en: "The camera pushes in slowly toward the subject." },
    { th: "ถอยออกเผยฉาก", en: "The camera pulls out slowly to reveal the whole scene." },
    { th: "แพนไปทางขวา", en: "The camera pans right across the scene." },
    { th: "เลื่อนข้างตาม", en: "The camera trucks left alongside the subject." },
    { th: "เงยขึ้นฟ้า", en: "The camera tilts up from the ground to the sky." },
    { th: "โคจรรอบตัว", en: "An arc shot circles around the subject." },
    { th: "ติดตามผู้แสดง", en: "A tracking shot follows the subject as they move." },
    { th: "กล้องนิ่ง", en: "Static shot, the camera holds perfectly still." },
    { th: "มุมมองสายตา", en: "POV shot through the character's eyes." },
    { th: "ถือกล้องสั่นนิดๆ", en: "Handheld camera with a slight natural shake." },
    { th: "โดรนบินผ่าน", en: "Aerial drone shot gliding slowly over the landscape." },
    { th: "ซูมเข้าใบหน้า", en: "The lens zooms in on the subject's face." },
  ] },
  { label: "ขนาดภาพ", items: [
    { th: "ไกลเห็นทั้งฉาก", en: "Wide establishing shot." },
    { th: "ครึ่งตัว", en: "Medium shot." },
    { th: "ใกล้ใบหน้า", en: "Close-up shot." },
    { th: "ใกล้มาก", en: "Extreme close-up." },
  ] },
  { label: "สไตล์และแสง", items: [
    { th: "หนังฟอร์มยักษ์", en: "Live-action, cinematic, anamorphic lens, shallow depth of field." },
    { th: "อนิเมะ 2D", en: "2D-animated, anime style." },
    { th: "3D CG", en: "3D CG animation." },
    { th: "ฟิล์มเก่า", en: "Vintage film look with soft grain." },
    { th: "โกลเด้นอาวร์", en: "Warm golden hour light." },
    { th: "นีออนกลางคืน", en: "Neon-lit night with wet reflections." },
  ] },
  { label: "เสียง (โมเดลที่มีเสียงในตัว)", items: [
    { th: "เสียงบรรยากาศจริง", en: "Natural ambient sound matching the scene." },
    { th: "ออร์เคสตรา", en: "Background score: sweeping orchestral strings that build slowly." },
    { th: "อิเล็กทรอนิกส์", en: "Background score: pulsing electronic beat at a fast tempo." },
    { th: "ไม่มีดนตรี", en: "No background music." },
  ] },
];

/** Jobs one studio may have rendering at once. Each is a paid order of its own. */
const MAX_PARALLEL_JOBS = 3;

/** One order in the tray above the canvas. */
interface TrayJob {
  id: number;
  tab: TabType;
  prompt: string;
  aspect: string;
  startedAt: number;
  status: "running" | "completed" | "failed";
  progress: QueueProgress | null;
  result: GenerationResult | null;
}

/**
 * The server answers some refusals in English (the mobile app matches on the
 * text, so it stays). A customer reads them here in Thai.
 */
function localizeOrderError(message: string): string {
  const credits = /Insufficient credits\. Need (\d+), have (\d+)/i.exec(message);
  if (credits) return `เครดิตไม่พอ — งานนี้ใช้ ${credits[1]} เครดิต แต่มีอยู่ ${credits[2]} เครดิต`;
  if (/Model not available/i.test(message)) return "โมเดลนี้ปิดให้บริการชั่วคราว";
  if (/temporarily unavailable/i.test(message)) return "บริการไม่ว่างชั่วคราว ลองใหม่ในอีกสักครู่";
  if (/Prompt is required/i.test(message)) return "กรุณาพิมพ์ prompt ก่อน";
  if (/Generation failed/i.test(message)) return "สร้างไม่สำเร็จ ลองใหม่อีกครั้ง";
  return message;
}

type EnhanceOutcome =
  | { ok: true; prompt: string; source: string; engine?: string }
  | { ok: false; error: string };

/** "✨ ปรับพรอมต์ด้วย AI" — errors as values, like every request helper here. */
async function requestEnhance(body: Record<string, unknown>): Promise<EnhanceOutcome> {
  try {
    const res = await fetch("/api/studio/enhance-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "ปรับพรอมต์ไม่สำเร็จ" };
    if (typeof data.prompt !== "string" || !data.prompt.trim()) return { ok: false, error: "AI ไม่ได้ส่งพรอมต์กลับมา" };
    return { ok: true, prompt: data.prompt, source: String(data.source ?? ""), engine: data.engine };
  } catch {
    return { ok: false, error: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้" };
  }
}

/** A dropped or pasted picture as the data URL the image slots hold. */
function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * The time, for event handlers. Out here because React Compiler cannot always
 * tell a handler from render code and reports `Date.now()` inside one as an
 * impure call during render — the same false positive `pickResolution` notes —
 * and a component with a compiler error loses auto-memoization entirely.
 */
function clockNow(): number {
  return Date.now();
}

/** Largest picture the server reads back for a rented worker (MAX_BYTES.image). */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * What the customer was writing, kept across a reload. Per browser only —
 * a convenience, never the record of an order.
 */
const DRAFT_KEY = "xdr-studio-draft-v1";
interface StudioDraft {
  tab?: TabType;
  prompt?: string;
  negativePrompt?: string;
  lyrics?: string;
  aspectRatio?: string;
}
function readDraft(): StudioDraft {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as StudioDraft) : {};
  } catch {
    return {};
  }
}
function writeDraft(draft: StudioDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private window or storage full — losing a draft is not worth an error.
  }
}

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
  negativePrompt?: string | null;
  /** `ai_models.id` it was made with, for "use these settings again". */
  modelDbId?: number;
  /** The order's settings (aspect, length, quality…), whitelisted by the gallery API. */
  remix?: {
    aspectRatio?: string;
    resolution?: string;
    quality?: string;
    duration?: number;
    numOutputs?: number;
    steps?: number;
    cfgScale?: number;
    strength?: number;
    lyrics?: string;
    music?: MusicStyleParams;
  } | null;
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
  "1:1": "1/1", "16:9": "16/9", "9:16": "9/16", "4:3": "4/3", "3:2": "3/2", "3:4": "3/4", "2:3": "2/3",
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
/** Where a panel actually fits, worked out when it opens. */
type Placement = { up: boolean; left: number; width: number; maxHeight: number };

/**
 * Artwork for the studio's five tabs, keyed by tab.
 *
 * Only files that are actually in public/studio-tabs belong here — a missing
 * one falls back to a text pill, which is better than an <Image> pointed at a
 * 404. Each is a 440px-wide PNG with its own Thai and English label drawn in,
 * downscaled from a ~2,000px original: the button is ~190px on screen, so the
 * full-size art was 1.5MB to draw something a tenth of that. Downscale with
 * premultiplied alpha — these plates are transparent around a neon edge, and
 * a plain resize drags the transparent black into the glow.
 */
/** The second line on each plate, matching what the artwork has drawn in. */
const TAB_EN: Record<TabType, string> = {
  image: "Image", video: "Video", edit: "Edit", lipsync: "Lip Sync", audio: "Music",
};

const TAB_ART: Partial<Record<TabType, string>> = {
  image: "/studio-tabs/tab-image.png",
  video: "/studio-tabs/tab-video.png",
  edit: "/studio-tabs/tab-edit.png",
  lipsync: "/studio-tabs/tab-lipsync.png",
  audio: "/studio-tabs/tab-music.png",
};

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

  /**
   * The panel used to open upward at a fixed width, always.
   *
   * That was right while every control sat low in one 336px-wide rail. In four
   * columns they moved to the TOP of a 270px column against the right edge of
   * the screen, and the same panel then opened off the top of the viewport —
   * measured at -66px for the first one, so two thirds of it was simply gone —
   * and hung 25px past the right edge. Both are decided here instead, from the
   * room the trigger actually has when it is clicked.
   */
  const [place, setPlace] = useState<Placement>({ up: false, left: 0, width, maxHeight: 320 });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const t = el.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - gap * 2);
    const above = t.top - gap;
    const below = vh - t.bottom - gap;
    // Downward by default; upward only when down cannot hold the panel and up
    // has more room. Either way it is absolutely positioned, so neither
    // direction can push the layout around — only fit decides.
    const up = below < Math.min(320, above) && above > below;
    // Hang from whichever edge was asked for, then keep it on screen.
    const wanted = align === "right" ? t.right - w : t.left;
    const clamped = Math.max(gap, Math.min(wanted, vw - w - gap));
    setPlace({
      up,
      left: clamped - t.left,
      width: w,
      maxHeight: Math.min(320, Math.max(160, up ? above : below)),
    });
  }, [align, width]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle(null);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", measure);
    };
  }, [isOpen, onToggle, measure]);

  return (
    <div ref={ref} style={{ position: "relative", flex: "1 1 132px", minWidth: "min(124px, 100%)" }}>
      <button
        type="button"
        onClick={() => {
          if (isOpen) {
            onToggle(null);
            return;
          }
          // Measured before it is shown, so it never paints in the wrong place.
          measure();
          onToggle(id);
        }}
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
            position: "absolute",
            ...(place.up ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
            left: place.left,
            width: place.width,
            maxHeight: place.maxHeight,
            overflowY: "auto",
            background: "rgba(15,23,42,0.97)", backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
            padding: 12, zIndex: 40, boxShadow: "0 24px 48px -12px rgba(0,0,0,0.7)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
/**
 * A row of song-style chips.
 *
 * Single-select rows clear on a second click: the model is happiest when it is
 * told less rather than told something wrong, so "no opinion" has to stay
 * reachable once an opinion has been given. Multi-select rows stop accepting
 * new picks at `max` — past three moods or six instruments the tags start
 * eating the song's own token budget (they share one 24,576-token context).
 */
function ChipRow({
  label, options, value, onChange, max, disabled, hint,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string | string[] | undefined;
  onChange: (next: string | string[] | undefined) => void;
  max?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const multi = Array.isArray(value) || typeof max === "number";
  const picked = Array.isArray(value) ? value : value ? [value] : [];
  const full = multi && typeof max === "number" && picked.length >= max;

  const toggle = (id: string) => {
    if (disabled) return;
    if (!multi) {
      onChange(picked[0] === id ? undefined : id);
      return;
    }
    const next = picked.includes(id) ? picked.filter((p) => p !== id) : full ? picked : [...picked, id];
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <div style={{ opacity: disabled ? 0.4 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: "#64748b" }}>{hint}</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {options.map((o) => {
          const on = picked.includes(o.id);
          // A chip that cannot be added any more is dimmed rather than hidden,
          // so the list does not reshuffle under the cursor at the limit.
          const blocked = !on && full;
          return (
            <button key={o.id} type="button" disabled={disabled} onClick={() => toggle(o.id)}
              style={{
                padding: "5px 9px", borderRadius: 8, fontSize: 11.5, fontFamily: "inherit",
                cursor: disabled ? "default" : blocked ? "not-allowed" : "pointer",
                background: on ? `hsla(${220 + HUE},60%,50%,0.28)` : "rgba(255,255,255,0.04)",
                color: on ? "#fff" : blocked ? "#475569" : "#94a3b8",
                border: `1px solid ${on ? `hsla(${220 + HUE},70%,60%,0.55)` : "rgba(255,255,255,0.08)"}`,
              }}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A labelled slider whose current value is spelled out, not left as a number. */
function StyleSlider({
  label, value, min, max, step, format, onChange, disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ opacity: disabled ? 0.4 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{label}</span>
        <span style={{ fontSize: 11, color: `hsl(${220 + HUE},70%,78%)`, fontWeight: 600 }}>{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: `hsl(${220 + HUE},70%,60%)`, cursor: disabled ? "default" : "pointer" }} />
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
    creditBalance, creditsLoaded, fetchCredits,
    isGenerating, setIsGenerating,
  } = useAppStore();

  // What was being written before a reload. Read once, in an initializer: the
  // page renders nothing until the session loads, so there is no server HTML
  // for a restored value to disagree with.
  const [draft0] = useState(readDraft);
  const [tab, setTab] = useState<TabType>(() => (draft0.tab && draft0.tab in TAB_EN ? draft0.tab : "image"));
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState(() => (typeof draft0.prompt === "string" ? draft0.prompt.slice(0, 10_000) : ""));
  const [negativePrompt, setNegativePrompt] = useState(() => (typeof draft0.negativePrompt === "string" ? draft0.negativePrompt : ""));
  const [selectedStyle, setSelectedStyle] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState(() =>
    draft0.aspectRatio && draft0.aspectRatio in ASPECT_RATIO_CSS ? draft0.aspectRatio : "1:1"
  );
  /** Quality mode the customer picked; null = the model's default. */
  const [qualityId, setQualityId] = useState<string | null>(null);
  /** "✨ ปรับพรอมต์ด้วย AI": in flight, the prompt it replaced (for ↶), and where it came from. */
  const [enhancing, setEnhancing] = useState(false);
  const [promptBeforeEnhance, setPromptBeforeEnhance] = useState<string | null>(null);
  const [enhanceNote, setEnhanceNote] = useState<string | null>(null);
  /**
   * Orders in the tray: the one on the canvas and any still rendering behind
   * it. A rented-GPU render can take minutes, and nobody should have to watch
   * one finish before ordering the next.
   */
  const [jobs, setJobs] = useState<TrayJob[]>([]);
  /** Which order the canvas shows. The ref is what pollers read; the state is what renders. */
  const focusRef = useRef<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  /** When the last order was sent — a double click must not buy two. */
  const lastSubmitRef = useRef(0);
  /** A history item opened on the canvas, so its settings can be reused. */
  const [viewing, setViewing] = useState<HistoryItem | null>(null);
  /** A file is being dragged over the studio. */
  const [dragging, setDragging] = useState(false);
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
  /**
   * The picked File itself, kept only so its waveform can be drawn.
   *
   * `inputAudio` is the R2 URL the request travels with, and R2 answers no
   * `Access-Control-Allow-Origin` — so once the track is up there the browser
   * can play it but can never read its samples. In the picker they are already
   * in hand. That is the one moment a waveform is free.
   */
  const [inputAudioFile, setInputAudioFile] = useState<File | null>(null);
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
  const [lyrics, setLyrics] = useState(() => (typeof draft0.lyrics === "string" ? draft0.lyrics.slice(0, 3000) : ""));
  const [songTitle, setSongTitle] = useState("");
  /**
   * Instrumental switch. Separate from "lyrics are empty" on purpose: a
   * customer who wrote a verse and then wants to hear the backing track should
   * get one without losing what they typed.
   */
  const [instrumental, setInstrumental] = useState(false);
  /**
   * The song's direction: who sings it, in what genre, with what behind them.
   *
   * Held as the choices, never as the sentence — `composeMusicTags` on the
   * server turns them into the model's `[Tags]` line, so the studio and the
   * mobile app cannot drift into building different prompts from the same
   * picks. `instrumental` is folded in only at submit time, because it is a
   * switch the customer can flip back and forth without losing the rest.
   */
  const [musicStyle, setMusicStyle] = useState<MusicStyleParams>({
    complexity: MUSIC_COMPLEXITY_DEFAULT,
    variance: MUSIC_VARIANCE_DEFAULT,
  });
  const setMusicField = useCallback(
    <K extends keyof MusicStyleParams>(key: K, value: MusicStyleParams[K]) =>
      setMusicStyle((s) => ({ ...s, [key]: value })),
    []
  );

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
  /** Quality modes this model offers the viewer, and the one in force. */
  const qualityModes = selectedModel?.quality?.length ? selectedModel.quality : null;
  const activeQuality = qualityModes
    ? qualityModes.find((m) => m.id === qualityId) ?? qualityModes.find((m) => m.isDefault) ?? qualityModes[0]
    : null;
  /**
   * One output's price — the same formula GenerationService charges with,
   * rounded up after the quality multiplier exactly as the server does.
   */
  const creditsFor = (seconds: number | null) =>
    selectedModel
      ? Math.ceil(
          creditsForDuration(selectedModel.creditsPerUnit, selectedModel.durationCurve, seconds) *
            (activeQuality?.creditsMultiplier ?? 1)
        )
      : 0;

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
  /** Longest source track a cover accepts — the upload cap, not the model's. */
  const coverSourceSeconds = musicOpts?.maxSourceSeconds ?? musicOpts?.maxDuration ?? 240;
  /**
   * The tag line the model will actually receive, shown before the order.
   *
   * Built with the same function the server builds it with, so what the
   * customer reads here is what YuE2 reads under `[Tags]` — chips that only
   * *looked* like they did something would be worse than no chips at all.
   */
  const styleSummary =
    musicOpts?.controls && prompt.trim()
      ? composeMusicTags(prompt, { ...musicStyle, instrumental })
      : "";

  /**
   * One source of truth for whether the button can fire. It used to be spelled
   * out three times — in `disabled`, in `cursor` and in `opacity` — and the
   * three had already drifted: `disabled` checked `canOrder`, the other two did
   * not, so a model pulled back for tuning still rendered as clickable.
   */
  const runningJobs = jobs.filter((j) => j.status === "running").length;
  const cannotSubmit =
    runningJobs >= MAX_PARALLEL_JOBS ||
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
    await uploadMediaFile(file, kind, maxSeconds);
  };

  /** The upload itself, shared by the pickers and a file dropped on the studio. */
  const uploadMediaFile = async (file: File, kind: "audio" | "video", maxSeconds: number) => {
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
    if (kind === "audio") { setInputAudio(result.url!); setInputAudioName(file.name); setInputAudioFile(file); }
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

  /**
   * Record how an order ended — in its tray entry always, on the canvas only
   * when the canvas is showing it. An order that finishes behind another one
   * says so in its toast instead of jumping onto the screen.
   */
  const settleJob = useCallback((id: number, outcome: GenerationResult) => {
    const ok = outcome.status === "completed";
    const onCanvas = focusRef.current === id;
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: ok ? "completed" : "failed", progress: null, result: outcome } : j)));
    if (onCanvas) {
      setResult(outcome);
      setIsGenerating(false);
      setProgress(null);
    }
    fetchCredits();
    if (ok) {
      fetchHistory();
      toast(
        "success",
        onCanvas ? "สร้างสำเร็จ!" : "งานที่สั่งไว้เสร็จแล้ว",
        `ใช้ ${outcome.creditsUsed} เครดิต${onCanvas ? "" : " · กดที่แถบงานเหนือแคนวาสเพื่อดู"}`,
      );
    } else {
      toast("error", "สร้างไม่สำเร็จ", outcome.error ? localizeOrderError(outcome.error) : "เกิดข้อผิดพลาด");
    }
  }, [setIsGenerating, fetchCredits, fetchHistory, toast]);

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

      // Progress lands on the order's tray entry always, and on the canvas
      // only while the canvas is showing this order.
      if (data.gpu) {
        const gpu = data.gpu;
        sawGpu = true;
        rendering = gpu.stage === "rendering";
        deadlineMs = GPU_DEADLINE_MS;
        const at = Date.now();
        setJobs((js) => js.map((j) => (j.id === generationId ? { ...j, progress: nextQueueProgress(j.progress, gpu, at) } : j)));
        if (focusRef.current === generationId) setProgress((prev) => nextQueueProgress(prev, gpu, at));
      } else if (sawGpu) {
        setJobs((js) => js.map((j) => (j.id === generationId ? { ...j, progress: null } : j)));
        if (focusRef.current === generationId) setProgress(null);
      }

      if (data.status === "completed") {
        settleJob(generationId, {
          id: data.id, status: "completed",
          resultUrl: data.resultUrl,
          resultUrls: data.resultUrls
            ? (Array.isArray(data.resultUrls) ? data.resultUrls : [data.resultUrl as string])
            : [data.resultUrl as string],
          thumbnailUrl: data.thumbnailUrl,
          creditsUsed: data.creditsUsed, processingMs: data.processingMs,
          expiresAt: data.expiresAt, daysLeft: data.daysLeft,
        });
        return;
      }
      if (data.status === "failed") {
        settleJob(generationId, { id: data.id, status: "failed", creditsUsed: 0, error: data.errorMessage ?? undefined });
        return;
      }
    }

    // Stopped watching. The job is still running server-side and the credits
    // are already spent — telling the user to "try again" here would charge
    // them twice for one clip.
    setJobs((js) => js.filter((j) => j.id !== generationId));
    if (focusRef.current === generationId) {
      focusRef.current = null;
      setFocusId(null);
      setIsGenerating(false);
      setProgress(null);
    }
    toast(
      "info",
      "ยังสร้างไม่เสร็จ",
      "งานยังทำงานอยู่เบื้องหลัง ผลลัพธ์จะขึ้นในแกลเลอรีเมื่อเสร็จ ไม่ต้องสั่งสร้างใหม่",
    );
    fetchHistory();
  }, [setIsGenerating, fetchHistory, toast, settleJob]);

  /** Put one tray order on the canvas: its progress while it runs, its result once done. */
  const focusJob = (job: TrayJob) => {
    focusRef.current = job.id;
    setFocusId(job.id);
    setViewing(null);
    setIsFavorited(false);
    if (job.status === "running") {
      setResult(null);
      setProgress(job.progress);
      setGenStartedAt(job.startedAt);
      setIsGenerating(true);
    } else {
      setIsGenerating(false);
      setProgress(null);
      setResult(job.result);
    }
  };

  /** Clear the canvas without touching orders still rendering in the tray. */
  const clearCanvas = () => {
    focusRef.current = null;
    setFocusId(null);
    setViewing(null);
    setResult(null);
    setIsGenerating(false);
    setProgress(null);
  };

  /**
   * `overrides.seed` is for Variations: it used to set the seed field and then
   * order, but the order read the field from before the click — so with a seed
   * locked, "Variations" rendered the very same picture again.
   */
  const handleGenerate = async (overrides: { seed?: number } = {}) => {
    // Lip-sync is driven by the uploaded voice, not by text, so it is the one
    // mode that may legitimately run with an empty prompt.
    if (!selectedModelId) return;
    if (tab !== "lipsync" && !prompt.trim()) return;
    if (runningJobs >= MAX_PARALLEL_JOBS) {
      toast("info", `กำลังสร้างอยู่ ${MAX_PARALLEL_JOBS} งานแล้ว`, "รอให้งานใดงานหนึ่งเสร็จก่อน แล้วค่อยสั่งเพิ่ม");
      return;
    }
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
    // One click, one order. The page used to lock for the whole render, which
    // is what stopped a double click buying two; now that orders can overlap,
    // it has to be stopped on purpose.
    const clickedAt = clockNow();
    if (clickedAt - lastSubmitRef.current < 1500) return;
    lastSubmitRef.current = clickedAt;

    // On the tray at once, under a placeholder id, so the canvas shows it
    // while the request is out — an API model can take half a minute to
    // answer the POST itself.
    const pendingId = -clickedAt;
    const jobAspect = tab === "audio" ? "1:1" : aspectRatio;
    setJobs((js) => [
      { id: pendingId, tab, prompt: prompt.trim(), aspect: jobAspect, startedAt: clickedAt, status: "running", progress: null, result: null },
      ...js.filter((j) => j.status === "running"),
      ...js.filter((j) => j.status !== "running").slice(0, 6),
    ]);
    focusRef.current = pendingId;
    setFocusId(pendingId);
    setViewing(null);
    setIsGenerating(true); setResult(null); setIsFavorited(false);
    setProgress(null); setGenStartedAt(clickedAt);
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
        // Priced by the server at this mode's multiplier — the same sum the
        // button shows. Only a mode this viewer may use is honoured.
        quality: activeQuality?.id,
        strength: refImage && tab === "image" ? strength : undefined,
        numOutputs: tab === "image" ? outputs : undefined,
        // Every video adapter reads `duration`; none of them read steps or
        // cfgScale. Sending diffusion knobs to a video endpoint is noise at
        // best and a rejected request at worst.
        //
        // Lip-sync sends none of the three. Its length is set by the voice
        // track, and the adapter derives the frame count from the model
        // row's own ceiling rather than from anything chosen here.
        // …and none from a music model that sets its own length: the server
        // gives it the full token budget, so anything sent here could only
        // shorten the song.
        duration: tab === "video" || (music && !musicOpts?.autoLength) ? duration : undefined,
        // The music model is a distilled turbo with its own fixed step count.
        steps: tab === "video" || tab === "lipsync" || music ? undefined : steps,
        cfgScale: tab === "video" || tab === "lipsync" || music ? undefined : guidance,
        seed: overrides.seed ?? seed ?? undefined,
        // Instrumental wins over whatever is in the box, and is expressed by
        // sending no lyrics at all — which is exactly what the models read as
        // "no vocal".
        lyrics: music && !instrumental ? lyrics.trim() || undefined : undefined,
        // The choices, not the prompt they compose into: the server builds the
        // `[Tags]` line so every client builds the same one.
        music: musicOpts?.controls ? { ...musicStyle, instrumental } : undefined,
      },
    });
    if (sent.kind !== "ok") {
      setJobs((js) => js.filter((j) => j.id !== pendingId));
      if (focusRef.current === pendingId) {
        focusRef.current = null;
        setFocusId(null);
        setIsGenerating(false);
      }
      toast("error", "เกิดข้อผิดพลาด", sent.kind === "network" ? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้" : localizeOrderError(sent.error));
      return;
    }
    const data = sent.data;
    // The placeholder becomes the real order.
    setJobs((js) => js.map((j) => (j.id === pendingId ? { ...j, id: data.id } : j)));
    if (focusRef.current === pendingId) {
      focusRef.current = data.id;
      setFocusId(data.id);
    }
    if (data.status === "completed" || data.status === "failed") settleJob(data.id, data);
    else pollResult(data.id);
  };

  /** "✨ ปรับพรอมต์ด้วย AI": rewrite what was typed into what this model reads best. */
  const handleEnhance = async () => {
    const text = prompt.trim();
    if (!text || enhancing) return;
    setEnhancing(true);
    setEnhanceNote(null);
    // Only MiniMax's Context-IR (self-hosted H3) looks at the frames; nothing
    // else is sent megabytes it would ignore.
    const h3Frames = selectedModel?.modelId === "minimax-h3" && tab === "video" && videoMode === "i2v";
    const out = await requestEnhance({
      prompt: text,
      tab,
      modelId: selectedModelId,
      videoMode: tab === "video" ? videoMode : undefined,
      duration: tab === "video" ? duration : undefined,
      aspectRatio: tab === "audio" ? undefined : aspectRatio,
      firstFrame: h3Frames ? inputImage ?? undefined : undefined,
      lastFrame: h3Frames ? inputImageEnd ?? undefined : undefined,
    });
    setEnhancing(false);
    if (!out.ok) {
      toast("error", "ปรับพรอมต์ไม่สำเร็จ", out.error);
      return;
    }
    setPromptBeforeEnhance(text);
    setPrompt(out.prompt.slice(0, 10_000));
    setEnhanceNote(
      out.source === "context-ir"
        ? "เรียบเรียงด้วย H3-Context-IR ของ MiniMax"
        : out.source === "llm"
          ? `เรียบเรียงด้วย AI${out.engine ? ` · ${out.engine}` : ""}`
          : "ปรับแบบพื้นฐาน (ผู้ช่วย AI ยังไม่ได้เชื่อมต่อ)"
    );
  };

  const undoEnhance = () => {
    if (promptBeforeEnhance === null) return;
    setPrompt(promptBeforeEnhance);
    setPromptBeforeEnhance(null);
    setEnhanceNote(null);
  };

  /** A clip builder phrase goes in as a sentence; a picture one as a comma-joined tag. */
  const addPromptSentence = (text: string) => {
    setPrompt((p) => {
      const trimmed = p.trim();
      if (!trimmed) return text;
      if (trimmed.toLowerCase().includes(text.toLowerCase())) return trimmed;
      return `${trimmed}${/[.!?]$/.test(trimmed) ? "" : "."} ${text}`;
    });
  };

  /** Ctrl/⌘+Enter orders from any of the text fields. */
  const onSubmitKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!cannotSubmit) void handleGenerate();
    }
  };

  /** Open a finished piece from the history strip on the canvas. */
  const viewHistory = (g: HistoryItem) => {
    focusRef.current = null;
    setFocusId(null);
    setIsGenerating(false);
    setProgress(null);
    setIsFavorited(false);
    setViewing(g);
    setResult({
      id: g.id,
      status: "completed",
      resultUrl: g.resultUrl ?? g.thumbnailUrl,
      resultUrls: g.resultUrl ? [g.resultUrl] : undefined,
      thumbnailUrl: g.thumbnailUrl,
      creditsUsed: 0,
    });
    document.querySelector(".rp-studio-center")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  /**
   * Put a past order back — model, prompt, shape, length, quality, song —
   * ready to order again with a fresh seed. The history strip used to restore
   * only the prompt, leaving the customer to rebuild everything else from
   * memory.
   */
  const remixFrom = (g: HistoryItem) => {
    const nextTab: TabType = g.type === "video" || g.type === "edit" || g.type === "audio" ? g.type : "image";
    const model = models.find((m) => m.id === g.modelDbId);
    const r = g.remix ?? {};
    setTab(nextTab);
    clearCanvas();
    setPrompt(g.prompt ?? "");
    setNegativePrompt(g.negativePrompt ?? "");
    setPromptBeforeEnhance(null);
    setEnhanceNote(null);
    if (model && model.canOrder !== false) setSelectedModelId(model.id);
    if (r.aspectRatio && r.aspectRatio in ASPECT_RATIO_CSS) setAspectRatio(r.aspectRatio);
    if (typeof r.duration === "number") setDuration(r.duration);
    if (r.resolution) setResolution(r.resolution);
    setQualityId(r.quality ?? null);
    if (typeof r.numOutputs === "number") setNumOutputs(Math.min(4, Math.max(1, Math.round(r.numOutputs))));
    if (nextTab === "audio") {
      if (typeof r.lyrics === "string") setLyrics(r.lyrics.slice(0, 3000));
      if (r.music) {
        setMusicStyle({ complexity: MUSIC_COMPLEXITY_DEFAULT, variance: MUSIC_VARIANCE_DEFAULT, ...r.music });
        setInstrumental(r.music.instrumental === true);
      }
    }
    toast(
      "info",
      "โหลดการตั้งค่าเดิมแล้ว",
      model ? `${model.name} — กดทอเพื่อสร้างอีกครั้งด้วย seed ใหม่` : "โมเดลเดิมไม่มีแล้ว — ใช้โมเดลที่เลือกอยู่แทน",
    );
  };

  /** Carry a finished picture into the next step: animate it, edit it, or reference it. */
  const carryResultTo = (target: "video" | "edit" | "ref", url: string) => {
    clearCanvas();
    if (target === "video") {
      setTab("video");
      setVideoMode("i2v");
      setInputImage(url);
      setInputImagePreview(url);
      setInputImageEnd(null);
      toast("info", "ใส่เป็นภาพเริ่มต้นของคลิปแล้ว", "อธิบายว่าอยากให้ภาพเคลื่อนไหวอย่างไร แล้วกดทอ");
    } else if (target === "edit") {
      setTab("edit");
      setInputImage(url);
      setInputImagePreview(url);
      toast("info", "ใส่เป็นภาพต้นฉบับแล้ว", "พิมพ์ว่าต้องการแก้อะไรในภาพ");
    } else {
      setTab("image");
      setRefImage(url);
      setRefImagePreview(url);
      toast("info", "ใส่เป็นภาพอ้างอิงแล้ว", "ปรับความเข้มได้ที่ปุ่ม ↑ ภาพอ้างอิง");
    }
  };

  /**
   * A file pasted or dropped anywhere on the studio goes where this tab takes
   * one: a picture into the tab's image slot, a voice or a song into its
   * upload (with the same length checks as the pickers).
   */
  const acceptFile = async (file: File) => {
    if (file.type.startsWith("audio/") || file.type.startsWith("video/")) {
      const kind = file.type.startsWith("audio/") ? "audio" : "video";
      if (kind === "audio" && tab === "lipsync") return uploadMediaFile(file, "audio", MAX_INPUT_SECONDS);
      if (kind === "audio" && musicOpts?.sourceSong) return uploadMediaFile(file, "audio", coverSourceSeconds);
      if (kind === "video" && tab === "lipsync" && lipsyncNeeds === "video") return uploadMediaFile(file, "video", MAX_INPUT_SECONDS);
      toast(
        "info",
        "แท็บนี้ไม่ได้ใช้ไฟล์ชนิดนี้",
        kind === "audio" ? "ไฟล์เสียงใช้ได้ที่แท็บลิปซิงค์ หรือโมเดลคัฟเวอร์เพลง" : "คลิปใช้ได้ที่แท็บลิปซิงค์",
      );
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast("error", "ไฟล์ชนิดนี้ใช้ไม่ได้", "รองรับภาพ เสียง และวิดีโอ");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast("error", "ไฟล์ภาพใหญ่เกินไป", "รองรับไม่เกิน 12 MB");
      return;
    }
    const url = await fileToDataUrl(file);
    if (!url) {
      toast("error", "อ่านไฟล์ภาพไม่ได้");
      return;
    }
    if (tab === "image") {
      setRefImage(url); setRefImagePreview(url);
      toast("success", "ใส่เป็นภาพอ้างอิงแล้ว");
    } else if (tab === "edit") {
      setInputImage(url); setInputImagePreview(url);
      toast("success", "ใส่เป็นภาพต้นฉบับแล้ว");
    } else if (tab === "video") {
      setVideoMode("i2v"); setInputImage(url); setInputImagePreview(url);
      toast("success", "ใส่เป็นภาพเริ่มต้นของคลิปแล้ว");
    } else if (tab === "lipsync" && lipsyncNeeds === "image") {
      setInputImage(url); setInputImagePreview(url);
      toast("success", "ใส่เป็นรูปหน้าคนที่จะให้พูดแล้ว");
    } else {
      toast("info", "แท็บนี้ไม่ได้ใช้ภาพ");
    }
  };

  // Ctrl+V a picture anywhere on the page — the quickest way in for a
  // screenshot. Plain text is left to go wherever it was being pasted. The
  // listener is added once and reads the latest handler through a ref, which
  // is refreshed after every render (never during one).
  const acceptFileRef = useRef(acceptFile);
  useEffect(() => {
    acceptFileRef.current = acceptFile;
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void acceptFileRef.current(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // Keep what is being written across a reload (this browser only).
  useEffect(() => {
    const t = setTimeout(() => writeDraft({ tab, prompt, negativePrompt, lyrics, aspectRatio }), 400);
    return () => clearTimeout(t);
  }, [tab, prompt, negativePrompt, lyrics, aspectRatio]);

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
  /** The balance is known and this order costs more than it. The server is still the judge. */
  const shortOfCredits = creditsLoaded && totalCredits > 0 && creditBalance < totalCredits;
  /** A song has no picture shape; its in-progress frame is square. */
  const frameAspect = tab === "audio" ? "1:1" : aspectRatio;
  /** The tray order on the canvas, if the canvas is showing one. */
  const focusedJob = jobs.find((j) => j.id === focusId) ?? null;
  /** Shape and kind of what the canvas shows — the focused order's, not the form's current values. */
  const canvasAspect = focusedJob?.aspect ?? frameAspect;
  const canvasTab = focusedJob?.tab ?? tab;
  const resultUrl = result?.resultUrl ?? "";
  const resultKind = viewing?.type ?? canvasTab;
  const resultIsAudio = AUDIO_EXT.test(resultUrl);
  const resultIsVideo =
    !resultIsAudio && (resultKind === "video" || resultKind === "lipsync" || /\.(mp4|webm|mov)(\?|$)/i.test(resultUrl));
  const resultIsImage = !!resultUrl && !resultIsAudio && !resultIsVideo;
  if (!session) return null;

  // ─── RENDER ─────────────────────────────────────────────────────────
  return (
    <div className="rp-studio" style={{ color: "#f1f5f9" }}
      // A file dropped anywhere lands where this tab takes one (acceptFile).
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void acceptFile(file);
      }}>

      {dragging && (
        <div className="rp-drop-hint" aria-hidden="true">
          <div>
            <div style={{ fontSize: 34, marginBottom: 6 }}>⤓</div>
            {tab === "image" ? "วางภาพเพื่อใช้เป็นภาพอ้างอิง"
              : tab === "edit" ? "วางภาพที่ต้องการแก้ไข"
                : tab === "video" ? "วางภาพเพื่อเริ่มคลิปจากภาพนี้"
                  : tab === "lipsync" ? "วางไฟล์เสียง คลิป หรือรูปหน้าคน"
                    : "วางเพลงต้นฉบับ (โหมดคัฟเวอร์)"}
          </div>
        </div>
      )}

      {/* ═══ JOB — which tool, which model, what it costs ═══
          The rail used to carry all fifteen control groups at 336px wide,
          which is what made every label truncate. Each column now answers
          one question, and the balance sits with the model that spends it. */}
      <aside className="rp-studio-jobs rp-scroll" style={{ borderRight: "1px solid rgba(255,255,255,0.06)", padding: 18, display: "flex", flexDirection: "column", gap: 12, background: "rgba(15,23,42,0.25)" }}>

        {/* The five things the studio makes.
            Each one is a piece of art with its own label baked into it, and
            they stack rather than sit side by side: at 3:1 in a 220px column,
            five across would leave each 36px wide. A tab whose art has not
            landed yet falls back to the plain pill, so the menu never waits
            on a file. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {([
            { key: "image" as TabType, label: "สร้างภาพ", icon: "▧" },
            { key: "video" as TabType, label: "สร้างวิดีโอ", icon: "▶" },
            { key: "edit"  as TabType, label: "แก้ไขภาพ", icon: "✦" },
            { key: "lipsync" as TabType, label: "ลิปซิงค์", icon: "♪" },
            { key: "audio" as TabType, label: "สร้างเพลง", icon: "♫" },
          ]).map(t => {
            const blocked = tabBlockedReason(t.key);
            const disabled = blocked !== null && tab !== t.key;
            const art = TAB_ART[t.key];
            const pick = () => {
              setTab(t.key); setResult(null); setNumOutputs(1);
              // The audio upload is shared between lip-sync and the cover
              // panel, and their limits differ by a factor of six: a four
              // minute song accepted for a cover must not still be sitting
              // there when the customer opens lip-sync, where the bill
              // follows the track's length.
              if (t.key !== tab) { setInputAudio(null); setInputAudioName(null); setInputAudioFile(null); }
            };

            if (art) {
              return (
                <button key={t.key} type="button" className="rp-tab-art"
                  data-active={tab === t.key ? "true" : "false"}
                  disabled={disabled} onClick={pick}
                  title={blocked ?? t.label} aria-label={t.label}
                  aria-current={tab === t.key ? "true" : undefined}>
                  <Image src={art} alt={t.label} width={440} height={147} sizes="220px" priority={t.key === "image"} />
                </button>
              );
            }

            // Drawn to match the artwork beside it — same plate, same 3:1, same
            // neon edge — so a tab still waiting on its art reads as part of
            // the set rather than as the one that is missing.
            return (
            <button key={t.key} type="button" className="rp-tab-plate"
              data-active={tab === t.key ? "true" : "false"}
              disabled={disabled}
              title={blocked ?? t.label}
              onClick={pick}
              aria-current={tab === t.key ? "true" : undefined}>
              <span className="rp-tab-plate-icon" aria-hidden="true">{t.icon}</span>
              <span className="rp-tab-plate-text">
                <span className="rp-tab-plate-th">{t.label}</span>
                <span className="rp-tab-plate-en">{TAB_EN[t.key]}</span>
              </span>
              <span className="rp-tab-plate-go" aria-hidden="true">&rsaquo;</span>
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

        {/* Credit balance — absorbs the right rail's credits card, including
            its top-up link, into a single line. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "#94a3b8" }}>
          <span style={{ color: "#fbbf24" }}>✦</span>
          เครดิต <span style={{ fontWeight: 600, color: "#f1f5f9" }}>{creditBalance.toLocaleString()}</span>
          <a href="/pricing" style={{ color: "#a5f3fc", textDecoration: "none", borderBottom: "1px dotted rgba(165,243,252,0.4)" }}>+ เติม</a>
        </div>
      </aside>

      {/* ═══ INPUT — everything handed to the model ═══
          Prompt, lyrics and every upload together, because "where do I put
          my file" was the question this layout kept failing to answer. */}
      <aside className="rp-studio-input rp-scroll" style={{ borderRight: "1px solid rgba(255,255,255,0.06)", padding: 18, display: "flex", flexDirection: "column", gap: 12, background: "rgba(15,23,42,0.18)" }}>


        {/* Prompt — the only element allowed to grow, so it absorbs whatever
            height the viewport has spare and the rail still fits one screen. */}
        <Section label={tab === "lipsync" ? "Prompt (ไม่บังคับ)" : tab === "audio" ? "สไตล์เพลง" : "Prompt"} grow>
          {/* Read-only while ✨ works: its answer replaces the box, and would
              silently drop anything typed in the meantime (Context-IR can take
              a minute). */}
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onSubmitKey}
            readOnly={enhancing} aria-busy={enhancing}
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
            style={{ ...xdrInputStyle, padding: 14, fontSize: 14, lineHeight: 1.5, resize: "none", flex: 1, minHeight: tab === "audio" ? 72 : 96, opacity: enhancing ? 0.6 : 1 }} />
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
          {/* The prompt assistant: short idea in, the model's own format out.
              The result replaces the box's text where the customer can read
              and edit it — and ↶ puts back what they wrote. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={handleEnhance} disabled={enhancing || !prompt.trim()}
              title={tab === "video" && selectedModel?.modelId === "minimax-h3"
                ? "เรียบเรียงเป็นโครงช็อต กล้อง และเสียง ตามรูปแบบที่ MiniMax H3 ถูกฝึกมา"
                : "ให้ AI ขยายไอเดียสั้น ๆ เป็นพรอมต์ที่โมเดลเข้าใจดีที่สุด"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9,
                fontSize: 12, fontFamily: "inherit", fontWeight: 600,
                cursor: enhancing || !prompt.trim() ? "default" : "pointer",
                opacity: !prompt.trim() && !enhancing ? 0.45 : 1,
                background: `linear-gradient(135deg, hsla(${280 + HUE},75%,55%,0.28), hsla(${190 + HUE},80%,50%,0.22))`,
                color: "#f5f3ff", border: `1px solid hsla(${280 + HUE},70%,65%,0.45)`,
              }}>
              <span className={enhancing ? "xdr-motion" : undefined} style={enhancing ? { display: "inline-block", animation: "spin 1.2s linear infinite" } : undefined}>✨</span>
              {enhancing
                ? (tab === "video" && selectedModel?.modelId === "minimax-h3" ? "กำลังเรียบเรียงฉาก… (อาจถึง 1 นาที)" : "กำลังเรียบเรียง…")
                : tab === "audio" ? "ช่วยเขียนสไตล์เพลง" : "ปรับพรอมต์ด้วย AI"}
            </button>
            {promptBeforeEnhance !== null && !enhancing && (
              <button type="button" onClick={undoEnhance}
                style={{ padding: "7px 10px", borderRadius: 9, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", background: "rgba(255,255,255,0.04)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)" }}>
                ↶ ใช้ข้อความเดิม
              </button>
            )}
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#475569" }} title="สั่งสร้างจากช่องพิมพ์ได้เลย">Ctrl/⌘ + Enter = ทอ</span>
          </div>
          {enhanceNote && (
            <div style={{ fontSize: 10.5, color: "#a78bfa", marginTop: 5 }}>✦ {enhanceNote} — แก้ต่อได้ตามใจ</div>
          )}
          {/* Live prompt stats — replaces the right rail's "รายละเอียด prompt"
              card in one line instead of three stacked rows. */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, color: "#64748b", fontFamily: "ui-monospace,monospace" }}>
            <span>{prompt.trim() ? `${prompt.trim().split(/\s+/).length} คำ` : "ยังไม่มี prompt"}</span>
            <span>{prompt.length.toLocaleString()} / 10,000</span>
          </div>
        </Section>

        {tab === "audio" && (
          <>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
              <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value.slice(0, 3000))} onKeyDown={onSubmitKey}
                disabled={instrumental}
                placeholder={"[Verse]\nเขียนเนื้อร้องที่นี่\n\n[Chorus]\nท่อนฮุกที่อยากให้ติดหู"}
                style={{
                  ...xdrInputStyle, marginTop: 6, padding: 12, fontSize: 13, lineHeight: 1.5,
                  resize: "none", flex: 1, minHeight: 260, opacity: instrumental ? 0.45 : 1,
                }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10.5, color: "#64748b" }}>
                <span>{instrumental ? "โหมดบรรเลง — เนื้อร้องที่พิมพ์ไว้จะถูกเก็บไว้เฉย ๆ" : "วงเล็บเหลี่ยมบอกโมเดลว่าเป็นท่อนอะไร"}</span>
                <span style={{ fontFamily: "ui-monospace,monospace" }}>{lyrics.length.toLocaleString()} / 3,000</span>
              </div>

              {/* Exactly what the model will be told, composed by the same
                  function the server uses. Shown because chips whose effect
                  you cannot see are chips you cannot learn to use. */}
              {styleSummary && (
                <div style={{
                  marginTop: 10, padding: "9px 11px", borderRadius: 10,
                  background: "rgba(2,6,23,0.5)", border: "1px solid rgba(255,255,255,0.08)",
                }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#a5f3fc", marginBottom: 5, textTransform: "uppercase" }}>
                    สไตล์ที่ส่งให้ AI
                  </div>
                  <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.55, wordBreak: "break-word" }}>
                    {styleSummary}
                  </div>
                </div>
              )}
          </>
        )}

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

        {/* Start frame on a text-only clip. The upload lives behind the mode
            selector, so on t2v the box is simply absent with nothing saying
            why. Show the affordance and let it flip the mode in one click. */}
        {tab === "video" && videoMode === "t2v" && (
          <Section label="ภาพเริ่มต้น">
            <button type="button" onClick={() => setVideoMode("i2v")}
              style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: 20, borderRadius: 12, border: "1.5px dashed rgba(255,255,255,0.15)", background: "rgba(2,6,23,0.3)", color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "center", lineHeight: 1.5 }}>
              <div style={{ fontSize: 22, marginBottom: 2 }}>↑</div>
              อยากให้คลิปเริ่มจากภาพของคุณ?
              <span style={{ color: `hsl(${220 + HUE},70%,78%)` }}>กดที่นี่เพื่อสลับเป็นโหมด “ภาพ → วิดีโอ”</span>
            </button>
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

        {/* Why the end-frame box is not there. Without this the control just
            vanishes on a model that cannot do first-and-last-frame, which
            reads as a missing feature rather than a model limit. */}
        {tab === "video" && videoMode === "i2v" && selectedModel?.video?.lastFrame !== true && (
          <div style={{ fontSize: 11, lineHeight: 1.6, color: "#64748b", padding: "8px 10px", borderRadius: 8, background: "rgba(2,6,23,0.3)", border: "1px solid rgba(255,255,255,0.06)" }}>
            โมเดลนี้กำหนด<span style={{ color: "#94a3b8" }}>ภาพสุดท้าย</span>ของคลิปไม่ได้ — ถ้าต้องการ ให้เลือกโมเดลที่รองรับ first-and-last-frame
          </div>
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
              onClear={() => { setInputAudio(null); setInputAudioName(null); setInputAudioFile(null); }}
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
            {/* `coverSourceSeconds` is what a cover may start *from* — a
                different number from what the model may sing, and set by the
                12 MB upload cap rather than by the model. Floored, not
                rounded: the cap is 5 min 30 s and `Math.round` advertised
                "6 นาที", which is an invitation to pick a file the uploader
                then rejects. Under-promise on a limit. */}
            <FilePick
              value={inputAudioName}
              busy={uploading === "audio"}
              accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,audio/x-m4a"
              hint={`อัปโหลดเพลง MP3 (ไม่เกิน ${Math.floor(coverSourceSeconds / 60)} นาที, 12 MB)`}
              onPick={(e) => handleMediaUpload(e, "audio", coverSourceSeconds)}
              onClear={() => { setInputAudio(null); setInputAudioName(null); setInputAudioFile(null); }}
            />
            {inputAudioFile && (
              <div style={{ marginTop: 10 }}>
                {/* Keyed on the file itself: picking another track remounts
                    the player rather than leaving the old waveform up. */}
                <AudioWave
                  key={`${inputAudioFile.name}:${inputAudioFile.size}:${inputAudioFile.lastModified}`}
                  source={inputAudioFile}
                  height={64}
                />
              </div>
            )}
            <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
              AI ถอดเฉพาะ<strong style={{ color: "#94a3b8" }}>ทำนอง</strong>ออกมาแล้วร้องใหม่ทั้งเพลง — เสียงร้องเดิมไม่ได้ถูกนำมาใช้
              ถ้าอยากได้คำร้องเดิม ให้พิมพ์ลงช่องเนื้อเพลง · WAV/FLAC ทั้งเพลงมักเกิน 12 MB ให้แปลงเป็น MP3 ก่อน
            </div>
          </Section>
        )}
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
              onClick={() => { if (cannotSubmit) return; handleGenerate({ seed: Math.floor(Math.random() * 2_147_483_647) }); }}>Variations</Pill>
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

        {/* The order tray: every order placed from this page, newest first.
            Orders render side by side (up to MAX_PARALLEL_JOBS); the canvas
            shows the one picked here. */}
        {jobs.length > 0 && (
          <div className="rp-tray" role="list" aria-label="งานที่สั่ง">
            {jobs.map((j) => {
              const on = j.id === focusId;
              const fraction = j.status === "running" && j.progress?.stage === "rendering" ? shownFraction(j.progress, j.progress.at) : null;
              const thumb = j.result?.thumbnailUrl || j.result?.resultUrl;
              const isAudio = j.tab === "audio" || AUDIO_EXT.test(thumb ?? "");
              const isVideoThumb = !isAudio && (j.tab === "video" || j.tab === "lipsync" || /\.(mp4|webm|mov)(\?|$)/i.test(thumb ?? ""));
              return (
                <button key={j.id} type="button" role="listitem" onClick={() => focusJob(j)} title={j.prompt || "งานลิปซิงค์"}
                  className="rp-tray-item" data-active={on ? "true" : "false"} data-status={j.status}>
                  <span className="rp-tray-thumb">
                    {j.status === "completed" && thumb && !isAudio ? (
                      isVideoThumb ? (
                        <video src={`${thumb}#t=0.1`} muted playsInline preload="metadata" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" loading="lazy" />
                      )
                    ) : j.status === "completed" && isAudio ? (
                      <span style={{ fontSize: 16 }}>♫</span>
                    ) : j.status === "failed" ? (
                      <span style={{ color: "#fca5a5", fontWeight: 700 }}>!</span>
                    ) : (
                      <span className="rp-tray-spin" aria-hidden="true" />
                    )}
                  </span>
                  <span className="rp-tray-text">
                    <span className="rp-tray-prompt">{j.prompt || "ลิปซิงค์"}</span>
                    <span className="rp-tray-state">
                      {j.status === "completed" ? "เสร็จแล้ว"
                        : j.status === "failed" ? "ไม่สำเร็จ · คืนเครดิต"
                          : j.id < 0 ? "กำลังส่ง…"
                            : j.progress?.stage === "queued" && (j.progress.position ?? 0) > 0 ? `รอคิว ${j.progress.position}`
                              : fraction != null ? `กำลังสร้าง ${Math.floor(fraction * 100)}%` : "กำลังสร้าง…"}
                    </span>
                  </span>
                </button>
              );
            })}
            {jobs.some((j) => j.status !== "running") && (
              <button type="button" className="rp-tray-clear"
                onClick={() => setJobs((js) => js.filter((j) => j.status === "running" || j.id === focusId))}>
                ล้างที่เสร็จแล้ว
              </button>
            )}
          </div>
        )}

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
              <div style={{ width: `min(100%, calc(${GENERATING_FRAME_MAX_H} * ${aspectNumber(canvasAspect)}))`, margin: "0 auto" }}>
                {canvasTab === "image" && tab === "image" && outputs > 1 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
                    {Array.from({ length: outputs }).map((_, i) => (
                      <StudioFrame key={i} index={i} seed={(i + 1) * 0.137} aspect={canvasAspect} generating={true} progress={progress} />
                    ))}
                  </div>
                ) : (
                  <StudioFrame index={0} seed={0.42} aspect={canvasAspect} generating={true} progress={progress} />
                )}
              </div>
              <GeneratingStatus progress={progress} tab={canvasTab} startedAt={genStartedAt} />
              {runningJobs < MAX_PARALLEL_JOBS && (
                <div style={{ textAlign: "center", fontSize: 11, color: "rgba(165,243,252,0.6)", marginTop: 8 }}>
                  สั่งงานถัดไปต่อได้เลย — ระบบทำพร้อมกันได้ {MAX_PARALLEL_JOBS} งาน
                </div>
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
                  {refImagePreview && tab === "image" && !viewing ? (
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
                    <AudioResult src={result.resultUrl} title={songTitle || "เพลงของคุณ"} genId={result.id} />
                  ) : resultIsVideo ? (
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
                  {resultIsImage && (
                    <Pill onClick={handleUpscale}>{isUpscaling ? "⟳ Upscaling..." : "⤢ Upscale"}</Pill>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {viewing && <Pill onClick={() => remixFrom(viewing)}>↺ ใช้การตั้งค่านี้</Pill>}
                  <Pill onClick={clearCanvas}>↻ สร้างใหม่</Pill>
                </div>
              </div>

              {/* The next step for a finished picture — the chain a creator
                  actually follows: still → clip, still → edit, still → the
                  reference for the next still. */}
              {resultIsImage && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>ใช้ภาพนี้ต่อ:</span>
                  <Pill onClick={() => carryResultTo("video", result.resultUrl as string)}
                    disabled={tabBlockedReason("video") !== null} title={tabBlockedReason("video") ?? "เปิดแท็บวิดีโอ ใส่ภาพนี้เป็นเฟรมแรก"}>▶ ทำเป็นวิดีโอ</Pill>
                  <Pill onClick={() => carryResultTo("edit", result.resultUrl as string)}
                    disabled={tabBlockedReason("edit") !== null} title={tabBlockedReason("edit") ?? "เปิดแท็บแก้ไขภาพ"}>✦ แก้ไขภาพนี้</Pill>
                  <Pill onClick={() => carryResultTo("ref", result.resultUrl as string)} title="สร้างภาพใหม่โดยอ้างอิงภาพนี้">⎘ ใช้เป็นภาพอ้างอิง</Pill>
                </div>
              )}

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
              <p style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", marginBottom: 18 }}>{result.error ? localizeOrderError(result.error) : "เกิดข้อผิดพลาด"}</p>
              <button onClick={clearCanvas}
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
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" }}>· รุ่นก่อนหน้า (history)</div>
              <a href="/gallery" style={{ fontSize: 11, color: "#a5f3fc", textDecoration: "none", letterSpacing: "0.05em" }}>ดูทั้งหมด →</a>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))", gap: 8 }}>
              {history.slice(0, 16).map((g) => {
                const src = g.thumbnailUrl || g.resultUrl;
                const isVideo = g.type === "video" || g.resultUrl?.endsWith(".mp4");
                // A provider that hands back a real poster image keeps <img>.
                const srcIsVideo = isVideo && !/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(src ?? "");
                // A song has nothing to draw; it gets a note on its own colour.
                const isAudio = g.type === "audio" || AUDIO_EXT.test(src ?? "");
                return (
                  <button key={g.id} type="button" title={`${g.prompt}\n— กดเพื่อดู แล้วใช้การตั้งค่าเดิมสร้างใหม่ได้`}
                    // Opens the piece on the canvas; "↺ ใช้การตั้งค่านี้" there
                    // puts the whole order back (model, shape, length…).
                    onClick={() => viewHistory(g)}
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

      {/* ═══ SETTINGS — the knobs, and the button that spends them ═══ */}
      <aside className="rp-studio-set rp-scroll" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", padding: 18, display: "flex", flexDirection: "column", gap: 12, background: "rgba(15,23,42,0.25)" }}>


        {/* ── Compact control deck ─────────────────────────────────────
            Everything below is one-line triggers. Each opens upward so a
            panel near the bottom of the rail never pushes the layout. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {/* Prompt builder. Pictures get their vocabulary as comma-joined
              phrases; clips get camera and shot direction as sentences (the
              form video models read it in); songs keep their tag chips. */}
          <Popover id="tags" open={openPanel} onToggle={setOpenPanel}
            label={tab === "audio" ? "+ แท็ก" : tab === "video" || tab === "lipsync" ? "🎥 กล้องและฉาก" : "✦ ตัวช่วยพรอมต์"}
            // No wider than the settings column: the rail scrolls, so a panel
            // that overhangs its box is clipped rather than drawn over the canvas.
            width={286}>
            {tab === "audio" ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MUSIC_TAG_CHIPS.map((t) => {
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
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(tab === "video" || tab === "lipsync" ? VIDEO_BUILDER : IMAGE_BUILDER).map((group) => (
                  <div key={group.label}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "#a5f3fc", marginBottom: 6 }}>{group.label}</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {group.items.map((item) => {
                        const already = prompt.toLowerCase().includes(item.en.toLowerCase());
                        const sentence = tab === "video" || tab === "lipsync";
                        return (
                          <button key={item.en} type="button" title={item.en}
                            onClick={() => (sentence ? addPromptSentence(item.en) : addPromptTag(item.en))}
                            style={{
                              padding: "5px 9px", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                              background: already ? `hsla(${220 + HUE},60%,50%,0.18)` : "rgba(255,255,255,0.05)",
                              color: already ? "#a5f3fc" : "#cbd5e1",
                              border: already ? `1px solid hsla(${220 + HUE},70%,60%,0.4)` : "1px solid rgba(255,255,255,0.1)",
                            }}>{already ? "✓ " : "+ "}{item.th}</button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 10.5, color: "#64748b", lineHeight: 1.5 }}>
                  ชี้ที่ปุ่มเพื่อดูข้อความภาษาอังกฤษที่จะเติมลงพรอมต์ · โมเดลส่วนใหญ่อ่านคำศัพท์ภาพยนตร์/ถ่ายภาพภาษาอังกฤษได้แม่นที่สุด
                </div>
              </div>
            )}
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

          {/* Quality modes — only where the model offers a real choice (Qwen-
              Image: Lightning vs the full model). Each carries its price
              multiplier, and the button's total already includes it. */}
          {qualityModes && qualityModes.length > 1 && (
            <Popover id="quality" open={openPanel} onToggle={setOpenPanel} label="คุณภาพ"
              value={activeQuality?.label ?? "—"} width={290}>
              <div style={{ display: "grid", gap: 6 }}>
                {qualityModes.map((m) => {
                  const on = activeQuality?.id === m.id;
                  return (
                    <button key={m.id} type="button" onClick={() => { setQualityId(m.id); setOpenPanel(null); }}
                      style={{
                        textAlign: "left", padding: "9px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                        background: on ? `hsla(${220 + HUE},60%,50%,0.25)` : "rgba(255,255,255,0.04)",
                        color: on ? "#fff" : "#94a3b8",
                        border: on ? `1px solid hsla(${220 + HUE},70%,60%,0.5)` : "1px solid rgba(255,255,255,0.08)",
                      }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
                        <span>{m.label}{m.adminOnly ? " · ทดลอง (เห็นเฉพาะแอดมิน)" : ""}</span>
                        <span style={{ color: "#fbbf24", fontSize: 11, whiteSpace: "nowrap" }}>
                          {m.creditsMultiplier === 1 ? "ราคาปกติ" : `×${m.creditsMultiplier} เครดิต`}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.85, marginTop: 3, lineHeight: 1.45 }}>{m.description}</div>
                    </button>
                  );
                })}
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
              20s option on a model that tops out at 5 just buys a failed job.
              Hidden entirely on a model that decides its own length: there the
              number was never a length anyone received, only the point at which
              the song got cut off. */}
          {(tab === "video" || (tab === "audio" && !musicOpts?.autoLength)) && (
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

          {/* ── Song direction ─────────────────────────────────────────────
              Three panels rather than one: the official YuE2 template asks for
              language, genre, vocal, tempo, instruments and mood, which is far
              more than fits one popover, and they are chosen at different
              moments — the genre first, the voice next, the arrangement last.
              Every chip here ends up in the model's `[Tags]` line; the two
              sliders do not, they are real node inputs. */}
          {musicOpts?.controls && (
            <Popover id="genre" open={openPanel} onToggle={setOpenPanel} label="แนวเพลง"
              value={MUSIC_GENRES.find((g) => g.id === musicStyle.genre)?.label ?? "อิสระ"} width={320}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <ChipRow label="แนวเพลง" options={MUSIC_GENRES} value={musicStyle.genre}
                  onChange={(v) => setMusicField("genre", v as string | undefined)}
                  hint="กดซ้ำเพื่อยกเลิก" />
                <ChipRow label="ภาษาที่ร้อง" options={MUSIC_LANGUAGES} value={musicStyle.language}
                  disabled={instrumental}
                  onChange={(v) => setMusicField("language", v as string | undefined)} />
                <ChipRow label="อารมณ์" options={MUSIC_MOODS} value={musicStyle.moods ?? []} max={3}
                  onChange={(v) => setMusicField("moods", v as string[] | undefined)}
                  hint={`เลือกได้ ${musicStyle.moods?.length ?? 0}/3`} />
              </div>
            </Popover>
          )}

          {musicOpts?.controls && (
            <Popover id="voice" open={openPanel} onToggle={setOpenPanel} label="เสียงร้อง"
              value={instrumental ? "บรรเลง" : MUSIC_VOCALS.find((v) => v.id === musicStyle.vocal)?.label ?? "อิสระ"}
              width={300}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {instrumental && (
                  <div style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.5 }}>
                    เปิดโหมดเพลงบรรเลงอยู่ — ตัวเลือกเสียงร้องถูกปิดไว้ ปลดได้ที่ช่องเนื้อเพลง
                  </div>
                )}
                <ChipRow label="ผู้ร้อง" options={MUSIC_VOCALS} value={musicStyle.vocal} disabled={instrumental}
                  onChange={(v) => setMusicField("vocal", v as string | undefined)} />
                <ChipRow label="ช่วงวัย" options={MUSIC_AGES} value={musicStyle.age} disabled={instrumental}
                  onChange={(v) => setMusicField("age", v as string | undefined)} />
                <ChipRow label="ลักษณะเสียง" options={MUSIC_TIMBRES} value={musicStyle.timbre} disabled={instrumental}
                  onChange={(v) => setMusicField("timbre", v as string | undefined)} />
              </div>
            </Popover>
          )}

          {musicOpts?.controls && (
            <Popover id="arrange" open={openPanel} onToggle={setOpenPanel} label="ดนตรี"
              value={musicComplexity(musicStyle.complexity).label} width={320} align="right">
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <ChipRow label="เครื่องดนตรี" options={MUSIC_INSTRUMENTS} value={musicStyle.instruments ?? []} max={6}
                  onChange={(v) => setMusicField("instruments", v as string[] | undefined)}
                  hint={`เลือกได้ ${musicStyle.instruments?.length ?? 0}/6`} />

                {/* Tempo is off by default: an unasked-for BPM is a constraint
                    the model did not need, and a wrong one fights the lyrics. */}
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#94a3b8", marginBottom: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={musicStyle.bpm !== undefined}
                      onChange={(e) => setMusicField("bpm", e.target.checked ? 100 : undefined)} />
                    กำหนดจังหวะเอง {musicStyle.bpm === undefined && <span style={{ color: "#64748b" }}>(ปล่อยให้ AI เลือก)</span>}
                  </label>
                  {musicStyle.bpm !== undefined && (
                    <StyleSlider label="จังหวะ" value={musicStyle.bpm} min={MUSIC_BPM_MIN} max={MUSIC_BPM_MAX} step={2}
                      format={(v) => `${v} BPM`} onChange={(v) => setMusicField("bpm", v)} />
                  )}
                </div>

                {/* Real node inputs, not tags: density picks YuE2's `mode`
                    (chord-annotated score vs melody only) and variety is its
                    sampling temperature. */}
                <StyleSlider label="ความซับซ้อนของดนตรี" value={musicStyle.complexity ?? MUSIC_COMPLEXITY_DEFAULT}
                  min={1} max={5} step={1}
                  format={(v) => musicComplexity(v).label}
                  onChange={(v) => setMusicField("complexity", v)} />

                <StyleSlider label="ความแปลกใหม่" value={musicStyle.variance ?? MUSIC_VARIANCE_DEFAULT}
                  min={MUSIC_VARIANCE_MIN} max={MUSIC_VARIANCE_MAX} step={0.05}
                  format={(v) => (v < 0.85 ? `ปลอดภัย ${v.toFixed(2)}` : v > 1.15 ? `กล้าเสี่ยง ${v.toFixed(2)}` : `สมดุล ${v.toFixed(2)}`)}
                  onChange={(v) => setMusicField("variance", v)} />

                <button type="button"
                  onClick={() => setMusicStyle({ complexity: MUSIC_COMPLEXITY_DEFAULT, variance: MUSIC_VARIANCE_DEFAULT })}
                  style={{
                    padding: "7px 0", borderRadius: 8, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer",
                    background: "rgba(255,255,255,0.04)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)",
                  }}>
                  ล้างตัวเลือกทั้งหมด
                </button>
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
          <Popover id="ref" open={openPanel} onToggle={setOpenPanel} label="↑ ภาพอ้างอิง"
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
                "พิมพ์ไอเดียสั้น ๆ แล้วกด ✨ ปรับพรอมต์ด้วย AI — ระบบเรียบเรียงให้ตรงรูปแบบที่โมเดลนั้นเข้าใจดีที่สุด แก้ต่อได้ก่อนสั่ง",
                tab === "video"
                  ? "ปุ่ม 🎥 กล้องและฉาก เติมการเคลื่อนกล้อง ขนาดภาพ และแสงเป็นประโยคที่โมเดลวิดีโออ่านเข้าใจ"
                  : "ปุ่ม ✦ ตัวช่วยพรอมต์ เติมคำศัพท์ช่างภาพ: สไตล์ แสง เลนส์ สี",
                "วางภาพ (Ctrl+V) หรือลากไฟล์มาวางตรงไหนก็ได้ ระบบใส่ให้ในช่องที่แท็บนี้ใช้",
                "สั่งต่อกันได้ถึง 3 งานพร้อมกัน ดูทุกงานที่แถบเหนือแคนวาส · Ctrl/⌘+Enter = ทอ",
                "ได้ภาพที่ชอบแล้ว กด ▶ ทำเป็นวิดีโอ เพื่อใช้เป็นเฟรมแรกของคลิปได้ทันที",
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

        {/* Said before the order, not after the server refuses it. The
            server stays the judge — a balance topped up in another tab is
            read fresh there — so the button is not locked by this. */}
        {shortOfCredits && (
          <div style={{
            marginTop: "auto", padding: "10px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.5,
            background: "rgba(248,113,113,0.1)", color: "#fca5a5", border: "1px solid rgba(248,113,113,0.28)",
          }}>
            เครดิตไม่พอสำหรับงานนี้ — ต้องใช้ {totalCredits.toLocaleString()} มีอยู่ {creditBalance.toLocaleString()}{" "}
            <a href="/pricing" style={{ color: "#fecaca", fontWeight: 600, whiteSpace: "nowrap" }}>เติมเครดิต →</a>
          </div>
        )}

        {/* Generate Button. It no longer locks while a render runs: orders
            queue side by side in the tray, up to MAX_PARALLEL_JOBS. */}
        <button onClick={() => handleGenerate()}
          disabled={cannotSubmit}
          style={{
            marginTop: shortOfCredits ? 0 : "auto", padding: 16, borderRadius: 12,
            background: `linear-gradient(135deg, hsl(${160 + HUE},70%,45%), hsl(${280 + HUE},70%,55%))`,
            color: "#fff", border: "none", fontSize: 15, fontWeight: 600,
            cursor: cannotSubmit ? "not-allowed" : "pointer",
            opacity: cannotSubmit ? 0.6 : 1,
            boxShadow: `0 10px 24px -8px hsla(${270 + HUE},70%,50%,0.55)`,
          }}>
          {runningJobs >= MAX_PARALLEL_JOBS ? (
            `⟳ กำลังสร้าง ${runningJobs} งาน — รอให้เสร็จก่อน`
          ) : (
            <>
              ทอ ✦ {outputs > 1 ? `${outputs} ภาพ · ` : ""}{totalCredits || "—"} credits
              {runningJobs > 0 && <span style={{ display: "block", fontSize: 11, fontWeight: 500, opacity: 0.85, marginTop: 2 }}>กำลังสร้างอยู่ {runningJobs} งาน · สั่งเพิ่มได้</span>}
            </>
          )}
        </button>
      </aside>

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
          grid-template-columns: 220px 380px minmax(0, 1fr) 300px;
          height: calc(100dvh - 80px);
          overflow: hidden;
        }
        .rp-studio-jobs,
        .rp-studio-input,
        .rp-studio-set {
          min-height: 0;
          overflow-y: auto;
        }
        /* Flex items shrink by default, so on a short window every control
           squashed below its own height — a 20px-tall Generate button rather
           than a scrollbar. Pin them, and let the prompt (which carries an
           inline flex:1, and inline wins over this rule) be the only thing
           that gives. Past its min-height the rail scrolls instead. */
        .rp-studio-jobs > *,
        .rp-studio-input > *,
        .rp-studio-set > * { flex-shrink: 0; }
        /* Tab artwork. The images are all equally bright, so the unselected
           ones are held back and the chosen one lit, rather than relying on
           the art to say which is active. */
        .rp-tab-art {
          display: block;
          width: 100%;
          padding: 0;
          border: none;
          background: transparent;
          border-radius: 10px;
          line-height: 0;
          cursor: pointer;
          filter: saturate(0.7) brightness(0.62);
          transition: filter 220ms ease, transform 220ms ease;
        }
        .rp-tab-art :global(img) { width: 100%; height: auto; display: block; }
        .rp-tab-art:hover:not(:disabled) {
          filter: saturate(1.1) brightness(1.08) drop-shadow(0 0 13px hsla(190,90%,60%,0.5));
          transform: translateY(-1px);
        }
        .rp-tab-art[data-active="true"] {
          filter: saturate(1.15) brightness(1.15) drop-shadow(0 0 16px hsla(280,90%,65%,0.55));
        }
        .rp-tab-art:disabled {
          filter: grayscale(0.75) brightness(0.4);
          cursor: not-allowed;
        }
        /* The stand-in plate: same proportions and neon edge as the artwork. */
        .rp-tab-plate {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          aspect-ratio: 3 / 1;
          padding: 0 12px;
          border-radius: 12px;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          color: #e8eaf6;
          border: 1.5px solid transparent;
          background:
            linear-gradient(rgba(2,6,23,0.92), rgba(2,6,23,0.92)) padding-box,
            linear-gradient(120deg, hsl(280,85%,62%), hsl(190,90%,58%), hsl(160,80%,55%)) border-box;
          filter: saturate(0.7) brightness(0.62);
          transition: filter 220ms ease, transform 220ms ease;
        }
        .rp-tab-plate-icon { font-size: 22px; opacity: 0.9; flex-shrink: 0; }
        .rp-tab-plate-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
        .rp-tab-plate-th { font-size: 15px; font-weight: 600; }
        .rp-tab-plate-en { font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.65; }
        .rp-tab-plate-go { font-size: 18px; opacity: 0.75; flex-shrink: 0; }
        .rp-tab-plate:hover:not(:disabled) {
          filter: saturate(1.1) brightness(1.08) drop-shadow(0 0 13px hsla(190,90%,60%,0.5));
          transform: translateY(-1px);
        }
        .rp-tab-plate[data-active="true"] {
          filter: saturate(1.15) brightness(1.15) drop-shadow(0 0 16px hsla(280,90%,65%,0.55));
        }
        .rp-tab-plate:disabled { filter: grayscale(0.75) brightness(0.4); cursor: not-allowed; }
        @media (prefers-reduced-motion: reduce) {
          .rp-tab-art, .rp-tab-plate { transition: none; }
          .rp-tab-art:hover:not(:disabled), .rp-tab-plate:hover:not(:disabled) { transform: none; }
        }
        .rp-studio-center {
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        /* Order tray — one row, scrolls sideways rather than pushing the
           canvas down when there are many. */
        .rp-tray {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 6px;
          margin-bottom: 12px;
          flex-shrink: 0;
          scrollbar-width: thin;
        }
        .rp-tray-item {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 168px;
          max-width: 220px;
          padding: 6px 10px 6px 6px;
          border-radius: 11px;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          color: #e2e8f0;
          background: rgba(15,23,42,0.55);
          border: 1px solid rgba(255,255,255,0.08);
          transition: border-color 160ms ease, background 160ms ease;
        }
        .rp-tray-item:hover { background: rgba(30,41,59,0.7); }
        .rp-tray-item[data-active="true"] {
          border-color: hsla(290,80%,65%,0.6);
          background: hsla(260,60%,30%,0.35);
        }
        .rp-tray-item[data-status="failed"] { border-color: rgba(248,113,113,0.35); }
        .rp-tray-thumb {
          width: 38px;
          height: 38px;
          border-radius: 8px;
          flex-shrink: 0;
          overflow: hidden;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, hsl(250,45%,18%), hsl(200,45%,12%));
        }
        .rp-tray-thumb :global(img),
        .rp-tray-thumb :global(video) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          pointer-events: none;
        }
        .rp-tray-spin {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2px solid rgba(165,243,252,0.25);
          border-top-color: #a5f3fc;
          animation: spin 900ms linear infinite;
        }
        .rp-tray-text { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
        .rp-tray-prompt {
          font-size: 11.5px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rp-tray-state { font-size: 10.5px; color: #94a3b8; }
        .rp-tray-item[data-status="completed"] .rp-tray-state { color: #34d399; }
        .rp-tray-item[data-status="failed"] .rp-tray-state { color: #fca5a5; }
        .rp-tray-clear {
          flex-shrink: 0;
          padding: 0 12px;
          border-radius: 11px;
          font-size: 11px;
          font-family: inherit;
          cursor: pointer;
          color: #94a3b8;
          background: transparent;
          border: 1px dashed rgba(255,255,255,0.14);
        }
        /* Drop target over the whole studio while a file is dragged in. */
        .rp-drop-hint {
          position: fixed;
          inset: 12px;
          z-index: 60;
          display: grid;
          place-items: center;
          text-align: center;
          font-size: 16px;
          font-weight: 600;
          color: #e0f2fe;
          border-radius: 20px;
          border: 2px dashed hsla(190,90%,65%,0.7);
          background: rgba(3,6,18,0.72);
          backdrop-filter: blur(4px);
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .rp-tray-spin { animation: none; }
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
        /* Four columns need ~1500px before the canvas — the whole point of the
           page — starts losing. Measured at 1272px: chrome took 820px and the
           result was left 452px, a third of the display. Below that the two
           input-side columns stack into one instead, which buys the canvas
           about 200px back and keeps it above half the width. */
        @media (max-width: 1500px) {
          .rp-studio {
            grid-template-columns: 340px minmax(0, 1fr) 270px;
            grid-template-rows: auto minmax(0, 1fr);
          }
          .rp-studio-jobs {
            grid-column: 1;
            grid-row: 1;
            border-bottom: 1px solid rgba(255,255,255,0.06);
          }
          .rp-studio-input { grid-column: 1; grid-row: 2; }
          .rp-studio-center { grid-column: 2; grid-row: 1 / -1; }
          .rp-studio-set { grid-column: 3; grid-row: 1 / -1; }
        }
        @media (max-width: 1180px) {
          /* Below this the four-column workspace stops being usable — let the
             page breathe and scroll normally instead of squeezing every rail.
             It stacks earlier than the old two-pane layout did, because four
             columns run out of room sooner. */
          .rp-studio {
            grid-template-columns: 1fr;
            grid-template-rows: none;
            height: auto;
            overflow: visible;
          }
          .rp-studio-jobs,
          .rp-studio-input,
          .rp-studio-center,
          .rp-studio-set { grid-column: auto; grid-row: auto; }
          .rp-studio-jobs,
          .rp-studio-input,
          .rp-studio-set {
            overflow: visible;
            border-right: none !important;
            border-left: none !important;
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
