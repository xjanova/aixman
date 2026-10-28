"use client";

/**
 * /generate — AI image/video/edit/lip-sync/music studio (X-DREAMER themed)
 *
 * Two parts on one screen, plus a floating orb:
 *   composer: numbered sections (model, prompt, the files the mode takes,
 *             settings) and the order bar — balance, price, the button
 *   stage   : the order tray, the canvas, and a row of the latest pieces
 *   orb     : the mode menu (ModeOrb), above every layout, draggable
 *
 * Below 1100 px the two parts stack, the page scrolls, and the order bar is
 * fixed to the bottom of the screen.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/components/ui/toast-provider";
import { creditsForDuration } from "@/lib/pricing";
import { voiceRenderSeconds } from "@/lib/voice-length";
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
import { loadAudio } from "@/components/xdreamer/audio-wave";
import { AudioTrimmer, coversWhole, cutAudio, initialTrim, trimKey, type TrimRange } from "@/components/xdreamer/audio-trim";
import { ModeOrb, type OrbItem } from "@/components/xdreamer/mode-orb";
import { NO_ORDER_INPUTS, type OrderInputs } from "@/lib/order-inputs";
import { loginHref } from "@/lib/safe-callback";
import { checkClip, checkVoice, lipsyncCredits, type ClipFacts } from "@/lib/lipsync-rules";
import { MAX_BYTES } from "@/lib/uploads";
import {
  composeReferencePrompt,
  defaultRole,
  nextRole,
  referenceToken,
  roleLabel,
  splitReferencePrompt,
  type ReferenceRole,
} from "@/lib/studio-references";

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
 * Largest audio file decoded in the page to be drawn and cut. A decoded track
 * is float samples at the device's rate — a few minutes is a hundred MB or
 * more — so anything past this goes up whole.
 */
const DECODE_LIMIT_BYTES = 80 * 1024 * 1024;

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

/** What the voice and song pickers take. */
const AUDIO_ACCEPT = "audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,audio/x-m4a";

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
  model?: { name?: string; subcategory?: string | null };
  createdAt: string;
}

/**
 * One reference picture of an image order: its R2 URL once uploaded (null
 * while the upload runs) and what it shows, which goes into the prompt.
 */
interface RefPic {
  id: number;
  url: string | null;
  role: ReferenceRole;
}

/**
 * A voice or song picked from disk, decoded so it can be drawn and cut. Only a
 * file read in this tab has one: R2 sends no CORS header, so a track put back
 * from a past order can be played but never read.
 */
interface TrimSource {
  file: File;
  buffer: AudioBuffer;
}

/**
 * Everything a history item puts over the form, kept so "↶" can give the
 * customer back what they were writing before they opened it.
 */
interface FormSnapshot {
  tab: TabType;
  modelId: number | null;
  prompt: string;
  negativePrompt: string;
  lyrics: string;
  aspectRatio: string;
  duration: number;
  resolution: string | null;
  qualityId: string | null;
  numOutputs: number;
  strength: number;
  steps: number;
  guidance: number;
  musicStyle: MusicStyleParams;
  instrumental: boolean;
  videoMode: "t2v" | "i2v";
  refs: RefPic[];
  trimSrc: TrimSource | null;
  trimSel: TrimRange | null;
  trimUploaded: string | null;
  inputImage: string | null;
  inputImagePreview: string | null;
  inputImageEnd: string | null;
  inputAudio: string | null;
  inputAudioName: string | null;
  inputAudioFile: File | null;
  sourceVideo: string | null;
  sourceVideoName: string | null;
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
    <button type="button" className="rp-pill" data-on={active ? "true" : "false"} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/** One numbered section of the composer: "01 โมเดล", with an optional note on the right. */
function Field({ no, label, aside, children }: { no: string; label: string; aside?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="rp-lbl"><i>{no}</i>{label}{aside && <span>{aside}</span>}</div>
      {children}
    </div>
  );
}

/** "01", "02" … — sections are numbered as they are drawn. */
function sectionNo(n: number): string {
  return String(n).padStart(2, "0");
}

/** The motes rising through the fountain behind the studio. Fixed, so every render agrees. */
const MOTES: { left: string; dur: string; delay: string; tone: "c" | "v" | "p" }[] = [
  { left: "8%", dur: "19s", delay: "-3s", tone: "c" },
  { left: "21%", dur: "24s", delay: "-11s", tone: "v" },
  { left: "34%", dur: "17s", delay: "-6s", tone: "c" },
  { left: "47%", dur: "27s", delay: "-15s", tone: "p" },
  { left: "58%", dur: "21s", delay: "-2s", tone: "v" },
  { left: "66%", dur: "18s", delay: "-9s", tone: "c" },
  { left: "75%", dur: "25s", delay: "-19s", tone: "v" },
  { left: "86%", dur: "20s", delay: "-5s", tone: "c" },
  { left: "94%", dur: "23s", delay: "-13s", tone: "p" },
];

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
/** What a re-dub model takes, as one line under the clip picker. */
function clipRuleHint(
  rule: { minSeconds?: number; maxSeconds: number; minSide?: number; maxSide?: number; containers?: string[] } | undefined,
  billing: { kind: "flat" } | { kind: "clipBlocks"; blockSeconds: number } | null,
): string {
  if (!rule) return `คลิปยาวไม่เกิน ${MAX_INPUT_SECONDS} วินาที`;
  const parts = [rule.minSeconds ? `คลิปยาว ${rule.minSeconds}–${rule.maxSeconds} วินาที` : `คลิปยาวไม่เกิน ${rule.maxSeconds} วินาที`];
  if (rule.minSide && rule.maxSide) parts.push(`ความละเอียดด้านละ ${rule.minSide}–${rule.maxSide} พิกเซล`);
  if (rule.containers?.length) parts.push("ไฟล์ MP4 หรือ MOV");
  if (billing?.kind === "clipBlocks") parts.push(`คิดเครดิตตามความยาวคลิป ช่วงละ ${billing.blockSeconds} วินาที`);
  return parts.join(" · ");
}

async function uploadMedia(
  file: File,
  kind: "audio" | "video" | "image",
): Promise<{ url?: string; error?: string; durationSeconds?: number; width?: number; height?: number; contentType?: string }> {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/uploads?kind=${kind}`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "ลองใหม่อีกครั้ง" };
    if (typeof data.url !== "string") return { error: "เซิร์ฟเวอร์ไม่ได้ส่งลิงก์ไฟล์กลับมา" };
    // The server's own reading of the file — the one an order is priced by.
    const seconds = typeof data.durationSeconds === "number" && data.durationSeconds > 0 ? data.durationSeconds : undefined;
    // A clip's picture, read the way the order path reads it.
    const size = (n: unknown) => (typeof n === "number" && n > 0 ? n : undefined);
    return {
      url: data.url,
      durationSeconds: seconds,
      width: size(data.width),
      height: size(data.height),
      contentType: typeof data.contentType === "string" ? data.contentType : undefined,
    };
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
    // 3D models live in their own studio (/generate/3d): this canvas draws
    // pictures and clips, and a GLB opened here would be a broken image.
    return (data.data ?? []).filter((g: HistoryItem) => g.type !== "model3d" && (g.resultUrl || g.thumbnailUrl));
  } catch {
    return null;
  }
}

/** The uploads a past order was made from, or null when they could not be read. */
async function fetchOrderInputs(generationId: number): Promise<OrderInputs | null> {
  try {
    const res = await fetch(`/api/gallery/${generationId}/inputs`);
    if (!res.ok) return null;
    const data = await res.json();
    const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
    return {
      inputImage: text(data.inputImage),
      inputImageEnd: text(data.inputImageEnd),
      inputAudio: text(data.inputAudio),
      inputVideo: text(data.inputVideo),
      referenceImages: Array.isArray(data.referenceImages)
        ? data.referenceImages.filter((u: unknown): u is string => typeof u === "string" && u !== "")
        : [],
    };
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
      <div className="rp-drop" data-busy="true" role="status">
        <span className="rp-spin" aria-hidden="true" />
        กำลังอัปโหลด…
      </div>
    );
  }

  if (value) {
    return (
      <div className="rp-filechip">
        <span className="rp-filechip-ic" aria-hidden="true">✓</span>
        <span className="rp-filechip-name">{value}</span>
        <button type="button" onClick={onClear} aria-label="เอาไฟล์ออก">×</button>
      </div>
    );
  }

  return (
    <label className="rp-drop">
      <span className="rp-drop-ic" aria-hidden="true">↑</span>
      {hint}
      <small>หรือลากไฟล์มาวางตรงไหนก็ได้</small>
      <input type="file" accept={accept} hidden onChange={onPick} />
    </label>
  );
}

/**
 * A picture slot: the picture with × once it is there, else a drop zone. The
 * pictures are the customer's own or a URL of ours, so a plain <img>.
 */
function ImageSlot({
  src, alt, hint, accept, busy = false, onPick, onClear, onLoad, onError,
}: {
  src: string | null;
  alt: string;
  hint: string;
  accept: string;
  busy?: boolean;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onLoad?: (img: HTMLImageElement) => void;
  onError?: () => void;
}) {
  if (busy) {
    return (
      <div className="rp-drop" data-busy="true" role="status">
        <span className="rp-spin" aria-hidden="true" />
        กำลังอัปโหลด…
      </div>
    );
  }
  if (src) {
    return (
      <div className="rp-pic">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} onLoad={onLoad ? (e) => onLoad(e.currentTarget) : undefined} onError={onError} />
        <button type="button" onClick={onClear} aria-label={`เอา${alt}ออก`}>×</button>
      </div>
    );
  }
  return (
    <label className="rp-drop">
      <span className="rp-drop-ic" aria-hidden="true">↑</span>
      {hint}
      <small>ลาก &amp; วาง หรือ Ctrl+V</small>
      <input type="file" accept={accept} hidden onChange={onPick} />
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

/** English names of the tabs — what `?tab=` and a saved draft are checked against. */
const TAB_EN: Record<TabType, string> = {
  image: "Image", video: "Video", edit: "Edit", lipsync: "Lip Sync", audio: "Music",
};

/** The modes in the order the orb lists them and the composer counts them. */
const TAB_ORDER: TabType[] = ["image", "video", "edit", "lipsync", "audio"];

const TAB_LABEL: Record<TabType, string> = {
  image: "สร้างภาพ", video: "สร้างวิดีโอ", edit: "แก้ไขภาพ", lipsync: "ลิปซิงค์", audio: "สร้างเพลง",
};

/**
 * The orb's icons — one set, drawn together as glass objects on black, keyed
 * out and cut square (public/studio). The names carry a version because
 * public/sw.js used to keep every image forever: a redrawn icon under its old
 * name never reaches a browser that had the old one. Bump the suffix when the
 * art changes, and redraw the whole set or the new one stands out of it.
 */
const TAB_ICON: Record<TabType, string> = {
  image: "/studio/ic-image-v1.webp",
  video: "/studio/ic-video-v1.webp",
  edit: "/studio/ic-edit-v1.webp",
  lipsync: "/studio/ic-lipsync-v1.webp",
  audio: "/studio/ic-music-v1.webp",
};
/** Drawn in the same set; these two open pages of their own. */
const MODEL3D_ICON = "/studio/ic-3d-v1.webp";
const GALLERY_ICON = "/studio/ic-gallery-v1.webp";

const glyph = (shape: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {shape}
  </svg>
);

/** The mode in use, as a line icon on the orb itself. */
const TAB_GLYPH: Record<TabType, React.ReactNode> = {
  image: glyph(<><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>),
  video: glyph(<><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="m15.5 10 6-3.5v11l-6-3.5" /></>),
  edit: glyph(<><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="m13.5 6.5 4 4" /></>),
  lipsync: glyph(<><path d="M3 12c3-4 6-5 9-5s6 1 9 5c-3 4-6 5-9 5s-6-1-9-5z" /><path d="M3 12h18" /></>),
  audio: glyph(<><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>),
};

/** Where a panel actually fits, worked out when it opens: fixed coordinates. */
type Placement = { up: boolean; left: number; top: number; bottom: number; width: number; maxHeight: number };

/**
 * Compact control that opens its contents in a floating panel. Nothing is
 * removed by it; it moves one click away — 12 styles, 10 templates and the
 * prompt builder would otherwise push the order button off the screen.
 *
 * The panel goes to <body> at fixed coordinates. The composer scrolls and its
 * glass has a backdrop-filter, and both would clip it or re-anchor it; and up
 * or down is decided from the room the trigger has when it is clicked — a
 * panel that always opened upward once lost two thirds of itself off the top.
 * `tool` draws the trigger as a small button (the prompt's toolbar), `field`
 * as a full-width selector showing its value.
 */
function Popover({
  id, open, onToggle, label, value, children, align = "left", width = 300, variant = "field",
}: {
  id: string;
  open: string | null;
  onToggle: (id: string | null) => void;
  label: string;
  value?: string;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
  variant?: "field" | "tool";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isOpen = open === id;
  const [place, setPlace] = useState<Placement>({ up: false, left: 0, top: 0, bottom: 0, width, maxHeight: 360 });

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
    // has more room.
    const up = below < Math.min(320, above) && above > below;
    // Hang from whichever edge was asked for, then keep it on screen.
    const wanted = align === "right" ? t.right - w : t.left;
    setPlace({
      up,
      left: Math.max(gap, Math.min(wanted, vw - w - gap)),
      top: t.bottom + 6,
      bottom: vh - t.top + 6,
      width: w,
      maxHeight: Math.min(360, Math.max(160, (up ? above : below) - 6)),
    });
  }, [align, width]);

  useEffect(() => {
    if (!isOpen) return;
    const inside = (n: EventTarget | null) =>
      n instanceof Node && (ref.current?.contains(n) === true || panelRef.current?.contains(n) === true);
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) onToggle(null);
    };
    // A fixed panel would float away from a trigger that scrolled: close it.
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onToggle(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measure);
    };
  }, [isOpen, onToggle, measure]);

  const tool = variant === "tool";
  return (
    <div ref={ref} className={tool ? "rp-pop rp-pop-tool" : "rp-pop"}>
      <button
        type="button"
        className={tool ? "rp-tool" : "rp-popbtn"}
        data-open={isOpen ? "true" : "false"}
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen) {
            onToggle(null);
            return;
          }
          // Measured before it is shown, so it never paints in the wrong place.
          measure();
          onToggle(id);
        }}
      >
        {tool ? label : (
          <>
            <span className="rp-popbtn-text">{label}{value && <b>{value}</b>}</span>
            <span className="rp-popbtn-caret" aria-hidden="true">▼</span>
          </>
        )}
      </button>
      {isOpen && createPortal(
        <div
          ref={panelRef}
          className="xdr-pop"
          role="dialog"
          aria-label={label}
          style={{
            position: "fixed",
            ...(place.up ? { bottom: place.bottom } : { top: place.top }),
            left: place.left,
            width: place.width,
            maxHeight: place.maxHeight,
          }}
        >
          {children}
        </div>,
        document.body,
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
  // A link from the home page names the tab (`?tab=`) and may carry a prompt
  // (`?prompt=`). Read after mount, not in the initializers above: on a
  // client-side navigation the address still shows the previous page while
  // this one first renders. Saved to the draft at once — a visitor who is not
  // signed in goes through /login, which comes back to /generate without the
  // query — then taken out of the address, so a reload does not lay it over
  // whatever was written since.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("tab") && !url.searchParams.has("prompt")) return;
    const tabParam = url.searchParams.get("tab");
    const promptParam = url.searchParams.get("prompt")?.trim();
    const fromLink: StudioDraft = {};
    if (tabParam && Object.hasOwn(TAB_EN, tabParam)) fromLink.tab = tabParam as TabType;
    if (promptParam) fromLink.prompt = promptParam.slice(0, 2000);
    /* eslint-disable react-hooks/set-state-in-effect -- the address is only readable once mounted */
    if (fromLink.tab) setTab(fromLink.tab);
    if (fromLink.prompt) setPrompt(fromLink.prompt);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (fromLink.tab || fromLink.prompt) writeDraft({ ...readDraft(), ...fromLink });
    url.searchParams.delete("tab");
    url.searchParams.delete("prompt");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
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
  /** A history item opened on the canvas; the form holds the order that made it. */
  const [viewing, setViewing] = useState<HistoryItem | null>(null);
  /** What was being written before a history item was opened over it, for "↶". */
  const [formBeforeOpen, setFormBeforeOpen] = useState<FormSnapshot | null>(null);
  /** The opened order's uploads are still on their way; an order now would go without them. */
  const [loadingInputs, setLoadingInputs] = useState(false);
  /**
   * The uploads the opened order was made from, as a record: the canvas shows
   * its original beside the result from here, and the form plays a file back
   * only while its slot still holds this one — edits to the form change neither.
   */
  const [openedInputs, setOpenedInputs] = useState<OrderInputs | null>(null);
  /** Bumped by every open and by whatever overrides one, so a late answer is dropped. */
  const openSeqRef = useRef(0);
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
  /**
   * Reference pictures of an image order, in the order they are sent. One for
   * an img2img model (with `strength`), up to the model's cap for one that
   * composes from several; each is uploaded to R2 when added.
   */
  const [refs, setRefs] = useState<RefPic[]>([]);
  const refIdRef = useRef(0);
  const promptRef = useRef<HTMLTextAreaElement>(null);
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
  /**
   * The voice or song as picked, decoded, and the part of it to keep. What is
   * uploaded (`inputAudio`) is that part, cut here — a whole file when the
   * whole file is kept and small enough. `trimUploaded` is the selection the
   * upload is of; while it differs from the selection, the order waits.
   */
  const [trimSrc, setTrimSrc] = useState<TrimSource | null>(null);
  const [trimSel, setTrimSel] = useState<TrimRange | null>(null);
  const [trimDragging, setTrimDragging] = useState(false);
  const [trimUploaded, setTrimUploaded] = useState<string | null>(null);
  /** The selection whose upload failed; not retried until the customer asks or moves it. */
  const [trimFailed, setTrimFailed] = useState<string | null>(null);
  /** Bumped by every pick and clear, so a late decode or upload is dropped. */
  const trimSeqRef = useRef(0);
  /**
   * Seconds per uploaded audio URL: the server's reading from /api/uploads, or
   * the player's for a file put back from a past order. Keyed by URL rather
   * than held beside `inputAudio`, so no path that swaps or clears the track
   * can leave a stale length behind it.
   */
  const [audioLengths, setAudioLengths] = useState<Record<string, number>>({});
  /** What the server read from each uploaded clip, by URL — the numbers an order is checked against. */
  const [clipFacts, setClipFacts] = useState<Record<string, ClipFacts>>({});
  /**
   * The natural size of the picture in the image slot, read when it draws. A
   * portrait made to speak keeps its own shape, so this — not the aspect
   * control the lip-sync tab does not have — is the frame that is ordered.
   */
  const [imageDims, setImageDims] = useState<{ src: string; width: number; height: number } | null>(null);
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

  useEffect(() => { if (session === null) router.push(loginHref()); }, [session, router]);
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
  /** Why the 3D studio cannot take an order right now, or null — the same test as a tab. */
  const model3dModels = models.filter((m) => m.category === "model3d");
  const model3dBlocked = !modelsLoaded
    ? null
    : model3dModels.length === 0
      ? "ยังไม่มีโมเดลในหมวดนี้"
      : model3dModels.some((m) => m.canOrder !== false)
        ? null
        : model3dModels[0].unavailableReason ?? model3dModels[0].tuningMessage ?? "ยังใช้งานไม่ได้ในขณะนี้";
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

  /** A voice or song is in the slot — uploaded, or picked and being cut. */
  const hasAudio = inputAudio !== null || trimSrc !== null;

  /** Lip-sync needs both halves: the voice, and the thing that speaks it. */
  const missingLipsyncInput = tab === "lipsync" && (!hasAudio || !lipsyncSource);

  /**
   * A model whose clip is as long as the voice (a self-hosted portrait): the
   * rule the server applies to the stored file, and the length — or the
   * reason it will be refused — for the track in the slot. Null when the model
   * has no such rule or the track's length is not known here (the server then
   * still decides).
   */
  const voiceRule = tab === "lipsync" ? selectedModel?.lengthFromAudio ?? null : null;
  // A picked file is ordered as the part kept of it, which is what gets uploaded.
  const inputAudioSeconds = trimSrc && trimSel
    ? trimSel.end - trimSel.start
    : inputAudio ? audioLengths[inputAudio] ?? null : null;
  const voiceLength =
    voiceRule && inputAudioSeconds !== null ? voiceRenderSeconds(inputAudioSeconds, voiceRule, selectedModel?.maxDuration) : null;
  /** Longest voice the lip-sync picker accepts: the model's own ceiling where it has one. */
  const lipsyncAudioMax = voiceRule && selectedModel?.maxDuration ? selectedModel.maxDuration : MAX_INPUT_SECONDS;

  /**
   * A model that re-dubs a clip: its rules (length, picture, file; on an API
   * row the voice beside it and the billing), and what they say about the
   * clip and voice in the slots — the same checks GenerationService makes on
   * the stored files, so a clip that will be refused is refused here first.
   */
  const videoRule = tab === "lipsync" && lipsyncNeeds === "video" ? selectedModel?.videoLipsync ?? null : null;
  const sourceClip = sourceVideo ? clipFacts[sourceVideo] ?? null : null;
  const clipCheck = videoRule && sourceClip ? checkClip(videoRule.clip, sourceClip) : null;
  const clipVoiceCheck =
    videoRule?.voice && sourceClip && inputAudioSeconds !== null
      ? checkVoice(videoRule.voice, { seconds: inputAudioSeconds, bytes: inputAudioFile?.size ?? 0 }, sourceClip.seconds)
      : null;
  /** Longest clip the picker takes: the model's own limit where it has one. */
  const clipMaxSeconds = videoRule?.clip.maxSeconds ?? MAX_INPUT_SECONDS;
  /** The portrait in the slot, at its natural size, once it has drawn. */
  const portraitDims = imageDims && imageDims.src === inputImagePreview ? imageDims : null;

  /** Music controls this model offers; null for API music models and every other tab. */
  const musicOpts = tab === "audio" ? selectedModel?.music ?? null : null;
  /** A cover has nothing to cover until the customer uploads the song. */
  const missingSourceSong = musicOpts?.sourceSong === true && !hasAudio;
  /** Longest source track a cover accepts — the upload cap, not the model's. */
  const coverSourceSeconds = musicOpts?.maxSourceSeconds ?? musicOpts?.maxDuration ?? 240;

  /** Longest part of a picked track this tab may keep. */
  const trimMax = tab === "lipsync" ? lipsyncAudioMax : coverSourceSeconds;
  /** The selection the order needs uploaded, or null with nothing picked here. */
  const trimWanted = trimSrc && trimSel ? trimKey(trimSel) : null;
  /** Longer than the model takes: said under the waveform, and never uploaded. */
  const trimTooLong = trimSel !== null && trimSrc !== null && trimSel.end - trimSel.start > trimMax + 0.05;
  /** The upload does not match the selection yet: the order waits for it. */
  const audioStale = trimWanted !== null && trimWanted !== trimUploaded;
  const trimState: "saving" | "saved" | "failed" =
    trimTooLong || !audioStale ? "saved" : trimWanted === trimFailed ? "failed" : "saving";

  /**
   * How many reference pictures this order may carry: what the model's adapter
   * forwards (/api/models `references`, checked again by the server). A model
   * from before that field takes one, the img2img slot it always had.
   */
  const refCap = tab === "image" ? (selectedModel?.references ? selectedModel.references.images : 1) : 0;
  /** Several pictures, each with its role, instead of one with a strength. */
  const multiRef = refCap >= 2;
  const refsUploading = refs.some((r) => r.url === null);
  /** More than this model takes — after switching to a model with a lower cap. */
  const refsOver = refCap > 0 && refs.length > refCap;
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
    // A voice the server would refuse (too long, too short, unreadable).
    voiceLength?.ok === false ||
    // …or a clip (or a voice beside it) the model does not take.
    clipCheck?.ok === false ||
    clipVoiceCheck?.ok === false ||
    missingSourceSong ||
    // …or, on a reopened order, without the files it was made from.
    loadingInputs ||
    // An order placed mid-upload would go out without the end frame.
    uploading === "image" ||
    // …or, on a cover, without the song itself.
    (musicOpts?.sourceSong === true && uploading === "audio") ||
    // …or before the reference pictures are up, or with more than the model takes.
    (tab === "image" && (refsUploading || refsOver)) ||
    // …or before the part of the track that was kept is the part uploaded.
    (audioStale && (tab === "lipsync" || musicOpts?.sourceSong === true));

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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // So the same picture can be picked again after it was removed.
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setInputImage(base64); setInputImagePreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const clearInputImage = () => { setInputImage(null); setInputImagePreview(null); };
  /** A portrait made to speak keeps its own shape: its size is read when it draws. */
  const onInputImageLoad = (img: HTMLImageElement) => {
    if (inputImagePreview && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setImageDims({ src: inputImagePreview, width: img.naturalWidth, height: img.naturalHeight });
    }
  };

  /**
   * Reference pictures from the picker, a drop or a paste. An img2img model
   * takes one (it replaces the one there), a model that composes several takes
   * up to its cap (they are added). Each goes to R2 as it is added — the order
   * carries URLs, and GenerationService accepts only ours. Returns how many
   * made it.
   */
  const addRefFiles = async (files: File[]): Promise<number> => {
    const pictures = files.filter((f) => f.type.startsWith("image/"));
    if (pictures.length === 0) return 0;
    if (refCap === 0) {
      toast("error", "โมเดลนี้ไม่รับภาพอ้างอิง", "เลือกโมเดลที่มีป้าย “รับภาพอ้างอิงได้”");
      return 0;
    }
    const room = multiRef ? refCap - refs.length : 1;
    if (room <= 0) {
      toast("error", "ภาพอ้างอิงครบแล้ว", `โมเดลนี้รับได้ ${refCap} ภาพ — เอาภาพเดิมออกก่อน`);
      return 0;
    }
    if (pictures.length > room) {
      toast("info", `ใส่ได้อีก ${room} ภาพ`, `โมเดลนี้รับภาพอ้างอิงได้ ${refCap} ภาพ ภาพที่เกินไม่ได้ใส่`);
    }
    const taken = pictures.slice(0, room);
    const fits = taken.filter((f) => f.size <= MAX_BYTES.image);
    if (fits.length < taken.length) toast("error", "ไฟล์ใหญ่เกินไป", "ภาพอ้างอิงต้องไม่เกิน 12 MB ต่อภาพ");
    if (fits.length === 0) return 0;
    const start = multiRef ? refs.length : 0;
    const tiles = fits.map((file, i) => {
      refIdRef.current += 1;
      const pic: RefPic = { id: refIdRef.current, url: null, role: defaultRole(start + i) };
      return { file, pic };
    });
    setRefs((rs) => (multiRef ? [...rs, ...tiles.map((t) => t.pic)] : [tiles[0].pic]));
    const done = await Promise.all(tiles.map(async ({ file, pic }) => {
      const res = await uploadMedia(file, "image");
      const url = res.url;
      if (url) {
        setRefs((rs) => rs.map((r) => (r.id === pic.id ? { ...r, url } : r)));
        return true;
      }
      setRefs((rs) => rs.filter((r) => r.id !== pic.id));
      return false;
    }));
    const failed = done.filter((ok) => !ok).length;
    if (failed > 0) {
      toast("error", "อัปโหลดภาพอ้างอิงไม่สำเร็จ", failed > 1 ? `${failed} ภาพ ลองอีกครั้ง` : "ลองอีกครั้ง");
    }
    return done.length - failed;
  };
  const removeRef = (id: number) => setRefs((rs) => rs.filter((r) => r.id !== id));
  const cycleRole = (id: number) =>
    setRefs((rs) => rs.map((r) => (r.id === id ? { ...r, role: nextRole(r.role) } : r)));

  /** "ภาพ 2" into the prompt at the caret — the words that point the model at a picture. */
  const insertRefToken = (n: number) => {
    // ✨ is rewriting the box; anything put in now would be lost under its answer.
    if (enhancing) return;
    const token = referenceToken(n);
    const el = promptRef.current;
    // A box never clicked into reports its caret at 0: add to the end instead.
    const untouched = !el || (document.activeElement !== el && el.selectionStart === 0 && el.selectionEnd === 0);
    const from = untouched ? prompt.length : el.selectionStart;
    const to = untouched ? prompt.length : el.selectionEnd;
    const before = prompt.slice(0, from);
    const after = prompt.slice(to);
    const lead = before && !/\s$/.test(before) ? " " : "";
    // A space after it too, so typing goes on as a new word.
    const trail = !/^\s/.test(after) ? " " : "";
    setPrompt(`${before}${lead}${token}${trail}${after}`.slice(0, 10_000));
    const caret = Math.min(10_000, before.length + lead.length + token.length + trail.length);
    requestAnimationFrame(() => {
      const box = promptRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(caret, caret);
    });
  };

  /** Forget the voice or song: the upload, the picked file and its selection. */
  const clearAudio = () => {
    trimSeqRef.current += 1;
    setTrimSrc(null); setTrimSel(null); setTrimUploaded(null); setTrimFailed(null); setTrimDragging(false);
    setInputAudio(null); setInputAudioName(null); setInputAudioFile(null);
    setUploading((u) => (u === "audio" ? null : u));
  };

  /**
   * A voice or song from disk. Decoded here when the browser can, so it is
   * drawn and a part of it can be kept — the upload follows the selection
   * (`commitTrim`). A file this browser cannot decode, or one too big to decode
   * comfortably, goes up whole under the old length check.
   */
  const pickAudio = async (file: File, maxSeconds: number) => {
    clearAudio();
    const seq = trimSeqRef.current;
    if (file.size > DECODE_LIMIT_BYTES) {
      await uploadMediaFile(file, "audio", maxSeconds);
      return;
    }
    setUploading("audio");
    const loaded = await loadAudio(file);
    if (seq !== trimSeqRef.current) return;
    setUploading(null);
    if (!loaded || !(loaded.decoded.duration > 0)) {
      await uploadMediaFile(file, "audio", maxSeconds);
      return;
    }
    setTrimSrc({ file, buffer: loaded.decoded });
    setTrimSel(initialTrim(loaded.decoded.duration, maxSeconds));
  };

  /**
   * Upload the part of the track that is kept: the file itself when all of it
   * is kept and the server takes its size, else the selection cut here. The
   * slot's URL and `trimUploaded` change together, so the order always carries
   * the part it says it does.
   */
  const commitTrim = async () => {
    if (!trimSrc || !trimSel) return;
    const seq = trimSeqRef.current;
    const src = trimSrc;
    const range = trimSel;
    const key = trimKey(range);
    const whole = coversWhole(range, src.buffer.duration) && src.file.size <= MAX_BYTES.audio;
    const file = whole ? src.file : await cutAudio(src.buffer, range, src.file.name);
    if (seq !== trimSeqRef.current) return;
    if (!file) {
      setTrimFailed(key);
      toast("error", "ตัดเสียงไม่สำเร็จ", "เบราว์เซอร์นี้ตัดไฟล์ไม่ได้ ลองตัดเสียงก่อนแล้วอัปโหลดใหม่");
      return;
    }
    const res = await uploadMedia(file, "audio");
    if (seq !== trimSeqRef.current) return;
    const url = res.url;
    if (!url) {
      setTrimFailed(key);
      toast("error", "อัปโหลดไม่สำเร็จ", res.error ?? "ลองใหม่อีกครั้ง");
      return;
    }
    setInputAudio(url); setInputAudioName(src.file.name); setInputAudioFile(file);
    setAudioLengths((m) => ({ ...m, [url]: res.durationSeconds ?? range.end - range.start }));
    setTrimUploaded(key);
  };
  const commitTrimRef = useRef(commitTrim);
  useEffect(() => {
    commitTrimRef.current = commitTrim;
  });
  // The selection settles (no handle held for a moment) → upload that part.
  useEffect(() => {
    if (!trimWanted || trimDragging || trimTooLong || trimWanted === trimUploaded || trimWanted === trimFailed) return;
    const t = setTimeout(() => void commitTrimRef.current(), 450);
    return () => clearTimeout(t);
  }, [trimWanted, trimDragging, trimTooLong, trimUploaded, trimFailed]);

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
    if (kind === "audio") await pickAudio(file, maxSeconds);
    else await uploadMediaFile(file, kind, maxSeconds);
  };

  /** The upload itself, shared by the pickers and a file dropped on the studio. */
  const uploadMediaFile = async (file: File, kind: "audio" | "video", maxSeconds: number) => {
    setUploading(kind);

    const seconds = await probeDuration(file, kind);
    // The same quarter second of slack the server allows: an MP3 trimmed to
    // the limit still carries its encoder's end padding.
    if (seconds !== null && seconds > maxSeconds + 0.25) {
      setUploading(null);
      toast(
        "error",
        "ไฟล์ยาวเกินไป",
        `รองรับไม่เกิน ${maxSeconds} วินาที (ไฟล์นี้ ${seconds.toFixed(1)} วินาที) กรุณาตัดให้สั้นลงก่อน`,
      );
      return;
    }

    const result = await uploadMedia(file, kind);
    setUploading(null);

    if (result.error) {
      toast("error", "อัปโหลดไม่สำเร็จ", result.error);
      return;
    }
    if (kind === "audio") {
      setInputAudio(result.url!); setInputAudioName(file.name); setInputAudioFile(file);
      // What a voice-driven order will be priced by: the server's reading if it
      // gave one, the browser's otherwise.
      const length = result.durationSeconds ?? seconds;
      if (length) setAudioLengths((m) => ({ ...m, [result.url!]: length }));
    }
    else {
      setSourceVideo(result.url!); setSourceVideoName(file.name);
      const length = result.durationSeconds ?? seconds;
      if (length && result.width && result.height) {
        const ext = result.contentType === "video/webm" ? "webm" : "mp4";
        setClipFacts((m) => ({ ...m, [result.url!]: { seconds: length, width: result.width!, height: result.height!, bytes: file.size, ext } }));
      }
    }
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

  const pollResult = useCallback(async (generationId: number, slowApi = false) => {
    // API-backed providers answer within a few minutes. GPU-backed ones rent a
    // machine first, and on a cold host that means installing ComfyUI and
    // pulling ~42 GB of weights. The server allows warmup + render (60 + 30
    // min by default), so the client has to outlast that or it would declare a
    // timeout on a job that is still perfectly healthy.
    const API_DEADLINE_MS = 4 * 60_000;
    // …except a clip re-dub, which the server runs in the background for as
    // long as the vendor takes (Kling: about twelve minutes; it waits up to
    // thirty, lipsync-rules.ts).
    const SLOW_API_DEADLINE_MS = 35 * 60_000;
    const GPU_DEADLINE_MS = 95 * 60_000;

    const startedAt = Date.now();
    let deadlineMs = slowApi ? SLOW_API_DEADLINE_MS : API_DEADLINE_MS;
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
    setFormBeforeOpen(null);
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
    setFormBeforeOpen(null);
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
        !hasAudio
          ? "ต้องอัปโหลดไฟล์เสียงที่จะให้พูด"
          : lipsyncNeeds === "image"
            ? "ต้องอัปโหลดรูปหน้าคนที่จะให้พูด"
            : "ต้องอัปโหลดคลิปต้นฉบับที่จะพากย์ทับ",
      );
      return;
    }
    if (voiceLength && !voiceLength.ok) {
      toast("error", "ใช้ไฟล์เสียงนี้ไม่ได้", voiceLength.message);
      return;
    }
    if (clipCheck && !clipCheck.ok) {
      toast("error", "ใช้คลิปนี้ไม่ได้", clipCheck.message);
      return;
    }
    if (clipVoiceCheck && !clipVoiceCheck.ok) {
      toast("error", "ใช้ไฟล์เสียงนี้ไม่ได้", clipVoiceCheck.message);
      return;
    }
    if (missingSourceSong) {
      toast("error", "ยังไม่ได้อัปโหลดเพลงต้นฉบับ", "โหมดคัฟเวอร์ต้องมีเพลงให้ AI ถอดทำนองก่อน");
      return;
    }
    if (tab === "image" && refsUploading) {
      toast("info", "ภาพอ้างอิงยังอัปโหลดไม่เสร็จ", "รอสักครู่แล้วกดอีกครั้ง");
      return;
    }
    if (tab === "image" && refsOver) {
      toast("error", "ภาพอ้างอิงเกินจำนวน", `โมเดลนี้รับได้ ${refCap} ภาพ — เอาออกให้เหลือ ${refCap} ภาพก่อนสั่ง`);
      return;
    }
    if (audioStale && (tab === "lipsync" || musicOpts?.sourceSong === true)) {
      if (trimTooLong) toast("error", "ช่วงเสียงยาวเกินไป", `โมเดลนี้รับไม่เกิน ${Math.floor(trimMax)} วินาที ลากขอบให้สั้นลง`);
      else toast("info", "กำลังเตรียมช่วงเสียงที่เลือก", "รอสักครู่แล้วกดอีกครั้ง");
      return;
    }
    // Reference pictures travel as URLs. A model that composes several is told
    // in the prompt what each one is (studio-references.ts) — the same words
    // the customer points at with "ภาพ 1", "ภาพ 2".
    const sentPics = refCap > 0 ? refs.filter((r): r is RefPic & { url: string } => r.url !== null) : [];
    const multiSend = multiRef && sentPics.length > 0;
    const promptToSend = multiSend ? composeReferencePrompt(prompt, sentPics.map((r) => r.role)) : prompt.trim();
    if (promptToSend.length > 10_000) {
      toast("error", "พรอมต์ยาวเกินไป", "รวมคำอธิบายภาพอ้างอิงแล้วเกิน 10,000 ตัวอักษร ตัดพรอมต์ให้สั้นลง");
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
    // A portrait made to speak keeps its own shape.
    const portrait = tab === "lipsync" && lipsyncNeeds === "image" ? portraitDims : null;
    const jobAspect = tab === "audio" ? "1:1" : portrait ? `${portrait.width}:${portrait.height}` : aspectRatio;
    setJobs((js) => [
      { id: pendingId, tab, prompt: prompt.trim(), aspect: jobAspect, startedAt: clickedAt, status: "running", progress: null, result: null },
      ...js.filter((j) => j.status === "running"),
      ...js.filter((j) => j.status !== "running").slice(0, 6),
    ]);
    focusRef.current = pendingId;
    setFocusId(pendingId);
    setViewing(null);
    setFormBeforeOpen(null);
    setIsGenerating(true); setResult(null); setIsFavorited(false);
    setProgress(null); setGenStartedAt(clickedAt);
    const ar = aspectRatios.find((a) => a.value === aspectRatio);
    // On video the mode decides: text→video must not smuggle a start frame in,
    // or the provider silently switches endpoint behind the customer's back.
    const imageToSend =
      tab === "image"
        ? (multiSend ? null : sentPics[0]?.url ?? null)
        : tab === "audio" || (tab === "video" && videoMode === "t2v") ? null : inputImage;
    // The music tab hides the picture controls, but their state lives on — an
    // image tab's negative prompt reaching the music model would be sung as
    // the lyrics, and its image style appended to the song's description.
    const music = tab === "audio";
    // The song keeps the name it was made under, not whatever is typed next.
    if (music) setSongTitle(prompt.trim());
    // An API row that bills by the clip is a re-dub the server finishes in the background.
    const slowApi = Boolean(videoRule?.billing);
    const sent = await postGeneration({
      modelId: selectedModelId,
      // Lip-sync has no generation type of its own on the server: what it
      // produces is a clip, and the tab exists only to give it the right
      // controls here.
      type: tab === "lipsync" ? "video" : tab,
      prompt: promptToSend,
      // Checked against the model's cap and our bucket again on the server.
      referenceImages: multiSend ? sentPics.map((r) => r.url) : undefined,
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
        width: portrait?.width ?? (ar?.w || 1024), height: portrait?.height ?? (ar?.h || 1024), aspectRatio,
        // The customer's pick as-is. The server falls back to the model's
        // default when it is absent or not offered for the frame shape
        // (h3RenderPlan), which is the same preset the popover shows as chosen.
        resolution: resolution ?? undefined,
        // Priced by the server at this mode's multiplier — the same sum the
        // button shows. Only a mode this viewer may use is honoured.
        quality: activeQuality?.id,
        strength: tab === "image" && !multiSend && sentPics.length > 0 ? strength : undefined,
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
    else pollResult(data.id, slowApi);
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

  /** Which tab made this order. Lip-sync is a 'video' order on the server; its model says which. */
  const tabForHistory = (g: HistoryItem): TabType => {
    const subcategory = g.model?.subcategory ?? models.find((m) => m.id === g.modelDbId)?.subcategory;
    if (isLipsyncModel(subcategory)) return "lipsync";
    return g.type === "video" || g.type === "edit" || g.type === "audio" ? g.type : "image";
  };

  const captureForm = (): FormSnapshot => ({
    tab, modelId: selectedModelId, prompt, negativePrompt, lyrics, aspectRatio, duration, resolution,
    qualityId, numOutputs, strength, steps, guidance, musicStyle, instrumental, videoMode,
    refs: refs.filter((r) => r.url !== null), trimSrc, trimSel, trimUploaded,
    inputImage, inputImagePreview, inputImageEnd,
    inputAudio, inputAudioName, inputAudioFile, sourceVideo, sourceVideoName,
  });

  const applyForm = (f: FormSnapshot) => {
    setTab(f.tab); setSelectedModelId(f.modelId);
    setPrompt(f.prompt); setNegativePrompt(f.negativePrompt); setLyrics(f.lyrics);
    setAspectRatio(f.aspectRatio); setDuration(f.duration); setResolution(f.resolution);
    setQualityId(f.qualityId); setNumOutputs(f.numOutputs);
    setStrength(f.strength); setSteps(f.steps); setGuidance(f.guidance);
    setMusicStyle(f.musicStyle); setInstrumental(f.instrumental); setVideoMode(f.videoMode);
    setRefs(f.refs);
    trimSeqRef.current += 1;
    setTrimSrc(f.trimSrc); setTrimSel(f.trimSel); setTrimUploaded(f.trimUploaded); setTrimFailed(null); setTrimDragging(false);
    setInputImage(f.inputImage); setInputImagePreview(f.inputImagePreview); setInputImageEnd(f.inputImageEnd);
    setInputAudio(f.inputAudio); setInputAudioName(f.inputAudioName); setInputAudioFile(f.inputAudioFile);
    setSourceVideo(f.sourceVideo); setSourceVideoName(f.sourceVideoName);
  };

  /**
   * An order's uploads, into the slots its tab reads them from. Every other
   * slot is emptied, so the form shows what that order used and nothing left
   * over from before.
   */
  const fillAttachments = (kind: TabType, inputs: OrderInputs, roles: ReferenceRole[] | null = null) => {
    const image = inputs.inputImage;
    // An image order's pictures: the several it composed from, or its one reference.
    const pics = kind !== "image" ? [] : inputs.referenceImages.length > 0 ? inputs.referenceImages : image ? [image] : [];
    setRefs(pics.map((url, i) => {
      refIdRef.current += 1;
      return { id: refIdRef.current, url, role: roles && roles.length === pics.length ? roles[i] : defaultRole(i) };
    }));
    const main = kind === "image" ? null : image;
    setInputImage(main); setInputImagePreview(main);
    // The server only takes an end frame alongside a start frame.
    setInputImageEnd(kind === "video" && image ? inputs.inputImageEnd : null);
    if (kind === "video") setVideoMode(image ? "i2v" : "t2v");
    const audio = kind === "lipsync" || kind === "audio" ? inputs.inputAudio : null;
    trimSeqRef.current += 1;
    setTrimSrc(null); setTrimSel(null); setTrimUploaded(null); setTrimFailed(null);
    setInputAudio(audio); setInputAudioName(audio ? "ไฟล์เสียงจากงานเดิม" : null); setInputAudioFile(null);
    const video = kind === "lipsync" ? inputs.inputVideo : null;
    setSourceVideo(video); setSourceVideoName(video ? "คลิปจากงานเดิม" : null);
  };

  /**
   * Open a finished piece from the history strip: it goes on the canvas and
   * the studio becomes the order that made it — its tab, model, prompt,
   * settings and uploads — ready to change and order again with a fresh seed.
   * What the customer was writing is kept for "↶".
   */
  const openHistory = async (g: HistoryItem) => {
    const seq = ++openSeqRef.current;
    const kind = tabForHistory(g);
    const model = models.find((m) => m.id === g.modelDbId);
    const r = g.remix ?? {};

    // Kept once, from before the first piece opened over it: browsing on from
    // piece to piece must not replace the draft with the last piece opened.
    const hasDraft = Boolean(
      prompt.trim() || lyrics.trim() || refs.length > 0 || inputImage || inputImageEnd || inputAudio || trimSrc || sourceVideo
    );
    const keepsDraft = !viewing && hasDraft;
    if (keepsDraft) setFormBeforeOpen(captureForm());

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

    setTab(kind);
    // A several-reference order carries its pictures' roles in the prompt it
    // was sent with: they go back on the pictures, the words back in the box.
    const split = kind === "image" ? splitReferencePrompt(g.prompt ?? "") : { prompt: g.prompt ?? "", roles: null };
    setPrompt(split.prompt.slice(0, 10_000));
    setNegativePrompt(g.negativePrompt ?? "");
    setPromptBeforeEnhance(null);
    setEnhanceNote(null);
    if (model && model.canOrder !== false) setSelectedModelId(model.id);
    if (r.aspectRatio && r.aspectRatio in ASPECT_RATIO_CSS) setAspectRatio(r.aspectRatio);
    if (typeof r.duration === "number") setDuration(r.duration);
    setResolution(r.resolution ?? null);
    setQualityId(r.quality ?? null);
    setNumOutputs(kind === "image" && typeof r.numOutputs === "number" ? Math.min(4, Math.max(1, Math.round(r.numOutputs))) : 1);
    if (typeof r.strength === "number") setStrength(Math.min(1, Math.max(0, r.strength)));
    if (typeof r.steps === "number") setSteps(Math.min(80, Math.max(10, Math.round(r.steps))));
    if (typeof r.cfgScale === "number") setGuidance(Math.min(20, Math.max(1, r.cfgScale)));
    if (kind === "audio") {
      setLyrics(typeof r.lyrics === "string" ? r.lyrics.slice(0, 3000) : "");
      setMusicStyle({ complexity: MUSIC_COMPLEXITY_DEFAULT, variance: MUSIC_VARIANCE_DEFAULT, ...(r.music ?? {}) });
      setInstrumental(r.music?.instrumental === true);
    }

    const notes = [
      !model ? "โมเดลเดิมไม่มีแล้ว — ใช้โมเดลที่เลือกอยู่แทน"
        : model.canOrder === false ? `${model.name} ปิดให้บริการชั่วคราว — เลือกโมเดลอื่นในแท็บนี้แทน` : null,
      keepsDraft ? "ร่างที่เขียนค้างไว้ยังเก็บอยู่ — กด ↶ ใต้ผลงานเพื่อกลับไป" : null,
    ].filter(Boolean);
    if (notes.length > 0) toast("info", "เปิดงานเดิมแล้ว", notes.join(" · "));
    document.querySelector(".rp-studio-canvas")?.scrollTo({ top: 0, behavior: "smooth" });
    // Stacked, the canvas is below the composer: bring it into view.
    if (window.innerWidth < 1100) document.querySelector(".rp-stage")?.scrollIntoView({ behavior: "smooth", block: "start" });

    // The files come in their own request (a start frame can be megabytes).
    // Until they land the slots are empty and the order button waits.
    fillAttachments(kind, NO_ORDER_INPUTS);
    setOpenedInputs(null);
    setLoadingInputs(true);
    const inputs = await fetchOrderInputs(g.id);
    if (openSeqRef.current !== seq) return;
    setLoadingInputs(false);
    if (!inputs) {
      toast("error", "โหลดไฟล์แนบของงานเดิมไม่สำเร็จ", "prompt และการตั้งค่าโหลดแล้ว — กดที่งานอีกครั้ง หรืออัปโหลดไฟล์ใหม่");
      return;
    }
    setOpenedInputs(inputs);
    fillAttachments(kind, inputs, split.roles);
  };

  /** "↶": the draft from before the first history item was opened, and an empty canvas. */
  const restoreDraft = () => {
    if (!formBeforeOpen) return;
    openSeqRef.current++;
    setLoadingInputs(false);
    setOpenedInputs(null);
    applyForm(formBeforeOpen);
    clearCanvas();
  };

  /** Switch mode — from the orb. */
  const pickTab = (key: TabType) => {
    setTab(key); setResult(null); setNumOutputs(1);
    // The canvas is cleared, so no history item is open any more.
    setViewing(null); setFormBeforeOpen(null);
    // Files of an order still loading belong to the tab being left.
    if (key !== tab && loadingInputs) { openSeqRef.current++; setLoadingInputs(false); }
    // The audio upload is shared between lip-sync and the cover panel, and
    // their limits differ by a factor of six: a four minute song accepted for
    // a cover must not still be sitting there when the customer opens
    // lip-sync, where the bill follows the track's length.
    if (key !== tab) clearAudio();
  };

  /**
   * A file put back from a reopened order that no longer loads: the order
   * reused an upload of an older one, and the older one's retention removed
   * it. Sending the dead link would only fail after the charge. Files picked
   * in this visit are left alone — they have not expired.
   */
  const dropExpiredInput = (url: string | null, clear: () => void) => {
    const restored = openedInputs && url !== null && Object.values(openedInputs).includes(url);
    if (!restored) return;
    clear();
    toast("info", "ไฟล์แนบเดิมหมดอายุแล้ว", "กรุณาอัปโหลดไฟล์ใหม่ก่อนสร้าง");
  };

  /** Carry a finished picture into the next step: animate it, edit it, or reference it. */
  const carryResultTo = (target: "video" | "edit" | "ref", url: string) => {
    // A model that composes several keeps the pictures already there, and this
    // one joins them; any other model takes it as its one reference.
    const joins = target === "ref" && tab === "image" && multiRef;
    if (joins && refs.length >= refCap) {
      toast("error", "ภาพอ้างอิงครบแล้ว", `โมเดลนี้รับได้ ${refCap} ภาพ — เอาภาพเดิมออกก่อน`);
      return;
    }
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
      refIdRef.current += 1;
      const pic: RefPic = { id: refIdRef.current, url, role: defaultRole(joins ? refs.length : 0) };
      setRefs((rs) => (joins ? [...rs, pic] : [pic]));
      toast(
        "info",
        "ใส่เป็นภาพอ้างอิงแล้ว",
        joins ? `เป็นภาพ ${refs.length + 1} — กดป้ายใต้ภาพเพื่อบอกว่าเป็นตัวละคร ชุด หรือสถานที่` : "ปรับความเข้มได้ที่ช่องภาพอ้างอิง",
      );
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
      if (kind === "audio" && tab === "lipsync") return pickAudio(file, lipsyncAudioMax);
      if (kind === "audio" && musicOpts?.sourceSong) return pickAudio(file, coverSourceSeconds);
      if (kind === "video" && tab === "lipsync" && lipsyncNeeds === "video") return uploadMediaFile(file, "video", clipMaxSeconds);
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
    // Reference pictures go up to R2 as they are added (addRefFiles).
    if (tab === "image") {
      if ((await addRefFiles([file])) > 0) toast("success", "ใส่เป็นภาพอ้างอิงแล้ว");
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
    if (tab === "edit") {
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

  const totalCredits =
    // An API clip re-dub is billed by its own rule: one price, or per started block of the clip.
    videoRule?.billing && selectedModel
      ? lipsyncCredits(videoRule.billing, selectedModel.creditsPerUnit, sourceClip?.seconds ?? 0)
      : creditsFor(tab === "video" || tab === "audio" ? duration : voiceLength?.ok ? voiceLength.seconds : null) * outputs;
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
  /**
   * The picture shown beside a result as its original: the reference of a
   * fresh image order, or what a reopened picture was made from (its
   * reference, or the photo an edit changed).
   */
  const originalImage = viewing
    ? (resultIsImage ? openedInputs?.inputImage ?? null : null)
    : (tab === "image" && !multiRef ? refs[0]?.url ?? null : null);
  if (!session) return null;

  // ─── RENDER ─────────────────────────────────────────────────────────
  // Sections are numbered as they are drawn: the music tab adds lyrics, and
  // only a cover takes a file.
  const tabNo = TAB_ORDER.indexOf(tab) + 1;
  const showLyrics = tab === "audio";
  const showInputs = tab !== "audio" || musicOpts?.sourceSong === true;
  const inputsAt = showLyrics ? 4 : 3;
  const settingsAt = inputsAt + (showInputs ? 1 : 0);
  const inputsLabel =
    tab === "image" ? "ภาพอ้างอิง"
      : tab === "video" ? "เริ่มจาก"
        : tab === "edit" ? "ภาพต้นฉบับ"
          : tab === "lipsync" ? "ไฟล์ที่ใช้"
            : "เพลงต้นฉบับที่จะคัฟเวอร์";
  /** The first order still rendering, for the phone's bar above the composer. */
  const runningJob = jobs.find((j) => j.status === "running") ?? null;
  const runningFraction =
    runningJob?.progress?.stage === "rendering" ? shownFraction(runningJob.progress, runningJob.progress.at) : null;
  const canvasState = isGenerating ? "กำลังสร้าง"
    : result?.status === "completed" ? (viewing ? "งานเดิม" : "เสร็จแล้ว")
      : result?.status === "failed" ? "ไม่สำเร็จ" : "พร้อมสร้าง";
  /**
   * The model card's reference line, in reference-caps.ts referenceLabel's
   * words — that module reads the server catalogue, so it is not imported
   * here. On the video tab only a model wired for a first frame says so: an
   * API clip model takes its start frame another way and reports none.
   */
  const caps = selectedModel?.references ?? null;
  const refText = !caps ? null
    : tab === "image" ? (caps.images > 0 ? `รับภาพอ้างอิงได้ ${caps.images} ภาพ` : "ไม่รับภาพอ้างอิง")
      : tab === "video" && caps.firstFrame ? (caps.lastFrame ? "รับภาพเฟรมแรกและเฟรมสุดท้าย" : "รับภาพเฟรมแรก 1 ภาพ")
        : null;
  const trimTooLongNote = trimTooLong && trimSel ? (
    <span style={{ color: "#fbbf24" }}>
      ช่วงที่เลือกยาว {(trimSel.end - trimSel.start).toFixed(1)} วินาที — โมเดลนี้รับไม่เกิน {Math.floor(trimMax)} วินาที ลากขอบให้สั้นลง
    </span>
  ) : null;
  /** Under the voice: the clip is as long as the voice, and so is the price. */
  const voiceNote = trimTooLongNote ?? (voiceRule ? (
    voiceLength?.ok === false ? (
      <span style={{ color: "#fbbf24" }}>{voiceLength.message}</span>
    ) : hasAudio
      ? `ความยาวคลิป = ความยาวเสียง${voiceLength ? ` ${voiceLength.seconds.toFixed(1)} วินาที` : ""} · ✦ ${totalCredits} เครดิต`
      : `คิดเครดิตตามความยาวเสียง: ✦ ${creditsFor(null)} (ไม่เกิน 5 วิ) ถึง ✦ ${creditsFor(lipsyncAudioMax)} (${lipsyncAudioMax} วิ)`
  ) : null);
  const orbModes: OrbItem[] = TAB_ORDER.map((key) => {
    const blocked = tabBlockedReason(key);
    return {
      key,
      label: TAB_LABEL[key],
      icon: TAB_ICON[key],
      active: tab === key,
      // The tab in use stays reachable even when its models went away under it.
      blocked: blocked !== null && tab !== key ? blocked : null,
      onPick: () => pickTab(key),
    };
  });
  const orbLinks: OrbItem[] = [
    // Picture to 3D model has a studio of its own — nothing on this canvas
    // fits a scene you turn around.
    { key: "model3d", label: "สร้างโมเดล 3D", icon: MODEL3D_ICON, href: "/generate/3d", blocked: model3dBlocked },
    { key: "gallery", label: "แกลเลอรี", icon: GALLERY_ICON, href: "/gallery" },
  ];

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
        const files = Array.from(e.dataTransfer.files ?? []);
        // Several pictures at once go into the reference slots together.
        if (tab === "image" && files.length > 1) void addRefFiles(files);
        else if (files[0]) void acceptFile(files[0]);
      }}>

      {/* The memory fountain, faint, behind everything; a few motes rise through it. */}
      <div className="rp-bg" aria-hidden="true">
        <div className="rp-bg-img" />
        <div className="rp-bg-veil" />
        {MOTES.map((m, i) => (
          <span key={i} className="rp-mote" data-tone={m.tone} style={{ left: m.left, animationDuration: m.dur, animationDelay: m.delay }} />
        ))}
      </div>

      {dragging && (
        <div className="rp-drop-hint" aria-hidden="true">
          <div>
            <div style={{ fontSize: 34, marginBottom: 6 }}>⤓</div>
            {tab === "image" ? (refCap === 0 ? "โมเดลนี้ไม่รับภาพอ้างอิง" : "วางภาพเพื่อใช้เป็นภาพอ้างอิง")
              : tab === "edit" ? "วางภาพที่ต้องการแก้ไข"
                : tab === "video" ? "วางภาพเพื่อเริ่มคลิปจากภาพนี้"
                  : tab === "lipsync" ? "วางไฟล์เสียง คลิป หรือรูปหน้าคน"
                    : "วางเพลงต้นฉบับ (โหมดคัฟเวอร์)"}
          </div>
        </div>
      )}

      {/* Phone: the composer fills the screen, so what is rendering is said
          above it, one tap from the canvas further down. */}
      {runningJobs > 0 && (
        <button type="button" className="rp-jobbar"
          onClick={() => document.querySelector(".rp-stage")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          <span className="rp-spin" aria-hidden="true" />
          <span>กำลังสร้าง {runningJobs} งาน{runningFraction != null ? ` · ${Math.floor(runningFraction * 100)}%` : ""}</span>
          <b>ดูผลงาน ↓</b>
        </button>
      )}

      {/* ═══ COMPOSER — everything handed to the model, and the order ═══
          The glass is a layer of its own beside the content, not around it:
          backdrop-filter makes an element the containing block of whatever is
          fixed inside it, and on a phone the order bar is fixed to the screen. */}
      <section className="rp-composer" aria-label="ตั้งค่างาน">
        <div className="rp-hud rp-composer-glass" aria-hidden="true"><span className="rp-led"><i /></span></div>
        <div className="rp-cscroll rp-scroll">
          <div className="rp-chead">
            <div style={{ minWidth: 0 }}>
              <div className="rp-crumb">
                <span className="rp-dot" data-run={runningJobs > 0 ? "true" : "false"} aria-hidden="true" />
                <span className="rp-mono">{sectionNo(tabNo)} / 05</span> สตูดิโอ
              </div>
              <h1 className="rp-title">{TAB_LABEL[tab]}</h1>
            </div>
            {/* Reference material, not controls. */}
            <Popover id="tips" open={openPanel} onToggle={setOpenPanel} label="? คำแนะนำ" width={320} align="right" variant="tool">
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
                  "โมเดลที่รับภาพอ้างอิงหลายภาพ: ใส่ภาพตัวละคร ชุด สิ่งของ สถานที่ แล้วพิมพ์ ภาพ 1, ภาพ 2 ในพรอมต์",
                  "วางภาพ (Ctrl+V) หรือลากไฟล์มาวางตรงไหนก็ได้ ระบบใส่ให้ในช่องที่แท็บนี้ใช้",
                  "สั่งต่อกันได้ถึง 3 งานพร้อมกัน ดูทุกงานที่แถบเหนือแคนวาส · Ctrl/⌘+Enter = ทอ",
                  "ได้ภาพที่ชอบแล้ว กด ▶ ทำเป็นวิดีโอ เพื่อใช้เป็นเฟรมแรกของคลิปได้ทันที",
                  "img2img: ความเข้ม 0.5–0.7 = balance, > 0.8 = ตามภาพอ้างอิงมาก",
                ]).concat("ลูกแก้วมุมจอ: ชี้หรือแตะเพื่อเปลี่ยนโหมด ลากไปวางตรงไหนก็ได้").map((tip, i) => (
                  <div key={i} style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: `hsl(${(160 + i * 30 + HUE) % 360},70%,70%)`, flexShrink: 0 }}>✦</span>
                    <span style={{ fontSize: 12, color: "rgba(203,213,225,0.78)", lineHeight: 1.5 }}>{tip}</span>
                  </div>
                ))}
              </div>
            </Popover>
          </div>

          {/* ── 01 Model ── */}
          <Field no="01" label="โมเดล">
            <div ref={dropdownRef}>
              <button type="button" className="rp-model rp-raised" aria-expanded={showModelDropdown}
                onClick={() => setShowModelDropdown(!showModelDropdown)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small fixed art */}
                <img className="rp-mlogo" src={TAB_ICON[tab]} alt="" width={44} height={44} />
                <span className="rp-mbody">
                  <span className="rp-mname">{selectedModel ? selectedModel.name : modelsLoaded ? "เลือกโมเดล..." : "กำลังโหลดโมเดล…"}</span>
                  {selectedModel && (
                    <span className="rp-mmeta">
                      <span className="rp-tag" data-tone={selectedModel.canOrder === false ? "warn" : "ok"}>
                        {selectedModel.canOrder === false ? (selectedModel.status === "tuning" ? "กำลังปรับแต่ง" : "ยังใช้ไม่ได้") : "พร้อมใช้"}
                      </span>
                      {refText && <span className="rp-tag" data-tone="ref">{refText}</span>}
                      <span className="rp-tag">{selectedModel.provider.name}</span>
                    </span>
                  )}
                </span>
                <span className="rp-mprice">
                  {selectedModel && <b>✦ {selectedModel.creditsPerUnit}</b>}
                  <span>เปลี่ยนโมเดล {showModelDropdown ? "▴" : "▾"}</span>
                </span>
              </button>
              {/* In the flow, not floating: the composer scrolls, and a list
                  hung over it would be cut off by its edge. */}
              {showModelDropdown && (
                <div className="rp-mlist rp-well rp-scroll" role="listbox" aria-label="เลือกโมเดล">
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
                      <button key={m.id} type="button" role="option" aria-selected={selectedModelId === m.id} disabled={blocked}
                        className="rp-mopt" data-on={selectedModelId === m.id ? "true" : "false"}
                        title={blocked ? reason : undefined}
                        onClick={() => { if (blocked) return; setSelectedModelId(m.id); setShowModelDropdown(false); }}>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
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
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: "#94a3b8" }}>
                            {blocked ? reason : `${m.provider.name}${m.subcategory ? ` · ${m.subcategory}` : ""}`}
                          </span>
                        </span>
                        <span style={{ padding: "2px 6px", borderRadius: 6, background: "hsla(48,90%,60%,0.15)", color: "#fbbf24", fontSize: 10, fontWeight: 600, flexShrink: 0 }}>✦ {m.creditsPerUnit}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Field>

          {/* ── 02 Prompt ── */}
          <Field no="02" label={tab === "lipsync" ? "Prompt (ไม่บังคับ)" : tab === "audio" ? "สไตล์เพลง" : "Prompt"}
            aside={`${prompt.trim() ? `${prompt.trim().split(/\s+/).length} คำ · ` : ""}${prompt.length.toLocaleString()} / 10,000`}>
            <div className="rp-prompt rp-well">
              {/* Read-only while ✨ works: its answer replaces the box, and would
                  silently drop anything typed in the meantime (Context-IR can
                  take a minute). */}
              <textarea ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onSubmitKey}
                readOnly={enhancing} aria-busy={enhancing} aria-label="Prompt"
                placeholder={
                  tab === "lipsync"
                    ? lipsyncNeeds === "image"
                      ? "อธิบายท่าทาง/บรรยากาศเพิ่มได้ เช่น พิธีกรยิ้มแย้ม พูดกับกล้อง..."
                      : "ไม่ต้องใส่ก็ได้ — เสียงที่อัปโหลดเป็นตัวกำหนดผลลัพธ์"
                    : tab === "video"
                      ? "อธิบายวิดีโอที่ต้องการ..."
                      : tab === "audio"
                        ? "แนวเพลง อารมณ์ เครื่องดนตรี เสียงร้อง เช่น ป๊อปไทยสดใส เสียงร้องหญิง กีตาร์โปร่ง จังหวะเร็ว"
                        : multiRef && refs.length > 1
                          ? "เช่น ผู้หญิงจาก ภาพ 1 สวมชุดจาก ภาพ 2 ยืนหน้าร้านใน ภาพ 3 แสงเย็นอ่อน ๆ"
                          : "อธิบายภาพที่ต้องการ..."
                }
                style={{ minHeight: tab === "audio" ? 72 : 104, opacity: enhancing ? 0.6 : 1 }} />
              {/* The prompt assistant: short idea in, the model's own format
                  out. The result replaces the box's text where the customer
                  can read and edit it — and ↶ puts back what they wrote. */}
              <div className="rp-ptools">
                <button type="button" className="rp-tool rp-tool-ai" onClick={handleEnhance} disabled={enhancing || !prompt.trim()}
                  title={tab === "video" && selectedModel?.modelId === "minimax-h3"
                    ? "เรียบเรียงเป็นโครงช็อต กล้อง และเสียง ตามรูปแบบที่ MiniMax H3 ถูกฝึกมา"
                    : "ให้ AI ขยายไอเดียสั้น ๆ เป็นพรอมต์ที่โมเดลเข้าใจดีที่สุด"}>
                  <span className={enhancing ? "xdr-motion" : undefined} style={enhancing ? { display: "inline-block", animation: "spin 1.2s linear infinite" } : undefined}>✨</span>
                  {enhancing
                    ? (tab === "video" && selectedModel?.modelId === "minimax-h3" ? "กำลังเรียบเรียงฉาก… (อาจถึง 1 นาที)" : "กำลังเรียบเรียง…")
                    : tab === "audio" ? "ช่วยเขียนสไตล์เพลง" : "ปรับพรอมต์ด้วย AI"}
                </button>
                {promptBeforeEnhance !== null && !enhancing && (
                  <button type="button" className="rp-tool rp-raised" onClick={undoEnhance}>↶ ใช้ข้อความเดิม</button>
                )}
                {/* Prompt builder. Pictures get their vocabulary as comma-joined
                    phrases; clips get camera and shot direction as sentences
                    (the form video models read it in); songs keep their tag chips. */}
                <Popover id="tags" open={openPanel} onToggle={setOpenPanel} variant="tool" width={320}
                  label={tab === "audio" ? "+ แท็ก" : tab === "video" || tab === "lipsync" ? "🎥 กล้องและฉาก" : "✦ ตัวช่วยพรอมต์"}>
                  {tab === "audio" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {MUSIC_TAG_CHIPS.map((t) => {
                        const already = prompt.toLowerCase().includes(t.toLowerCase());
                        return (
                          <button key={t} type="button" onClick={() => addPromptTag(t)}
                            style={{
                              padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
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
                {/* Templates are about pictures — none of them reaches a music model. */}
                {templates.length > 0 && tab !== "edit" && tab !== "audio" && (
                  <Popover id="templates" open={openPanel} onToggle={setOpenPanel} label="เทมเพลต" variant="tool" width={300}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {templates.slice(0, 10).map(t => (
                        <button key={t.id} type="button" title={t.description || t.prompt}
                          onClick={() => { setPrompt(t.prompt); setNegativePrompt(t.negativePrompt || ""); setOpenPanel(null); }}
                          style={{
                            padding: "6px 11px", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                            background: "rgba(255,255,255,0.05)", color: "#cbd5e1",
                            border: "1px solid rgba(255,255,255,0.1)",
                          }}>
                          {t.isFeatured ? "★ " : ""}{t.name}
                        </button>
                      ))}
                    </div>
                  </Popover>
                )}
                <span className="rp-kbd rp-mono" title="สั่งสร้างจากช่องพิมพ์ได้เลย">Ctrl/⌘ + Enter = ทอ</span>
              </div>
            </div>
            {/* The free Pollinations model does not understand Thai — it renders
                an unrelated image instead of failing, so warn before credits are spent. */}
            {selectedModel?.provider.slug === "pollinations" && THAI_CHARS.test(prompt) && (
              <div className="rp-warn" style={{ marginTop: 8 }}>
                โมเดลฟรีอ่านภาษาไทยไม่ออก — จะได้ภาพที่ไม่ตรงกับที่พิมพ์ กรุณาพิมพ์ prompt เป็นภาษาอังกฤษ หรือเลือกโมเดลแบบเสียเครดิต
              </div>
            )}
            {enhanceNote && (
              <div style={{ fontSize: 10.5, color: "#a78bfa", marginTop: 6 }}>✦ {enhanceNote} — แก้ต่อได้ตามใจ</div>
            )}
          </Field>

          {/* ── Lyrics (music) ── */}
          {showLyrics && (
            <Field no={sectionNo(3)} label="เนื้อเพลง" aside={`${lyrics.length.toLocaleString()} / 3,000`}>
              <div className="rp-lyrics-tools">
                {SECTION_TAGS.map((tag) => (
                  <button key={tag} type="button" className="rp-sectag rp-mono" disabled={instrumental}
                    onClick={() => setLyrics((l) => `${l.replace(/\s*$/, "")}${l.trim() ? "\n\n" : ""}${tag}\n`.slice(0, 3000))}>
                    {tag}
                  </button>
                ))}
                <label className="rp-check">
                  <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />
                  เพลงบรรเลง (ไม่มีเสียงร้อง)
                </label>
              </div>
              <div className="rp-prompt rp-well" style={{ marginTop: 8 }}>
                <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value.slice(0, 3000))} onKeyDown={onSubmitKey}
                  disabled={instrumental} aria-label="เนื้อเพลง"
                  placeholder={"[Verse]\nเขียนเนื้อร้องที่นี่\n\n[Chorus]\nท่อนฮุกที่อยากให้ติดหู"}
                  style={{ minHeight: 220, opacity: instrumental ? 0.45 : 1 }} />
              </div>
              <div className="rp-note">
                {instrumental ? "โหมดบรรเลง — เนื้อร้องที่พิมพ์ไว้จะถูกเก็บไว้เฉย ๆ" : "วงเล็บเหลี่ยมบอกโมเดลว่าเป็นท่อนอะไร"}
              </div>
              {/* Exactly what the model will be told, composed by the same
                  function the server uses. Shown because chips whose effect
                  you cannot see are chips you cannot learn to use. */}
              {styleSummary && (
                <div className="rp-well" style={{ marginTop: 10, padding: "9px 11px", borderRadius: 10 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#a5f3fc", marginBottom: 5, textTransform: "uppercase" }}>
                    สไตล์ที่ส่งให้ AI
                  </div>
                  <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.55, wordBreak: "break-word" }}>
                    {styleSummary}
                  </div>
                </div>
              )}
            </Field>
          )}

          {/* ── 03 The files this mode takes ── */}
          {showInputs && (
            <Field no={sectionNo(inputsAt)} label={inputsLabel}
              aside={tab === "image" && multiRef ? `${refs.length} / ${refCap} ภาพ` : undefined}>

              {/* Reference pictures. Several, each with what it is, for a model
                  that composes from several; one with its strength for img2img;
                  none — said rather than offered — for a model that takes none. */}
              {tab === "image" && (refCap === 0 ? (
                <div className="rp-note" style={{ marginTop: 0 }}>
                  โมเดลนี้ไม่รับภาพอ้างอิง — ถ้าอยากให้ภาพออกมาตามรูปของคุณ เลือกโมเดลที่มีป้าย “รับภาพอ้างอิงได้”
                  {refs.length > 0 ? " · ภาพที่ใส่ไว้จะไม่ถูกส่งไปกับงานนี้" : ""}
                </div>
              ) : (
                <div className="rp-refbox rp-well">
                  {multiRef && (
                    <div className="rp-rmeter" aria-hidden="true">
                      {Array.from({ length: refCap }, (_, i) => <i key={i} data-on={i < refs.length ? "true" : "false"} />)}
                    </div>
                  )}
                  <div className="rp-rgrid" data-single={multiRef ? undefined : "true"}>
                    {refs.map((r, i) => (
                      <div key={r.id} className="rp-rtile" data-main={multiRef && i === 0 ? "true" : undefined}>
                        {r.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.url} alt={`ภาพอ้างอิง ${i + 1}`} loading="lazy"
                            onError={() => dropExpiredInput(r.url, () => removeRef(r.id))} />
                        ) : (
                          <span className="rp-spin" role="status" aria-label="กำลังอัปโหลด" />
                        )}
                        {multiRef && <span className="rp-rno rp-mono">{i + 1}</span>}
                        <button type="button" className="rp-rx" onClick={() => removeRef(r.id)} aria-label={`เอาภาพ ${i + 1} ออก`}>×</button>
                        {multiRef && (
                          <button type="button" className="rp-rrole" onClick={() => cycleRole(r.id)} title="กดเพื่อเปลี่ยนว่าภาพนี้คืออะไร">
                            {roleLabel(r.role)} ▾
                          </button>
                        )}
                      </div>
                    ))}
                    {refs.length < refCap && (
                      <label className="rp-radd">
                        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
                        {multiRef ? "เพิ่มภาพ" : "อัปโหลดภาพอ้างอิง"}
                        <small>{multiRef ? `อีก ${refCap - refs.length} ภาพ · เลือกหลายภาพได้` : "ลาก & วาง หรือ Ctrl+V"}</small>
                        <input type="file" accept="image/png,image/jpeg,image/webp" multiple={multiRef} hidden
                          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void addRefFiles(files); }} />
                      </label>
                    )}
                  </div>
                  {multiRef ? (
                    <>
                      <div className="rp-rhint">
                        พิมพ์ <b>ภาพ 1</b>, <b>ภาพ 2</b> … ในพรอมต์เพื่อบอกว่าใช้ภาพไหนตรงไหน · กดป้ายใต้ภาพเพื่อบอกว่าเป็นตัวละคร ชุด สิ่งของ หรือสถานที่
                      </div>
                      {refs.length > 0 && (
                        <div className="rp-rins">
                          <span>แทรกในพรอมต์:</span>
                          {refs.map((r, i) => (
                            <button key={r.id} type="button" className="rp-raised" onClick={() => insertRefToken(i + 1)}>{referenceToken(i + 1)}</button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : refs.length > 0 && (
                    <div className="rp-slider">
                      <div><span>ความเข้มอ้างอิง</span><b className="rp-mono">{Math.round(strength * 100)}%</b></div>
                      <input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(+e.target.value)}
                        aria-label="ความเข้มอ้างอิง" />
                    </div>
                  )}
                  {refsOver && (
                    <div className="rp-warn" style={{ marginTop: 10 }}>
                      โมเดลนี้รับภาพอ้างอิงได้ {refCap} ภาพ — เอาออกให้เหลือ {refCap} ภาพก่อนสั่ง
                    </div>
                  )}
                </div>
              ))}

              {/* Text→video or image→video. The providers have always supported
                  both; this is the control that says which one, instead of
                  leaving it to be inferred from whether an upload is present. */}
              {tab === "video" && (
                <>
                  <div className="rp-seg rp-well">
                    {([
                      { key: "t2v" as const, label: "ข้อความ → วิดีโอ", hint: "เริ่มจากคำอธิบายล้วน" },
                      { key: "i2v" as const, label: "ภาพ → วิดีโอ", hint: "ทำให้ภาพที่มีอยู่เคลื่อนไหว" },
                    ]).map((m) => (
                      <button key={m.key} type="button" data-on={videoMode === m.key ? "true" : "false"} onClick={() => setVideoMode(m.key)}>
                        <b>{m.label}</b>
                        <span>{m.hint}</span>
                      </button>
                    ))}
                  </div>
                  {videoMode === "t2v" ? (
                    // The upload lives behind the mode, so on t2v the slot would
                    // simply be absent with nothing saying why. Offer it, one click.
                    <button type="button" className="rp-drop" style={{ marginTop: 10 }} onClick={() => setVideoMode("i2v")}>
                      <span className="rp-drop-ic" aria-hidden="true">↑</span>
                      อยากให้คลิปเริ่มจากภาพของคุณ?
                      <small>กดที่นี่เพื่อสลับเป็นโหมด “ภาพ → วิดีโอ”</small>
                    </button>
                  ) : (
                    <div className="rp-frames" data-two={offersLastFrame ? "true" : undefined}>
                      <div>
                        <div className="rp-sub">ภาพเริ่มต้น</div>
                        <ImageSlot src={inputImagePreview} alt="ภาพเริ่มต้น" hint="อัปโหลดภาพ" accept="image/*"
                          onPick={handleImageUpload} onClear={clearInputImage} onLoad={onInputImageLoad}
                          onError={() => dropExpiredInput(inputImagePreview, clearInputImage)} />
                      </div>
                      {/* The frame the clip should end on — first-and-last-frame
                          models only. Optional: without it the model decides. */}
                      {offersLastFrame && (
                        <div>
                          <div className="rp-sub">ภาพสุดท้าย (ไม่บังคับ)</div>
                          <ImageSlot src={inputImageEnd} alt="ภาพสุดท้าย" hint="ภาพที่ต้องการให้คลิปจบ" accept="image/png,image/jpeg,image/webp"
                            busy={uploading === "image"} onPick={handleEndFrameUpload} onClear={() => setInputImageEnd(null)}
                            onError={() => dropExpiredInput(inputImageEnd, () => setInputImageEnd(null))} />
                        </div>
                      )}
                    </div>
                  )}
                  {/* Why there is no end-frame slot: without this it just
                      vanishes, which reads as a missing feature, not a model limit. */}
                  {videoMode === "i2v" && selectedModel?.video?.lastFrame !== true && (
                    <div className="rp-note">
                      โมเดลนี้กำหนด<span style={{ color: "#94a3b8" }}>ภาพสุดท้าย</span>ของคลิปไม่ได้ — ถ้าต้องการ ให้เลือกโมเดลที่รองรับ first-and-last-frame
                    </div>
                  )}
                </>
              )}

              {tab === "edit" && (
                <ImageSlot src={inputImagePreview} alt="ภาพต้นฉบับ" hint="อัปโหลดภาพที่ต้องการแก้ไข" accept="image/*"
                  onPick={handleImageUpload} onClear={clearInputImage} onLoad={onInputImageLoad}
                  onError={() => dropExpiredInput(inputImagePreview, clearInputImage)} />
              )}

              {/* Lip-sync: the thing that speaks, and the voice. Clip and voice
                  go to R2 first and only their URLs travel with the order. */}
              {tab === "lipsync" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {lipsyncNeeds === "image" ? (
                    <div>
                      <div className="rp-sub">รูปหน้าคนที่จะให้พูด</div>
                      {/* What the rented worker can read (frame-input.ts) — a GIF
                          or HEIC portrait would only be refused at the order. */}
                      <ImageSlot src={inputImagePreview} alt="รูปหน้าคน" hint="อัปโหลดรูปหน้าคน" accept="image/png,image/jpeg,image/webp"
                        onPick={handleImageUpload} onClear={clearInputImage} onLoad={onInputImageLoad}
                        onError={() => dropExpiredInput(inputImagePreview, clearInputImage)} />
                      <div className="rp-note">ใช้รูปที่เห็นหน้าชัด หันเข้ากล้อง ปากไม่ถูกบัง — คลิปจะออกมาตามสัดส่วนของรูป</div>
                    </div>
                  ) : (
                    <div>
                      <div className="rp-sub">คลิปต้นฉบับที่จะพากย์ทับ</div>
                      <FilePick
                        value={sourceVideoName}
                        busy={uploading === "video"}
                        accept="video/mp4,video/webm,video/quicktime"
                        hint="อัปโหลดคลิป (MP4 / WebM)"
                        onPick={(e) => handleMediaUpload(e, "video", clipMaxSeconds)}
                        onClear={() => { setSourceVideo(null); setSourceVideoName(null); }}
                      />
                      {/* A clip put back from a reopened order: the customer may
                          not have it to hand any more, so it is shown, not named. */}
                      {sourceVideo && sourceVideo === openedInputs?.inputVideo && (
                        <video src={sourceVideo} controls muted playsInline preload="metadata"
                          onError={() => dropExpiredInput(sourceVideo, () => { setSourceVideo(null); setSourceVideoName(null); })}
                          style={{ width: "100%", maxHeight: 180, marginTop: 8, borderRadius: 10, background: "#000", display: "block" }} />
                      )}
                      {sourceClip && (
                        <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: "#a5f3fc" }}>
                          คลิป {sourceClip.seconds.toFixed(1)} วินาที · {sourceClip.width}×{sourceClip.height}
                          {videoRule?.billing?.kind === "clipBlocks" && clipCheck?.ok !== false ? ` · ✦ ${totalCredits} เครดิต` : ""}
                        </div>
                      )}
                      {clipCheck?.ok === false && <div className="rp-warn" style={{ marginTop: 8 }}>{clipCheck.message}</div>}
                      <div className="rp-note">
                        {clipRuleHint(videoRule?.clip, videoRule?.billing ?? null)} · เห็นหน้าชัด · เสียงเดิมในคลิปจะถูกแทนที่ทั้งหมด
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="rp-sub">ไฟล์เสียงที่จะให้พูด</div>
                    {/* Hear it, and keep only the part to be spoken, before paying for it. */}
                    {trimSrc && trimSel ? (
                      <AudioTrimmer file={trimSrc.file} buffer={trimSrc.buffer} range={trimSel} maxSeconds={lipsyncAudioMax}
                        onChange={setTrimSel} onDragging={setTrimDragging} accept={AUDIO_ACCEPT}
                        onPick={(e) => handleMediaUpload(e, "audio", lipsyncAudioMax)} onClear={clearAudio}
                        state={trimState} onRetry={() => setTrimFailed(null)} note={voiceNote} />
                    ) : (
                      <>
                        <FilePick
                          value={inputAudioName}
                          busy={uploading === "audio"}
                          accept={AUDIO_ACCEPT}
                          hint={voiceRule ? `อัปโหลดเสียงพูด (MP3 / WAV / M4A) ใช้ได้ไม่เกิน ${lipsyncAudioMax} วินาที` : "อัปโหลดเสียง (MP3 / WAV / M4A)"}
                          onPick={(e) => handleMediaUpload(e, "audio", lipsyncAudioMax)}
                          onClear={clearAudio}
                        />
                        {inputAudio && inputAudio === openedInputs?.inputAudio && (
                          <audio src={inputAudio} controls preload="metadata"
                            // A track put back from a past order has no upload
                            // reading: the player's prices it here (the server re-reads it).
                            onLoadedMetadata={(e) => {
                              const d = e.currentTarget.duration;
                              if (Number.isFinite(d) && d > 0) setAudioLengths((m) => (inputAudio in m ? m : { ...m, [inputAudio]: d }));
                            }}
                            onError={() => dropExpiredInput(inputAudio, clearAudio)}
                            style={{ width: "100%", height: 36, marginTop: 8 }} />
                        )}
                        {voiceNote && <div className="rp-note" style={{ color: "#a5f3fc" }}>{voiceNote}</div>}
                      </>
                    )}
                    {clipVoiceCheck?.ok === false && <div className="rp-warn" style={{ marginTop: 8 }}>{clipVoiceCheck.message}</div>}
                    <div className="rp-note">พูดภาษาอะไรก็ได้รวมถึงไทย — โมเดลอ่านคลื่นเสียงเป็นรูปปาก ไม่ได้อ่านภาษา</div>
                  </div>
                </div>
              )}

              {/* Cover mode: the model transcribes this song's melody and sings
                  it again in the style above. */}
              {tab === "audio" && musicOpts?.sourceSong && (
                <>
                  {trimSrc && trimSel ? (
                    <AudioTrimmer file={trimSrc.file} buffer={trimSrc.buffer} range={trimSel} maxSeconds={coverSourceSeconds}
                      onChange={setTrimSel} onDragging={setTrimDragging} accept={AUDIO_ACCEPT}
                      onPick={(e) => handleMediaUpload(e, "audio", coverSourceSeconds)} onClear={clearAudio}
                      state={trimState} onRetry={() => setTrimFailed(null)} note={trimTooLongNote} />
                  ) : (
                    <>
                      {/* `coverSourceSeconds` is what a cover may start *from* —
                          not what the model may sing. Floored, not rounded: the
                          cap is 5 min 30 s and `Math.round` advertised "6 นาที".
                          Under-promise on a limit. */}
                      <FilePick
                        value={inputAudioName}
                        busy={uploading === "audio"}
                        accept={AUDIO_ACCEPT}
                        hint={`อัปโหลดเพลง MP3 / WAV — ใช้ได้ไม่เกิน ${Math.floor(coverSourceSeconds / 60)} นาที เลือกช่วงได้หลังอัปโหลด`}
                        onPick={(e) => handleMediaUpload(e, "audio", coverSourceSeconds)}
                        onClear={clearAudio}
                      />
                      {/* The song of a reopened cover. No waveform: R2 sends no
                          CORS header, so the browser can play it but not read it. */}
                      {inputAudio && inputAudio === openedInputs?.inputAudio && (
                        <audio src={inputAudio} controls preload="metadata"
                          onError={() => dropExpiredInput(inputAudio, clearAudio)}
                          style={{ width: "100%", height: 36, marginTop: 10 }} />
                      )}
                    </>
                  )}
                  <div className="rp-note">
                    AI ถอดเฉพาะ<strong style={{ color: "#94a3b8" }}>ทำนอง</strong>ออกมาแล้วร้องใหม่ทั้งเพลง — เสียงร้องเดิมไม่ได้ถูกนำมาใช้
                    ถ้าอยากได้คำร้องเดิม ให้พิมพ์ลงช่องเนื้อเพลง · ไฟล์ใหญ่เกิน 12 MB ระบบแปลงช่วงที่เลือกเป็น MP3 ให้เอง
                  </div>
                </>
              )}
            </Field>
          )}

          {/* ── Settings: the knobs, as chips where a glance should tell ── */}
          <Field no={sectionNo(settingsAt)} label="ตั้งค่า">
            <div className="rp-sets">
              {/* Lip-sync has no aspect to choose: the result keeps the shape
                  of the clip or the portrait it was given. */}
              {tab !== "edit" && tab !== "lipsync" && tab !== "audio" && (
                <div>
                  <div className="rp-sub">สัดส่วน</div>
                  <div className="rp-chips">
                    {aspectRatios
                      .filter(ar => tab !== "video" || VIDEO_ASPECTS.includes(ar.value))
                      .map(ar => {
                        const [w, h] = ar.value.split(":").map(Number);
                        const unit = 13 / Math.max(w, h);
                        return (
                          <button key={ar.value} type="button" className="rp-chip rp-raised" data-on={aspectRatio === ar.value ? "true" : "false"}
                            onClick={() => setAspectRatio(ar.value)}>
                            <span className="rp-shape" aria-hidden="true" style={{ width: Math.round(w * unit), height: Math.round(h * unit) }} />
                            {ar.label}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Clip length. `ai_models.max_duration` is the ceiling — offering
                  20s on a model that tops out at 5 just buys a failed job.
                  Hidden on a model that decides its own length: there the number
                  was never a length anyone received, only where the song got cut. */}
              {(tab === "video" || (tab === "audio" && !musicOpts?.autoLength)) && (
                <div>
                  <div className="rp-sub">ความยาว</div>
                  <div className="rp-chips">
                    {durationChoices.map(d => (
                      <button key={d} type="button" className="rp-chip rp-raised" data-on={duration === d ? "true" : "false"} onClick={() => setDuration(d)}>
                        {tab === "audio" && d >= 60 && d % 60 === 0 ? `${d / 60} นาที` : `${d}s`}
                        {/* Priced by length: say so before the order, not on the receipt. */}
                        {selectedModel?.durationCurve && <small>✦ {creditsFor(d)}</small>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hidden when the model yields one output per order — offering 4
                  would take payment for images it never renders. */}
              {tab === "image" && selectedModel?.maxOutputs !== 1 && (
                <div>
                  <div className="rp-sub">จำนวน</div>
                  <div className="rp-chips">
                    {[1, 2, 3, 4].map(n => (
                      <button key={n} type="button" className="rp-chip rp-raised" data-on={numOutputs === n ? "true" : "false"}
                        style={{ minWidth: 44, justifyContent: "center" }} onClick={() => setNumOutputs(n)}>{n}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Resolution presets — only where the model offers a real choice
                  for this aspect ratio (H3: 768p / 720p / 544p on 16:9). */}
              {resolutionChoices.length > 1 && (
                <div>
                  <div className="rp-sub">ความละเอียด</div>
                  <div className="rp-chips">
                    {resolutionChoices.map(r => (
                      <button key={r.id} type="button" className="rp-chip rp-raised" data-on={activeResolution?.id === r.id ? "true" : "false"}
                        onClick={() => setResolution(r.id)}>{r.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quality modes — only where the model offers a real choice (Qwen-
                  Image: Lightning vs the full model). Each carries its price
                  multiplier, and the button's total already includes it. */}
              {qualityModes && qualityModes.length > 1 && (
                <div>
                  <div className="rp-sub">คุณภาพ</div>
                  <div className="rp-chips">
                    {qualityModes.map((m) => (
                      <button key={m.id} type="button" className="rp-chip rp-raised" data-on={activeQuality?.id === m.id ? "true" : "false"}
                        title={m.description} onClick={() => setQualityId(m.id)}>
                        {m.label}{m.adminOnly ? " · ทดลอง (เห็นเฉพาะแอดมิน)" : ""}
                        <small>{m.creditsMultiplier === 1 ? "ราคาปกติ" : `×${m.creditsMultiplier} เครดิต`}</small>
                      </button>
                    ))}
                  </div>
                  {activeQuality?.description && <div className="rp-note">{activeQuality.description}</div>}
                </div>
              )}

              <div className="rp-poprow">
                {/* The image styles are about pictures — none reaches a music model. */}
                {stylesLoaded && styles.length > 0 && tab !== "edit" && tab !== "audio" && (
                  <Popover id="style" open={openPanel} onToggle={setOpenPanel} label="สไตล์"
                    value={selectedStyle ? (styles.find(s => s.id === selectedStyle)?.name ?? "") : "—"} width={300}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                      {styles.slice(0, 12).map(s => (
                        <button key={s.id} type="button" onClick={() => setSelectedStyle(selectedStyle === s.id ? null : s.id)}
                          style={{
                            padding: "7px 6px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                            background: selectedStyle === s.id ? `hsla(${220 + HUE},60%,50%,0.25)` : "rgba(255,255,255,0.04)",
                            color: selectedStyle === s.id ? "#fff" : "#94a3b8",
                            border: selectedStyle === s.id ? `1px solid hsla(${220 + HUE},70%,60%,0.5)` : "1px solid rgba(255,255,255,0.08)",
                          }}>{s.name}</button>
                      ))}
                    </div>
                  </Popover>
                )}

                {/* ── Song direction ───────────────────────────────────────
                    Three panels rather than one: the official YuE2 template asks
                    for language, genre, vocal, tempo, instruments and mood, which
                    is far more than fits one popover, and they are chosen at
                    different moments. Every chip ends up in the model's `[Tags]`
                    line; the two sliders do not, they are real node inputs. */}
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

                      {/* Tempo is off by default: an unasked-for BPM is a
                          constraint the model did not need, and a wrong one
                          fights the lyrics. */}
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
                          (chord-annotated score vs melody only) and variety is
                          its sampling temperature. */}
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

                {/* Video keeps this panel too — steps and guidance mean nothing
                    to a video endpoint, but seed does, and locking the whole
                    panel away took reproducible clips with it. */}
                <Popover id="advanced" open={openPanel} onToggle={setOpenPanel} label="⚙ ขั้นสูง" width={300} align="right">
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
              </div>

              {tab !== "edit" && tab !== "audio" && (
                <input className="rp-input rp-well" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)}
                  aria-label="Negative prompt" placeholder="Negative prompt — blurry, low quality, text..." />
              )}
            </div>
          </Field>

          {/* Every model in this tab may still be unproven, in which case
              auto-select lands on one anyway. Say why the button is dead
              rather than letting it look broken. */}
          {selectedModel?.canOrder === false && (
            <div className="rp-warn">
              {selectedModel.unavailableReason ?? selectedModel.tuningMessage ?? "โมเดลนี้ยังใช้งานไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง"}
            </div>
          )}
          {loadingInputs && <div className="rp-info">กำลังโหลดไฟล์แนบของงานเดิม…</div>}
          {missingStartFrame && !loadingInputs && <div className="rp-warn">โหมด “ภาพ → วิดีโอ” ต้องอัปโหลดภาพเริ่มต้นก่อน</div>}
          {missingLipsyncInput && !loadingInputs && (
            <div className="rp-warn">
              {!hasAudio
                ? "ต้องอัปโหลดไฟล์เสียงที่จะให้พูดก่อน"
                : lipsyncNeeds === "image"
                  ? "ต้องอัปโหลดรูปหน้าคนที่จะให้พูดก่อน"
                  : "ต้องอัปโหลดคลิปต้นฉบับที่จะพากย์ทับก่อน"}
            </div>
          )}
        </div>

        {/* ═══ The order: balance, price, and the button that spends it ═══
            It no longer locks while a render runs: orders queue side by side
            in the tray, up to MAX_PARALLEL_JOBS. */}
        <div className="rp-order">
          {/* Said before the order, not after the server refuses it. The
              server stays the judge — a balance topped up in another tab is
              read fresh there — so the button is not locked by this. */}
          {shortOfCredits && (
            <div className="rp-short">
              เครดิตไม่พอสำหรับงานนี้ — ต้องใช้ {totalCredits.toLocaleString()} มีอยู่ {creditBalance.toLocaleString()}{" "}
              <a href="/pricing">เติมเครดิต →</a>
            </div>
          )}
          <div className="rp-osum">
            <span>คงเหลือ <b>{creditBalance.toLocaleString()}</b> เครดิต</span>
            <a href="/pricing">+ เติมเครดิต</a>
          </div>
          <button type="button" className="rp-go" onClick={() => handleGenerate()} disabled={cannotSubmit}>
            {runningJobs >= MAX_PARALLEL_JOBS ? (
              <span className="rp-go-label" style={{ fontSize: 14 }}>⟳ กำลังสร้าง {runningJobs} งาน — รอให้เสร็จก่อน</span>
            ) : (
              <>
                <span className="rp-go-label">ทอ</span>
                <span className="rp-gop">✦ {outputs > 1 ? `${outputs} ภาพ · ` : ""}{totalCredits || "—"} เครดิต</span>
              </>
            )}
          </button>
          <div className="rp-onote">
            {runningJobs >= MAX_PARALLEL_JOBS
              ? "รอให้งานใดงานหนึ่งเสร็จก่อน แล้วค่อยสั่งเพิ่ม"
              : runningJobs > 0
                ? `กำลังสร้างอยู่ ${runningJobs} งาน · สั่งเพิ่มได้อีก ${MAX_PARALLEL_JOBS - runningJobs} งาน`
                : `ทำพร้อมกันได้ ${MAX_PARALLEL_JOBS} งาน · Ctrl/⌘ + Enter = ทอ`}
          </div>
        </div>
      </section>

      {/* ═══ STAGE — the orders, the canvas, the latest pieces ═══ */}
      <main className="rp-stage">
        {/* The order tray: every order placed from this page, newest first.
            Orders render side by side (up to MAX_PARALLEL_JOBS); the canvas
            shows the one picked here. */}
        {jobs.length > 0 && (
          <div className="rp-tray rp-scroll" role="list" aria-label="งานที่สั่ง">
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
                      <span className="rp-spin" aria-hidden="true" />
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

        <div className="rp-canvas rp-hud">
          <span className="rp-led" aria-hidden="true"><i /></span>
          <div className="rp-cbar">
            <span className="rp-dot" data-run={isGenerating ? "true" : "false"} aria-hidden="true" />
            <span className="rp-mono">{TAB_LABEL[canvasTab]}{canvasTab === "audio" ? "" : ` · ${canvasAspect}`}</span>
            <span>{canvasState}</span>
            <span className="rp-cbar-r">
              {/* Variations is just another order, so it follows the button's rule. */}
              <Pill disabled={cannotSubmit}
                title={cannotSubmit && selectedModel?.canOrder === false ? (selectedModel.unavailableReason ?? undefined) : "สั่งอีกรอบด้วย seed ใหม่"}
                onClick={() => { if (cannotSubmit) return; handleGenerate({ seed: Math.floor(Math.random() * 2_147_483_647) }); }}>Variations</Pill>
              {tab === "image" && (
                <Pill disabled={!upscaleAvailable}
                  title={upscaleAvailable ? undefined : "Upscale ยังไม่เปิดให้บริการ"}
                  onClick={() => upscaleAvailable && result?.id && handleUpscale()}>{isUpscaling ? "⟳ Upscale" : "Upscale"}</Pill>
              )}
              <Pill onClick={() => { window.location.href = "/gallery"; }}>History</Pill>
            </span>
          </div>

          {/* Result canvas — the only element that flexes, so the workspace
              fills the viewport exactly instead of overflowing it. */}
          <div className="rp-studio-canvas rp-scroll">
            {isGenerating ? (
              <div style={{ width: "100%" }}>
                {/* Width follows the height cap, so the frame keeps its shape
                    and always fits: one frame per output that is actually
                    coming — a 2×2 grid fills the same box as a single frame. */}
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
                        <button type="button" onClick={() => handleDownload(url)} aria-label={`ดาวน์โหลดภาพที่ ${i + 1}`}
                          style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 8, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", fontSize: 13 }}>↓</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 16, border: "1px solid rgba(255,255,255,0.06)" }}>
                    {originalImage ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
                        <div style={{ position: "relative" }}>
                          <span style={{ position: "absolute", top: 8, left: 8, zIndex: 2, padding: "3px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", fontSize: 10, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>ต้นฉบับ</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={originalImage} alt="Original" style={{ width: "100%", borderRadius: 12, opacity: 0.7, objectFit: "contain" }} />
                        </div>
                        <div style={{ position: "relative" }}>
                          <span style={{ position: "absolute", top: 8, left: 8, zIndex: 2, padding: "3px 8px", borderRadius: 999, background: `hsla(${160 + HUE},70%,50%,0.3)`, backdropFilter: "blur(8px)", fontSize: 10, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>ผลลัพธ์</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={result.resultUrl} alt={prompt} style={{ width: "100%", borderRadius: 12, objectFit: "contain" }} />
                        </div>
                      </div>
                    ) : AUDIO_EXT.test(result.resultUrl) ? (
                      <AudioResult src={result.resultUrl} title={viewing?.prompt || songTitle || "เพลงของคุณ"} genId={result.id} />
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
                    {viewing && formBeforeOpen && (
                      <Pill onClick={restoreDraft} title="คืน prompt การตั้งค่า และไฟล์แนบที่เขียนค้างไว้ก่อนเปิดงานนี้">↶ กลับไปร่างเดิม</Pill>
                    )}
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

                {/* Retention notice — stated at the moment of delivery, because
                    a customer who is never told the window will lose work they
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
                <button type="button" onClick={clearCanvas}
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
                        <button key={s} type="button" className="rp-chip rp-raised" onClick={() => setPrompt(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : tab === "image" ? (
                  <div className="rp-samples">
                    {STUDIO_SAMPLES.image.map((s) => (
                      <SampleFrame key={s.src} src={s.src} label={s.label} aspect={aspectRatio} />
                    ))}
                  </div>
                ) : (
                  <div style={{ aspectRatio: ASPECT_RATIO_CSS[aspectRatio] || "1/1", maxHeight: 520, maxWidth: "100%", margin: "0 auto" }}>
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
        </div>

        {/* The latest pieces, one row. It stays while a render runs now: a
            single row costs 46 px, and the canvas sizes itself from what is
            left (container query), so the queue animation still fits. */}
        {history.length > 0 && (
          <div className="rp-recent">
            <span className="rp-rl">ล่าสุด · <a href="/gallery">ดูทั้งหมด →</a></span>
            <div className="rp-recent-row rp-scroll">
              {history.slice(0, 16).map((g) => {
                const src = g.thumbnailUrl || g.resultUrl;
                const isVideo = g.type === "video" || g.resultUrl?.endsWith(".mp4");
                // A provider that hands back a real poster image keeps <img>.
                const srcIsVideo = isVideo && !/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(src ?? "");
                // A song has nothing to draw; it gets a note on its own colour.
                const isAudio = g.type === "audio" || AUDIO_EXT.test(src ?? "");
                return (
                  <button key={g.id} type="button" className="rp-thumb" title={`${g.prompt}\n— กดเพื่อเปิดงานนี้ พร้อม prompt การตั้งค่า และไฟล์แนบเดิม`}
                    // Opens the piece on the canvas and puts the whole order
                    // back on its own tab (openHistory).
                    onClick={() => void openHistory(g)}
                    aria-current={viewing?.id === g.id ? "true" : undefined}
                    style={{ background: `linear-gradient(135deg, hsl(${(g.id * 23 + HUE) % 360}, 50%, 15%), hsl(${(g.id * 23 + 60 + HUE) % 360}, 50%, 8%))` }}>
                    {/* A video's thumbnail is the video itself (rented-GPU jobs
                        store the mp4 there), and <img> draws that as a broken
                        icon. #t=0.1 makes the browser paint the first frame. */}
                    {isAudio && (
                      <AudioCover seed={g.prompt} bars={6} label={false} style={{ position: "absolute", inset: 0 }} />
                    )}
                    {src && !isAudio && srcIsVideo && (
                      <video src={`${src}#t=0.1`} muted playsInline preload="metadata" />
                    )}
                    {src && !isAudio && !srcIsVideo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" />
                    )}
                    {isVideo && <span className="rp-thumb-play" aria-hidden="true">▶</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <ModeOrb modes={orbModes} links={orbLinks} title={TAB_LABEL[tab]} glyph={TAB_GLYPH[tab]} />

      <style jsx global>{`
        @property --rp-a { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
        @keyframes rp-led { to { --rp-a: 360deg; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes rp-breathe { from { transform: scale(1); } to { transform: scale(1.035) translateY(-6px); } }
        @keyframes rp-rise {
          0% { transform: translate(0, 0); opacity: 0; }
          12% { opacity: 0.75; }
          70% { opacity: 0.45; }
          100% { transform: translate(28px, -105vh); opacity: 0; }
        }
        @keyframes rp-pulse { 50% { opacity: 0.45; } }
        @keyframes rp-sheen { 0%, 60% { left: -50%; } 100% { left: 120%; } }

        /* ── Viewport-locked studio ──────────────────────────────────────
           On a wide screen the workspace is exactly one screen: nothing
           scrolls the document, the composer scrolls inside its card, and
           the canvas takes whatever height is left. */
        .rp-studio {
          --cy: 103, 232, 249;
          --vi: 167, 139, 250;
          position: relative;
          display: flex;
          gap: 22px;
          padding: 16px 26px 22px;
          height: calc(100dvh - 80px);
          box-sizing: border-box;
          overflow: hidden;
        }
        .rp-studio .rp-mono { font-family: var(--font-geist-mono), ui-monospace, monospace; letter-spacing: 0.02em; }

        /* The memory fountain: fixed behind the studio, under its content. */
        .rp-studio .rp-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
        .rp-studio .rp-bg-img {
          position: absolute; inset: -2%;
          background: url(/studio/bg-fountain-v1.webp) center 62% / cover no-repeat;
          opacity: 0.42; filter: saturate(1.05);
          -webkit-mask: radial-gradient(120% 95% at 58% 70%, #000 35%, transparent 85%);
          mask: radial-gradient(120% 95% at 58% 70%, #000 35%, transparent 85%);
          animation: rp-breathe 18s ease-in-out infinite alternate;
        }
        .rp-studio .rp-bg-veil {
          position: absolute; inset: 0;
          background: radial-gradient(900px 600px at 18% 30%, rgba(3, 6, 18, 0.78), transparent 70%),
            linear-gradient(180deg, rgba(3, 6, 18, 0.55), rgba(3, 6, 18, 0.2) 40%, rgba(3, 6, 18, 0.6));
        }
        .rp-studio .rp-mote {
          position: absolute; bottom: -12px; width: 3px; height: 3px; border-radius: 50%;
          background: rgba(var(--cy), 0.9); box-shadow: 0 0 10px 2px rgba(var(--cy), 0.45);
          opacity: 0; animation: rp-rise linear infinite;
        }
        .rp-studio .rp-mote[data-tone="v"] { background: rgba(var(--vi), 0.9); box-shadow: 0 0 10px 2px rgba(var(--vi), 0.45); }
        .rp-studio .rp-mote[data-tone="p"] { background: rgba(244, 114, 182, 0.9); box-shadow: 0 0 10px 2px rgba(244, 114, 182, 0.4); }
        .rp-studio > .rp-composer, .rp-studio > .rp-stage, .rp-studio > .rp-jobbar { position: relative; z-index: 1; }

        /* ── Surfaces ── a card is tinted glass with depth: a lit top edge, a
           shaded bottom, a gradient rim, and a thin LED running round it. */
        .rp-studio .rp-hud {
          position: relative; border-radius: 18px; isolation: isolate;
          background:
            radial-gradient(60% 22px at 50% 0, rgba(var(--cy), 0.16), transparent),
            linear-gradient(90deg, transparent 18%, rgba(var(--cy), 0.85) 50%, transparent 82%) top center / 70% 1px no-repeat,
            linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0) 120px),
            linear-gradient(165deg, rgba(17, 27, 56, 0.8), rgba(7, 11, 27, 0.86) 55%, rgba(12, 9, 32, 0.88));
          backdrop-filter: blur(24px) saturate(150%);
          -webkit-backdrop-filter: blur(24px) saturate(150%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 -1px 0 rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(2, 4, 12, 0.85),
            0 34px 70px -30px rgba(0, 0, 0, 0.95), 0 0 60px -22px rgba(34, 211, 238, 0.28);
        }
        .rp-studio .rp-hud::before {
          content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
          background: linear-gradient(155deg, rgba(var(--cy), 0.42), rgba(var(--vi), 0.16) 32%, rgba(255, 255, 255, 0.035) 58%, rgba(236, 72, 153, 0.22));
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
        }
        .rp-studio .rp-led {
          position: absolute; inset: -1px; border-radius: 19px; pointer-events: none; z-index: 2;
          filter: drop-shadow(0 0 3px rgba(103, 232, 249, 0.95)) drop-shadow(0 0 8px rgba(139, 92, 246, 0.6));
        }
        .rp-studio .rp-led i {
          position: absolute; inset: 0; border-radius: inherit; padding: 1.5px;
          background: conic-gradient(from var(--rp-a), transparent 0 74%, rgba(var(--vi), 0) 75%, rgba(var(--vi), 0.9) 83%, rgba(var(--cy), 1) 89%, #fff 90%, transparent 91%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          animation: rp-led 9s linear infinite;
        }
        /* raised sits on the glass; a well is cut into it */
        .rp-studio .rp-raised {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.015));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.11), inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 6px 14px -8px rgba(0, 0, 0, 0.8);
          border: 0;
        }
        .rp-studio .rp-well {
          background: linear-gradient(180deg, rgba(1, 3, 12, 0.72), rgba(8, 13, 30, 0.6));
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 1px 0 rgba(255, 255, 255, 0.04);
          border: 0;
        }
        .rp-studio .rp-dot {
          display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
          background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.14), 0 0 10px rgba(52, 211, 153, 0.8);
          animation: rp-pulse 2.4s ease-in-out infinite;
        }
        .rp-studio .rp-dot[data-run="true"] { background: #c4b5fd; box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.16), 0 0 10px rgba(167, 139, 250, 0.85); }
        .rp-studio .rp-spin {
          display: inline-block; width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
          border: 2px solid rgba(165, 243, 252, 0.25); border-top-color: #a5f3fc;
          animation: spin 900ms linear infinite;
        }

        /* ── Scrollbars: a faint LED rail with a glowing bead ──
           The site sets scrollbar-width/-color on every element, and Chrome
           ignores the ::-webkit-scrollbar styles while either is set. */
        .rp-studio .rp-scroll, .xdr-pop { scrollbar-width: auto; scrollbar-color: auto; }
        .rp-studio .rp-scroll::-webkit-scrollbar, .xdr-pop::-webkit-scrollbar { width: 12px; height: 12px; }
        .rp-studio .rp-scroll::-webkit-scrollbar-track, .xdr-pop::-webkit-scrollbar-track {
          margin: 14px 0;
          background: linear-gradient(90deg, transparent 5.5px, rgba(var(--cy), 0.13) 5.5px 6.5px, transparent 6.5px);
        }
        .rp-studio .rp-scroll::-webkit-scrollbar-track:horizontal {
          margin: 0 14px;
          background: linear-gradient(180deg, transparent 5.5px, rgba(var(--cy), 0.13) 5.5px 6.5px, transparent 6.5px);
        }
        .rp-studio .rp-scroll::-webkit-scrollbar-thumb, .xdr-pop::-webkit-scrollbar-thumb {
          border-radius: 8px; border: 4px solid transparent; background-clip: padding-box;
          background-image: linear-gradient(180deg, #67e8f9, #a78bfa 70%, #f0abfc);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
        }
        .rp-studio .rp-scroll::-webkit-scrollbar-thumb:horizontal { background-image: linear-gradient(90deg, #67e8f9, #a78bfa 70%, #f0abfc); }
        .rp-studio .rp-scroll::-webkit-scrollbar-thumb:hover, .xdr-pop::-webkit-scrollbar-thumb:hover { border-width: 3px; }
        .rp-studio .rp-scroll::-webkit-scrollbar-button, .xdr-pop::-webkit-scrollbar-button { display: none; }
        .rp-studio .rp-scroll::-webkit-scrollbar-corner { background: transparent; }
        @supports not selector(::-webkit-scrollbar) {
          .rp-studio .rp-scroll, .xdr-pop { scrollbar-width: thin; scrollbar-color: rgba(103, 232, 249, 0.55) transparent; }
        }

        /* ── Composer ── */
        .rp-studio .rp-composer { width: 404px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; }
        .rp-studio .rp-composer-glass { position: absolute; inset: 0; z-index: 0; }
        .rp-studio .rp-cscroll {
          position: relative; z-index: 1; flex: 1; min-height: 0; overflow: auto;
          padding: 18px 10px 12px 20px; margin-right: 4px;
          display: flex; flex-direction: column; gap: 18px;
        }
        .rp-studio .rp-cscroll > * { flex-shrink: 0; }
        .rp-studio .rp-chead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .rp-studio .rp-crumb { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #64748b; }
        .rp-studio .rp-crumb .rp-mono { color: rgba(var(--cy), 0.75); }
        .rp-studio .rp-title { margin: 4px 0 0; font-size: 21px; font-weight: 600; color: #f8fafc; letter-spacing: -0.01em; }
        .rp-studio .rp-lbl { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: #a3b0c4; margin-bottom: 8px; font-weight: 500; }
        .rp-studio .rp-lbl i {
          font-style: normal; font-family: var(--font-geist-mono), ui-monospace, monospace; font-size: 10.5px;
          color: rgba(var(--cy), 0.75); padding: 1px 5px; border-radius: 5px;
          background: rgba(var(--cy), 0.06); box-shadow: inset 0 0 0 1px rgba(var(--cy), 0.22);
        }
        .rp-studio .rp-lbl span { margin-left: auto; font-size: 11px; color: #475569; font-weight: 400; font-family: var(--font-geist-mono), ui-monospace, monospace; }
        .rp-studio .rp-sub { font-size: 11.5px; color: #8391a7; margin: 0 0 6px; }
        .rp-studio .rp-note { margin-top: 7px; font-size: 11px; line-height: 1.55; color: #64748b; }
        .rp-studio .rp-warn, .rp-studio .rp-info {
          padding: 9px 12px; border-radius: 10px; font-size: 12px; line-height: 1.5;
          background: hsla(38, 90%, 55%, 0.12); color: #fbbf24; box-shadow: inset 0 0 0 1px hsla(38, 90%, 55%, 0.28);
        }
        .rp-studio .rp-info { background: rgba(148, 163, 184, 0.1); color: rgba(203, 213, 225, 0.85); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }

        /* model card */
        .rp-studio .rp-model {
          display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 12px; border-radius: 13px;
          color: inherit; font: inherit; text-align: left; cursor: pointer;
        }
        .rp-studio .rp-model:hover { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(var(--cy), 0.32), 0 6px 14px -8px rgba(0, 0, 0, 0.8); }
        .rp-studio .rp-mlogo { width: 44px; height: 44px; flex-shrink: 0; object-fit: contain; filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.5)); }
        .rp-studio .rp-mbody { min-width: 0; flex: 1; }
        .rp-studio .rp-mname { display: block; font-size: 14.5px; font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rp-studio .rp-mmeta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
        .rp-studio .rp-tag { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: rgba(139, 92, 246, 0.14); color: #c4b5fd; }
        .rp-studio .rp-tag[data-tone="ok"] { background: rgba(52, 211, 153, 0.12); color: #6ee7b7; }
        .rp-studio .rp-tag[data-tone="warn"] { background: hsla(38, 90%, 55%, 0.16); color: #fbbf24; }
        .rp-studio .rp-tag[data-tone="ref"] { background: rgba(var(--cy), 0.1); color: #a5f3fc; }
        .rp-studio .rp-mprice { margin-left: auto; text-align: right; flex-shrink: 0; }
        .rp-studio .rp-mprice b { display: block; font-size: 14px; color: #fde68a; font-weight: 600; }
        .rp-studio .rp-mprice span { font-size: 11px; color: #64748b; white-space: nowrap; }
        .rp-studio .rp-mlist { margin-top: 8px; max-height: 300px; overflow-y: auto; border-radius: 12px; padding: 4px; }
        .rp-studio .rp-mopt {
          width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 0; border-radius: 9px;
          background: transparent; color: #e2e8f0; text-align: left; font: inherit; cursor: pointer;
        }
        .rp-studio .rp-mopt:hover:not(:disabled) { background: rgba(255, 255, 255, 0.04); }
        .rp-studio .rp-mopt[data-on="true"] { background: rgba(var(--cy), 0.1); box-shadow: inset 0 0 0 1px rgba(var(--cy), 0.35); }
        .rp-studio .rp-mopt:disabled { opacity: 0.45; cursor: not-allowed; }

        /* prompt */
        .rp-studio .rp-prompt { border-radius: 13px; overflow: hidden; transition: box-shadow 160ms ease; }
        .rp-studio .rp-prompt:focus-within {
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(var(--cy), 0.55), 0 0 0 3px rgba(var(--cy), 0.07), 0 0 18px -4px rgba(var(--cy), 0.45);
        }
        .rp-studio .rp-prompt textarea {
          display: block; width: 100%; box-sizing: border-box; padding: 13px 14px 10px; border: 0; outline: none; resize: vertical;
          background: transparent; color: #e2e8f0; font: inherit; font-size: 14px; line-height: 1.7; caret-color: #67e8f9;
        }
        .rp-studio .rp-prompt textarea::placeholder { color: #475569; }
        .rp-studio .rp-ptools { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-top: 1px solid rgba(255, 255, 255, 0.05); }
        .rp-studio .rp-tool, .xdr-pop .rp-tool {
          display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 0; border-radius: 8px;
          font: inherit; font-size: 12.5px; color: #cbd5e1; cursor: pointer; white-space: nowrap;
        }
        .rp-studio .rp-tool:disabled { opacity: 0.45; cursor: default; }
        .rp-studio .rp-tool-ai {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.26), rgba(34, 211, 238, 0.18));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 0 0 1px rgba(192, 132, 252, 0.45), 0 6px 16px -8px rgba(168, 85, 247, 0.7);
          color: #f5f3ff; font-weight: 600;
        }
        .rp-studio .rp-kbd { margin-left: auto; font-size: 10.5px; color: #475569; }

        /* popover triggers */
        .rp-studio .rp-pop { position: relative; flex: 1 1 132px; min-width: min(124px, 100%); }
        .rp-studio .rp-pop-tool { flex: none; min-width: 0; }
        .rp-studio .rp-popbtn {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 9px 12px; border: 0; border-radius: 10px; cursor: pointer; font: inherit; font-size: 12.5px; color: #e2e8f0;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.015));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.11), inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 6px 14px -8px rgba(0, 0, 0, 0.8);
        }
        .rp-studio .rp-pop-tool .rp-tool {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.015));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.11), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
        }
        .rp-studio .rp-popbtn[data-open="true"], .rp-studio .rp-pop-tool .rp-tool[data-open="true"] {
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(var(--cy), 0.5), 0 0 16px -6px rgba(var(--cy), 0.6);
        }
        .rp-studio .rp-popbtn-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rp-studio .rp-popbtn-text b { color: #a5f3fc; font-weight: 500; margin-left: 6px; }
        .rp-studio .rp-popbtn-caret { font-size: 9px; opacity: 0.6; flex-shrink: 0; transition: transform 200ms; }
        .rp-studio [data-open="true"] .rp-popbtn-caret { transform: rotate(180deg); }
        .xdr-pop {
          --cy: 103, 232, 249;
          z-index: 70; overflow-y: auto; box-sizing: border-box; padding: 12px; border-radius: 13px; color: #e2e8f0;
          background: linear-gradient(180deg, rgba(17, 27, 56, 0.97), rgba(7, 11, 27, 0.98));
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(var(--cy), 0.22),
            0 24px 48px -12px rgba(0, 0, 0, 0.85), 0 0 40px -16px rgba(34, 211, 238, 0.35);
        }

        /* lyrics */
        .rp-studio .rp-lyrics-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .rp-studio .rp-sectag {
          padding: 3px 8px; border-radius: 7px; font-size: 10.5px; cursor: pointer;
          background: hsla(265, 60%, 60%, 0.12); color: #c4b5fd; border: 1px solid hsla(265, 60%, 60%, 0.28);
        }
        .rp-studio .rp-sectag:disabled { opacity: 0.4; cursor: default; }
        .rp-studio .rp-check { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #94a3b8; cursor: pointer; }

        /* uploads */
        .rp-studio .rp-drop {
          width: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
          padding: 20px 14px; border: 0; border-radius: 12px; cursor: pointer; text-align: center; line-height: 1.5;
          font: inherit; font-size: 12.5px; color: #a5f3fc;
          background: rgba(var(--cy), 0.04); outline: 1px dashed rgba(var(--cy), 0.35); outline-offset: -1px;
          transition: background 160ms ease;
        }
        .rp-studio .rp-drop:hover { background: rgba(var(--cy), 0.09); }
        .rp-studio .rp-drop small { font-size: 11px; color: #64748b; }
        .rp-studio .rp-drop[data-busy="true"] { cursor: wait; color: #94a3b8; flex-direction: row; gap: 10px; }
        .rp-studio .rp-drop-ic { font-size: 20px; line-height: 1; }
        .rp-studio .rp-filechip {
          display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 11px;
          background: linear-gradient(180deg, rgba(1, 3, 12, 0.72), rgba(8, 13, 30, 0.6));
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
        }
        .rp-studio .rp-filechip-ic {
          width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0; display: grid; place-items: center; font-size: 13px;
          color: #6ee7b7; background: rgba(52, 211, 153, 0.12); box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.3);
        }
        .rp-studio .rp-filechip-name { flex: 1; min-width: 0; font-size: 12.5px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rp-studio .rp-filechip button, .rp-studio .rp-pic button {
          width: 24px; height: 24px; flex-shrink: 0; border-radius: 50%; border: 0; cursor: pointer; font-size: 14px; line-height: 1;
          color: #fff; background: rgba(3, 6, 18, 0.72); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
        }
        .rp-studio .rp-pic {
          position: relative; border-radius: 12px; overflow: hidden; background: #0b1020;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 8px 18px -10px rgba(0, 0, 0, 0.9);
        }
        .rp-studio .rp-pic img { display: block; width: 100%; max-height: 200px; object-fit: cover; }
        .rp-studio .rp-pic button { position: absolute; top: 8px; right: 8px; }
        .rp-studio .rp-seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 11px; }
        .rp-studio .rp-seg button {
          display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 8px 6px; border: 0; border-radius: 8px;
          background: transparent; color: #8391a7; font: inherit; cursor: pointer; text-align: center;
        }
        .rp-studio .rp-seg button b { font-size: 13px; font-weight: 500; }
        .rp-studio .rp-seg button span { font-size: 10.5px; opacity: 0.75; }
        .rp-studio .rp-seg button[data-on="true"] {
          color: #f8fafc;
          background: linear-gradient(180deg, rgba(var(--cy), 0.16), rgba(var(--cy), 0.05));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(var(--cy), 0.4);
        }
        .rp-studio .rp-frames { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 10px; }
        .rp-studio .rp-frames[data-two="true"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .rp-studio .rp-frames[data-two="true"] .rp-pic img { aspect-ratio: 16 / 10; }
        .rp-studio .rp-frames[data-two="true"] .rp-drop { aspect-ratio: 16 / 10; padding: 8px; }

        /* reference pictures */
        .rp-studio .rp-refbox { border-radius: 13px; padding: 12px; }
        .rp-studio .rp-rmeter { display: flex; gap: 3px; margin: 0 0 11px; }
        .rp-studio .rp-rmeter i { flex: 1; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.07); }
        .rp-studio .rp-rmeter i[data-on="true"] { background: linear-gradient(90deg, #67e8f9, #a78bfa); box-shadow: 0 0 6px rgba(var(--cy), 0.7); }
        .rp-studio .rp-rgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .rp-studio .rp-rgrid[data-single="true"] { grid-template-columns: minmax(0, 1fr); }
        .rp-studio .rp-rtile {
          position: relative; aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: #0b1020;
          display: grid; place-items: center;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 8px 16px -10px rgba(0, 0, 0, 0.9);
        }
        .rp-studio .rp-rgrid[data-single="true"] .rp-rtile { aspect-ratio: 16 / 10; }
        .rp-studio .rp-rtile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .rp-studio .rp-rtile[data-main="true"] {
          box-shadow: inset 0 0 0 1.5px rgba(var(--cy), 0.8), 0 0 14px -4px rgba(var(--cy), 0.7), 0 8px 16px -10px rgba(0, 0, 0, 0.9);
        }
        .rp-studio .rp-rtile::after {
          content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 48%;
          background: linear-gradient(transparent, rgba(3, 6, 18, 0.88)); pointer-events: none;
        }
        .rp-studio .rp-rno {
          position: absolute; left: 5px; top: 5px; z-index: 1; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
          border-radius: 9px; display: grid; place-items: center; font-size: 10.5px; font-weight: 600; color: #03131a;
          background: linear-gradient(180deg, #cffafe, #67e8f9); box-shadow: 0 0 8px rgba(var(--cy), 0.8);
        }
        .rp-studio .rp-rx {
          position: absolute; right: 4px; top: 4px; z-index: 1; width: 22px; height: 22px; border: 0; border-radius: 50%; padding: 0;
          display: grid; place-items: center; cursor: pointer; color: #e2e8f0; font-size: 13px; line-height: 1;
          background: rgba(3, 6, 18, 0.72); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
          opacity: 0; transition: opacity 120ms;
        }
        .rp-studio .rp-rtile:hover .rp-rx, .rp-studio .rp-rx:focus-visible { opacity: 1; }
        @media (hover: none) { .rp-studio .rp-rx { opacity: 1; } }
        .rp-studio .rp-rrole {
          position: absolute; left: 4px; right: 4px; bottom: 4px; z-index: 1; display: flex; align-items: center; justify-content: center;
          gap: 3px; padding: 3px 0; border: 0; border-radius: 6px; cursor: pointer; font: inherit; font-size: 10.5px; color: #e2e8f0;
          background: rgba(7, 12, 28, 0.55); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
          -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
          white-space: nowrap; overflow: hidden;
        }
        .rp-studio .rp-rrole:hover { box-shadow: inset 0 0 0 1px rgba(var(--cy), 0.55); }
        .rp-studio .rp-radd {
          aspect-ratio: 1; border-radius: 10px; cursor: pointer; font-size: 11.5px; color: #a5f3fc; text-align: center;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
          background: rgba(var(--cy), 0.04); outline: 1px dashed rgba(var(--cy), 0.35); outline-offset: -1px;
        }
        .rp-studio .rp-rgrid[data-single="true"] .rp-radd { aspect-ratio: 16 / 10; }
        .rp-studio .rp-radd small { font-size: 9.5px; color: #64748b; line-height: 1.3; padding: 0 4px; }
        .rp-studio .rp-radd:hover { background: rgba(var(--cy), 0.09); }
        .rp-studio .rp-rhint { margin-top: 10px; font-size: 11.5px; color: #7d8ba1; line-height: 1.55; }
        .rp-studio .rp-rhint b { color: #a5f3fc; font-weight: 500; }
        .rp-studio .rp-rins { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 8px; }
        .rp-studio .rp-rins > span { font-size: 11px; color: #64748b; margin-right: 2px; }
        .rp-studio .rp-rins button { cursor: pointer; font: inherit; font-size: 11.5px; padding: 3px 8px; border-radius: 6px; color: #a5f3fc; }
        .rp-studio .rp-slider { margin-top: 12px; }
        .rp-studio .rp-slider > div { display: flex; justify-content: space-between; font-size: 11.5px; color: #94a3b8; margin-bottom: 6px; }
        .rp-studio .rp-slider b { color: #a5f3fc; font-weight: 500; }
        .rp-studio .rp-slider input { width: 100%; accent-color: #67e8f9; }

        /* settings */
        .rp-studio .rp-sets { display: flex; flex-direction: column; gap: 14px; }
        .rp-studio .rp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .rp-studio .rp-chip {
          display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 9px;
          font: inherit; font-size: 13px; color: #94a3b8; cursor: pointer;
        }
        .rp-studio .rp-chip:hover { color: #e2e8f0; }
        .rp-studio .rp-chip[data-on="true"] {
          color: #fff;
          background: linear-gradient(180deg, rgba(var(--cy), 0.16), rgba(var(--cy), 0.05));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(var(--cy), 0.45), inset 0 -2px 0 rgba(var(--cy), 0.9), 0 6px 16px -6px rgba(var(--cy), 0.55);
        }
        .rp-studio .rp-chip small { font-size: 10.5px; color: #fbbf24; font-family: var(--font-geist-mono), ui-monospace, monospace; }
        .rp-studio .rp-shape { display: inline-block; border: 1.5px solid currentColor; border-radius: 2px; box-sizing: border-box; }
        .rp-studio .rp-poprow { display: flex; flex-wrap: wrap; gap: 6px; }
        .rp-studio .rp-input {
          width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; outline: none;
          color: #f1f5f9; font: inherit; font-size: 12.5px;
        }
        .rp-studio .rp-input::placeholder { color: #475569; }
        .rp-studio .rp-input:focus { box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(var(--cy), 0.5); }

        /* the order */
        .rp-studio .rp-order {
          position: relative; z-index: 1; flex-shrink: 0; padding: 12px 20px 16px; border-radius: 0 0 18px 18px;
          background: linear-gradient(180deg, rgba(3, 6, 18, 0), rgba(3, 6, 18, 0.5));
        }
        .rp-studio .rp-order::before {
          content: ""; position: absolute; left: 20px; right: 20px; top: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(var(--cy), 0.3), transparent);
        }
        .rp-studio .rp-short {
          margin-bottom: 10px; padding: 8px 11px; border-radius: 10px; font-size: 12px; line-height: 1.5;
          background: rgba(248, 113, 113, 0.1); color: #fca5a5; box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.28);
        }
        .rp-studio .rp-short a { color: #fecaca; font-weight: 600; white-space: nowrap; }
        .rp-studio .rp-osum { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 12.5px; color: #94a3b8; margin-bottom: 10px; }
        .rp-studio .rp-osum b { color: #f8fafc; font-weight: 600; }
        .rp-studio .rp-osum a { font-size: 12px; text-decoration: none; padding: 3px 9px; border-radius: 7px; background: rgba(var(--cy), 0.12); color: #a5f3fc; white-space: nowrap; }
        .rp-studio .rp-go {
          position: relative; overflow: hidden; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 15px 18px; border: 0; border-radius: 13px; cursor: pointer; color: #fff; font: inherit; font-size: 16px; font-weight: 600;
          background: linear-gradient(120deg, #06b6d4, #8b5cf6 55%, #ec4899);
          box-shadow: 0 14px 34px -12px rgba(139, 92, 246, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -2px 0 rgba(0, 0, 0, 0.18);
        }
        .rp-studio .rp-go::after {
          content: ""; position: absolute; top: 0; bottom: 0; width: 40%; left: -50%;
          background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.22), transparent);
          animation: rp-sheen 4.5s ease-in-out infinite;
        }
        .rp-studio .rp-go:disabled { cursor: not-allowed; opacity: 0.55; filter: saturate(0.6); }
        .rp-studio .rp-go:disabled::after { animation: none; }
        .rp-studio .rp-go-label { position: relative; z-index: 1; }
        .rp-studio .rp-gop {
          position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 6px; font-size: 14px;
          padding: 4px 10px; border-radius: 8px; background: rgba(3, 6, 18, 0.28); white-space: nowrap;
        }
        .rp-studio .rp-onote { text-align: center; font-size: 11.5px; color: #64748b; margin-top: 9px; }

        /* ── Stage ── */
        .rp-studio .rp-stage { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
        .rp-studio .rp-tray { display: flex; gap: 8px; overflow-x: auto; flex-shrink: 0; padding-bottom: 4px; }
        .rp-studio .rp-tray-item {
          display: flex; align-items: center; gap: 10px; min-width: 176px; max-width: 230px; padding: 6px 12px 6px 6px;
          border: 0; border-radius: 11px; cursor: pointer; text-align: left; font: inherit; color: #e2e8f0;
          background: linear-gradient(180deg, rgba(17, 27, 56, 0.7), rgba(7, 11, 27, 0.75));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 8px 18px -10px rgba(0, 0, 0, 0.9);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        }
        .rp-studio .rp-tray-item[data-active="true"] {
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(var(--vi), 0.5), 0 0 18px -6px rgba(var(--vi), 0.7);
        }
        .rp-studio .rp-tray-item[data-status="failed"] { box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.35); }
        .rp-studio .rp-tray-thumb {
          width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0; overflow: hidden; display: grid; place-items: center;
          background: linear-gradient(135deg, hsl(250, 45%, 18%), hsl(200, 45%, 12%));
        }
        .rp-studio .rp-tray-thumb img, .rp-studio .rp-tray-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
        .rp-studio .rp-tray-text { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
        .rp-studio .rp-tray-prompt { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rp-studio .rp-tray-state { font-size: 11px; color: #c4b5fd; }
        .rp-studio .rp-tray-item[data-status="completed"] .rp-tray-state { color: #6ee7b7; }
        .rp-studio .rp-tray-item[data-status="failed"] .rp-tray-state { color: #fca5a5; }
        .rp-studio .rp-tray-clear {
          flex-shrink: 0; padding: 0 12px; border-radius: 11px; font: inherit; font-size: 12px; cursor: pointer;
          color: #64748b; background: transparent; border: 1px dashed rgba(255, 255, 255, 0.14);
        }
        .rp-studio .rp-canvas { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px 14px; }
        .rp-studio .rp-cbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 11.5px; color: #64748b; margin-bottom: 10px; position: relative; z-index: 3; }
        .rp-studio .rp-cbar .rp-mono { color: #7d8ba1; }
        .rp-studio .rp-cbar-r { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
        .rp-studio .rp-pill {
          padding: 6px 12px; border: 0; border-radius: 9px; font: inherit; font-size: 12.5px; cursor: pointer; color: #94a3b8;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.015));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.11), inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 6px 14px -8px rgba(0, 0, 0, 0.8);
          transition: color 160ms ease, box-shadow 160ms ease;
        }
        .rp-studio .rp-pill:hover:not(:disabled) { color: #e2e8f0; }
        .rp-studio .rp-pill[data-on="true"] {
          color: #fff;
          background: linear-gradient(180deg, rgba(var(--cy), 0.16), rgba(var(--cy), 0.05));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(var(--cy), 0.45);
        }
        /* Dimmed rather than hidden, with the reason in the tooltip. */
        .rp-studio .rp-pill:disabled { opacity: 0.38; cursor: not-allowed; }
        /* The canvas block is the flexible one; the bar above it and the
           recent row below keep their natural height so they stay on screen. */
        .rp-studio .rp-studio-canvas {
          flex: 1; min-height: 0; display: flex; border-radius: 12px;
          /* "safe": content taller than the canvas starts at the top instead of
             being centred past both edges — which is how the queue animation
             once went missing. */
          align-items: safe center; justify-content: safe center;
          overflow-x: hidden; overflow-y: auto;
          /* Its height comes from the layout, never from its content, so it can
             be a size container: the in-progress frame sizes itself from the
             room left here (less ~170px for the status block). */
          container-type: size;
          --gen-frame-h: min(460px, max(160px, calc(100cqh - 170px)));
        }
        .rp-studio .rp-samples { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; max-width: 760px; margin: 0 auto; }
        .rp-studio .rp-recent { display: flex; align-items: center; gap: 12px; flex-shrink: 0; min-height: 46px; padding-right: 110px; }
        .rp-studio .rp-rl { font-size: 12px; color: #64748b; flex-shrink: 0; white-space: nowrap; }
        .rp-studio .rp-rl a { color: #a5f3fc; text-decoration: none; }
        .rp-studio .rp-recent-row { display: flex; gap: 8px; overflow-x: auto; min-width: 0; padding: 2px 2px 4px; }
        .rp-studio .rp-thumb {
          position: relative; width: 46px; height: 46px; flex-shrink: 0; padding: 0; border: 0; border-radius: 9px; overflow: hidden; cursor: pointer;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 6px 14px -8px rgba(0, 0, 0, 0.9);
        }
        .rp-studio .rp-thumb img, .rp-studio .rp-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
        .rp-studio .rp-thumb[aria-current="true"] { box-shadow: inset 0 0 0 1.5px rgba(var(--cy), 0.9), 0 0 12px -2px rgba(var(--cy), 0.7); }
        .rp-studio .rp-thumb-play { position: absolute; bottom: 3px; right: 3px; font-size: 8px; color: #fff; background: rgba(0, 0, 0, 0.6); padding: 1px 4px; border-radius: 4px; }

        /* Drop target over the whole studio while a file is dragged in. */
        .rp-studio .rp-drop-hint {
          position: fixed; inset: 12px; z-index: 60; display: grid; place-items: center; text-align: center;
          font-size: 16px; font-weight: 600; color: #e0f2fe; border-radius: 20px;
          border: 2px dashed hsla(190, 90%, 65%, 0.7); background: rgba(3, 6, 18, 0.72);
          backdrop-filter: blur(4px); pointer-events: none;
        }
        .rp-studio .rp-jobbar { display: none; }

        /* ── Stacked (tablet, phone) ──────────────────────────────────────
           Below this the composer would squeeze the canvas to nothing: the
           parts stack, the page scrolls normally, and the order bar stays on
           the bottom of the screen. */
        @media (max-width: 1099px) {
          .rp-studio { flex-direction: column; height: auto; overflow: visible; padding: 12px 14px 112px; gap: 14px; }
          /* Above the stage: the fixed order bar lives in the composer's
             stacking context, and the stage, later in the page, painted over it. */
          .rp-studio > .rp-composer { width: auto; z-index: 2; }
          .rp-studio .rp-cscroll { overflow: visible; padding: 16px 16px 18px; margin-right: 0; }
          .rp-studio .rp-order {
            position: fixed; left: 12px; right: 12px; bottom: 14px; z-index: 40;
            display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 12px;
            padding: 9px 9px 9px 16px; border-radius: 18px;
            background: linear-gradient(180deg, rgba(24, 36, 72, 0.88), rgba(8, 13, 32, 0.94));
            backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 0 0 1px rgba(var(--cy), 0.16), 0 18px 40px -16px rgba(0, 0, 0, 0.9);
          }
          .rp-studio .rp-order::before { left: 20%; right: 20%; top: -1px; background: linear-gradient(90deg, transparent, rgba(var(--cy), 0.75), transparent); }
          .rp-studio .rp-short { grid-column: 1 / -1; margin: 0 0 8px; }
          .rp-studio .rp-osum { flex-direction: column; align-items: flex-start; gap: 3px; margin: 0; font-size: 11.5px; }
          .rp-studio .rp-osum a { padding: 2px 8px; font-size: 11px; }
          .rp-studio .rp-go { padding: 12px 14px; font-size: 15px; }
          .rp-studio .rp-gop { font-size: 13px; padding: 3px 8px; }
          .rp-studio .rp-onote { display: none; }
          .rp-studio .rp-jobbar {
            display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border: 0; border-radius: 12px; cursor: pointer;
            font: inherit; font-size: 12.5px; color: #e2e8f0; text-align: left;
            background: linear-gradient(180deg, rgba(76, 29, 149, 0.32), rgba(30, 16, 70, 0.4));
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(var(--vi), 0.45), 0 0 18px -6px rgba(var(--vi), 0.7);
          }
          .rp-studio .rp-jobbar b { margin-left: auto; font-weight: 500; color: #c4b5fd; }
          .rp-studio .rp-stage { scroll-margin-top: 90px; }
          .rp-studio .rp-canvas { min-height: 380px; }
          /* Here the canvas grows with its content, which a size container
             cannot do — the frame cap falls back to the viewport. */
          .rp-studio .rp-studio-canvas { overflow: visible; min-height: 300px; container-type: normal; --gen-frame-h: min(460px, 44vh); }
          .rp-studio .rp-recent { padding-right: 0; }
        }
        @media (max-width: 640px) {
          .rp-studio { padding: 10px 10px 108px; }
          .rp-studio .rp-cscroll { padding: 14px 12px 16px; }
          .rp-studio .rp-canvas { padding: 10px 10px 12px; }
          .rp-studio .rp-samples { gap: 10px; }
          .rp-studio .rp-kbd { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rp-studio .rp-bg-img, .rp-studio .rp-mote, .rp-studio .rp-led i, .rp-studio .rp-dot, .rp-studio .rp-go::after { animation: none; }
          .rp-studio .rp-mote { display: none; }
          .rp-studio .rp-spin { animation-duration: 2.4s; }
        }
      `}</style>
    </div>
  );
}
