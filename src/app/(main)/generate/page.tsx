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
import { kieQuote, speechChars } from "@/lib/providers/kie-pricing";
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
import { AquaChordHandoff } from "@/components/xdreamer/aquachord";
import { SongLyrics } from "@/components/xdreamer/song-lyrics";
import { KaraokePanel } from "@/components/xdreamer/karaoke";
import { ReplaceSection, type ReplaceWindow } from "@/components/xdreamer/replace-section";
import { replacedLyrics } from "@/lib/lyrics/replace";
import { sunoReplaceWindow } from "@/lib/providers/kie-suno";
import { AudioTracks, type AudioTrack } from "@/components/xdreamer/audio-tracks";
import { TrackWave } from "@/components/xdreamer/track-wave";
import { loadAudio } from "@/components/xdreamer/audio-wave";
import { AudioTrimmer, coversWhole, cutAudio, initialTrim, trimKey, type TrimRange } from "@/components/xdreamer/audio-trim";
import { ModeOrb, type OrbItem } from "@/components/xdreamer/mode-orb";
import { ModelBalloons } from "@/components/xdreamer/model-balloons";
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
import { CameraPreview } from "@/components/camera-preview/CameraPreview";
import { shotHint, type ShotSpec } from "@/lib/camera-shots";
import { useLocale, useT } from "@/lib/i18n/client";
import { formatCredits, formatDate, formatNumber, type Msg, type Translate } from "@/lib/i18n/locale";
import { stemLabelText } from "@/lib/i18n/suno-text";

const HUE = 70;

type TabType = "image" | "video" | "edit" | "lipsync" | "audio" | "speech";

/**
 * The video tab's modes. The last two are KIE's clip tools: each works on an
 * uploaded clip rather than a description, and offers only its own models.
 */
type VideoMode = "t2v" | "i2v" | "motion" | "upscale";
type VideoTool = "motion" | "upscale";
const videoToolOf = (subcategory?: string | null): VideoTool | null =>
  subcategory === "motion" ? "motion" : subcategory === "video-upscale" ? "upscale" : null;

/**
 * The music tab's modes. Writing a song is the first; the rest work on a
 * track the customer brings (Suno's tools, kie-suno.ts, and the in-house
 * cover) or make short sounds. Each lists only its own models.
 */
type MusicMode = "create" | "cover" | "extend" | "replace" | "mashup" | "add" | "stems" | "sounds";
const MUSIC_MODES: { key: MusicMode; label: Msg; hint: Msg }[] = [
  { key: "create", label: { th: "แต่งเพลง", en: "Write a song" }, hint: { th: "จากแนวเพลงและเนื้อร้อง", en: "From a style and lyrics" } },
  { key: "cover", label: { th: "คัฟเวอร์", en: "Cover" }, hint: { th: "ทำนองเดิม แนวใหม่", en: "Same tune, new style" } },
  { key: "extend", label: { th: "ต่อเพลง", en: "Extend" }, hint: { th: "ยาวขึ้นจากจุดที่เลือก", en: "Longer, from a point you pick" } },
  { key: "replace", label: { th: "แก้ท่อนเพลง", en: "Replace a part" }, hint: { th: "ร้องใหม่เฉพาะบรรทัดที่เลือก", en: "Sing just the lines you pick anew" } },
  { key: "mashup", label: { th: "มิกซ์ 2 เพลง", en: "Mashup" }, hint: { th: "รวมสองเพลงเป็นเพลงใหม่", en: "Two songs made into one" } },
  { key: "add", label: { th: "เติมเสียง", en: "Add a part" }, hint: { th: "ใส่เสียงร้อง หรือใส่ดนตรี", en: "Add vocals or music" } },
  { key: "stems", label: { th: "แยกสเต็ม", en: "Split stems" }, hint: { th: "เสียงร้อง กลอง เบส …", en: "Vocals, drums, bass …" } },
  { key: "sounds", label: { th: "เสียงประกอบ", en: "Sounds" }, hint: { th: "ลูป บีต เอฟเฟกต์", en: "Loops, beats, effects" } },
];
const musicModeOf = (m: { subcategory?: string | null; music?: { sourceSong: boolean } | null }): MusicMode => {
  switch (m.subcategory) {
    case "music-cover": return "cover";
    case "music-extend": return "extend";
    case "music-replace": return "replace";
    case "music-mashup": return "mashup";
    case "music-add": return "add";
    case "music-stems": return "stems";
    case "music-sounds": return "sounds";
  }
  // The in-house cover is a song model that starts from an upload.
  return m.music?.sourceSong ? "cover" : "create";
};
type SunoTool = "song" | "cover" | "extend" | "add-vocals" | "add-instrumental" | "stems" | "sounds" | "replace" | "mashup";
/** The customer's Suno fine-tuning (kie-suno.ts SunoParams); absent = the model's own choice. */
interface SunoChoices {
  title?: string;
  exclude?: string;
  styleWeight?: number;
  weirdness?: number;
  audioWeight?: number;
  variety?: number;
  length?: number;
  continueAt?: number;
  stem?: string;
  loop?: boolean;
  tempo?: number;
  key?: string;
  /** Replace Section: the part sung anew and the whole song's words after it. */
  replaceFrom?: number;
  replaceTo?: number;
  fullLyrics?: string;
  /** Mashup: the second track (our URL). */
  mashWith?: string;
}
/** Only what this tool reads goes with the order. */
function sunoParamsFor(tool: SunoTool, c: SunoChoices, tier: string | undefined): SunoChoices | undefined {
  if (tool === "stems") return tier === "one" && c.stem ? { stem: c.stem } : undefined;
  if (tool === "sounds") return { loop: c.loop || undefined, tempo: c.tempo, key: c.key };
  return {
    title: c.title?.trim() || undefined,
    exclude: c.exclude?.trim() || undefined,
    styleWeight: c.styleWeight,
    weirdness: c.weirdness,
    audioWeight: c.audioWeight,
    variety: c.variety,
    length: tool === "song" || tool === "mashup" ? c.length : undefined,
    continueAt: tool === "extend" ? c.continueAt : undefined,
    replaceFrom: tool === "replace" ? c.replaceFrom : undefined,
    replaceTo: tool === "replace" ? c.replaceTo : undefined,
    fullLyrics: tool === "replace" ? c.fullLyrics : undefined,
    mashWith: tool === "mashup" ? c.mashWith : undefined,
  };
}
/** A part picked for Replace Section, with the upload and words it was picked on: stale once either changes. */
interface ReplacePick extends ReplaceWindow {
  src: string;
  original: string;
}
/** Mashup's second track, uploaded as it is. */
interface MashSong {
  url: string;
  name: string;
  seconds: number | null;
}
const SUNO_VARIETY: Msg[] = [
  { th: "ตรงสไตล์", en: "On style" },
  { th: "ปกติ", en: "Normal" },
  { th: "หลากหลาย", en: "Varied" },
  { th: "กล้าลอง", en: "Bold" },
  { th: "สุดทาง", en: "Wild" },
];
const SUNO_LENGTHS = [30, 60, 120, 180, 240, 360];
/** A track this order made, carried on to the next tool: [mode, Suno tool, menu label]. */
const SONG_NEXT: [MusicMode, SunoTool, Msg][] = [
  ["stems", "stems", { th: "✂ แยกสเต็ม", en: "✂ Split stems" }],
  ["cover", "cover", { th: "↻ คัฟเวอร์เป็นแนวใหม่", en: "↻ Cover in a new style" }],
  ["extend", "extend", { th: "⏩ ต่อเพลงให้ยาวขึ้น", en: "⏩ Make it longer" }],
  ["replace", "replace", { th: "✎ แก้ท่อนเพลง", en: "✎ Replace a part" }],
  ["mashup", "mashup", { th: "🔀 มิกซ์กับอีกเพลง", en: "🔀 Mash up with another song" }],
  ["add", "add-vocals", { th: "🎤 ใส่เสียงร้อง (ดนตรีบรรเลง)", en: "🎤 Add vocals (to an instrumental)" }],
  ["add", "add-instrumental", { th: "🎸 ใส่ดนตรี (เสียงร้องเปล่า)", en: "🎸 Add music (to a bare vocal)" }],
];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Text-to-speech rows are 'audio' on the server, like songs; the subcategory gives them their own tab. */
const isSpeechModel = (m: { category: string; subcategory: string | null }) =>
  m.category === "audio" && m.subcategory === "speech";

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
 * One prompt-builder button. `shot` marks a camera option: it is shown as a
 * looping 3D preview of what that camera does instead of a text chip.
 */
interface BuilderItem {
  /** What the chip says, in the visitor's language. */
  label: Msg;
  /** The English the chip inserts into the prompt: model text, never translated. */
  prompt: string;
  shot?: ShotSpec;
}
type BuilderGroup = { label: Msg; items: BuilderItem[] };

/**
 * Building blocks for a picture prompt, grouped by what they control. Each
 * inserts the English phrase image models were trained on; the Thai label is
 * only there to be read.
 */
const IMAGE_BUILDER: BuilderGroup[] = [
  { label: { th: "สไตล์ภาพ", en: "Style" }, items: [
    { label: { th: "ภาพถ่ายสมจริง", en: "Photoreal" }, prompt: "photorealistic photograph" },
    { label: { th: "ภาพนิ่งจากหนัง", en: "Film still" }, prompt: "cinematic film still" },
    { label: { th: "อนิเมะ", en: "Anime" }, prompt: "anime illustration, clean line art" },
    { label: { th: "3D เรนเดอร์", en: "3D render" }, prompt: "3D render, soft global illumination" },
    { label: { th: "สีน้ำ", en: "Watercolor" }, prompt: "watercolor painting" },
    { label: { th: "สีน้ำมัน", en: "Oil painting" }, prompt: "oil painting, visible brush strokes" },
    { label: { th: "ไอโซเมตริก", en: "Isometric" }, prompt: "isometric illustration" },
    { label: { th: "โปสเตอร์", en: "Poster" }, prompt: "graphic poster design, bold typography" },
  ] },
  { label: { th: "แสง", en: "Lighting" }, items: [
    { label: { th: "โกลเด้นอาวร์", en: "Golden hour" }, prompt: "golden hour sunlight" },
    { label: { th: "ไฟสตูดิโอนุ่ม", en: "Soft studio light" }, prompt: "soft studio softbox lighting" },
    { label: { th: "นีออนยามค่ำ", en: "Neon night" }, prompt: "neon-lit night, reflections on wet street" },
    { label: { th: "แสงขอบ", en: "Rim light" }, prompt: "dramatic rim light" },
    { label: { th: "ลำแสงทะลุหมอก", en: "God rays" }, prompt: "volumetric god rays through haze" },
    { label: { th: "โทนมืดดราม่า", en: "Moody low-key" }, prompt: "moody low-key lighting" },
  ] },
  { label: { th: "มุมกล้อง / เลนส์", en: "Camera / lens" }, items: [
    { label: { th: "พอร์ตเทรต 85mm", en: "85mm portrait" }, prompt: "close-up portrait, 85mm lens, shallow depth of field", shot: { angle: "portrait-85" } },
    { label: { th: "มุมกว้าง 24mm", en: "24mm wide" }, prompt: "wide-angle 24mm shot", shot: { angle: "wide-24" } },
    { label: { th: "มาโคร", en: "Macro" }, prompt: "macro shot, extreme detail", shot: { angle: "macro" } },
    { label: { th: "มุมสูงโดรน", en: "Drone view" }, prompt: "aerial drone view", shot: { angle: "aerial" } },
    { label: { th: "มุมต่ำ", en: "Low angle" }, prompt: "low-angle hero shot", shot: { angle: "low-angle" } },
    { label: { th: "มุมบนวางราบ", en: "Top-down flat lay" }, prompt: "top-down flat lay", shot: { angle: "top-down" } },
  ] },
  { label: { th: "สีและบรรยากาศ", en: "Color & mood" }, items: [
    { label: { th: "พาสเทล", en: "Pastel" }, prompt: "soft pastel palette" },
    { label: { th: "สีสด", en: "Vivid" }, prompt: "vibrant saturated colors" },
    { label: { th: "ขาวดำ", en: "Black & white" }, prompt: "black and white, high contrast" },
    { label: { th: "ทีลแอนด์ออเรนจ์", en: "Teal & orange" }, prompt: "teal and orange color grade" },
    { label: { th: "โทนฟิล์ม", en: "Film tones" }, prompt: "warm analog film tones, subtle grain" },
  ] },
  { label: { th: "ความคมชัด", en: "Detail" }, items: [
    { label: { th: "รายละเอียดสูง", en: "High detail" }, prompt: "highly detailed" },
    { label: { th: "โฟกัสคม", en: "Sharp focus" }, prompt: "sharp focus" },
    { label: { th: "8K", en: "8K" }, prompt: "8k" },
    { label: { th: "HDR", en: "HDR" }, prompt: "HDR" },
  ] },
];

/**
 * The same for a clip, as whole sentences: video models read camera direction
 * as an action in the description ("The camera pushes in…"), and the camera
 * vocabulary is the one MiniMax's prompting guide for H3 defines.
 */
const VIDEO_BUILDER: BuilderGroup[] = [
  { label: { th: "การเคลื่อนกล้อง", en: "Camera movement" }, items: [
    { label: { th: "ดันเข้าช้าๆ", en: "Slow push-in" }, prompt: "The camera pushes in slowly toward the subject.", shot: { move: "push-in" } },
    { label: { th: "ถอยออกเผยฉาก", en: "Pull out to reveal" }, prompt: "The camera pulls out slowly to reveal the whole scene.", shot: { move: "pull-out" } },
    { label: { th: "แพนไปทางขวา", en: "Pan right" }, prompt: "The camera pans right across the scene.", shot: { move: "pan-right" } },
    { label: { th: "เลื่อนข้างตาม", en: "Truck alongside" }, prompt: "The camera trucks left alongside the subject.", shot: { move: "truck-left" } },
    { label: { th: "เงยขึ้นฟ้า", en: "Tilt up to the sky" }, prompt: "The camera tilts up from the ground to the sky.", shot: { move: "tilt-up" } },
    { label: { th: "โคจรรอบตัว", en: "Orbit" }, prompt: "An arc shot circles around the subject.", shot: { move: "orbit" } },
    { label: { th: "ติดตามผู้แสดง", en: "Tracking shot" }, prompt: "A tracking shot follows the subject as they move.", shot: { move: "tracking" } },
    { label: { th: "กล้องนิ่ง", en: "Static" }, prompt: "Static shot, the camera holds perfectly still.", shot: { move: "static" } },
    { label: { th: "มุมมองสายตา", en: "POV" }, prompt: "POV shot through the character's eyes.", shot: { move: "pov" } },
    { label: { th: "ถือกล้องสั่นนิดๆ", en: "Handheld" }, prompt: "Handheld camera with a slight natural shake.", shot: { move: "handheld" } },
    { label: { th: "โดรนบินผ่าน", en: "Drone flyover" }, prompt: "Aerial drone shot gliding slowly over the landscape.", shot: { move: "drone" } },
    { label: { th: "ซูมเข้าใบหน้า", en: "Zoom to face" }, prompt: "The lens zooms in on the subject's face.", shot: { move: "zoom-face" } },
  ] },
  { label: { th: "ขนาดภาพ", en: "Shot size" }, items: [
    { label: { th: "ไกลเห็นทั้งฉาก", en: "Wide establishing" }, prompt: "Wide establishing shot.", shot: { size: "extreme-wide" } },
    { label: { th: "ครึ่งตัว", en: "Medium" }, prompt: "Medium shot.", shot: { size: "medium" } },
    { label: { th: "ใกล้ใบหน้า", en: "Close-up" }, prompt: "Close-up shot.", shot: { size: "close" } },
    { label: { th: "ใกล้มาก", en: "Extreme close-up" }, prompt: "Extreme close-up.", shot: { size: "extreme-close" } },
  ] },
  { label: { th: "สไตล์และแสง", en: "Style & light" }, items: [
    { label: { th: "หนังฟอร์มยักษ์", en: "Blockbuster" }, prompt: "Live-action, cinematic, anamorphic lens, shallow depth of field." },
    { label: { th: "อนิเมะ 2D", en: "2D anime" }, prompt: "2D-animated, anime style." },
    { label: { th: "3D CG", en: "3D CG" }, prompt: "3D CG animation." },
    { label: { th: "ฟิล์มเก่า", en: "Vintage film" }, prompt: "Vintage film look with soft grain." },
    { label: { th: "โกลเด้นอาวร์", en: "Golden hour" }, prompt: "Warm golden hour light." },
    { label: { th: "นีออนกลางคืน", en: "Neon night" }, prompt: "Neon-lit night with wet reflections." },
  ] },
  { label: { th: "เสียง (โมเดลที่มีเสียงในตัว)", en: "Sound (models with built-in audio)" }, items: [
    { label: { th: "เสียงบรรยากาศจริง", en: "Natural ambience" }, prompt: "Natural ambient sound matching the scene." },
    { label: { th: "ออร์เคสตรา", en: "Orchestral" }, prompt: "Background score: sweeping orchestral strings that build slowly." },
    { label: { th: "อิเล็กทรอนิกส์", en: "Electronic" }, prompt: "Background score: pulsing electronic beat at a fast tempo." },
    { label: { th: "ไม่มีดนตรี", en: "No music" }, prompt: "No background music." },
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
 * text, so it stays). A customer reads them here in their own language.
 */
function localizeOrderError(message: string, t: Translate): string {
  const credits = /Insufficient credits\. Need (\d+), have (\d+)/i.exec(message);
  if (credits) {
    return t(
      `เครดิตไม่พอ — งานนี้ใช้ ${credits[1]} เครดิต แต่มีอยู่ ${credits[2]} เครดิต`,
      `Not enough credits — this needs ${credits[1]} and you have ${credits[2]}.`,
    );
  }
  if (/Model not available/i.test(message)) return t("โมเดลนี้ปิดให้บริการชั่วคราว", "This model is temporarily unavailable.");
  if (/temporarily unavailable/i.test(message)) return t("บริการไม่ว่างชั่วคราว ลองใหม่ในอีกสักครู่", "The service is busy right now. Try again in a moment.");
  if (/Prompt is required/i.test(message)) return t("กรุณาพิมพ์ prompt ก่อน", "Please type a prompt first.");
  if (/Generation failed/i.test(message)) return t("สร้างไม่สำเร็จ ลองใหม่อีกครั้ง", "Generation failed. Please try again.");
  return message;
}

type EnhanceOutcome =
  | { ok: true; prompt: string; source: string; engine?: string }
  | { ok: false; error: string };

/** "✨ ปรับพรอมต์ด้วย AI" — errors as values, like every request helper here. */
async function requestEnhance(body: Record<string, unknown>, t: Translate): Promise<EnhanceOutcome> {
  try {
    const res = await fetch("/api/studio/enhance-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || t("ปรับพรอมต์ไม่สำเร็จ", "Couldn't improve the prompt") };
    if (typeof data.prompt !== "string" || !data.prompt.trim()) return { ok: false, error: t("AI ไม่ได้ส่งพรอมต์กลับมา", "The AI didn't send a prompt back") };
    return { ok: true, prompt: data.prompt, source: String(data.source ?? ""), engine: data.engine };
  } catch {
    return { ok: false, error: t("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้", "Couldn't reach the server") };
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
const MUSIC_STARTERS: Msg[] = [
  { th: "ป๊อปไทยสดใส เสียงร้องหญิง กีตาร์โปร่ง จังหวะเร็ว", en: "Bright Thai pop, female vocal, acoustic guitar, fast tempo" },
  { th: "ลูกทุ่งอีสานสนุกๆ แคน พิณ เสียงร้องชาย", en: "Fun Isan luk thung, khaen, phin, male vocal" },
  { th: "lo-fi ชิลๆ เปียโน ฝนตก ฟังตอนทำงาน", en: "Chill lo-fi, piano, rain, music to work to" },
  { th: "ดนตรีประกอบโฆษณา สร้างแรงบันดาลใจ ออร์เคสตรา", en: "Inspiring orchestral music for an ad" },
];

/** A song-style picker with nothing picked. */
const ANY: Msg = { th: "อิสระ", en: "Any" };

/** What the voice and song pickers take. */
const AUDIO_ACCEPT = "audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,audio/x-m4a";

/**
 * The model picker's order: what can be ordered now first, then the rest, each
 * keeping the admin's sort order — a customer should not scroll past a page of
 * closed models to find the open ones.
 */
function pickerOrder<T extends { canOrder?: boolean }>(models: T[]): T[] {
  return [...models.filter((m) => m.canOrder !== false), ...models.filter((m) => m.canOrder === false)];
}

/**
 * A model picture that fails to load (an admin's thumbnail URL gone stale)
 * falls back to the category art instead of a broken-image box.
 */
function previewFallback(art: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.dataset.fellBack) return;
    img.dataset.fellBack = "true";
    img.src = art;
    img.removeAttribute("data-photo");
    img.parentElement?.setAttribute("data-photo", "false");
  };
}

/** Used to warn when a Thai prompt is sent to an English-only model. */
const THAI_CHARS = /\p{Script=Thai}/u;

interface GenerationResult {
  id: number;
  status: string;
  resultUrl?: string;
  resultUrls?: string[];
  /** A name per file (a stem split's "เสียงร้อง", "กลอง" …). */
  resultLabels?: string[];
  /** The words each file sings, same order ('' = none). */
  resultLyrics?: string[];
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
    voice?: string;
    speechStyle?: string;
  } | null;
  resultUrl?: string;
  resultUrls?: unknown;
  resultLabels?: string[] | null;
  resultLyrics?: string[] | null;
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
  videoMode: VideoMode;
  musicMode: MusicMode;
  suno: SunoChoices;
  replaceOriginal: string;
  replacePick: ReplacePick | null;
  mashSong: MashSong | null;
  voiceId: string | null;
  speechStyle: string;
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
  resultLabels?: string[] | null;
  resultLyrics?: string[] | null;
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
function Field({ no, label, aside, hidden, children }: {
  no: string; label: string; aside?: string;
  /** Kept mounted but not shown — the prompt box on an upscale, which has nothing to describe. */
  hidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div hidden={hidden}>
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
  t: Translate,
): string {
  if (!rule) return t(`คลิปยาวไม่เกิน ${MAX_INPUT_SECONDS} วินาที`, `Clips up to ${MAX_INPUT_SECONDS} seconds`);
  const parts = [
    rule.minSeconds
      ? t(`คลิปยาว ${rule.minSeconds}–${rule.maxSeconds} วินาที`, `Clips of ${rule.minSeconds}–${rule.maxSeconds} seconds`)
      : t(`คลิปยาวไม่เกิน ${rule.maxSeconds} วินาที`, `Clips up to ${rule.maxSeconds} seconds`),
  ];
  if (rule.minSide && rule.maxSide) parts.push(t(`ความละเอียดด้านละ ${rule.minSide}–${rule.maxSide} พิกเซล`, `${rule.minSide}–${rule.maxSide} px per side`));
  if (rule.containers?.length) parts.push(t("ไฟล์ MP4 หรือ MOV", "MP4 or MOV"));
  if (billing?.kind === "clipBlocks") {
    parts.push(t(`คิดเครดิตตามความยาวคลิป ช่วงละ ${billing.blockSeconds} วินาที`, `billed by clip length, per ${billing.blockSeconds}-second block`));
  }
  return parts.join(" · ");
}

async function uploadMedia(
  file: File,
  kind: "audio" | "video" | "image",
  t: Translate,
): Promise<{ url?: string; error?: string; durationSeconds?: number; width?: number; height?: number; contentType?: string }> {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/uploads?kind=${kind}`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) return { error: data.error || t("ลองใหม่อีกครั้ง", "Please try again") };
    if (typeof data.url !== "string") return { error: t("เซิร์ฟเวอร์ไม่ได้ส่งลิงก์ไฟล์กลับมา", "The server didn't send back a file link") };
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
    return { error: t("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้", "Couldn't reach the server") };
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
  t: Translate,
): Promise<{ kind: "ok"; data: GenerationResult } | { kind: "rejected"; error: string } | { kind: "network" }> {
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { kind: "rejected", error: data.error || t("ไม่สามารถสร้างได้", "Couldn't create this") };
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
async function runUpscale(generationId: number, t: Translate): Promise<UpscaleOutcome> {
  try {
    const res = await fetch("/api/upscale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId }) });
    const data = await res.json();
    if (!res.ok) return { kind: "rejected", error: data.error || t("เกิดข้อผิดพลาด", "Something went wrong") };
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
  const t = useT();
  if (busy) {
    return (
      <div className="rp-drop" data-busy="true" role="status">
        <span className="rp-spin" aria-hidden="true" />
        {t("กำลังอัปโหลด…", "Uploading…")}
      </div>
    );
  }

  if (value) {
    return (
      <div className="rp-filechip">
        <span className="rp-filechip-ic" aria-hidden="true">✓</span>
        <span className="rp-filechip-name">{value}</span>
        <button type="button" onClick={onClear} aria-label={t("เอาไฟล์ออก", "Remove file")}>×</button>
      </div>
    );
  }

  return (
    <label className="rp-drop">
      <span className="rp-drop-ic" aria-hidden="true">↑</span>
      {hint}
      <small>{t("หรือลากไฟล์มาวางตรงไหนก็ได้", "or drop a file anywhere")}</small>
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
  const t = useT();
  if (busy) {
    return (
      <div className="rp-drop" data-busy="true" role="status">
        <span className="rp-spin" aria-hidden="true" />
        {t("กำลังอัปโหลด…", "Uploading…")}
      </div>
    );
  }
  if (src) {
    return (
      <div className="rp-pic">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} onLoad={onLoad ? (e) => onLoad(e.currentTarget) : undefined} onError={onError} />
        <button type="button" onClick={onClear} aria-label={t(`เอา${alt}ออก`, `Remove ${alt.toLowerCase()}`)}>×</button>
      </div>
    );
  }
  return (
    <label className="rp-drop">
      <span className="rp-drop-ic" aria-hidden="true">↑</span>
      {hint}
      <small>{t("ลาก & วาง หรือ Ctrl+V", "Drag & drop or Ctrl+V")}</small>
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
  image: "Image", video: "Video", edit: "Edit", lipsync: "Lip Sync", audio: "Music", speech: "Speech",
};

/** The modes in the order the orb lists them and the composer counts them. */
const TAB_ORDER: TabType[] = ["image", "video", "edit", "lipsync", "audio", "speech"];

const TAB_LABEL: Record<TabType, Msg> = {
  image: { th: "สร้างภาพ", en: "Create image" },
  video: { th: "สร้างวิดีโอ", en: "Create video" },
  edit: { th: "แก้ไขภาพ", en: "Edit image" },
  lipsync: { th: "ลิปซิงค์", en: "Lip sync" },
  audio: { th: "สร้างเพลง", en: "Create music" },
  speech: { th: "เสียงพูด", en: "Speech" },
};

/**
 * The orb's icons — one set, drawn together as glass objects on black, keyed
 * out and cut square (public/studio). The names carry a version because
 * public/sw.js used to keep every image forever: a redrawn icon under its old
 * name never reaches a browser that had the old one. Bump the suffix when the
 * art changes, and redraw the whole set or the new one stands out of it.
 */
const PICKER_TITLE: Record<TabType, Msg> = {
  image: { th: "เลือกโมเดลสร้างภาพ", en: "Choose an image model" },
  video: { th: "เลือกโมเดลสร้างวิดีโอ", en: "Choose a video model" },
  edit: { th: "เลือกโมเดลแก้ภาพ", en: "Choose an editing model" },
  lipsync: { th: "เลือกโมเดลพากย์ทับคลิป", en: "Choose a lip-sync model" },
  audio: { th: "เลือกโมเดลเพลง", en: "Choose a music model" },
  speech: { th: "เลือกโมเดลเสียงพูด", en: "Choose a speech model" },
};

const TAB_ICON: Record<TabType, string> = {
  image: "/studio/ic-image-v1.webp",
  video: "/studio/ic-video-v1.webp",
  edit: "/studio/ic-edit-v1.webp",
  lipsync: "/studio/ic-lipsync-v1.webp",
  audio: "/studio/ic-music-v1.webp",
  speech: "/studio/ic-speech-v1.webp",
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
  speech: glyph(<><path d="M4 10v4" /><path d="M8 7v10" /><path d="M12 4v16" /><path d="M16 8v8" /><path d="M20 10.5v3" /></>),
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
  id, open, onToggle, label, value, children, align = "left", width = 300, maxHeight = 360, variant = "field",
}: {
  id: string;
  open: string | null;
  onToggle: (id: string | null) => void;
  label: string;
  value?: string;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
  /** Tallest the panel may grow when the screen has room. */
  maxHeight?: number;
  variant?: "field" | "tool";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isOpen = open === id;
  const [place, setPlace] = useState<Placement>({ up: false, left: 0, top: 0, bottom: 0, width, maxHeight });

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
      maxHeight: Math.min(maxHeight, Math.max(160, (up ? above : below) - 6)),
    });
  }, [align, width, maxHeight]);

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
  options: { id: string; label: Msg }[];
  value: string | string[] | undefined;
  onChange: (next: string | string[] | undefined) => void;
  max?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const t = useT();
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
              {t(o.label)}
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
  const t = useT();
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
        {isVideo ? t("▶ ตัวอย่าง", "▶ Sample") : t("ตัวอย่าง", "Sample")}
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
const CREATING_TIPS: Record<string, Msg[]> = {
  video: [
    { th: "กำลังจัดแสงและมุมกล้อง…", en: "Setting up the lights and camera…" },
    { th: "กำลังวาดเฟรมทีละภาพ…", en: "Drawing it frame by frame…" },
    { th: "กำลังใส่เสียงประกอบ…", en: "Adding the sound…" },
    { th: "กำลังเก็บรายละเอียดการเคลื่อนไหว…", en: "Polishing the motion…" },
  ],
  image: [
    { th: "กำลังเรียงองค์ประกอบภาพ…", en: "Composing the picture…" },
    { th: "กำลังลงสีและแสงเงา…", en: "Painting in color, light and shadow…" },
    { th: "กำลังเก็บรายละเอียดให้คมชัด…", en: "Sharpening the details…" },
  ],
  edit: [
    { th: "กำลังอ่านภาพต้นฉบับ…", en: "Reading your original…" },
    { th: "กำลังแก้ไขตามที่สั่ง…", en: "Making your changes…" },
    { th: "กำลังเกลี่ยรอยต่อให้เนียน…", en: "Blending the seams…" },
  ],
  lipsync: [
    { th: "กำลังฟังเสียงพูด…", en: "Listening to the voice…" },
    { th: "กำลังขยับปากให้ตรงจังหวะ…", en: "Matching the lips to the words…" },
    { th: "กำลังเก็บรายละเอียดใบหน้า…", en: "Polishing the face…" },
  ],
  audio: [
    { th: "กำลังแต่งทำนอง…", en: "Writing the melody…" },
    { th: "กำลังเรียบเรียงดนตรี…", en: "Arranging the music…" },
    { th: "กำลังใส่เสียงร้อง…", en: "Adding the vocals…" },
    { th: "กำลังมิกซ์เสียง…", en: "Mixing…" },
  ],
  speech: [
    { th: "กำลังอ่านข้อความ…", en: "Reading the text…" },
    { th: "กำลังใส่จังหวะและน้ำเสียง…", en: "Adding pace and tone…" },
    { th: "กำลังเก็บเสียงให้ใส…", en: "Cleaning up the audio…" },
  ],
};

/**
 * ElevenLabs v3's audio tags: written into the text in square brackets and
 * performed, not read out (elevenlabs.io/docs, "Audio tags").
 */
const SPEECH_TAGS: { tag: string; label: Msg }[] = [
  { tag: "[laughs]", label: { th: "หัวเราะ", en: "Laugh" } },
  { tag: "[whispers]", label: { th: "กระซิบ", en: "Whisper" } },
  { tag: "[sighs]", label: { th: "ถอนหายใจ", en: "Sigh" } },
  { tag: "[excited]", label: { th: "ตื่นเต้น", en: "Excited" } },
  { tag: "[curious]", label: { th: "สงสัย", en: "Curious" } },
  { tag: "[sarcastic]", label: { th: "ประชด", en: "Sarcastic" } },
  { tag: "[crying]", label: { th: "ร้องไห้", en: "Crying" } },
  { tag: "[exhales]", label: { th: "ผ่อนลมหายใจ", en: "Exhale" } },
];

/** The animated centre of a frame while its result is being made. */
function GeneratingOverlay({ progress }: { progress: QueueProgress | null }) {
  const t = useT();
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
              <div style={{ fontSize: 10, letterSpacing: "0.18em", opacity: 0.75 }}>{t("คิวที่", "Queue")}</div>
              {/* Keyed on the number, so each step down replays the pop. */}
              <div key={place} className="xdr-motion" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.05, animation: "xdr-pop 450ms ease-out" }}>{place}</div>
            </>
          ) : fraction != null ? (
            <>
              <div style={{ fontSize: 10, letterSpacing: "0.18em", opacity: 0.75 }}>{t("กำลังสร้าง", "Creating")}</div>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
                {Math.floor(fraction * 100)}<span style={{ fontSize: 16, opacity: 0.8 }}>%</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.04em" }}>
              {/* A queue with no number to show (an API order): still a queue, not "creating". */}
              {progress?.paused ? t("หยุดชั่วคราว", "Paused") : progress?.stage === "queued" ? t("รอคิว", "Queued") : t("กำลังสร้าง", "Creating")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Queue place, the honest ETA and a moving bar, under the frame(s). */
function GeneratingStatus({ progress, tab, startedAt }: { progress: QueueProgress | null; tab: string; startedAt: number | null }) {
  const t = useT();
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

  const place = queued && (progress?.position ?? 0) > 1 ? t(` • คิวที่ ${progress?.position}`, ` • #${progress?.position} in queue`) : "";
  const headline = progress
    ? `${progress.label}${place}${render != null ? ` ${Math.floor(render * 100)}%` : ""}`
    : t("กำลังสร้างผลงานของคุณ", "Creating your work");
  const waitLine = progress?.etaLabel
    ? progress.basis === "baseline"
      ? t(`คาดว่าใช้เวลา ${progress.etaLabel}`, `Expected to take about ${progress.etaLabel}`)
      : t(`เหลืออีก ${progress.etaLabel}`, `About ${progress.etaLabel} left`)
    : null;
  const idleLine = tab === "video" ? t("วิดีโอมักใช้เวลา 30-120 วินาที", "Videos usually take 30–120 seconds") : t("รอสักครู่", "Just a moment");
  const eta = waitLine ?? (!progress ? idleLine : null);

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
        {queued ? t("ระบบจะเริ่มสร้างให้อัตโนมัติเมื่อถึงคิวของคุณ", "It starts automatically when it's your turn") : t(tips[tip % tips.length])}
      </div>
      {progress && (
        <div style={{ fontSize: 11, color: "rgba(203,213,225,0.45)", marginTop: 6 }}>
          {t("ปิดหน้านี้ได้ ผลงานจะเข้าแกลเลอรีเมื่อเสร็จ", "You can close this page — your work goes to your gallery when it's done")}
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
  const t = useT();
  const { locale } = useLocale();
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
  /** A model a link named (`?model=`, the admin's test order), applied once the list has loaded. */
  const [linkedModel, setLinkedModel] = useState<number | null>(null);
  const [prompt, setPrompt] = useState(() => (typeof draft0.prompt === "string" ? draft0.prompt.slice(0, 10_000) : ""));
  // A link from the home page names the tab (`?tab=`) and may carry a prompt
  // (`?prompt=`); an admin page may name a model (`?model=`). Read after mount, not in the initializers above: on a
  // client-side navigation the address still shows the previous page while
  // this one first renders. Saved to the draft at once — a visitor who is not
  // signed in goes through /login, which comes back to /generate without the
  // query — then taken out of the address, so a reload does not lay it over
  // whatever was written since.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("tab") && !url.searchParams.has("prompt") && !url.searchParams.has("model")) return;
    const tabParam = url.searchParams.get("tab");
    const promptParam = url.searchParams.get("prompt")?.trim();
    const modelParam = Number(url.searchParams.get("model"));
    const fromLink: StudioDraft = {};
    if (tabParam && Object.hasOwn(TAB_EN, tabParam)) fromLink.tab = tabParam as TabType;
    if (promptParam) fromLink.prompt = promptParam.slice(0, 2000);
    /* eslint-disable react-hooks/set-state-in-effect -- the address is only readable once mounted */
    if (fromLink.tab) setTab(fromLink.tab);
    if (fromLink.prompt) setPrompt(fromLink.prompt);
    if (Number.isInteger(modelParam) && modelParam > 0) setLinkedModel(modelParam);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (fromLink.tab || fromLink.prompt) writeDraft({ ...readDraft(), ...fromLink });
    url.searchParams.delete("tab");
    url.searchParams.delete("prompt");
    url.searchParams.delete("model");
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
  const [enhanceNote, setEnhanceNote] = useState<Msg | null>(null);
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
  const composerRef = useRef<HTMLElement>(null);
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
  const [videoMode, setVideoMode] = useState<VideoMode>("t2v");
  const [musicMode, setMusicMode] = useState<MusicMode>("create");
  const [suno, setSuno] = useState<SunoChoices>({});
  /** Replace Section: the song's own words, and the part picked from them. */
  const [replaceOriginal, setReplaceOriginal] = useState("");
  const [replacePick, setReplacePick] = useState<ReplacePick | null>(null);
  /** Mashup: the second song. */
  const [mashSong, setMashSong] = useState<MashSong | null>(null);
  const [mashUploading, setMashUploading] = useState(false);
  /** A finished track carried on to the next tool: played in the slot, as an upload has no player. */
  const [carriedAudio, setCarriedAudio] = useState<string | null>(null);
  /** Speech tab: the voice picked (null = the model's default) and, for a model that takes one, how to speak. */
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [speechStyle, setSpeechStyle] = useState("");
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
      : key === "speech"
        ? isSpeechModel(m)
        : // Lip-sync models are stored under 'video' and speech under 'audio',
          // but each belongs to its own tab; leaving them in this list would
          // offer a model whose required inputs these controls cannot supply.
          m.category === key && !isLipsyncModel(m.subcategory) && !isSpeechModel(m);
  /** The clip tool the video tab is in, or null on text/image → video. */
  const videoTool: VideoTool | null = tab === "video" && (videoMode === "motion" || videoMode === "upscale") ? videoMode : null;
  // A video mode lists only its own models: a motion copy offered on text →
  // video would get no clip, a text model on "upscale" no description.
  const filteredModels = models.filter((m) =>
    inTab(m, tab) &&
    (tab !== "video" || videoToolOf(m.subcategory) === videoTool) &&
    (tab !== "audio" || musicModeOf(m) === musicMode));
  /** The music modes some model offers — the switch appears only with more than one. */
  const musicModes = MUSIC_MODES.filter((mode) => models.some((m) => inTab(m, "audio") && musicModeOf(m) === mode.key));
  const lostMusicMode = modelsLoaded && musicMode !== "create" && !musicModes.some((m) => m.key === musicMode);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lostMusicMode) setMusicMode("create");
  }, [lostMusicMode]);
  /** The clip tools some connected video model offers — their modes appear only then. */
  const videoTools = (["motion", "upscale"] as const).filter((tool) =>
    models.some((m) => m.category === "video" && videoToolOf(m.subcategory) === tool),
  );
  // A tool mode whose models went away (switched off, or a reopened order's
  // model since retired) falls back to text → video rather than an empty list.
  const lostVideoTool = modelsLoaded && videoTool !== null && !videoTools.includes(videoTool);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lostVideoTool) setVideoMode("t2v");
  }, [lostVideoTool]);
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
      ? t("ยังไม่มีโมเดลในหมวดนี้", "No models in this category yet")
      : model3dModels.some((m) => m.canOrder !== false)
        ? null
        : model3dModels[0].unavailableReason ?? model3dModels[0].tuningMessage ?? t("ยังใช้งานไม่ได้ในขณะนี้", "Not available right now");
  const tabBlockedReason = (key: TabType): string | null => {
    if (!modelsLoaded) return null;
    const inThisTab = models.filter((m) => inTab(m, key));
    if (inThisTab.length === 0) return t("ยังไม่มีโมเดลในหมวดนี้", "No models in this category yet");
    if (inThisTab.some((m) => m.canOrder !== false)) return null;
    return inThisTab[0].unavailableReason ?? inThisTab[0].tuningMessage ?? t("ยังใช้งานไม่ได้ในขณะนี้", "Not available right now");
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

  // The model a link named: its own tab and video mode, then the model. After
  // the re-pick above, so its choice for the old tab does not win.
  useEffect(() => {
    if (!modelsLoaded || linkedModel === null) return;
    const m = models.find((x) => x.id === linkedModel);
    /* eslint-disable react-hooks/set-state-in-effect -- the list arrives after mount */
    setLinkedModel(null);
    if (!m) return;
    const home: TabType | undefined = isLipsyncModel(m.subcategory)
      ? "lipsync"
      : isSpeechModel(m)
        ? "speech"
        : TAB_ORDER.find((k) => k === m.category);
    if (!home) return;
    setTab(home);
    if (home === "video") setVideoMode(videoToolOf(m.subcategory) ?? "t2v");
    if (home === "audio") setMusicMode(musicModeOf(m));
    setSelectedModelId(m.id);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [modelsLoaded, linkedModel, models]);

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
    const timer = setInterval(ping, 30_000);
    // Coming back to the tab counts at once, not up to 30 s later.
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(timer);
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
   * A KIE.ai row's credits by tier, length and pictures (kie-pricing.ts) —
   * the table GenerationService charges from. Its tiers are the quality or
   * resolution chips below; the raw pick goes in, and `kieQuote` falls back
   * to the default exactly as the server does.
   */
  const priceTable = selectedModel?.priceTable ?? null;
  const kieTier =
    priceTable?.tierParam === "quality" ? activeQuality?.id
      : priceTable?.tierParam === "resolution" ? resolution ?? undefined
        : undefined;
  /** Pictures KIE may bill: the references on the image tab, the frames on the video tab. */
  const kieImages =
    tab === "image" ? refs.length
      : tab === "video" && videoMode === "i2v" && inputImage
        ? 1 + (selectedModel?.video?.lastFrame === true && inputImageEnd ? 1 : 0)
        : 0;
  /** A text-to-speech row's voices and limit (the speech tab), else null. */
  const speechRule = tab === "speech" ? selectedModel?.speech ?? null : null;
  /** Characters a speech order is priced and capped by, counted as the server counts them. */
  const speechLength = speechRule ? speechChars(prompt) : 0;
  const speechTooLong = speechRule !== null && speechLength > speechRule.maxChars;
  /** The voice that will speak: the pick if this model has it, else its default. */
  const activeVoice = speechRule ? speechRule.voices.find((v) => v.id === voiceId) ?? speechRule.voices[0] ?? null : null;
  /**
   * One output's price — the same formula GenerationService charges with,
   * rounded up after the quality multiplier exactly as the server does.
   * `tier` prices a chip other than the chosen one.
   */
  const creditsFor = (seconds: number | null, tier?: string) =>
    !selectedModel
      ? 0
      : priceTable
        ? kieQuote(priceTable, { tier: tier ?? kieTier, seconds, images: kieImages, chars: speechLength })
        : Math.ceil(
            creditsForDuration(selectedModel.creditsPerUnit, selectedModel.durationCurve, seconds) *
              (activeQuality?.creditsMultiplier ?? 1)
          );

  /** Which second file the chosen lip-sync model animates — a clip, or a still. */
  const lipsyncNeeds: "image" | "video" =
    selectedModel?.subcategory === LIPSYNC_PORTRAIT ? "image" : "video";
  /** The still the portrait models animate reuses the existing image picker. */
  const lipsyncSource = lipsyncNeeds === "image" ? inputImage : sourceVideo;

  /** Lengths this model can actually produce. Always offers at least 5s. */
  const durationChoices = (() => {
    // A KIE clip is sold at the lengths its table prices, and only those.
    if (tab === "video" && priceTable?.durations) return priceTable.durations;
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
  /** A clip tool's rule for its clip (upscale, motion copy), checked the same way as a re-dub's. */
  const toolClipRule = videoTool ? selectedModel?.clipInput?.clip ?? null : null;
  const clipRule = videoRule?.clip ?? toolClipRule;
  const sourceClip = sourceVideo ? clipFacts[sourceVideo] ?? null : null;
  const clipCheck = clipRule && sourceClip ? checkClip(clipRule, sourceClip) : null;
  const clipVoiceCheck =
    videoRule?.voice && sourceClip && inputAudioSeconds !== null
      ? checkVoice(videoRule.voice, { seconds: inputAudioSeconds, bytes: inputAudioFile?.size ?? 0 }, sourceClip.seconds)
      : null;
  /** Longest clip the picker takes: the model's own limit where it has one. */
  const clipMaxSeconds = clipRule?.maxSeconds ?? MAX_INPUT_SECONDS;
  /** Whole seconds a clip tool is billed for (KIE rounds up), once the clip is in. */
  const toolSeconds = videoTool && sourceClip ? Math.ceil(sourceClip.seconds) : null;
  /** A motion copy animates a character picture; an upscale takes the clip alone. */
  const toolNeedsImage = videoTool !== null && selectedModel?.clipInput?.needsImage === true;
  /** What a clip tool still needs — said on the form and when the button is pressed — or null. */
  const missingToolText = !videoTool
    ? null
    : !sourceVideo
      ? videoTool === "motion"
        ? t("ต้องอัปโหลดคลิปท่าทางต้นแบบก่อน", "Upload the clip whose moves to copy first")
        : t("ต้องอัปโหลดคลิปที่จะขยายก่อน", "Upload the clip to upscale first")
      : toolNeedsImage && !inputImage ? t("ต้องอัปโหลดภาพตัวละครก่อน", "Upload the character picture first") : null;
  /** The portrait in the slot, at its natural size, once it has drawn. */
  const portraitDims = imageDims && imageDims.src === inputImagePreview ? imageDims : null;

  /** Music controls this model offers; null for API music models and every other tab. */
  const musicOpts = tab === "audio" ? selectedModel?.music ?? null : null;
  /** A cover has nothing to cover until the customer uploads the song. */
  const missingSourceSong = musicOpts?.sourceSong === true && !hasAudio;
  /** Longest source track a cover accepts — the upload cap, not the model's. */
  const coverSourceSeconds = musicOpts?.maxSourceSeconds ?? musicOpts?.maxDuration ?? 240;
  /** A Suno tool's own options, or null for every other model. */
  const sunoOpts = musicOpts?.suno ?? null;
  const sunoTool: SunoTool | null = sunoOpts?.tool ?? null;
  /** A stem split has nothing to describe: its prompt box is not drawn. */
  const promptHidden = sunoTool === "stems";
  /** A tool that works on a track may go without words: the track is the instruction. */
  const promptOptional = sunoTool !== null && sunoTool !== "song" && sunoTool !== "sounds";
  /** "เพลงบรรเลง" only where it means something — not when vocals or a band are what is added. */
  const instrumentalOn = instrumental && sunoOpts?.instrumental !== false;
  /** The split chosen on a stems model ("ดึงชิ้นเดียว" asks which stem). */
  const stemTier = sunoTool === "stems" ? activeQuality?.id ?? null : null;
  const activeStem = sunoOpts?.stems?.find((x) => x.id === suno.stem) ?? sunoOpts?.stems?.[0] ?? null;
  // What the fine-tuning panel's button says it holds.
  const sunoTuned = suno.styleWeight !== undefined || suno.weirdness !== undefined || suno.audioWeight !== undefined;
  const sunoPicks = [
    suno.length ? clock(suno.length) : "",
    suno.variety !== undefined && SUNO_VARIETY[suno.variety] ? t(SUNO_VARIETY[suno.variety]) : "",
    sunoTuned ? t("กำหนดเอง", "Custom") : "",
  ].filter((x) => x).join(" · ");
  const sunoSummary = sunoPicks === "" ? t("อัตโนมัติ", "Auto") : sunoPicks;
  const setSunoField = <K extends keyof SunoChoices>(key: K, value: SunoChoices[K]) =>
    setSuno((c) => ({ ...c, [key]: value }));
  /** Where an extension picks up, in seconds of the track as ordered: the second chosen, else its last whole second. */
  const extendLast = sunoTool === "extend" && inputAudioSeconds !== null && inputAudioSeconds >= 2 ? Math.max(1, Math.floor(inputAudioSeconds) - 1) : null;
  const extendFrom = extendLast === null ? null : suno.continueAt !== undefined && suno.continueAt <= extendLast ? suno.continueAt : extendLast;
  /** A second picked on the waveform, kept inside the track. */
  const pickExtendFrom = (second: number) => {
    if (extendLast !== null) setSunoField("continueAt", Math.min(extendLast, Math.max(1, second)));
  };

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
  /** Replace Section: the part picked, while it is still of this upload and these words. */
  const replaceWindow =
    sunoTool === "replace" && replacePick && replacePick.src === inputAudio && replacePick.original === replaceOriginal && !audioStale ? replacePick : null;
  const replaceLines = replaceWindow && replaceWindow.first !== null && replaceWindow.last !== null ? { first: replaceWindow.first, last: replaceWindow.last } : null;
  /** The whole song's words after the change: the original with the picked lines swapped, or as typed when set by seconds. */
  const replaceFull = !replaceWindow
    ? ""
    : replaceLines ? replacedLyrics(replaceOriginal, replaceLines.first, replaceLines.last, lyrics) : replaceOriginal.trim();
  const replaceSeconds = replaceWindow?.seconds ?? inputAudioSeconds;
  const replaceCheck = replaceWindow && replaceSeconds ? sunoReplaceWindow(replaceSeconds, replaceWindow.from, replaceWindow.to) : null;
  /** What Replace Section still needs — on the form and when the button is pressed — or null. */
  const missingReplaceText =
    sunoTool !== "replace" || !hasAudio ? null
      : !replaceWindow ? t("เลือกท่อนที่จะร้องใหม่ก่อน", "Pick the part to sing anew first")
        : replaceCheck && !replaceCheck.ok ? t(replaceCheck.message)
          : !replaceFull.trim() ? t("ใส่เนื้อเพลงทั้งเพลงก่อน", "Add the whole song's lyrics first")
            : replaceLines && !lyrics.trim() ? t("ใส่เนื้อท่อนใหม่ที่จะร้องในช่องเนื้อเพลงก่อน", "Type the new words to sing in the lyrics box first")
              : null;
  const missingMashText = sunoTool === "mashup" && !mashSong ? t("อัปโหลดเพลงที่สองที่จะมิกซ์ก่อน", "Upload the second song to mash up first") : null;

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
      ? composeMusicTags(prompt, { ...musicStyle, instrumental: instrumentalOn })
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
    (tab !== "lipsync" && !videoTool && !promptOptional && !prompt.trim()) ||
    missingStartFrame ||
    missingToolText !== null ||
    speechTooLong ||
    missingLipsyncInput ||
    // A voice the server would refuse (too long, too short, unreadable).
    voiceLength?.ok === false ||
    // …or a clip (or a voice beside it) the model does not take.
    clipCheck?.ok === false ||
    clipVoiceCheck?.ok === false ||
    missingSourceSong ||
    // Replace Section without its part, or a mashup without its second song.
    missingReplaceText !== null ||
    missingMashText !== null ||
    mashUploading ||
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
    // A picture is upscaled by a picture model; Topaz Video Upscale matches the same words.
    m.category !== "video" &&
    (m.subcategory === "upscale" || /upscale|esrgan/i.test(m.name) || /upscale|esrgan/i.test(m.modelId))
  );

  const closeModelPicker = useCallback(() => setShowModelDropdown(false), []);
  const pickModel = useCallback((id: number) => {
    setSelectedModelId(id);
    setShowModelDropdown(false);
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
      toast(
        "error",
        t("โมเดลนี้ไม่รับภาพอ้างอิง", "This model doesn’t take reference pictures"),
        t("เลือกโมเดลที่มีป้าย “รับภาพอ้างอิงได้”", "Pick a model tagged “Takes reference pictures”"),
      );
      return 0;
    }
    const room = multiRef ? refCap - refs.length : 1;
    if (room <= 0) {
      toast(
        "error",
        t("ภาพอ้างอิงครบแล้ว", "No room for more pictures"),
        t(`โมเดลนี้รับได้ ${refCap} ภาพ — เอาภาพเดิมออกก่อน`, `This model takes ${refCap} ${refCap === 1 ? "picture" : "pictures"} — remove one first`),
      );
      return 0;
    }
    if (pictures.length > room) {
      toast(
        "info",
        t(`ใส่ได้อีก ${room} ภาพ`, `Room for ${room} more`),
        t(`โมเดลนี้รับภาพอ้างอิงได้ ${refCap} ภาพ ภาพที่เกินไม่ได้ใส่`, `This model takes ${refCap} reference ${refCap === 1 ? "picture" : "pictures"} — the extra ones were left out`),
      );
    }
    const taken = pictures.slice(0, room);
    const fits = taken.filter((f) => f.size <= MAX_BYTES.image);
    if (fits.length < taken.length) {
      toast("error", t("ไฟล์ใหญ่เกินไป", "File too large"), t("ภาพอ้างอิงต้องไม่เกิน 12 MB ต่อภาพ", "Each reference picture must be 12 MB or less"));
    }
    if (fits.length === 0) return 0;
    const start = multiRef ? refs.length : 0;
    const tiles = fits.map((file, i) => {
      refIdRef.current += 1;
      const pic: RefPic = { id: refIdRef.current, url: null, role: defaultRole(start + i) };
      return { file, pic };
    });
    setRefs((rs) => (multiRef ? [...rs, ...tiles.map((tile) => tile.pic)] : [tiles[0].pic]));
    const done = await Promise.all(tiles.map(async ({ file, pic }) => {
      const res = await uploadMedia(file, "image", t);
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
      toast(
        "error",
        t("อัปโหลดภาพอ้างอิงไม่สำเร็จ", "Couldn’t upload the reference pictures"),
        failed > 1 ? t(`${failed} ภาพ ลองอีกครั้ง`, `${failed} pictures — try again`) : t("ลองอีกครั้ง", "Try again"),
      );
    }
    return done.length - failed;
  };
  const removeRef = (id: number) => setRefs((rs) => rs.filter((r) => r.id !== id));
  /**
   * Swap a picture with its neighbour. The order is what "ภาพ 1, ภาพ 2 …"
   * in the prompt and the model's own input list mean, and the first is the
   * main one.
   */
  const moveRef = (id: number, step: -1 | 1) =>
    setRefs((rs) => {
      const from = rs.findIndex((r) => r.id === id);
      const to = from + step;
      if (from < 0 || to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  const cycleRole = (id: number) =>
    setRefs((rs) => rs.map((r) => (r.id === id ? { ...r, role: nextRole(r.role) } : r)));

  /** A word put where the caret is in the prompt box (or at its end), with a space either side. */
  const insertAtCaret = (token: string) => {
    // ✨ is rewriting the box; anything put in now would be lost under its answer.
    if (enhancing) return;
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
  /** "ภาพ 2" into the prompt at the caret — the words that point the model at a picture. */
  const insertRefToken = (n: number) => insertAtCaret(referenceToken(n, locale));

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
      toast(
        "error",
        t("ตัดเสียงไม่สำเร็จ", "Couldn’t cut the audio"),
        t("เบราว์เซอร์นี้ตัดไฟล์ไม่ได้ ลองตัดเสียงก่อนแล้วอัปโหลดใหม่", "This browser can’t cut the file. Trim it yourself, then upload it again."),
      );
      return;
    }
    const res = await uploadMedia(file, "audio", t);
    if (seq !== trimSeqRef.current) return;
    const url = res.url;
    if (!url) {
      setTrimFailed(key);
      toast("error", t("อัปโหลดไม่สำเร็จ", "Upload failed"), res.error ?? t("ลองใหม่อีกครั้ง", "Please try again"));
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
    const timer = setTimeout(() => void commitTrimRef.current(), 450);
    return () => clearTimeout(timer);
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
        t("ไฟล์ยาวเกินไป", "File too long"),
        t(
          `รองรับไม่เกิน ${maxSeconds} วินาที (ไฟล์นี้ ${seconds.toFixed(1)} วินาที) กรุณาตัดให้สั้นลงก่อน`,
          `Up to ${maxSeconds} seconds (this file is ${seconds.toFixed(1)} seconds). Please trim it first.`,
        ),
      );
      return;
    }

    const result = await uploadMedia(file, kind, t);
    setUploading(null);

    if (result.error) {
      toast("error", t("อัปโหลดไม่สำเร็จ", "Upload failed"), result.error);
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

  /** Mashup's second song → R2 as it is; its length is checked again on the server. */
  const pickMashSong = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const seconds = await probeDuration(file, "audio");
    if (seconds !== null && seconds > coverSourceSeconds + 0.25) {
      toast(
        "error",
        t("ไฟล์ยาวเกินไป", "File too long"),
        t(`เพลงที่สองยาวได้ไม่เกิน ${Math.floor(coverSourceSeconds / 60)} นาที`, `The second song can be up to ${Math.floor(coverSourceSeconds / 60)} min`),
      );
      return;
    }
    setMashUploading(true);
    const result = await uploadMedia(file, "audio", t);
    setMashUploading(false);
    if (result.error || !result.url) {
      toast("error", t("อัปโหลดไม่สำเร็จ", "Upload failed"), result.error ?? t("ลองใหม่อีกครั้ง", "Please try again"));
      return;
    }
    setMashSong({ url: result.url, name: file.name, seconds: result.durationSeconds ?? seconds });
  };

  /** Last frame → R2. No try/finally, for the same reason as handleMediaUpload. */
  const handleEndFrameUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading("image");
    const result = await uploadMedia(file, "image", t);
    setUploading(null);
    if (result.error) {
      toast("error", t("อัปโหลดไม่สำเร็จ", "Upload failed"), result.error);
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
        onCanvas ? t("สร้างสำเร็จ!", "Done!") : t("งานที่สั่งไว้เสร็จแล้ว", "Your order is ready"),
        t(
          `ใช้ ${outcome.creditsUsed} เครดิต${onCanvas ? "" : " · กดที่แถบงานเหนือแคนวาสเพื่อดู"}`,
          `Used ${formatCredits(outcome.creditsUsed, "en")}${onCanvas ? "" : " · tap it in the tray above the canvas to see it"}`,
        ),
      );
    } else {
      toast("error", t("สร้างไม่สำเร็จ", "Generation failed"), outcome.error ? localizeOrderError(outcome.error, t) : t("เกิดข้อผิดพลาด", "Something went wrong"));
    }
  }, [setIsGenerating, fetchCredits, fetchHistory, toast, t]);

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
          resultLabels: Array.isArray(data.resultLabels) ? data.resultLabels : undefined,
          resultLyrics: Array.isArray(data.resultLyrics) ? data.resultLyrics : undefined,
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
      t("ยังสร้างไม่เสร็จ", "Still working on it"),
      t(
        "งานยังทำงานอยู่เบื้องหลัง ผลลัพธ์จะขึ้นในแกลเลอรีเมื่อเสร็จ ไม่ต้องสั่งสร้างใหม่",
        "It's still running in the background and will appear in your gallery when it's done. No need to order it again.",
      ),
    );
    fetchHistory();
  }, [setIsGenerating, fetchHistory, toast, settleJob, t]);

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
    // …and so may a clip tool: an upscale has nothing to describe.
    if (tab !== "lipsync" && !videoTool && !promptOptional && !prompt.trim()) return;
    if (runningJobs >= MAX_PARALLEL_JOBS) {
      toast(
        "info",
        t(`กำลังสร้างอยู่ ${MAX_PARALLEL_JOBS} งานแล้ว`, `Already creating ${MAX_PARALLEL_JOBS} at once`),
        t("รอให้งานใดงานหนึ่งเสร็จก่อน แล้วค่อยสั่งเพิ่ม", "Wait for one to finish, then order another."),
      );
      return;
    }
    if (missingStartFrame) {
      toast("error", t("ยังไม่ได้เลือกภาพเริ่มต้น", "No start frame yet"), t("โหมดภาพ → วิดีโอ ต้องอัปโหลดภาพก่อน", "Image → video needs a picture first."));
      return;
    }
    if (missingToolText) {
      toast("error", t("ยังใส่ไฟล์ไม่ครบ", "Some files are missing"), missingToolText);
      return;
    }
    if (speechTooLong && speechRule) {
      toast(
        "error",
        t("ข้อความยาวเกินไป", "Text too long"),
        t(
          `โมเดลนี้อ่านได้ครั้งละไม่เกิน ${formatNumber(speechRule.maxChars, locale)} ตัวอักษร — ตัดให้สั้นลงหรือแบ่งเป็นหลายงาน`,
          `This model reads up to ${formatNumber(speechRule.maxChars, locale)} characters at a time — shorten it or split it into several orders.`,
        ),
      );
      return;
    }
    if (missingLipsyncInput) {
      toast(
        "error",
        t("ยังใส่ไฟล์ไม่ครบ", "Some files are missing"),
        !hasAudio
          ? t("ต้องอัปโหลดไฟล์เสียงที่จะให้พูด", "Upload the audio to be spoken")
          : lipsyncNeeds === "image"
            ? t("ต้องอัปโหลดรูปหน้าคนที่จะให้พูด", "Upload a photo of the face that will speak")
            : t("ต้องอัปโหลดคลิปต้นฉบับที่จะพากย์ทับ", "Upload the clip to re-dub"),
      );
      return;
    }
    if (voiceLength && !voiceLength.ok) {
      toast("error", t("ใช้ไฟล์เสียงนี้ไม่ได้", "Can't use this audio file"), t(voiceLength.msg));
      return;
    }
    if (clipCheck && !clipCheck.ok) {
      toast("error", t("ใช้คลิปนี้ไม่ได้", "Can't use this clip"), t(clipCheck.msg));
      return;
    }
    if (clipVoiceCheck && !clipVoiceCheck.ok) {
      toast("error", t("ใช้ไฟล์เสียงนี้ไม่ได้", "Can't use this audio file"), t(clipVoiceCheck.msg));
      return;
    }
    if (missingSourceSong) {
      toast(
        "error",
        t("ยังไม่ได้อัปโหลดเพลง", "No song uploaded yet"),
        sunoTool
          ? t("โหมดนี้ทำงานกับเพลงที่อัปโหลด — ใส่ไฟล์ก่อนสั่ง", "This mode works on a song you upload — add the file before ordering.")
          : t("โหมดคัฟเวอร์ต้องมีเพลงให้ AI ถอดทำนองก่อน", "A cover needs a song for the AI to take the tune from."),
      );
      return;
    }
    if (missingReplaceText) {
      toast("error", t("ยังเลือกท่อนไม่ครบ", "The part isn't set yet"), missingReplaceText);
      return;
    }
    if (missingMashText || mashUploading) {
      toast("info", t("ยังไม่มีเพลงที่สอง", "No second song yet"), missingMashText ?? t("รอให้อัปโหลดเสร็จก่อน", "Wait for the upload to finish."));
      return;
    }
    if (tab === "image" && refsUploading) {
      toast("info", t("ภาพอ้างอิงยังอัปโหลดไม่เสร็จ", "Reference pictures are still uploading"), t("รอสักครู่แล้วกดอีกครั้ง", "Wait a moment, then try again."));
      return;
    }
    if (tab === "image" && refsOver) {
      toast(
        "error",
        t("ภาพอ้างอิงเกินจำนวน", "Too many reference pictures"),
        t(`โมเดลนี้รับได้ ${refCap} ภาพ — เอาออกให้เหลือ ${refCap} ภาพก่อนสั่ง`, `This model takes ${refCap} — remove some before ordering.`),
      );
      return;
    }
    if (audioStale && (tab === "lipsync" || musicOpts?.sourceSong === true)) {
      if (trimTooLong) {
        toast(
          "error",
          t("ช่วงเสียงยาวเกินไป", "Selection too long"),
          t(`โมเดลนี้รับไม่เกิน ${Math.floor(trimMax)} วินาที ลากขอบให้สั้นลง`, `This model takes up to ${Math.floor(trimMax)} seconds — drag the edges in.`),
        );
      } else {
        toast("info", t("กำลังเตรียมช่วงเสียงที่เลือก", "Preparing your selection"), t("รอสักครู่แล้วกดอีกครั้ง", "Wait a moment, then try again."));
      }
      return;
    }
    // Reference pictures travel as URLs. A model that composes several is told
    // in the prompt what each one is (studio-references.ts) — the same words
    // the customer points at with "ภาพ 1", "ภาพ 2".
    const sentPics = refCap > 0 ? refs.filter((r): r is RefPic & { url: string } => r.url !== null) : [];
    const multiSend = multiRef && sentPics.length > 0;
    const promptToSend = multiSend ? composeReferencePrompt(prompt, sentPics.map((r) => r.role)) : prompt.trim();
    if (promptToSend.length > 10_000) {
      toast(
        "error",
        t("พรอมต์ยาวเกินไป", "Prompt too long"),
        t("รวมคำอธิบายภาพอ้างอิงแล้วเกิน 10,000 ตัวอักษร ตัดพรอมต์ให้สั้นลง", "With the reference descriptions it's over 10,000 characters. Shorten your prompt."),
      );
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
    // A clip tool's frame is its clip's; a voice, like a song, has none.
    const toolFrame = videoTool && sourceClip ? `${sourceClip.width}:${sourceClip.height}` : null;
    const jobAspect = tab === "audio" || tab === "speech" ? "1:1" : portrait ? `${portrait.width}:${portrait.height}` : toolFrame ?? aspectRatio;
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
        : tab === "audio" || tab === "speech" || (tab === "video" && (videoMode === "t2v" || videoMode === "upscale")) ? null : inputImage;
    // The music tab hides the picture controls, but their state lives on — an
    // image tab's negative prompt reaching the music model would be sung as
    // the lyrics, and its image style appended to the song's description.
    const music = tab === "audio";
    // Speech and the clip tools have none of the picture knobs either: a
    // negative prompt or a style's words would be read out, or ignored.
    const noPictureKnobs = music || tab === "speech" || videoTool !== null;
    // The song keeps the name it was made under, not whatever is typed next.
    if (music) setSongTitle(prompt.trim());
    // An API row that bills by the clip is a re-dub the server finishes in the
    // background, and so is every KIE order (after() + poll): a Veo clip or an
    // upscale outlasts the four minutes an API answer is otherwise given.
    const slowApi = Boolean(videoRule?.billing) || selectedModel?.asyncApi === true;
    // A stem split has no words of its own; its history line says what it was.
    const splitTitle = promptHidden ? `${t("แยกสเต็ม", "Split stems")} · ${activeQuality?.label ?? ""}${stemTier === "one" && activeStem ? ` (${activeStem.label})` : ""}` : null;
    const sent = await postGeneration({
      modelId: selectedModelId,
      // Lip-sync has no generation type of its own on the server: what it
      // produces is a clip, and the tab exists only to give it the right
      // controls here.
      // Speech is an 'audio' order, like a song.
      type: tab === "lipsync" ? "video" : tab === "speech" ? "audio" : tab,
      prompt: splitTitle ?? promptToSend,
      // Checked against the model's cap and our bucket again on the server.
      referenceImages: multiSend ? sentPics.map((r) => r.url) : undefined,
      negativePrompt: noPictureKnobs ? undefined : negativePrompt.trim() || undefined,
      styleId: noPictureKnobs ? undefined : selectedStyle || undefined,
      inputImage: tab === "lipsync" && lipsyncNeeds === "video" ? undefined : imageToSend || undefined,
      // A cover reads the same field as lip-sync: both are "a track the server
      // fetches from our bucket and hands to the model".
      inputAudio: tab === "lipsync" || musicOpts?.sourceSong ? inputAudio ?? undefined : undefined,
      inputVideo: tab === "lipsync" || videoTool ? sourceVideo ?? undefined : undefined,
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
        // A clip tool is as long as its clip, which the server reads for itself.
        duration: (tab === "video" && !videoTool) || (music && !musicOpts?.autoLength) ? duration : undefined,
        // The music model is a distilled turbo with its own fixed step count.
        steps: tab === "video" || tab === "lipsync" || tab === "speech" || music ? undefined : steps,
        cfgScale: tab === "video" || tab === "lipsync" || tab === "speech" || music ? undefined : guidance,
        seed: overrides.seed ?? seed ?? undefined,
        // Instrumental wins over whatever is in the box, and is expressed by
        // sending no lyrics at all — which is exactly what the models read as
        // "no vocal".
        lyrics: music && !instrumentalOn && musicOpts?.lyrics !== false ? lyrics.trim() || undefined : undefined,
        // The choices, not the prompt they compose into: the server builds the
        // `[Tags]` line so every client builds the same one.
        music: musicOpts?.controls ? { ...musicStyle, instrumental: instrumentalOn } : undefined,
        // Suno's fine-tuning, only the fields this tool reads (kie-suno.ts checks them again).
        suno: sunoTool
          ? sunoParamsFor(
              sunoTool,
              { ...suno, replaceFrom: replaceWindow?.from, replaceTo: replaceWindow?.to, fullLyrics: replaceFull || undefined, mashWith: mashSong?.url },
              activeQuality?.id,
            )
          : undefined,
        // One of the model's own voices; the server falls back to its default.
        voice: tab === "speech" ? activeVoice?.id : undefined,
        speechStyle: tab === "speech" && speechRule?.style ? speechStyle.trim() || undefined : undefined,
      },
    }, t);
    if (sent.kind !== "ok") {
      setJobs((js) => js.filter((j) => j.id !== pendingId));
      if (focusRef.current === pendingId) {
        focusRef.current = null;
        setFocusId(null);
        setIsGenerating(false);
      }
      toast(
        "error",
        t("เกิดข้อผิดพลาด", "Something went wrong"),
        sent.kind === "network" ? t("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้", "Couldn't reach the server") : localizeOrderError(sent.error, t),
      );
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
    }, t);
    setEnhancing(false);
    if (!out.ok) {
      toast("error", t("ปรับพรอมต์ไม่สำเร็จ", "Couldn't improve the prompt"), out.error);
      return;
    }
    setPromptBeforeEnhance(text);
    setPrompt(out.prompt.slice(0, 10_000));
    setEnhanceNote(
      out.source === "context-ir"
        ? { th: "เรียบเรียงด้วย H3-Context-IR ของ MiniMax", en: "Rewritten with MiniMax's H3-Context-IR" }
        : out.source === "llm"
          ? { th: `เรียบเรียงด้วย AI${out.engine ? ` · ${out.engine}` : ""}`, en: `Rewritten by AI${out.engine ? ` · ${out.engine}` : ""}` }
          : { th: "ปรับแบบพื้นฐาน (ผู้ช่วย AI ยังไม่ได้เชื่อมต่อ)", en: "Basic rewrite (the AI assistant isn't connected yet)" }
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
    // Speech is an 'audio' order like a song; its model says which.
    if (g.type === "audio" && subcategory === "speech") return "speech";
    return g.type === "video" || g.type === "edit" || g.type === "audio" ? g.type : "image";
  };

  const captureForm = (): FormSnapshot => ({
    tab, modelId: selectedModelId, prompt, negativePrompt, lyrics, aspectRatio, duration, resolution,
    qualityId, numOutputs, strength, steps, guidance, musicStyle, instrumental, videoMode, musicMode, suno, voiceId, speechStyle,
    replaceOriginal, replacePick, mashSong,
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
    setMusicMode(f.musicMode); setSuno(f.suno);
    setReplaceOriginal(f.replaceOriginal); setReplacePick(f.replacePick); setMashSong(f.mashSong);
    setVoiceId(f.voiceId); setSpeechStyle(f.speechStyle);
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
  const fillAttachments = (
    kind: TabType,
    inputs: OrderInputs,
    roles: ReferenceRole[] | null = null,
    tool: VideoTool | null = null,
  ) => {
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
    // A clip tool's order reopens in its own mode, or its model would not be listed.
    if (kind === "video") setVideoMode(tool ?? (image ? "i2v" : "t2v"));
    const audio = kind === "lipsync" || kind === "audio" ? inputs.inputAudio : null;
    trimSeqRef.current += 1;
    setTrimSrc(null); setTrimSel(null); setTrimUploaded(null); setTrimFailed(null);
    setInputAudio(audio); setInputAudioName(audio ? t("ไฟล์เสียงจากงานเดิม", "Audio from the earlier order") : null); setInputAudioFile(null);
    const video = kind === "lipsync" || tool ? inputs.inputVideo : null;
    setSourceVideo(video); setSourceVideoName(video ? t("คลิปจากงานเดิม", "Clip from the earlier order") : null);
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
    const tool = kind === "video" ? videoToolOf(g.model?.subcategory ?? model?.subcategory) : null;
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
      // A song's versions or a split's stems come back whole; a picture keeps its one.
      resultUrls: kind === "audio" && Array.isArray(g.resultUrls) && g.resultUrls.length > 1
        ? g.resultUrls.filter((u): u is string => typeof u === "string")
        : g.resultUrl ? [g.resultUrl] : undefined,
      resultLabels: kind === "audio" && Array.isArray(g.resultLabels) ? g.resultLabels : undefined,
      resultLyrics: kind === "audio" && Array.isArray(g.resultLyrics) ? g.resultLyrics : undefined,
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
      // Its own mode, or its model would not be listed.
      setMusicMode(musicModeOf({ subcategory: g.model?.subcategory ?? model?.subcategory, music: model?.music }));
      setLyrics(typeof r.lyrics === "string" ? r.lyrics.slice(0, 3000) : "");
      setMusicStyle({ complexity: MUSIC_COMPLEXITY_DEFAULT, variance: MUSIC_VARIANCE_DEFAULT, ...(r.music ?? {}) });
      setInstrumental(r.music?.instrumental === true);
    }
    if (kind === "speech") {
      setVoiceId(typeof r.voice === "string" ? r.voice : null);
      setSpeechStyle(typeof r.speechStyle === "string" ? r.speechStyle.slice(0, 300) : "");
    }

    const notes = [
      !model ? t("โมเดลเดิมไม่มีแล้ว — ใช้โมเดลที่เลือกอยู่แทน", "That model is gone — using the one selected now")
        : model.canOrder === false
          ? t(`${model.name} ปิดให้บริการชั่วคราว — เลือกโมเดลอื่นในแท็บนี้แทน`, `${model.name} is temporarily unavailable — pick another model in this tab`)
          : null,
      keepsDraft ? t("ร่างที่เขียนค้างไว้ยังเก็บอยู่ — กด ↶ ใต้ผลงานเพื่อกลับไป", "Your draft is kept — tap ↶ under the result to go back to it") : null,
    ].filter(Boolean);
    if (notes.length > 0) toast("info", t("เปิดงานเดิมแล้ว", "Earlier order opened"), notes.join(" · "));
    document.querySelector(".rp-studio-canvas")?.scrollTo({ top: 0, behavior: "smooth" });
    // Stacked, the canvas is below the composer: bring it into view.
    if (window.innerWidth < 1100) document.querySelector(".rp-stage")?.scrollIntoView({ behavior: "smooth", block: "start" });

    // The files come in their own request (a start frame can be megabytes).
    // Until they land the slots are empty and the order button waits.
    fillAttachments(kind, NO_ORDER_INPUTS, null, tool);
    setOpenedInputs(null);
    setLoadingInputs(true);
    const inputs = await fetchOrderInputs(g.id);
    if (openSeqRef.current !== seq) return;
    setLoadingInputs(false);
    if (!inputs) {
      toast(
        "error",
        t("โหลดไฟล์แนบของงานเดิมไม่สำเร็จ", "Couldn't load the earlier order's files"),
        t("prompt และการตั้งค่าโหลดแล้ว — กดที่งานอีกครั้ง หรืออัปโหลดไฟล์ใหม่", "The prompt and settings are loaded — tap the order again, or upload new files"),
      );
      return;
    }
    setOpenedInputs(inputs);
    fillAttachments(kind, inputs, split.roles, tool);
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
    toast("info", t("ไฟล์แนบเดิมหมดอายุแล้ว", "The earlier files have expired"), t("กรุณาอัปโหลดไฟล์ใหม่ก่อนสร้าง", "Please upload new files before creating."));
  };

  /** Carry a finished picture into the next step: animate it, edit it, or reference it. */
  const carryResultTo = (target: "video" | "edit" | "ref", url: string) => {
    // A model that composes several keeps the pictures already there, and this
    // one joins them; any other model takes it as its one reference.
    const joins = target === "ref" && tab === "image" && multiRef;
    if (joins && refs.length >= refCap) {
      toast(
        "error",
        t("ภาพอ้างอิงครบแล้ว", "No room for more pictures"),
        t(`โมเดลนี้รับได้ ${refCap} ภาพ — เอาภาพเดิมออกก่อน`, `This model takes ${refCap} ${refCap === 1 ? "picture" : "pictures"} — remove one first`),
      );
      return;
    }
    clearCanvas();
    if (target === "video") {
      setTab("video");
      setVideoMode("i2v");
      setInputImage(url);
      setInputImagePreview(url);
      setInputImageEnd(null);
      toast("info", t("ใส่เป็นภาพเริ่มต้นของคลิปแล้ว", "Set as the clip's start frame"), t("อธิบายว่าอยากให้ภาพเคลื่อนไหวอย่างไร แล้วกดทอ", "Describe how it should move, then tap Weave"));
    } else if (target === "edit") {
      setTab("edit");
      setInputImage(url);
      setInputImagePreview(url);
      toast("info", t("ใส่เป็นภาพต้นฉบับแล้ว", "Set as the original"), t("พิมพ์ว่าต้องการแก้อะไรในภาพ", "Type what you want to change in it"));
    } else {
      setTab("image");
      refIdRef.current += 1;
      const pic: RefPic = { id: refIdRef.current, url, role: defaultRole(joins ? refs.length : 0) };
      setRefs((rs) => (joins ? [...rs, pic] : [pic]));
      toast(
        "info",
        t("ใส่เป็นภาพอ้างอิงแล้ว", "Added as a reference picture"),
        joins
          ? t(`เป็นภาพ ${refs.length + 1} — กดป้ายใต้ภาพเพื่อบอกว่าเป็นตัวละคร ชุด หรือสถานที่`, `It's Image ${refs.length + 1} — tap the tag under it to say whether it's a character, an outfit or a place`)
          : t("ปรับความเข้มได้ที่ช่องภาพอ้างอิง", "Set how strongly it's followed in the reference slot"),
      );
    }
  };

  /**
   * A track this studio made, into the slot of the tool that works on it next
   * (stems, a cover, an extension, vocals or a band added) — no download and
   * upload in between. The file is ours on R2, which is what the server takes.
   */
  const carrySongTo = (mode: MusicMode, tool: SunoTool, url: string, label: string, words?: string) => {
    const target =
      models.find((m) => inTab(m, "audio") && m.music?.suno?.tool === tool && m.canOrder !== false) ??
      models.find((m) => inTab(m, "audio") && musicModeOf(m) === mode && m.canOrder !== false);
    if (!target) {
      toast("error", t("โหมดนี้ยังไม่เปิดให้บริการ", "This mode isn't available yet"));
      return;
    }
    clearCanvas();
    setTab("audio");
    setMusicMode(mode);
    setSelectedModelId(target.id);
    trimSeqRef.current += 1;
    setTrimSrc(null); setTrimSel(null); setTrimUploaded(null); setTrimFailed(null); setTrimDragging(false);
    setInputAudio(url); setInputAudioName(label); setInputAudioFile(null); setCarriedAudio(url);
    setSunoField("continueAt", undefined);
    // Replace Section starts from what the track sings; its part is picked anew.
    if (tool === "replace") {
      setReplaceOriginal(words?.trim() ?? "");
      setReplacePick(null);
    }
    toast("info", t(`ใส่ “${label}” แล้ว`, `Added “${label}”`), t("ปรับตั้งค่าแล้วกดทอได้เลย", "Adjust the settings, then tap Weave"));
  };
  /** Next steps a finished track may take: only tools some model here offers. */
  const songNext = SONG_NEXT.filter(([, tool]) => models.some((m) => inTab(m, "audio") && m.music?.suno?.tool === tool));

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
      if (kind === "video" && videoTool) return uploadMediaFile(file, "video", clipMaxSeconds);
      toast(
        "info",
        t("แท็บนี้ไม่ได้ใช้ไฟล์ชนิดนี้", "This tab doesn't use this kind of file"),
        kind === "audio"
          ? t("ไฟล์เสียงใช้ได้ที่แท็บลิปซิงค์ หรือโมเดลคัฟเวอร์เพลง", "Audio files work in the Lip sync tab or with a cover model")
          : t("คลิปใช้ได้ที่แท็บลิปซิงค์ และโหมดเลียนท่าทาง / ขยายวิดีโอ", "Clips work in the Lip sync tab and the Motion copy / Video upscale modes"),
      );
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast("error", t("ไฟล์ชนิดนี้ใช้ไม่ได้", "Can't use this kind of file"), t("รองรับภาพ เสียง และวิดีโอ", "Pictures, audio and video are supported"));
      return;
    }
    // Reference pictures go up to R2 as they are added (addRefFiles).
    if (tab === "image") {
      if ((await addRefFiles([file])) > 0) toast("success", t("ใส่เป็นภาพอ้างอิงแล้ว", "Added as a reference picture"));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast("error", t("ไฟล์ภาพใหญ่เกินไป", "Picture too large"), t("รองรับไม่เกิน 12 MB", "Up to 12 MB"));
      return;
    }
    const url = await fileToDataUrl(file);
    if (!url) {
      toast("error", t("อ่านไฟล์ภาพไม่ได้", "Couldn't read the picture"));
      return;
    }
    if (tab === "edit") {
      setInputImage(url); setInputImagePreview(url);
      toast("success", t("ใส่เป็นภาพต้นฉบับแล้ว", "Set as the original"));
    } else if (tab === "video" && videoTool === "upscale") {
      toast("info", t("โหมดขยายวิดีโอใช้คลิป ไม่ใช้ภาพ", "Video upscale takes a clip, not a picture"));
    } else if (tab === "video" && videoTool === "motion") {
      setInputImage(url); setInputImagePreview(url);
      toast("success", t("ใส่เป็นภาพตัวละครแล้ว", "Set as the character"));
    } else if (tab === "video") {
      setVideoMode("i2v"); setInputImage(url); setInputImagePreview(url);
      toast("success", t("ใส่เป็นภาพเริ่มต้นของคลิปแล้ว", "Set as the clip's start frame"));
    } else if (tab === "lipsync" && lipsyncNeeds === "image") {
      setInputImage(url); setInputImagePreview(url);
      toast("success", t("ใส่เป็นรูปหน้าคนที่จะให้พูดแล้ว", "Set as the face that will speak"));
    } else {
      toast("info", t("แท็บนี้ไม่ได้ใช้ภาพ", "This tab doesn't use pictures"));
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
    const timer = setTimeout(() => writeDraft({ tab, prompt, negativePrompt, lyrics, aspectRatio }), 400);
    return () => clearTimeout(timer);
  }, [tab, prompt, negativePrompt, lyrics, aspectRatio]);

  const handleDownload = async (url?: string, label?: string, quiet = false) => {
    const downloadUrl = url || result?.resultUrl;
    if (!downloadUrl || !result?.id) return false;
    const named = label ? `-${label.replace(/[\\/:*?"<>|()\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}` : "";
    const filename = `xdreamer-${result.id}${named}.${extensionOf(downloadUrl, "webp")}`;
    const ok = await downloadGeneration(result.id, downloadUrl, filename, url ? result.resultUrls?.indexOf(url) ?? -1 : -1);
    if (ok && !quiet) toast("success", t("ดาวน์โหลดสำเร็จ", "Downloaded"));
    else if (!ok) toast("error", t("ดาวน์โหลดไม่สำเร็จ", "Download failed"));
    return ok;
  };

  const handleFavorite = async () => {
    if (!result?.id) return;
    const next = !isFavorited;
    if (await saveFavorite(result.id, next)) setIsFavorited(next);
  };

  const handleShare = async () => {
    if (!result?.resultUrl) return;
    const shareTitle = t("ผลงานจาก X-DREAMER", "X-DREAMER creation");
    if (navigator.share) {
      try { await navigator.share({ title: shareTitle, url: result.resultUrl }); } catch {}
    } else {
      await navigator.clipboard.writeText(result.resultUrl);
      toast("info", t("คัดลอกลิงก์แล้ว", "Link copied"));
    }
  };

  const handleUpscale = async () => {
    if (!result?.id) return;
    setIsUpscaling(true);
    const outcome = await runUpscale(result.id, t);
    if (outcome.kind === "done") {
      const upscaledUrl = outcome.resultUrl;
      setResult(prev => prev ? { ...prev, resultUrl: upscaledUrl } : prev);
      fetchCredits();
      toast("success", t("Upscale สำเร็จ!", "Upscaled!"), t(`ใช้ ${outcome.creditsUsed} เครดิต`, `Used ${formatCredits(outcome.creditsUsed, "en")}`));
    } else if (outcome.kind === "rejected" || outcome.kind === "failed") {
      toast("error", t("Upscale ไม่สำเร็จ", "Upscale failed"), outcome.error);
    } else if (outcome.kind === "network") {
      toast("error", t("Upscale ไม่สำเร็จ", "Upscale failed"));
    }
    setIsUpscaling(false);
  };

  const totalCredits =
    // An API clip re-dub is billed by its own rule: one price, or per started block of the clip.
    videoRule?.billing && selectedModel
      ? lipsyncCredits(videoRule.billing, selectedModel.creditsPerUnit, sourceClip?.seconds ?? 0)
      : videoTool
        // Priced by the clip's whole seconds, so there is no price before a clip is in.
        ? toolSeconds !== null && clipCheck?.ok !== false ? creditsFor(toolSeconds) : 0
        : creditsFor(tab === "video" || tab === "audio" ? duration : voiceLength?.ok ? voiceLength.seconds : null) * outputs;
  /** The balance is known and this order costs more than it. The server is still the judge. */
  const shortOfCredits = creditsLoaded && totalCredits > 0 && creditBalance < totalCredits;
  /** A song or a voice has no picture shape; its in-progress frame is square. */
  const frameAspect = tab === "audio" || tab === "speech" ? "1:1" : aspectRatio;
  /** The tray order on the canvas, if the canvas is showing one. */
  const focusedJob = jobs.find((j) => j.id === focusId) ?? null;
  /** Shape and kind of what the canvas shows — the focused order's, not the form's current values. */
  const canvasAspect = focusedJob?.aspect ?? frameAspect;
  const canvasTab = focusedJob?.tab ?? tab;
  const resultUrl = result?.resultUrl ?? "";
  const resultKind = viewing?.type ?? canvasTab;
  // Songs and voices are always sound, whatever their file is called.
  const resultIsAudio = AUDIO_EXT.test(resultUrl) || resultKind === "audio" || resultKind === "speech";
  /** A song's versions or a split's stems, each with its name — null for a single file. */
  const resultTracks: AudioTrack[] | null =
    resultIsAudio && result?.resultUrls && result.resultUrls.length > 1
      ? result.resultUrls.map((url, i, all) => ({
          url,
          label: result.resultLabels?.length === all.length ? stemLabelText(result.resultLabels[i], locale) : t(`เวอร์ชัน ${i + 1}`, `Version ${i + 1}`),
        }))
      : null;
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
  // Not on a split, a sound, or a voice that already sings.
  const showLyrics = tab === "audio" && musicOpts?.lyrics !== false;
  // Speech takes no file; a song only when it is a cover.
  const showInputs = (tab !== "audio" && tab !== "speech") || musicOpts?.sourceSong === true;
  // An upscale has no prompt, so its clip is section 02.
  const inputsAt = showLyrics ? 4 : videoTool === "upscale" || promptHidden ? 2 : 3;
  /** The text is read out (speech) or optional (clip tools): no prompt assistant, builder or templates. */
  const plainPrompt = tab === "speech" || videoTool !== null;
  const settingsAt = inputsAt + (showInputs ? 1 : 0);
  const promptWords = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;
  const inputsLabel =
    tab === "image" ? t("ภาพอ้างอิง", "Reference pictures")
      : tab === "video"
        ? (videoTool === "motion"
          ? t("ตัวละครและท่าทาง", "Character and moves")
          : videoTool === "upscale" ? t("คลิปที่จะขยาย", "Clip to upscale") : t("เริ่มจาก", "Start from"))
        : tab === "edit" ? t("ภาพต้นฉบับ", "Original picture")
          : tab === "lipsync" ? t("ไฟล์ที่ใช้", "Your files")
            : sunoTool === "extend" ? t("เพลงที่จะต่อ", "Song to extend")
              : sunoTool === "replace" ? t("เพลงที่จะแก้ท่อน", "Song to change a part of")
                : sunoTool === "mashup" ? t("สองเพลงที่จะมิกซ์", "The two songs to mash up")
              : sunoTool === "add-vocals" ? t("ดนตรีบรรเลงที่จะใส่เสียงร้อง", "Instrumental to add vocals to")
                : sunoTool === "add-instrumental" ? t("เสียงร้องที่จะใส่ดนตรี", "Vocal to add music to")
                  : sunoTool === "stems" ? t("เพลงที่จะแยกสเต็ม", "Song to split")
                    : t("เพลงต้นฉบับที่จะคัฟเวอร์", "Original song to cover");
  /** The first order still rendering, for the phone's bar above the composer. */
  const runningJob = jobs.find((j) => j.status === "running") ?? null;
  const runningFraction =
    runningJob?.progress?.stage === "rendering" ? shownFraction(runningJob.progress, runningJob.progress.at) : null;
  const canvasState = isGenerating ? t("กำลังสร้าง", "Creating")
    : result?.status === "completed" ? (viewing ? t("งานเดิม", "Earlier order") : t("เสร็จแล้ว", "Done"))
      : result?.status === "failed" ? t("ไม่สำเร็จ", "Failed") : t("พร้อมสร้าง", "Ready");
  /**
   * The model card's reference line, in reference-caps.ts referenceLabel's
   * words — that module reads the server catalogue, so it is not imported
   * here. On the video tab only a model wired for a first frame says so: an
   * API clip model takes its start frame another way and reports none.
   */
  const caps = selectedModel?.references ?? null;
  const refText = !caps ? null
    : tab === "image"
      ? (caps.images > 0
        ? t(`รับภาพอ้างอิงได้ ${caps.images} ภาพ`, `Takes up to ${caps.images} reference ${caps.images === 1 ? "picture" : "pictures"}`)
        : t("ไม่รับภาพอ้างอิง", "Takes no reference pictures"))
      : tab === "video" && caps.firstFrame
        ? (caps.lastFrame ? t("รับภาพเฟรมแรกและเฟรมสุดท้าย", "Takes first and last frames") : t("รับภาพเฟรมแรก 1 ภาพ", "Takes a first frame"))
        : null;
  const trimTooLongNote = trimTooLong && trimSel ? (
    <span style={{ color: "#fbbf24" }}>
      {t(
        `ช่วงที่เลือกยาว ${(trimSel.end - trimSel.start).toFixed(1)} วินาที — โมเดลนี้รับไม่เกิน ${Math.floor(trimMax)} วินาที ลากขอบให้สั้นลง`,
        `The selection is ${(trimSel.end - trimSel.start).toFixed(1)} seconds — this model takes up to ${Math.floor(trimMax)}. Drag the edges in.`,
      )}
    </span>
  ) : null;
  /** Under the voice: the clip is as long as the voice, and so is the price. */
  const voiceNote = trimTooLongNote ?? (voiceRule ? (
    voiceLength?.ok === false ? (
      <span style={{ color: "#fbbf24" }}>{t(voiceLength.msg)}</span>
    ) : hasAudio
      ? t(
          `ความยาวคลิป = ความยาวเสียง${voiceLength ? ` ${voiceLength.seconds.toFixed(1)} วินาที` : ""} · ✦ ${totalCredits} เครดิต`,
          `Clip length = audio length${voiceLength ? ` (${voiceLength.seconds.toFixed(1)} s)` : ""} · ✦ ${formatCredits(totalCredits, "en")}`,
        )
      : priceTable?.perSecond
        ? t(
            `คิดเครดิตตามความยาวเสียง: ✦ ${creditsFor(1)} ต่อวินาที (สูงสุด ${lipsyncAudioMax} วิ = ✦ ${creditsFor(lipsyncAudioMax)})`,
            `Billed by audio length: ✦ ${creditsFor(1)} per second (up to ${lipsyncAudioMax} s = ✦ ${creditsFor(lipsyncAudioMax)})`,
          )
        : t(
            `คิดเครดิตตามความยาวเสียง: ✦ ${creditsFor(null)} (ไม่เกิน 5 วิ) ถึง ✦ ${creditsFor(lipsyncAudioMax)} (${lipsyncAudioMax} วิ)`,
            `Billed by audio length: ✦ ${creditsFor(null)} (up to 5 s) to ✦ ${creditsFor(lipsyncAudioMax)} (${lipsyncAudioMax} s)`,
          )
  ) : null);
  const orbModes: OrbItem[] = TAB_ORDER.map((key) => {
    const blocked = tabBlockedReason(key);
    return {
      key,
      label: t(TAB_LABEL[key]),
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
    { key: "model3d", label: t("สร้างโมเดล 3D", "Create 3D model"), icon: MODEL3D_ICON, href: "/generate/3d", blocked: model3dBlocked },
    { key: "gallery", label: t("แกลเลอรี", "Gallery"), icon: GALLERY_ICON, href: "/gallery" },
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
            {tab === "image"
              ? (refCap === 0 ? t("โมเดลนี้ไม่รับภาพอ้างอิง", "This model doesn’t take reference pictures") : t("วางภาพเพื่อใช้เป็นภาพอ้างอิง", "Drop a picture to use as a reference"))
              : tab === "edit" ? t("วางภาพที่ต้องการแก้ไข", "Drop the picture to edit")
                : tab === "video" ? t("วางภาพเพื่อเริ่มคลิปจากภาพนี้", "Drop a picture to start the clip from")
                  : tab === "lipsync" ? t("วางไฟล์เสียง คลิป หรือรูปหน้าคน", "Drop audio, a clip or a face photo")
                    : t("วางเพลงต้นฉบับ (โหมดคัฟเวอร์)", "Drop the original song (cover mode)")}
          </div>
        </div>
      )}

      {/* Phone: the composer fills the screen, so what is rendering is said
          above it, one tap from the canvas further down. */}
      {runningJobs > 0 && (
        <button type="button" className="rp-jobbar"
          onClick={() => document.querySelector(".rp-stage")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          <span className="rp-spin" aria-hidden="true" />
          <span>{t(`กำลังสร้าง ${runningJobs} งาน`, `Creating ${runningJobs}`)}{runningFraction != null ? ` · ${Math.floor(runningFraction * 100)}%` : ""}</span>
          <b>{t("ดูผลงาน ↓", "View ↓")}</b>
        </button>
      )}

      {/* ═══ COMPOSER — everything handed to the model, and the order ═══
          The glass is a layer of its own beside the content, not around it:
          backdrop-filter makes an element the containing block of whatever is
          fixed inside it, and on a phone the order bar is fixed to the screen. */}
      <section ref={composerRef} className="rp-composer" aria-label={t("ตั้งค่างาน", "Order settings")}>
        <div className="rp-hud rp-composer-glass" aria-hidden="true"><span className="rp-led"><i /></span></div>
        <div className="rp-cscroll rp-scroll">
          <div className="rp-chead">
            <div style={{ minWidth: 0 }}>
              <div className="rp-crumb">
                <span className="rp-dot" data-run={runningJobs > 0 ? "true" : "false"} aria-hidden="true" />
                <span className="rp-mono">{sectionNo(tabNo)} / {sectionNo(TAB_ORDER.length)}</span> {t("สตูดิโอ", "Studio")}
              </div>
              <h1 className="rp-title">{t(TAB_LABEL[tab])}</h1>
            </div>
            {/* Reference material, not controls. */}
            <Popover id="tips" open={openPanel} onToggle={setOpenPanel} label={t("? คำแนะนำ", "? Tips")} width={320} align="right" variant="tool">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(tab === "audio" ? [
                  t("บอกแนวเพลง อารมณ์ และเครื่องดนตรี เช่น 'ลูกทุ่งอีสานสนุกๆ แคน พิณ เสียงร้องชาย'", "Name a genre, a mood and instruments, e.g. 'fun Isan luk thung, khaen, phin, male vocal'"),
                  t("ใส่จังหวะช่วยได้มาก เช่น 90 BPM (ช้าๆ) หรือ 128 BPM (เต้นได้)", "A tempo helps a lot, e.g. 90 BPM (slow) or 128 BPM (danceable)"),
                  t("เนื้อเพลงแบ่งท่อนด้วย [verse] [chorus] [bridge] — ประโยคสั้นร้องชัดกว่า", "Split lyrics into sections with [verse] [chorus] [bridge] — short lines are sung more clearly"),
                  t("เว้นเนื้อเพลงว่างไว้ = เพลงบรรเลง เหมาะกับดนตรีประกอบคลิป", "Leave the lyrics empty for an instrumental — good as music for a clip"),
                ] : [
                  t(
                    "พิมพ์ไอเดียสั้น ๆ แล้วกด ✨ ปรับพรอมต์ด้วย AI — ระบบเรียบเรียงให้ตรงรูปแบบที่โมเดลนั้นเข้าใจดีที่สุด แก้ต่อได้ก่อนสั่ง",
                    "Type a short idea and tap ✨ Improve with AI — it's rewritten in the form that model understands best, and you can edit it before ordering",
                  ),
                  tab === "video"
                    ? t("ปุ่ม 🎥 กล้องและฉาก เติมการเคลื่อนกล้อง ขนาดภาพ และแสงเป็นประโยคที่โมเดลวิดีโออ่านเข้าใจ", "🎥 Camera & scene adds camera moves, shot sizes and light as sentences video models understand")
                    : t("ปุ่ม ✦ ตัวช่วยพรอมต์ เติมคำศัพท์ช่างภาพ: สไตล์ แสง เลนส์ สี", "✦ Prompt helper adds photographers' words: style, light, lens, color"),
                  t(
                    "โมเดลที่รับภาพอ้างอิงหลายภาพ: ใส่ภาพตัวละคร ชุด สิ่งของ สถานที่ แล้วพิมพ์ ภาพ 1, ภาพ 2 ในพรอมต์",
                    "Models that take several reference pictures: add a character, an outfit, objects or a place, then type Image 1, Image 2 in your prompt",
                  ),
                  t("วางภาพ (Ctrl+V) หรือลากไฟล์มาวางตรงไหนก็ได้ ระบบใส่ให้ในช่องที่แท็บนี้ใช้", "Paste a picture (Ctrl+V) or drop a file anywhere — it goes into the slot this tab uses"),
                  t("สั่งต่อกันได้ถึง 3 งานพร้อมกัน ดูทุกงานที่แถบเหนือแคนวาส · Ctrl/⌘+Enter = ทอ", "Run up to 3 orders at once and see them all in the tray above the canvas · Ctrl/⌘+Enter = Weave"),
                  t("ได้ภาพที่ชอบแล้ว กด ▶ ทำเป็นวิดีโอ เพื่อใช้เป็นเฟรมแรกของคลิปได้ทันที", "Like a picture? Tap ▶ Make a video to use it as a clip's first frame right away"),
                  t("img2img: ความเข้ม 0.5–0.7 = balance, > 0.8 = ตามภาพอ้างอิงมาก", "img2img: strength 0.5–0.7 = balanced, > 0.8 = follows the reference closely"),
                ]).concat(t("ลูกแก้วมุมจอ: ชี้หรือแตะเพื่อเปลี่ยนโหมด ลากไปวางตรงไหนก็ได้", "The corner orb: point at it or tap it to switch modes, drag it anywhere")).map((tip, i) => (
                  <div key={i} style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: `hsl(${(160 + i * 30 + HUE) % 360},70%,70%)`, flexShrink: 0 }}>✦</span>
                    <span style={{ fontSize: 12, color: "rgba(203,213,225,0.78)", lineHeight: 1.5 }}>{tip}</span>
                  </div>
                ))}
              </div>
            </Popover>
          </div>

          {/* ── 01 Model ── */}
          <Field no="01" label={t("โมเดล", "Model")}>
            {/* The music tab's modes: a song from scratch, or a tool that works on a track. */}
            {tab === "audio" && musicModes.length > 1 && (
              <div className="rp-seg rp-well rp-mseg" style={{ marginBottom: 10 }} role="tablist" aria-label={t("โหมดเพลง", "Music mode")}>
                {musicModes.map((m) => (
                  <button key={m.key} type="button" role="tab" aria-selected={musicMode === m.key}
                    data-on={musicMode === m.key ? "true" : "false"} onClick={() => setMusicMode(m.key)}>
                    <b>{t(m.label)}</b>
                    <span>{t(m.hint)}</span>
                  </button>
                ))}
              </div>
            )}
            <div>
              <button type="button" className="rp-model rp-raised" aria-expanded={showModelDropdown} aria-haspopup="dialog"
                onClick={() => setShowModelDropdown(!showModelDropdown)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small fixed art or the model's sample */}
                <img key={selectedModel?.id ?? "none"} className="rp-mlogo" data-photo={selectedModel?.preview ? "true" : undefined}
                  src={selectedModel?.preview?.src || TAB_ICON[tab]} alt="" width={44} height={44} onError={previewFallback(TAB_ICON[tab])} />
                <span className="rp-mbody">
                  <span className="rp-mname">{selectedModel ? selectedModel.name : modelsLoaded ? t("เลือกโมเดล...", "Choose a model...") : t("กำลังโหลดโมเดล…", "Loading models…")}</span>
                  {selectedModel && (
                    <span className="rp-mmeta">
                      <span className="rp-tag" data-tone={selectedModel.canOrder === false ? "warn" : "ok"}>
                        {selectedModel.canOrder === false
                          ? (selectedModel.status === "tuning" ? t("กำลังปรับแต่ง", "Being tuned") : t("ยังใช้ไม่ได้", "Unavailable"))
                          : t("พร้อมใช้", "Ready")}
                      </span>
                      {refText && <span className="rp-tag" data-tone="ref">{refText}</span>}
                    </span>
                  )}
                </span>
                <span className="rp-mprice">
                  {selectedModel && <b>✦ {selectedModel.creditsPerUnit}</b>}
                  <span>{t("เปลี่ยนโมเดล", "Change model")} {showModelDropdown ? "▴" : "▾"}</span>
                </span>
              </button>
              {/* Every model floats up over the stage as a balloon playing its showcase. */}
              {showModelDropdown && (
                <ModelBalloons models={pickerOrder(filteredModels)} selectedId={selectedModelId} art={TAB_ICON[tab]}
                  title={t(PICKER_TITLE[tab])} keepClear={composerRef} onPick={pickModel} onClose={closeModelPicker} />
              )}
            </div>
          </Field>

          {/* ── 02 Prompt (the text to read, on speech; none on an upscale) ── */}
          <Field no="02" hidden={videoTool === "upscale" || promptHidden}
            label={tab === "lipsync" || videoTool === "motion" ? t("Prompt (ไม่บังคับ)", "Prompt (optional)")
              : tab === "audio"
                ? (sunoTool === "sounds"
                  ? t("เสียงที่ต้องการ", "The sound you want")
                  : promptOptional ? t("สไตล์เพลง (ไม่บังคับ)", "Song style (optional)") : t("สไตล์เพลง", "Song style"))
                : tab === "speech" ? t("ข้อความที่จะให้อ่าน", "Text to read") : "Prompt"}
            aside={speechRule
              ? `${formatNumber(speechLength, locale)} / ${formatNumber(speechRule.maxChars, locale)} ${t("ตัวอักษร", "characters")}`
              : `${promptWords > 0 ? t(`${promptWords} คำ · `, `${promptWords} ${promptWords === 1 ? "word" : "words"} · `) : ""}${formatNumber(prompt.length, locale)} / ${formatNumber(10_000, locale)}`}>
            <div className="rp-prompt rp-well">
              {/* Read-only while ✨ works: its answer replaces the box, and would
                  silently drop anything typed in the meantime (Context-IR can
                  take a minute). */}
              <textarea ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onSubmitKey}
                readOnly={enhancing} aria-busy={enhancing} aria-label={tab === "speech" ? t("ข้อความที่จะให้อ่าน", "Text to read") : "Prompt"}
                placeholder={
                  tab === "lipsync"
                    ? lipsyncNeeds === "image"
                      ? t("อธิบายท่าทาง/บรรยากาศเพิ่มได้ เช่น พิธีกรยิ้มแย้ม พูดกับกล้อง...", "Optionally describe gestures or mood, e.g. a smiling host talking to the camera...")
                      : t("ไม่ต้องใส่ก็ได้ — เสียงที่อัปโหลดเป็นตัวกำหนดผลลัพธ์", "Optional — the uploaded audio drives the result")
                    : tab === "video"
                      ? videoTool === "motion"
                        ? t("ไม่ใส่ก็ได้ — ท่าทางมาจากคลิป · อธิบายฉากหลัง แสง หรือรายละเอียดเพิ่มได้", "Optional — the moves come from the clip · you can describe the background, light or details")
                        : t("อธิบายวิดีโอที่ต้องการ...", "Describe the video you want...")
                      : tab === "speech"
                        ? t(
                            "พิมพ์ข้อความที่ต้องการให้อ่านออกเสียง เช่น สวัสดีค่ะ ยินดีต้อนรับสู่ร้านของเรา วันนี้มีโปรโมชันพิเศษสำหรับลูกค้าทุกท่าน",
                            "Type the text to read aloud, e.g. Hello and welcome to our shop! Today we have a special offer for every customer.",
                          )
                      : tab === "audio" && sunoTool === "sounds"
                        ? t("อธิบายเสียง เช่น ฝนตกบนหลังคาสังกะสี ฟ้าร้องไกล ๆ หรือ บีตฮิปฮอปช้า ๆ กลองหนัก", "Describe the sound, e.g. rain on a tin roof with distant thunder, or a slow hip-hop beat with heavy drums")
                      : tab === "audio" && promptOptional
                        ? sunoTool === "add-instrumental"
                          ? t("แนวดนตรีที่อยากได้ เช่น วงอะคูสติก กีตาร์โปร่ง เปียโน อบอุ่น", "The music you want, e.g. an acoustic band, acoustic guitar, piano, warm")
                          : t("แนวใหม่ที่อยากได้ (เว้นว่างได้) เช่น ร็อกหนัก ๆ กลองแน่น เสียงร้องหญิง", "A new style (optional), e.g. heavy rock, tight drums, female vocal")
                      : tab === "audio"
                        ? t("แนวเพลง อารมณ์ เครื่องดนตรี เสียงร้อง เช่น ป๊อปไทยสดใส เสียงร้องหญิง กีตาร์โปร่ง จังหวะเร็ว", "Genre, mood, instruments, vocals, e.g. bright Thai pop, female vocal, acoustic guitar, fast tempo")
                        : multiRef && refs.length > 1
                          ? t("เช่น ผู้หญิงจาก ภาพ 1 สวมชุดจาก ภาพ 2 ยืนหน้าร้านใน ภาพ 3 แสงเย็นอ่อน ๆ", "e.g. the woman from Image 1 wearing the outfit from Image 2, standing outside the shop in Image 3, soft evening light")
                          : t("อธิบายภาพที่ต้องการ...", "Describe the picture you want...")
                }
                style={{ minHeight: tab === "audio" ? 72 : tab === "speech" ? 150 : 104, opacity: enhancing ? 0.6 : 1 }} />
              {/* How much of what one order may read is used. */}
              {speechRule && (
                <div className="rp-cmeter" data-over={speechTooLong ? "true" : undefined} aria-hidden="true">
                  <i style={{ width: `${Math.min(100, (speechLength / speechRule.maxChars) * 100)}%` }} />
                </div>
              )}
              {/* The prompt assistant: short idea in, the model's own format
                  out. The result replaces the box's text where the customer
                  can read and edit it — and ↶ puts back what they wrote. */}
              <div className="rp-ptools">
                {/* Emotion tags, put in the text where they should be performed. */}
                {speechRule?.tags && (
                  <Popover id="speechtags" open={openPanel} onToggle={setOpenPanel} variant="tool" width={320} label={t("🎭 แท็กอารมณ์", "🎭 Emotion tags")}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {SPEECH_TAGS.map((st) => (
                        <button key={st.tag} type="button" title={t(`แทรก ${st.tag} ตรงตำแหน่งเคอร์เซอร์`, `Insert ${st.tag} at the cursor`)}
                          onClick={() => { insertAtCaret(st.tag); setOpenPanel(null); }}
                          style={{
                            padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                            background: "rgba(255,255,255,0.05)", color: "#cbd5e1", border: "1px solid rgba(255,255,255,0.1)",
                          }}>
                          {t(st.label)} <span style={{ color: "#a5f3fc", fontFamily: "ui-monospace,monospace", fontSize: 10.5 }}>{st.tag}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: "#64748b", lineHeight: 1.5, marginTop: 10 }}>
                      {t(
                        "วางแท็กไว้หน้าคำหรือประโยคที่ต้องการ — โมเดลจะพูดด้วยอารมณ์นั้น ไม่ได้อ่านแท็กออกเสียง",
                        "Put a tag before the word or sentence — the model speaks it with that emotion and doesn't read the tag aloud",
                      )}
                    </div>
                  </Popover>
                )}
                {!plainPrompt && (<>
                <button type="button" className="rp-tool rp-tool-ai" onClick={handleEnhance} disabled={enhancing || !prompt.trim()}
                  title={tab === "video" && selectedModel?.modelId === "minimax-h3"
                    ? t("เรียบเรียงเป็นโครงช็อต กล้อง และเสียง ตามรูปแบบที่ MiniMax H3 ถูกฝึกมา", "Lays it out as shots, camera and sound, in the form MiniMax H3 was trained on")
                    : t("ให้ AI ขยายไอเดียสั้น ๆ เป็นพรอมต์ที่โมเดลเข้าใจดีที่สุด", "Let AI grow a short idea into the prompt the model understands best")}>
                  <span className={enhancing ? "xdr-motion" : undefined} style={enhancing ? { display: "inline-block", animation: "spin 1.2s linear infinite" } : undefined}>✨</span>
                  {enhancing
                    ? (tab === "video" && selectedModel?.modelId === "minimax-h3"
                      ? t("กำลังเรียบเรียงฉาก… (อาจถึง 1 นาที)", "Writing the scene… (up to a minute)")
                      : t("กำลังเรียบเรียง…", "Rewriting…"))
                    : tab === "audio" ? t("ช่วยเขียนสไตล์เพลง", "Help write the style") : t("ปรับพรอมต์ด้วย AI", "Improve with AI")}
                </button>
                {promptBeforeEnhance !== null && !enhancing && (
                  <button type="button" className="rp-tool rp-raised" onClick={undoEnhance}>{t("↶ ใช้ข้อความเดิม", "↶ Use my text")}</button>
                )}
                {/* Prompt builder. Pictures get their vocabulary as comma-joined
                    phrases; clips get camera and shot direction as sentences
                    (the form video models read it in); songs keep their tag chips. */}
                <Popover id="tags" open={openPanel} onToggle={setOpenPanel} variant="tool"
                  width={tab === "audio" ? 320 : 480} maxHeight={tab === "audio" ? 360 : 560}
                  label={tab === "audio" ? t("+ แท็ก", "+ Tags") : tab === "video" || tab === "lipsync" ? t("🎥 กล้องและฉาก", "🎥 Camera & scene") : t("✦ ตัวช่วยพรอมต์", "✦ Prompt helper")}>
                  {tab === "audio" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {MUSIC_TAG_CHIPS.map((chip) => {
                        const already = prompt.toLowerCase().includes(chip.toLowerCase());
                        return (
                          <button key={chip} type="button" onClick={() => addPromptTag(chip)}
                            style={{
                              padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                              background: already ? `hsla(${220 + HUE},60%,50%,0.18)` : "rgba(255,255,255,0.05)",
                              color: already ? "#a5f3fc" : "#94a3b8",
                              border: already ? `1px solid hsla(${220 + HUE},70%,60%,0.4)` : "1px solid rgba(255,255,255,0.1)",
                            }}>+ {chip}</button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {(tab === "video" || tab === "lipsync" ? VIDEO_BUILDER : IMAGE_BUILDER).map((group) => (
                        <div key={group.label.en}>
                          <div style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "#a5f3fc", marginBottom: 6 }}>{t(group.label)}</div>
                          {group.items.some((item) => item.shot) ? (
                            // Camera options: each plays what that camera does, on the same little scene.
                            <div className="rp-camgrid">
                              {group.items.map((item) => {
                                const already = prompt.toLowerCase().includes(item.prompt.toLowerCase());
                                const sentence = tab === "video" || tab === "lipsync";
                                return (
                                  <button key={item.prompt} type="button" className="rp-camtile" data-on={already ? "true" : "false"}
                                    title={item.prompt} aria-pressed={already}
                                    onClick={() => (sentence ? addPromptSentence(item.prompt) : addPromptTag(item.prompt))}>
                                    <span className="rp-camview">
                                      {item.shot && <CameraPreview shot={item.shot} />}
                                      {already && <span className="rp-camcheck" aria-hidden="true">✓</span>}
                                    </span>
                                    <span className="rp-camcap">
                                      <b>{t(item.label)}</b>
                                      {item.shot && <small>{shotHint(item.shot, locale)}</small>}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {group.items.map((item) => {
                              const already = prompt.toLowerCase().includes(item.prompt.toLowerCase());
                              const sentence = tab === "video" || tab === "lipsync";
                              return (
                                <button key={item.prompt} type="button" title={item.prompt}
                                  onClick={() => (sentence ? addPromptSentence(item.prompt) : addPromptTag(item.prompt))}
                                  style={{
                                    padding: "5px 9px", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                                    background: already ? `hsla(${220 + HUE},60%,50%,0.18)` : "rgba(255,255,255,0.05)",
                                    color: already ? "#a5f3fc" : "#cbd5e1",
                                    border: already ? `1px solid hsla(${220 + HUE},70%,60%,0.4)` : "1px solid rgba(255,255,255,0.1)",
                                  }}>{already ? "✓ " : "+ "}{t(item.label)}</button>
                              );
                            })}
                          </div>
                          )}
                        </div>
                      ))}
                      <div style={{ fontSize: 10.5, color: "#64748b", lineHeight: 1.5 }}>
                        {t(
                          "ชี้ที่ปุ่มเพื่อดูข้อความภาษาอังกฤษที่จะเติมลงพรอมต์ · โมเดลส่วนใหญ่อ่านคำศัพท์ภาพยนตร์/ถ่ายภาพภาษาอังกฤษได้แม่นที่สุด",
                          "Hover a chip to see the exact English it adds · most models read film and photo terms best in English",
                        )}
                      </div>
                    </div>
                  )}
                </Popover>
                </>)}
                {/* Templates are about pictures — none of them reaches a music model. */}
                {templates.length > 0 && !plainPrompt && tab !== "edit" && tab !== "audio" && (
                  <Popover id="templates" open={openPanel} onToggle={setOpenPanel} label={t("เทมเพลต", "Templates")} variant="tool" width={300}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {templates.slice(0, 10).map(tpl => (
                        <button key={tpl.id} type="button" title={tpl.description || tpl.prompt}
                          onClick={() => { setPrompt(tpl.prompt); setNegativePrompt(tpl.negativePrompt || ""); setOpenPanel(null); }}
                          style={{
                            padding: "6px 11px", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                            background: "rgba(255,255,255,0.05)", color: "#cbd5e1",
                            border: "1px solid rgba(255,255,255,0.1)",
                          }}>
                          {tpl.isFeatured ? "★ " : ""}{tpl.name}
                        </button>
                      ))}
                    </div>
                  </Popover>
                )}
                <span className="rp-kbd rp-mono" title={t("สั่งสร้างจากช่องพิมพ์ได้เลย", "Order straight from the text box")}>{t("Ctrl/⌘ + Enter = ทอ", "Ctrl/⌘ + Enter = Weave")}</span>
              </div>
            </div>
            {/* The free model does not understand Thai — it renders an unrelated
                image instead of failing, so warn before credits are spent. */}
            {selectedModel?.latinPromptOnly && THAI_CHARS.test(prompt) && (
              <div className="rp-warn" style={{ marginTop: 8 }}>
                {t(
                  "โมเดลฟรีอ่านภาษาไทยไม่ออก — จะได้ภาพที่ไม่ตรงกับที่พิมพ์ กรุณาพิมพ์ prompt เป็นภาษาอังกฤษ หรือเลือกโมเดลแบบเสียเครดิต",
                  "The free model can't read Thai — you'd get a picture that doesn't match. Write the prompt in English, or pick a paid model.",
                )}
              </div>
            )}
            {enhanceNote && (
              <div style={{ fontSize: 10.5, color: "#a78bfa", marginTop: 6 }}>✦ {t(enhanceNote)} — {t("แก้ต่อได้ตามใจ", "edit it as you like")}</div>
            )}
            {speechRule && (
              <div className="rp-note">
                {THAI_CHARS.test(prompt) ? t("อ่านภาษาไทยได้ · ", "Reads Thai · ") : ""}
                {t(
                  "ใส่ตัวเลข วันที่ และชื่อเฉพาะเป็นคำอ่านจะออกเสียงได้แม่นกว่า เช่น “สองร้อยบาท”",
                  "Numbers, dates and names come out more accurately when written as words, e.g. “two hundred baht”",
                )}
              </div>
            )}
          </Field>

          {/* ── Lyrics (music) ── */}
          {showLyrics && (
            <Field no={sectionNo(3)} label={sunoTool === "replace" ? t("เนื้อท่อนใหม่", "New words for the part") : t("เนื้อเพลง", "Lyrics")} aside={`${formatNumber(lyrics.length, locale)} / ${formatNumber(3000, locale)}`}>
              <div className="rp-lyrics-tools">
                {SECTION_TAGS.map((tag) => (
                  <button key={tag} type="button" className="rp-sectag rp-mono" disabled={instrumentalOn}
                    onClick={() => setLyrics((l) => `${l.replace(/\s*$/, "")}${l.trim() ? "\n\n" : ""}${tag}\n`.slice(0, 3000))}>
                    {tag}
                  </button>
                ))}
                {sunoOpts?.instrumental !== false && (
                  <label className="rp-check">
                    <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />
                    {t("เพลงบรรเลง (ไม่มีเสียงร้อง)", "Instrumental (no vocals)")}
                  </label>
                )}
              </div>
              <div className="rp-prompt rp-well" style={{ marginTop: 8 }}>
                <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value.slice(0, 3000))} onKeyDown={onSubmitKey}
                  disabled={instrumentalOn} aria-label={t("เนื้อเพลง", "Lyrics")}
                  placeholder={t("[Verse]\nเขียนเนื้อร้องที่นี่\n\n[Chorus]\nท่อนฮุกที่อยากให้ติดหู", "[Verse]\nWrite your lyrics here\n\n[Chorus]\nThe hook you want stuck in people's heads")}
                  style={{ minHeight: 220, opacity: instrumentalOn ? 0.45 : 1 }} />
              </div>
              <div className="rp-note">
                {instrumentalOn ? t("โหมดบรรเลง — เนื้อร้องที่พิมพ์ไว้จะถูกเก็บไว้เฉย ๆ", "Instrumental — the lyrics you typed are kept, but not sung")
                  : sunoTool === "replace"
                    ? t(
                        "เริ่มจากบรรทัดที่เลือกในส่วนเพลงด้านล่าง — แก้เป็นเนื้อใหม่ที่จะร้อง จำนวนบรรทัดใกล้เคียงของเดิมจะลงจังหวะดีที่สุด",
                        "Starts as the lines picked under the song below — change them to the new words; about as many lines as before fits the beat best",
                      )
                  : sunoTool === "mashup"
                    ? t("เว้นว่างได้ · ใส่เนื้อเพลงใหม่ได้ ถ้าใส่ ระบบใช้เนื้อแทนคำอธิบายสไตล์", "Optional · you can add new lyrics; when you do, they are used instead of the style description")
                  : sunoTool === "add-vocals"
                    ? t("เว้นว่างได้ — AI แต่งเนื้อให้เข้ากับดนตรี · วงเล็บเหลี่ยมบอกว่าเป็นท่อนอะไร", "Optional — the AI writes lyrics to fit the music · square brackets mark each section")
                    : sunoTool === "cover" || sunoTool === "extend"
                      ? t("เว้นว่างได้ · ใส่เนื้อใหม่เพื่อให้ร้องตามนี้ · วงเล็บเหลี่ยมบอกว่าเป็นท่อนอะไร", "Optional · add new lyrics to have them sung · square brackets mark each section")
                      : t("วงเล็บเหลี่ยมบอกโมเดลว่าเป็นท่อนอะไร", "Square brackets tell the model which section is which")}
              </div>
              {/* Exactly what the model will be told, composed by the same
                  function the server uses. Shown because chips whose effect
                  you cannot see are chips you cannot learn to use. */}
              {styleSummary && (
                <div className="rp-well" style={{ marginTop: 10, padding: "9px 11px", borderRadius: 10 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#a5f3fc", marginBottom: 5, textTransform: "uppercase" }}>
                    {t("สไตล์ที่ส่งให้ AI", "Style sent to the AI")}
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
              aside={tab === "image" && multiRef ? `${refs.length} / ${refCap} ${t("ภาพ", refCap === 1 ? "picture" : "pictures")}` : undefined}>

              {/* Reference pictures. Several, each with what it is, for a model
                  that composes from several; one with its strength for img2img;
                  none — said rather than offered — for a model that takes none. */}
              {tab === "image" && (refCap === 0 ? (
                <div className="rp-note" style={{ marginTop: 0 }}>
                  {t(
                    "โมเดลนี้ไม่รับภาพอ้างอิง — ถ้าอยากให้ภาพออกมาตามรูปของคุณ เลือกโมเดลที่มีป้าย “รับภาพอ้างอิงได้”",
                    "This model doesn’t take reference pictures — to work from your own pictures, pick a model tagged “Takes reference pictures”",
                  )}
                  {refs.length > 0 ? t(" · ภาพที่ใส่ไว้จะไม่ถูกส่งไปกับงานนี้", " · the pictures added won't be sent with this order") : ""}
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
                          <img src={r.url} alt={t(`ภาพอ้างอิง ${i + 1}`, `Reference picture ${i + 1}`)} loading="lazy"
                            onError={() => dropExpiredInput(r.url, () => removeRef(r.id))} />
                        ) : (
                          <span className="rp-spin" role="status" aria-label={t("กำลังอัปโหลด", "Uploading")} />
                        )}
                        {multiRef && <span className="rp-rno rp-mono">{i + 1}</span>}
                        <button type="button" className="rp-rx" onClick={() => removeRef(r.id)} aria-label={t(`เอาภาพ ${i + 1} ออก`, `Remove image ${i + 1}`)}>×</button>
                        {multiRef && refs.length > 1 && (
                          <span className="rp-rmove">
                            <button type="button" disabled={i === 0} onClick={() => moveRef(r.id, -1)}
                              aria-label={t(`เลื่อนภาพ ${i + 1} ไปก่อนหน้า`, `Move image ${i + 1} earlier`)} title={t("เลื่อนไปก่อนหน้า", "Move earlier")}>‹</button>
                            <button type="button" disabled={i === refs.length - 1} onClick={() => moveRef(r.id, 1)}
                              aria-label={t(`เลื่อนภาพ ${i + 1} ไปถัดไป`, `Move image ${i + 1} later`)} title={t("เลื่อนไปถัดไป", "Move later")}>›</button>
                          </span>
                        )}
                        {multiRef && (
                          <button type="button" className="rp-rrole" onClick={() => cycleRole(r.id)} title={t("กดเพื่อเปลี่ยนว่าภาพนี้คืออะไร", "Tap to change what this picture is")}>
                            {t(roleLabel(r.role))} ▾
                          </button>
                        )}
                      </div>
                    ))}
                    {refs.length < refCap && (
                      <label className="rp-radd">
                        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
                        {multiRef ? t("เพิ่มภาพ", "Add pictures") : t("อัปโหลดภาพอ้างอิง", "Upload a reference")}
                        <small>
                          {multiRef
                            ? t(`อีก ${refCap - refs.length} ภาพ · เลือกหลายภาพได้`, `${refCap - refs.length} more · pick several at once`)
                            : t("ลาก & วาง หรือ Ctrl+V", "Drag & drop or Ctrl+V")}
                        </small>
                        <input type="file" accept="image/png,image/jpeg,image/webp" multiple={multiRef} hidden
                          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void addRefFiles(files); }} />
                      </label>
                    )}
                  </div>
                  {multiRef ? (
                    <>
                      <div className="rp-rhint">
                        {t(
                          <>พิมพ์ <b>ภาพ 1</b>, <b>ภาพ 2</b> … ในพรอมต์เพื่อบอกว่าใช้ภาพไหนตรงไหน · กดป้ายใต้ภาพเพื่อบอกว่าเป็นตัวละคร ชุด สิ่งของ หรือสถานที่</>,
                          <>Type <b>Image 1</b>, <b>Image 2</b> … in your prompt to say which picture goes where · tap the tag under a picture to say whether it&apos;s a character, an outfit, an object or a place</>,
                        )}
                      </div>
                      {refs.length > 0 && (
                        <div className="rp-rins">
                          <span>{t("แทรกในพรอมต์:", "Insert into prompt:")}</span>
                          {refs.map((r, i) => (
                            <button key={r.id} type="button" className="rp-raised" onClick={() => insertRefToken(i + 1)}>{referenceToken(i + 1, locale)}</button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : refs.length > 0 && (
                    <div className="rp-slider">
                      <div><span>{t("ความเข้มอ้างอิง", "Reference strength")}</span><b className="rp-mono">{Math.round(strength * 100)}%</b></div>
                      <input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(+e.target.value)}
                        aria-label={t("ความเข้มอ้างอิง", "Reference strength")} />
                    </div>
                  )}
                  {refsOver && (
                    <div className="rp-warn" style={{ marginTop: 10 }}>
                      {t(
                        `โมเดลนี้รับภาพอ้างอิงได้ ${refCap} ภาพ — เอาออกให้เหลือ ${refCap} ภาพก่อนสั่ง`,
                        `This model takes ${refCap} reference ${refCap === 1 ? "picture" : "pictures"} — remove some before ordering`,
                      )}
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
                      { key: "t2v", label: t("ข้อความ → วิดีโอ", "Text → video"), hint: t("เริ่มจากคำอธิบายล้วน", "From a description alone") },
                      { key: "i2v", label: t("ภาพ → วิดีโอ", "Image → video"), hint: t("ทำให้ภาพที่มีอยู่เคลื่อนไหว", "Bring a picture to life") },
                      // KIE's clip tools, offered only where such a model is connected.
                      ...(videoTools.includes("motion")
                        ? [{ key: "motion", label: t("เลียนท่าทาง", "Motion copy"), hint: t("ตัวละครขยับตามคลิปต้นแบบ", "A character moves like a clip") }]
                        : []),
                      ...(videoTools.includes("upscale")
                        ? [{ key: "upscale", label: t("ขยายวิดีโอ", "Video upscale"), hint: t("เพิ่มความคมชัดให้คลิปเดิม", "Sharpen an existing clip") }]
                        : []),
                    ] as { key: VideoMode; label: string; hint: string }[]).map((m) => (
                      <button key={m.key} type="button" data-on={videoMode === m.key ? "true" : "false"} onClick={() => setVideoMode(m.key)}>
                        <b>{m.label}</b>
                        <span>{m.hint}</span>
                      </button>
                    ))}
                  </div>
                  {videoTool ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
                      {toolNeedsImage && (
                        <div>
                          <div className="rp-sub">{t("ภาพตัวละคร", "Character picture")}</div>
                          <ImageSlot src={inputImagePreview} alt={t("ภาพตัวละคร", "Character picture")} hint={t("อัปโหลดภาพตัวละคร", "Upload the character")} accept="image/png,image/jpeg,image/webp"
                            onPick={handleImageUpload} onClear={clearInputImage} onLoad={onInputImageLoad}
                            onError={() => dropExpiredInput(inputImagePreview, clearInputImage)} />
                          <div className="rp-note">
                            {t(
                              "เห็นตัวละครชัดทั้งตัว ไม่ถูกบัง — ท่าในภาพใกล้กับท่าแรกของคลิปจะได้ผลเนียนที่สุด",
                              "Show the whole character, nothing in the way — a pose close to the clip's first move gives the smoothest result",
                            )}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="rp-sub">{videoTool === "motion" ? t("คลิปท่าทางต้นแบบ", "Clip with the moves") : t("คลิปที่จะขยาย", "Clip to upscale")}</div>
                        <FilePick
                          value={sourceVideoName}
                          busy={uploading === "video"}
                          accept="video/mp4,video/quicktime"
                          hint={t("อัปโหลดคลิป (MP4 / MOV)", "Upload a clip (MP4 / MOV)")}
                          onPick={(e) => handleMediaUpload(e, "video", clipMaxSeconds)}
                          onClear={() => { setSourceVideo(null); setSourceVideoName(null); }}
                        />
                        {/* Seen before it is paid for: the motion to copy, or the clip to sharpen. */}
                        {sourceVideo && (
                          <video src={sourceVideo} muted loop playsInline autoPlay preload="metadata"
                            // A clip put back from a past order has no upload reading:
                            // the player's prices it here (the server reads the file again).
                            onLoadedMetadata={(e) => {
                              const v = e.currentTarget;
                              if (!(v.duration > 0) || !Number.isFinite(v.duration) || !v.videoWidth) return;
                              const ext = /\.webm(\?|$)/i.test(sourceVideo) ? "webm" : "mp4";
                              setClipFacts((m) => (sourceVideo in m ? m : {
                                ...m, [sourceVideo]: { seconds: v.duration, width: v.videoWidth, height: v.videoHeight, bytes: 0, ext },
                              }));
                            }}
                            onError={() => dropExpiredInput(sourceVideo, () => { setSourceVideo(null); setSourceVideoName(null); })}
                            style={{ width: "100%", maxHeight: 200, marginTop: 8, borderRadius: 10, background: "#000", display: "block", objectFit: "contain" }} />
                        )}
                        {sourceClip && (
                          <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: "#a5f3fc" }}>
                            {t(`คลิป ${sourceClip.seconds.toFixed(1)} วินาที`, `Clip ${sourceClip.seconds.toFixed(1)} s`)} · {sourceClip.width}×{sourceClip.height}
                            {toolSeconds !== null && clipCheck?.ok !== false
                              ? t(` · คิด ${toolSeconds} วินาที = ✦ ${totalCredits} เครดิต`, ` · billed ${toolSeconds} s = ✦ ${formatCredits(totalCredits, "en")}`)
                              : ""}
                          </div>
                        )}
                        {clipCheck?.ok === false && <div className="rp-warn" style={{ marginTop: 8 }}>{t(clipCheck.msg)}</div>}
                        <div className="rp-note">
                          {clipRuleHint(clipRule ?? undefined, null, t)} · {t(`คิดเครดิตตามความยาวคลิป ✦ ${creditsFor(1)} ต่อวินาที`, `billed by clip length, ✦ ${creditsFor(1)} per second`)}
                          {videoTool === "motion" ? t(" · คนในคลิปเห็นชัดทั้งตัว ท่าไม่เร็วเกินไป", " · the whole person visible, moves not too fast") : ""}
                        </div>
                      </div>
                    </div>
                  ) : videoMode === "t2v" ? (
                    // The upload lives behind the mode, so on t2v the slot would
                    // simply be absent with nothing saying why. Offer it, one click.
                    <button type="button" className="rp-drop" style={{ marginTop: 10 }} onClick={() => setVideoMode("i2v")}>
                      <span className="rp-drop-ic" aria-hidden="true">↑</span>
                      {t("อยากให้คลิปเริ่มจากภาพของคุณ?", "Want the clip to start from your picture?")}
                      <small>{t("กดที่นี่เพื่อสลับเป็นโหมด “ภาพ → วิดีโอ”", "Tap here to switch to “Image → video”")}</small>
                    </button>
                  ) : (
                    <div className="rp-frames" data-two={offersLastFrame ? "true" : undefined}>
                      <div>
                        <div className="rp-sub">{t("ภาพเริ่มต้น", "Start frame")}</div>
                        <ImageSlot src={inputImagePreview} alt={t("ภาพเริ่มต้น", "Start frame")} hint={t("อัปโหลดภาพ", "Upload a picture")} accept="image/*"
                          onPick={handleImageUpload} onClear={clearInputImage} onLoad={onInputImageLoad}
                          onError={() => dropExpiredInput(inputImagePreview, clearInputImage)} />
                      </div>
                      {/* The frame the clip should end on — first-and-last-frame
                          models only. Optional: without it the model decides. */}
                      {offersLastFrame && (
                        <div>
                          <div className="rp-sub">{t("ภาพสุดท้าย (ไม่บังคับ)", "End frame (optional)")}</div>
                          <ImageSlot src={inputImageEnd} alt={t("ภาพสุดท้าย", "End frame")} hint={t("ภาพที่ต้องการให้คลิปจบ", "The picture the clip should end on")} accept="image/png,image/jpeg,image/webp"
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
                      {t(
                        <>โมเดลนี้กำหนด<span style={{ color: "#94a3b8" }}>ภาพสุดท้าย</span>ของคลิปไม่ได้ — ถ้าต้องการ ให้เลือกโมเดลที่รองรับ first-and-last-frame</>,
                        <>This model can&apos;t set the clip&apos;s <span style={{ color: "#94a3b8" }}>end frame</span> — for that, pick a model with first-and-last-frame</>,
                      )}
                    </div>
                  )}
                </>
              )}

              {tab === "edit" && (
                <ImageSlot src={inputImagePreview} alt={t("ภาพต้นฉบับ", "Original picture")} hint={t("อัปโหลดภาพที่ต้องการแก้ไข", "Upload the picture to edit")} accept="image/*"
                  onPick={handleImageUpload} onClear={clearInputImage} onLoad={onInputImageLoad}
                  onError={() => dropExpiredInput(inputImagePreview, clearInputImage)} />
              )}

              {/* Lip-sync: the thing that speaks, and the voice. Clip and voice
                  go to R2 first and only their URLs travel with the order. */}
              {tab === "lipsync" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {lipsyncNeeds === "image" ? (
                    <div>
                      <div className="rp-sub">{t("รูปหน้าคนที่จะให้พูด", "The face that will speak")}</div>
                      {/* What the rented worker can read (frame-input.ts) — a GIF
                          or HEIC portrait would only be refused at the order. */}
                      <ImageSlot src={inputImagePreview} alt={t("รูปหน้าคน", "Face photo")} hint={t("อัปโหลดรูปหน้าคน", "Upload a face photo")} accept="image/png,image/jpeg,image/webp"
                        onPick={handleImageUpload} onClear={clearInputImage} onLoad={onInputImageLoad}
                        onError={() => dropExpiredInput(inputImagePreview, clearInputImage)} />
                      <div className="rp-note">
                        {t(
                          "ใช้รูปที่เห็นหน้าชัด หันเข้ากล้อง ปากไม่ถูกบัง — คลิปจะออกมาตามสัดส่วนของรูป",
                          "Use a clear photo facing the camera with the mouth visible — the clip keeps the photo's shape",
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="rp-sub">{t("คลิปต้นฉบับที่จะพากย์ทับ", "Clip to re-dub")}</div>
                      <FilePick
                        value={sourceVideoName}
                        busy={uploading === "video"}
                        accept="video/mp4,video/webm,video/quicktime"
                        hint={t("อัปโหลดคลิป (MP4 / WebM)", "Upload a clip (MP4 / WebM)")}
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
                          {t(`คลิป ${sourceClip.seconds.toFixed(1)} วินาที`, `Clip ${sourceClip.seconds.toFixed(1)} s`)} · {sourceClip.width}×{sourceClip.height}
                          {videoRule?.billing?.kind === "clipBlocks" && clipCheck?.ok !== false
                            ? ` · ✦ ${t(`${totalCredits} เครดิต`, formatCredits(totalCredits, "en"))}`
                            : ""}
                        </div>
                      )}
                      {clipCheck?.ok === false && <div className="rp-warn" style={{ marginTop: 8 }}>{t(clipCheck.msg)}</div>}
                      <div className="rp-note">
                        {clipRuleHint(videoRule?.clip, videoRule?.billing ?? null, t)} · {t("เห็นหน้าชัด · เสียงเดิมในคลิปจะถูกแทนที่ทั้งหมด", "face clearly visible · the clip's own sound is replaced entirely")}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="rp-sub">{t("ไฟล์เสียงที่จะให้พูด", "Audio to be spoken")}</div>
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
                          hint={voiceRule
                            ? t(`อัปโหลดเสียงพูด (MP3 / WAV / M4A) ใช้ได้ไม่เกิน ${lipsyncAudioMax} วินาที`, `Upload speech (MP3 / WAV / M4A), up to ${lipsyncAudioMax} seconds`)
                            : t("อัปโหลดเสียง (MP3 / WAV / M4A)", "Upload audio (MP3 / WAV / M4A)")}
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
                    {clipVoiceCheck?.ok === false && <div className="rp-warn" style={{ marginTop: 8 }}>{t(clipVoiceCheck.msg)}</div>}
                    <div className="rp-note">
                      {t(
                        "พูดภาษาอะไรก็ได้รวมถึงไทย — โมเดลอ่านคลื่นเสียงเป็นรูปปาก ไม่ได้อ่านภาษา",
                        "Any language works, Thai included — the model turns the sound into mouth shapes, it doesn't read the language",
                      )}
                    </div>
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
                      state={trimState} onRetry={() => setTrimFailed(null)} note={trimTooLongNote}
                      // The extension's start, in the file: the cut begins at the selection.
                      marker={extendFrom !== null ? trimSel.start + extendFrom : null} />
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
                        hint={sunoTool === "add-vocals"
                          ? t(`อัปโหลดดนตรีบรรเลง MP3 / WAV — ไม่เกิน ${Math.floor(coverSourceSeconds / 60)} นาที`, `Upload an instrumental, MP3 / WAV — up to ${Math.floor(coverSourceSeconds / 60)} min`)
                          : sunoTool === "add-instrumental"
                            ? t(`อัปโหลดเสียงร้องเปล่า MP3 / WAV — ไม่เกิน ${Math.floor(coverSourceSeconds / 60)} นาที`, `Upload a bare vocal, MP3 / WAV — up to ${Math.floor(coverSourceSeconds / 60)} min`)
                            : t(
                                `อัปโหลดเพลง MP3 / WAV — ใช้ได้ไม่เกิน ${Math.floor(coverSourceSeconds / 60)} นาที เลือกช่วงได้หลังอัปโหลด`,
                                `Upload a song, MP3 / WAV — up to ${Math.floor(coverSourceSeconds / 60)} min; pick the part after uploading`,
                              )}
                        onPick={(e) => handleMediaUpload(e, "audio", coverSourceSeconds)}
                        onClear={clearAudio}
                      />
                      {/* The song of a reopened order, or a track carried on from a
                          result: its waveform, read through our own route (R2 sends
                          no CORS header), with an extension's start marked on it. */}
                      {inputAudio && (inputAudio === openedInputs?.inputAudio || inputAudio === carriedAudio) && (
                        <TrackWave key={inputAudio} url={inputAudio} label={inputAudioName ?? t("เพลงต้นฉบับ", "Original song")}
                          height={44} marker={extendFrom}
                          onPickMarker={extendLast !== null ? pickExtendFrom : undefined}
                          pickLabel={(at) => t(`📍 ต่อจาก ${at}`, `📍 Continue from ${at}`)}
                          // Its length, for an extension's start and the checks below.
                          onDuration={(d) => setAudioLengths((m) => (inputAudio in m ? m : { ...m, [inputAudio]: d }))}
                          onError={() => dropExpiredInput(inputAudio, clearAudio)}
                          style={{ marginTop: 10 }} />
                      )}
                    </>
                  )}
                  {/* Replace Section: the part picked by its lines, from the song's karaoke timing. */}
                  {sunoTool === "replace" && (
                    <ReplaceSection
                      src={inputAudio && !audioStale && uploading !== "audio" ? inputAudio : null}
                      seconds={inputAudioSeconds}
                      original={replaceOriginal}
                      onOriginal={setReplaceOriginal}
                      value={replaceWindow}
                      onChange={(w) => setReplacePick(w && inputAudio ? { ...w, src: inputAudio, original: replaceOriginal } : null)}
                      onWords={(words) => setLyrics(words.slice(0, 3000))}
                    />
                  )}
                  {/* Mashup: the second song, uploaded as it is. */}
                  {sunoTool === "mashup" && (
                    <div style={{ marginTop: 12 }}>
                      <div className="rp-sub">{t("เพลงที่สอง", "Second song")}</div>
                      <FilePick
                        value={mashSong?.name ?? null}
                        busy={mashUploading}
                        accept={AUDIO_ACCEPT}
                        hint={t(
                          `อัปโหลดเพลงที่สอง MP3 / WAV — ไม่เกิน ${Math.floor(coverSourceSeconds / 60)} นาที`,
                          `Upload the second song, MP3 / WAV — up to ${Math.floor(coverSourceSeconds / 60)} min`,
                        )}
                        onPick={pickMashSong}
                        onClear={() => setMashSong(null)}
                      />
                      {mashSong && (
                        <TrackWave key={mashSong.url} url={mashSong.url} label={mashSong.name} height={44} hue={320}
                          onError={() => setMashSong(null)} style={{ marginTop: 10 }} />
                      )}
                    </div>
                  )}
                  {/* Where an extension picks up: a second inside the track, the end by default. */}
                  {extendLast !== null && extendFrom !== null && (
                    <div className="rp-slider" style={{ marginTop: 12 }}>
                      <div>
                        <span>{t("ต่อจากวินาทีที่", "Continue from")}</span>
                        <b className="rp-mono">
                          {extendFrom < extendLast ? clock(extendFrom) : `${clock(extendLast)} ${t("(ท้ายเพลง)", "(the end)")}`}
                        </b>
                      </div>
                      <input type="range" min={1} max={extendLast} step={1} value={extendFrom}
                        onChange={(e) => setSunoField("continueAt", +e.target.value)} aria-label={t("ต่อจากวินาทีที่", "Continue from")} />
                    </div>
                  )}
                  <div className="rp-note">
                    {sunoTool === "cover" ? (
                      t(
                        "คงทำนองเดิมไว้แล้วเรียบเรียงใหม่ตามสไตล์ที่พิมพ์ ได้ 2 เวอร์ชัน · เว้นเนื้อเพลงว่าง = ร้องตามเนื้อเดิม · ไฟล์ใหญ่เกิน 12 MB ระบบแปลงช่วงที่เลือกเป็น MP3 ให้เอง",
                        "Keeps the tune and rearranges it in the style you typed; you get 2 versions · empty lyrics = sung with the original words · files over 12 MB: the selected part is converted to MP3 for you",
                      )
                    ) : sunoTool === "extend" ? (
                      t(
                        "เพลงต่อจากจุดที่เลือกด้วยสไตล์เดิม ได้ 2 เวอร์ชัน · ใส่เนื้อท่อนใหม่ในช่องเนื้อเพลงได้ · ใช้รุ่นเดียวกับที่ทำเพลงเดิมจะต่อได้เนียนที่สุด",
                        "The song carries on from the point you pick in the same style; you get 2 versions · add new lyrics in the lyrics box · the same model version as the original joins most smoothly",
                      )
                    ) : sunoTool === "add-vocals" ? (
                      t(
                        "ใช้ดนตรีที่ไม่มีเสียงร้อง (เช่น ไฟล์ “ดนตรี” จากการแยกสเต็ม) · บอกแนวการร้องในช่องสไตล์ เลือกเสียงชาย/หญิงได้ที่ “เสียงร้อง”",
                        "Use music with no vocals (e.g. the “music” file from a stem split) · describe the singing in the style box; pick a male or female voice under “Vocals”",
                      )
                    ) : sunoTool === "add-instrumental" ? (
                      t(
                        "ใช้เสียงร้องเปล่าที่ไม่มีดนตรี (เช่น ไฟล์ “เสียงร้อง” จากการแยกสเต็ม) · บอกแนวดนตรีในช่องสไตล์",
                        "Use a bare vocal with no music (e.g. the “vocals” file from a stem split) · describe the music in the style box",
                      )
                    ) : sunoTool === "replace" ? (
                      t(
                        "ร้องใหม่เฉพาะช่วงที่เลือก ส่วนอื่นของเพลงคงเดิม ได้ 2 เวอร์ชัน · ช่วงต้องยาว 10 วินาทีขึ้นไปและไม่เกินครึ่งเพลง ถ้าบรรทัดที่เลือกสั้นไป ระบบรวมบรรทัดข้างเคียงให้ทั้งบรรทัด",
                        "Only the part picked is sung anew; the rest of the song stays; you get 2 versions · the part must be 10 seconds or more and at most half the song — too short, and whole neighbouring lines are taken in",
                      )
                    ) : sunoTool === "mashup" ? (
                      t(
                        "รวมสองเพลงเป็นเพลงใหม่ตามสไตล์ที่พิมพ์ ได้ 2 เวอร์ชัน · แต่ละเพลงยาวไม่เกิน 8 นาที · ตั้งความยาวเพลงใหม่ได้ที่ “ปรับละเอียด”",
                        "Two songs made into a new one in the style you typed; you get 2 versions · each song up to 8 minutes · set the new song's length under “Fine-tune”",
                      )
                    ) : sunoTool === "stems" ? (
                      t(
                        "เพลงที่มิกซ์ชัด ๆ แยกได้สะอาดที่สุด · ได้ไฟล์ MP3 ตามรูปแบบที่เลือก เลือกโหลดเฉพาะไฟล์ที่ต้องการได้ · ทุกครั้งที่สั่งคิดเครดิตใหม่",
                        "A clean mix splits most cleanly · you get MP3 files in the split you chose and can download just the ones you want · every order is charged again",
                      )
                    ) : (
                      t(
                        <>
                          AI ถอดเฉพาะ<strong style={{ color: "#94a3b8" }}>ทำนอง</strong>ออกมาแล้วร้องใหม่ทั้งเพลง — เสียงร้องเดิมไม่ได้ถูกนำมาใช้
                          ถ้าอยากได้คำร้องเดิม ให้พิมพ์ลงช่องเนื้อเพลง · ไฟล์ใหญ่เกิน 12 MB ระบบแปลงช่วงที่เลือกเป็น MP3 ให้เอง
                        </>,
                        <>
                          The AI takes only the <strong style={{ color: "#94a3b8" }}>tune</strong> and sings the whole song again — the original vocals aren&apos;t used.
                          For the original words, type them in the lyrics box · files over 12 MB: the selected part is converted to MP3 for you
                        </>,
                      )
                    )}
                  </div>
                </>
              )}
            </Field>
          )}

          {/* ── Settings: the knobs, as chips where a glance should tell ── */}
          <Field no={sectionNo(settingsAt)} label={tab === "speech" ? t("เสียงผู้พูด", "Voice") : t("ตั้งค่า", "Settings")}>
            <div className="rp-sets">
              {/* The voices as cards: who speaks, in a word or two how. */}
              {speechRule && (
                <div>
                  <div className="rp-sub">
                    {t(`เลือกเสียง · ${speechRule.voices.length} เสียง`, `Choose a voice · ${speechRule.voices.length} ${speechRule.voices.length === 1 ? "voice" : "voices"}`)}
                  </div>
                  <div className="rp-voices rp-scroll" role="radiogroup" aria-label={t("เสียงผู้พูด", "Voice")}>
                    {speechRule.voices.map((v) => {
                      const [name, ...about] = v.label.split(" — ");
                      const on = activeVoice?.id === v.id;
                      return (
                        <button key={v.id} type="button" role="radio" aria-checked={on} className="rp-voice rp-raised"
                          data-on={on ? "true" : "false"} data-g={v.gender} onClick={() => setVoiceId(v.id)}>
                          <span className="rp-vwave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                          <span style={{ minWidth: 0 }}>
                            <b>{name}</b>
                            {about.length > 0 && <small>{about.join(" — ")}</small>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {speechRule?.style && (
                <div>
                  <div className="rp-sub">{t("สไตล์การพูด (ไม่บังคับ)", "Speaking style (optional)")}</div>
                  <input className="rp-input rp-well" value={speechStyle} maxLength={300} onChange={(e) => setSpeechStyle(e.target.value)}
                    aria-label={t("สไตล์การพูด", "Speaking style")}
                    placeholder={t("เช่น พูดช้า ๆ น้ำเสียงอบอุ่น เหมือนเล่านิทานก่อนนอน", "e.g. slow and warm, like a bedtime story")} />
                </div>
              )}
              {speechRule && priceTable && (
                <div className="rp-note" style={{ marginTop: 0 }}>
                  {t(
                    `คิดเครดิตตามความยาวข้อความ · ✦ ${kieQuote(priceTable, { chars: 1000 })} ต่อ 1,000 ตัวอักษร — ประโยคสั้นคิดตามจริง ขั้นต่ำ ✦ 1`,
                    `Billed by text length · ✦ ${kieQuote(priceTable, { chars: 1000 })} per 1,000 characters — short text is billed as it is, at least ✦ 1`,
                  )}
                </div>
              )}
              {/* Lip-sync has no aspect to choose: the result keeps the shape
                  of the clip or the portrait it was given. */}
              {tab !== "edit" && tab !== "lipsync" && tab !== "audio" && tab !== "speech" && !videoTool && (
                <div>
                  <div className="rp-sub">{t("สัดส่วน", "Aspect ratio")}</div>
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
              {((tab === "video" && !videoTool) || (tab === "audio" && !musicOpts?.autoLength)) && (
                <div>
                  <div className="rp-sub">{t("ความยาว", "Length")}</div>
                  <div className="rp-chips">
                    {durationChoices.map(d => (
                      <button key={d} type="button" className="rp-chip rp-raised" data-on={duration === d ? "true" : "false"} onClick={() => setDuration(d)}>
                        {tab === "audio" && d >= 60 && d % 60 === 0 ? t(`${d / 60} นาที`, `${d / 60} min`) : `${d}s`}
                        {/* Priced by length: say so before the order, not on the receipt. */}
                        {(selectedModel?.durationCurve || priceTable?.durations) && <small>✦ {creditsFor(d)}</small>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hidden when the model yields one output per order — offering 4
                  would take payment for images it never renders. */}
              {tab === "image" && selectedModel?.maxOutputs !== 1 && (
                <div>
                  <div className="rp-sub">{t("จำนวน", "How many")}</div>
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
                  <div className="rp-sub">{t("ความละเอียด", "Resolution")}</div>
                  <div className="rp-chips">
                    {resolutionChoices.map(r => (
                      <button key={r.id} type="button" className="rp-chip rp-raised" data-on={activeResolution?.id === r.id ? "true" : "false"}
                        onClick={() => setResolution(r.id)}>
                        {r.label}
                        {priceTable && (
                          <small>
                            ✦ {videoTool
                              ? toolSeconds !== null ? creditsFor(toolSeconds, r.id) : `${creditsFor(1, r.id)}/${t("วินาที", "s")}`
                              : creditsFor(duration, r.id)}
                          </small>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quality modes — only where the model offers a real choice (Qwen-
                  Image: Lightning vs the full model). Each carries its price
                  multiplier, and the button's total already includes it. */}
              {qualityModes && qualityModes.length > 1 && (
                <div>
                  <div className="rp-sub">{sunoTool === "stems" ? t("รูปแบบการแยก", "Split") : sunoTool ? t("รุ่นโมเดล", "Model version") : t("คุณภาพ", "Quality")}</div>
                  <div className="rp-chips">
                    {qualityModes.map((m) => (
                      <button key={m.id} type="button" className="rp-chip rp-raised" data-on={activeQuality?.id === m.id ? "true" : "false"}
                        title={m.description} onClick={() => setQualityId(m.id)}>
                        {m.label}{m.adminOnly ? t(" · ทดลอง (เห็นเฉพาะแอดมิน)", " · trial (admins only)") : ""}
                        <small>
                          {priceTable
                            ? `✦ ${creditsFor(tab === "video" ? duration : null, m.id)}`
                            : m.creditsMultiplier === 1 ? t("ราคาปกติ", "Standard price") : t(`×${m.creditsMultiplier} เครดิต`, `×${m.creditsMultiplier} credits`)}
                        </small>
                      </button>
                    ))}
                  </div>
                  {activeQuality?.description && <div className="rp-note">{activeQuality.description}</div>}
                </div>
              )}

              {/* "ดึงชิ้นเดียว": which instrument comes out (and the song without it). */}
              {stemTier === "one" && sunoOpts?.stems && (
                <div>
                  <div className="rp-sub">{t("ดึงชิ้นไหน · ได้ไฟล์ชิ้นนั้นล้วน และเพลงที่ไม่มีชิ้นนั้น", "Which part · you get that part alone, and the song without it")}</div>
                  <div className="rp-chips rp-scroll" style={{ maxHeight: 132, overflowY: "auto" }}>
                    {sunoOpts.stems.map((x) => (
                      <button key={x.id} type="button" className="rp-chip rp-raised" data-on={activeStem?.id === x.id ? "true" : "false"}
                        onClick={() => setSunoField("stem", x.id)}>{x.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* A sound: whether it loops, its tempo and its key. */}
              {sunoTool === "sounds" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label className="rp-check" style={{ fontSize: 12 }}>
                    <input type="checkbox" checked={suno.loop === true} onChange={(e) => setSunoField("loop", e.target.checked || undefined)} />
                    {t("วนลูปไร้รอยต่อ (ต่อหัวต่อท้ายได้พอดี)", "Seamless loop (the end joins the start)")}
                  </label>
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#94a3b8", marginBottom: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={suno.tempo !== undefined}
                        onChange={(e) => setSunoField("tempo", e.target.checked ? 100 : undefined)} />
                      {t("กำหนดจังหวะเอง", "Set the tempo")} {suno.tempo === undefined && <span style={{ color: "#64748b" }}>{t("(ปล่อยให้ AI เลือก)", "(AI picks)")}</span>}
                    </label>
                    {suno.tempo !== undefined && (
                      <StyleSlider label={t("จังหวะ", "Tempo")} value={suno.tempo} min={40} max={220} step={1}
                        format={(v) => `${v} BPM`} onChange={(v) => setSunoField("tempo", v)} />
                    )}
                  </div>
                  {sunoOpts?.keys && (
                    <div>
                      <div className="rp-sub">{t("คีย์", "Key")}</div>
                      <div className="rp-chips rp-scroll" style={{ maxHeight: 96, overflowY: "auto" }}>
                        {sunoOpts.keys.map((k) => (
                          <button key={k} type="button" className="rp-chip rp-raised rp-mono"
                            data-on={(suno.key ?? "Any") === k ? "true" : "false"}
                            onClick={() => setSunoField("key", k === "Any" ? undefined : k)}>{k === "Any" ? t("อัตโนมัติ", "Auto") : k}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Style, song direction and seed: nothing a voice or a clip tool reads. */}
              {tab !== "speech" && !videoTool && (
              <div className="rp-poprow">
                {/* The image styles are about pictures — none reaches a music model. */}
                {stylesLoaded && styles.length > 0 && tab !== "edit" && tab !== "audio" && (
                  <Popover id="style" open={openPanel} onToggle={setOpenPanel} label={t("สไตล์", "Style")}
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
                  <Popover id="genre" open={openPanel} onToggle={setOpenPanel} label={t("แนวเพลง", "Genre")}
                    value={t(MUSIC_GENRES.find((g) => g.id === musicStyle.genre)?.label ?? ANY)} width={320}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <ChipRow label={t("แนวเพลง", "Genre")} options={MUSIC_GENRES} value={musicStyle.genre}
                        onChange={(v) => setMusicField("genre", v as string | undefined)}
                        hint={t("กดซ้ำเพื่อยกเลิก", "Tap again to clear")} />
                      <ChipRow label={t("ภาษาที่ร้อง", "Sung in")} options={MUSIC_LANGUAGES} value={musicStyle.language}
                        disabled={instrumental}
                        onChange={(v) => setMusicField("language", v as string | undefined)} />
                      <ChipRow label={t("อารมณ์", "Mood")} options={MUSIC_MOODS} value={musicStyle.moods ?? []} max={3}
                        onChange={(v) => setMusicField("moods", v as string[] | undefined)}
                        hint={t(`เลือกได้ ${musicStyle.moods?.length ?? 0}/3`, `${musicStyle.moods?.length ?? 0}/3 picked`)} />
                    </div>
                  </Popover>
                )}

                {musicOpts?.controls && (
                  <Popover id="voice" open={openPanel} onToggle={setOpenPanel} label={t("เสียงร้อง", "Vocals")}
                    value={instrumental ? t("บรรเลง", "Instrumental") : t(MUSIC_VOCALS.find((v) => v.id === musicStyle.vocal)?.label ?? ANY)}
                    width={300}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {instrumental && (
                        <div style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.5 }}>
                          {t("เปิดโหมดเพลงบรรเลงอยู่ — ตัวเลือกเสียงร้องถูกปิดไว้ ปลดได้ที่ช่องเนื้อเพลง", "Instrumental is on — vocal options are off. Turn it off in the lyrics box.")}
                        </div>
                      )}
                      <ChipRow label={t("ผู้ร้อง", "Singer")} options={MUSIC_VOCALS} value={musicStyle.vocal} disabled={instrumental}
                        onChange={(v) => setMusicField("vocal", v as string | undefined)} />
                      <ChipRow label={t("ช่วงวัย", "Age")} options={MUSIC_AGES} value={musicStyle.age} disabled={instrumental}
                        onChange={(v) => setMusicField("age", v as string | undefined)} />
                      <ChipRow label={t("ลักษณะเสียง", "Voice quality")} options={MUSIC_TIMBRES} value={musicStyle.timbre} disabled={instrumental}
                        onChange={(v) => setMusicField("timbre", v as string | undefined)} />
                    </div>
                  </Popover>
                )}

                {sunoTool && sunoTool !== "stems" && sunoTool !== "sounds" && (
                  <Popover id="suno" open={openPanel} onToggle={setOpenPanel} label={t("ปรับละเอียด", "Fine-tune")}
                    value={sunoSummary}
                    width={330} align="right">
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {sunoTool === "song" && !instrumentalOn && !lyrics.trim() && (
                        <div style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.5 }}>
                          {t(
                            "ตอนนี้ AI แต่งเนื้อให้เอง — ความยาว น้ำหนัก และความหลากหลายใช้ได้เมื่อใส่เนื้อเพลงเองหรือเลือกเพลงบรรเลง",
                            "The AI is writing the lyrics — length, weights and variety apply once you add your own lyrics or choose instrumental",
                          )}
                        </div>
                      )}
                      <div>
                        <div className="rp-sub">{t("ชื่อเพลง", "Song title")}</div>
                        <input className="rp-input rp-well" value={suno.title ?? ""} maxLength={80}
                          onChange={(e) => setSunoField("title", e.target.value || undefined)}
                          placeholder={t("เว้นว่าง = ใช้คำแรกของสไตล์เพลง", "Empty = the first words of the style")} aria-label={t("ชื่อเพลง", "Song title")} />
                      </div>
                      <div>
                        <div className="rp-sub">{t("ไม่เอาแนว / เสียงแบบนี้", "Avoid these styles / sounds")}</div>
                        <input className="rp-input rp-well" value={suno.exclude ?? ""} maxLength={500}
                          onChange={(e) => setSunoField("exclude", e.target.value || undefined)}
                          placeholder={t("เช่น heavy metal, autotune, เสียงแหลม", "e.g. heavy metal, autotune, shrill vocals")} aria-label={t("ไม่เอาแนว", "Avoid")} />
                      </div>
                      {sunoTool === "song" && (
                        <div>
                          <div className="rp-sub">{t("ความยาวเพลง", "Song length")}</div>
                          <div className="rp-chips">
                            <button type="button" className="rp-chip rp-raised" data-on={suno.length === undefined ? "true" : "false"}
                              onClick={() => setSunoField("length", undefined)}>{t("อัตโนมัติ", "Auto")}</button>
                            {SUNO_LENGTHS.map((sec) => (
                              <button key={sec} type="button" className="rp-chip rp-raised" data-on={suno.length === sec ? "true" : "false"}
                                onClick={() => setSunoField("length", sec)}>{sec < 60 ? t(`${sec} วิ`, `${sec} s`) : t(`${sec / 60} นาที`, `${sec / 60} min`)}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="rp-sub">{t("ความหลากหลายของ 2 เวอร์ชัน", "How different the 2 versions are")}</div>
                        <div className="rp-chips">
                          {SUNO_VARIETY.map((label, i) => (
                            <button key={label.en} type="button" className="rp-chip rp-raised"
                              data-on={(suno.variety ?? 1) === i ? "true" : "false"}
                              onClick={() => setSunoField("variety", i === 1 ? undefined : i)}>{t(label)}</button>
                          ))}
                        </div>
                      </div>
                      <StyleSlider label={t("ยึดตามสไตล์ที่พิมพ์", "Follow the typed style")} value={suno.styleWeight ?? 0.5} min={0} max={1} step={0.05}
                        format={(v) => (suno.styleWeight === undefined ? t("อัตโนมัติ", "Auto") : `${Math.round(v * 100)}%`)}
                        onChange={(v) => setSunoField("styleWeight", v)} />
                      <StyleSlider label={t("ความแหวกแนว", "Weirdness")} value={suno.weirdness ?? 0.5} min={0} max={1} step={0.05}
                        format={(v) => (suno.weirdness === undefined ? t("อัตโนมัติ", "Auto") : `${Math.round(v * 100)}%`)}
                        onChange={(v) => setSunoField("weirdness", v)} />
                      {!instrumentalOn && sunoTool !== "song" && (
                        <StyleSlider label={t("ยึดตามเสียงต้นฉบับ", "Follow the original audio")} value={suno.audioWeight ?? 0.5} min={0} max={1} step={0.05}
                          format={(v) => (suno.audioWeight === undefined ? t("อัตโนมัติ", "Auto") : `${Math.round(v * 100)}%`)}
                          onChange={(v) => setSunoField("audioWeight", v)} />
                      )}
                      <button type="button" onClick={() => setSuno((c) => ({ continueAt: c.continueAt, stem: c.stem }))}
                        style={{
                          padding: "7px 0", borderRadius: 8, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer",
                          background: "rgba(255,255,255,0.04)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)",
                        }}>
                        {t("กลับเป็นอัตโนมัติทั้งหมด", "Reset all to auto")}
                      </button>
                    </div>
                  </Popover>
                )}

                {musicOpts?.controls && (
                  <Popover id="arrange" open={openPanel} onToggle={setOpenPanel} label={t("ดนตรี", "Music")}
                    value={t(musicComplexity(musicStyle.complexity).label)} width={320} align="right">
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      <ChipRow label={t("เครื่องดนตรี", "Instruments")} options={MUSIC_INSTRUMENTS} value={musicStyle.instruments ?? []} max={6}
                        onChange={(v) => setMusicField("instruments", v as string[] | undefined)}
                        hint={t(`เลือกได้ ${musicStyle.instruments?.length ?? 0}/6`, `${musicStyle.instruments?.length ?? 0}/6 picked`)} />

                      {/* Tempo is off by default: an unasked-for BPM is a
                          constraint the model did not need, and a wrong one
                          fights the lyrics. */}
                      <div>
                        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#94a3b8", marginBottom: 6, cursor: "pointer" }}>
                          <input type="checkbox" checked={musicStyle.bpm !== undefined}
                            onChange={(e) => setMusicField("bpm", e.target.checked ? 100 : undefined)} />
                          {t("กำหนดจังหวะเอง", "Set the tempo")} {musicStyle.bpm === undefined && <span style={{ color: "#64748b" }}>{t("(ปล่อยให้ AI เลือก)", "(AI picks)")}</span>}
                        </label>
                        {musicStyle.bpm !== undefined && (
                          <StyleSlider label={t("จังหวะ", "Tempo")} value={musicStyle.bpm} min={MUSIC_BPM_MIN} max={MUSIC_BPM_MAX} step={2}
                            format={(v) => `${v} BPM`} onChange={(v) => setMusicField("bpm", v)} />
                        )}
                      </div>

                      {/* Real node inputs, not tags: density picks YuE2's `mode`
                          (chord-annotated score vs melody only) and variety is
                          its sampling temperature. */}
                      <StyleSlider label={t("ความซับซ้อนของดนตรี", "Arrangement density")} value={musicStyle.complexity ?? MUSIC_COMPLEXITY_DEFAULT}
                        min={1} max={5} step={1}
                        format={(v) => t(musicComplexity(v).label)}
                        onChange={(v) => setMusicField("complexity", v)} />

                      {!sunoTool && <StyleSlider label={t("ความแปลกใหม่", "Variety")} value={musicStyle.variance ?? MUSIC_VARIANCE_DEFAULT}
                        min={MUSIC_VARIANCE_MIN} max={MUSIC_VARIANCE_MAX} step={0.05}
                        format={(v) => `${v < 0.85 ? t("ปลอดภัย", "Safe") : v > 1.15 ? t("กล้าเสี่ยง", "Daring") : t("สมดุล", "Balanced")} ${v.toFixed(2)}`}
                        onChange={(v) => setMusicField("variance", v)} />}

                      <button type="button"
                        onClick={() => setMusicStyle({ complexity: MUSIC_COMPLEXITY_DEFAULT, variance: MUSIC_VARIANCE_DEFAULT })}
                        style={{
                          padding: "7px 0", borderRadius: 8, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer",
                          background: "rgba(255,255,255,0.04)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)",
                        }}>
                        {t("ล้างตัวเลือกทั้งหมด", "Clear all choices")}
                      </button>
                    </div>
                  </Popover>
                )}

                {/* Video keeps this panel too — steps and guidance mean nothing
                    to a video endpoint, but seed does, and locking the whole
                    panel away took reproducible clips with it. */}
                <Popover id="advanced" open={openPanel} onToggle={setOpenPanel} label={t("⚙ ขั้นสูง", "⚙ Advanced")} width={300} align="right">
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
                          placeholder={t("อัตโนมัติ", "auto")} style={{ ...xdrInputStyle, flex: 1, padding: 10, fontFamily: "ui-monospace,monospace" }} />
                        <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 99999))}
                          style={{ padding: "0 12px", borderRadius: 10, background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}>↻</button>
                      </div>
                    </div>
                  </div>
                </Popover>
              </div>
              )}

              {tab !== "edit" && tab !== "audio" && tab !== "speech" && !videoTool && (
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
              {selectedModel.unavailableReason ?? selectedModel.tuningMessage ?? t("โมเดลนี้ยังใช้งานไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง", "This model isn't available right now. Please try again later.")}
            </div>
          )}
          {loadingInputs && <div className="rp-info">{t("กำลังโหลดไฟล์แนบของงานเดิม…", "Loading the earlier order's files…")}</div>}
          {missingStartFrame && !loadingInputs && <div className="rp-warn">{t("โหมด “ภาพ → วิดีโอ” ต้องอัปโหลดภาพเริ่มต้นก่อน", "“Image → video” needs a start frame first")}</div>}
          {missingToolText && !loadingInputs && uploading !== "video" && <div className="rp-warn">{missingToolText}</div>}
          {speechTooLong && speechRule && (
            <div className="rp-warn">
              {t(
                `ข้อความยาว ${formatNumber(speechLength, locale)} ตัวอักษร — โมเดลนี้อ่านได้ครั้งละไม่เกิน ${formatNumber(speechRule.maxChars, locale)} ตัวอักษร ตัดให้สั้นลงหรือแบ่งเป็นหลายงาน`,
                `The text is ${formatNumber(speechLength, locale)} characters — this model reads up to ${formatNumber(speechRule.maxChars, locale)} at a time. Shorten it or split it into several orders.`,
              )}
            </div>
          )}
          {missingLipsyncInput && !loadingInputs && (
            <div className="rp-warn">
              {!hasAudio
                ? t("ต้องอัปโหลดไฟล์เสียงที่จะให้พูดก่อน", "Upload the audio to be spoken first")
                : lipsyncNeeds === "image"
                  ? t("ต้องอัปโหลดรูปหน้าคนที่จะให้พูดก่อน", "Upload a photo of the face that will speak first")
                  : t("ต้องอัปโหลดคลิปต้นฉบับที่จะพากย์ทับก่อน", "Upload the clip to re-dub first")}
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
              {t(
                `เครดิตไม่พอสำหรับงานนี้ — ต้องใช้ ${formatNumber(totalCredits, locale)} มีอยู่ ${formatNumber(creditBalance, locale)}`,
                `Not enough credits for this — it needs ${formatNumber(totalCredits, locale)} and you have ${formatNumber(creditBalance, locale)}`,
              )}{" "}
              <a href="/pricing">{t("เติมเครดิต →", "Top up →")}</a>
            </div>
          )}
          <div className="rp-osum">
            <span>
              {t(
                <>คงเหลือ <b>{formatNumber(creditBalance, locale)}</b> เครดิต</>,
                <><b>{formatNumber(creditBalance, locale)}</b> {creditBalance === 1 ? "credit" : "credits"} left</>,
              )}
            </span>
            <a href="/pricing">{t("+ เติมเครดิต", "+ Top up")}</a>
          </div>
          <button type="button" className="rp-go" onClick={() => handleGenerate()} disabled={cannotSubmit}>
            {runningJobs >= MAX_PARALLEL_JOBS ? (
              <span className="rp-go-label" style={{ fontSize: 14 }}>
                {t(`⟳ กำลังสร้าง ${runningJobs} งาน — รอให้เสร็จก่อน`, `⟳ Creating ${runningJobs} — wait for one to finish`)}
              </span>
            ) : (
              <>
                <span className="rp-go-label">{t("ทอ", "Weave")}</span>
                <span className="rp-gop">
                  ✦ {outputs > 1 ? t(`${outputs} ภาพ · `, `${outputs} images · `) : ""}{totalCredits || "—"} {t("เครดิต", totalCredits === 1 ? "credit" : "credits")}
                </span>
              </>
            )}
          </button>
          <div className="rp-onote">
            {runningJobs >= MAX_PARALLEL_JOBS
              ? t("รอให้งานใดงานหนึ่งเสร็จก่อน แล้วค่อยสั่งเพิ่ม", "Wait for one to finish, then order another")
              : runningJobs > 0
                ? t(
                    `กำลังสร้างอยู่ ${runningJobs} งาน · สั่งเพิ่มได้อีก ${MAX_PARALLEL_JOBS - runningJobs} งาน`,
                    `Creating ${runningJobs} · room for ${MAX_PARALLEL_JOBS - runningJobs} more`,
                  )
                : t(`ทำพร้อมกันได้ ${MAX_PARALLEL_JOBS} งาน · Ctrl/⌘ + Enter = ทอ`, `Up to ${MAX_PARALLEL_JOBS} at once · Ctrl/⌘ + Enter = Weave`)}
          </div>
        </div>
      </section>

      {/* ═══ STAGE — the orders, the canvas, the latest pieces ═══ */}
      <main className="rp-stage">
        {/* The order tray: every order placed from this page, newest first.
            Orders render side by side (up to MAX_PARALLEL_JOBS); the canvas
            shows the one picked here. */}
        {jobs.length > 0 && (
          <div className="rp-tray rp-scroll" role="list" aria-label={t("งานที่สั่ง", "Your orders")}>
            {jobs.map((j) => {
              const on = j.id === focusId;
              const fraction = j.status === "running" && j.progress?.stage === "rendering" ? shownFraction(j.progress, j.progress.at) : null;
              const thumb = j.result?.thumbnailUrl || j.result?.resultUrl;
              const isAudio = j.tab === "audio" || j.tab === "speech" || AUDIO_EXT.test(thumb ?? "");
              const isVideoThumb = !isAudio && (j.tab === "video" || j.tab === "lipsync" || /\.(mp4|webm|mov)(\?|$)/i.test(thumb ?? ""));
              return (
                <button key={j.id} type="button" role="listitem" onClick={() => focusJob(j)} title={j.prompt || t("งานลิปซิงค์", "Lip-sync order")}
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
                    <span className="rp-tray-prompt">{j.prompt || t("ลิปซิงค์", "Lip sync")}</span>
                    <span className="rp-tray-state">
                      {j.status === "completed" ? t("เสร็จแล้ว", "Done")
                        : j.status === "failed" ? t("ไม่สำเร็จ · คืนเครดิต", "Failed · refunded")
                          : j.id < 0 ? t("กำลังส่ง…", "Sending…")
                            : j.progress?.stage === "queued" && (j.progress.position ?? 0) > 0
                              ? t(`รอคิว ${j.progress.position}`, `Queued #${j.progress.position}`)
                              : j.progress?.stage === "queued" ? t("รอคิว…", "Queued…")
                              : fraction != null ? t(`กำลังสร้าง ${Math.floor(fraction * 100)}%`, `Creating ${Math.floor(fraction * 100)}%`) : t("กำลังสร้าง…", "Creating…")}
                    </span>
                  </span>
                </button>
              );
            })}
            {jobs.some((j) => j.status !== "running") && (
              <button type="button" className="rp-tray-clear"
                onClick={() => setJobs((js) => js.filter((j) => j.status === "running" || j.id === focusId))}>
                {t("ล้างที่เสร็จแล้ว", "Clear finished")}
              </button>
            )}
          </div>
        )}

        <div className="rp-canvas rp-hud">
          <span className="rp-led" aria-hidden="true"><i /></span>
          <div className="rp-cbar">
            <span className="rp-dot" data-run={isGenerating ? "true" : "false"} aria-hidden="true" />
            <span className="rp-mono">{t(TAB_LABEL[canvasTab])}{canvasTab === "audio" || canvasTab === "speech" ? "" : ` · ${canvasAspect}`}</span>
            <span>{canvasState}</span>
            <span className="rp-cbar-r">
              {/* Variations is just another order, so it follows the button's rule. */}
              <Pill disabled={cannotSubmit}
                title={cannotSubmit && selectedModel?.canOrder === false ? (selectedModel.unavailableReason ?? undefined) : t("สั่งอีกรอบด้วย seed ใหม่", "Order again with a new seed")}
                onClick={() => { if (cannotSubmit) return; handleGenerate({ seed: Math.floor(Math.random() * 2_147_483_647) }); }}>
                {t("สร้างแบบอื่น", "Variations")}
              </Pill>
              {tab === "image" && (
                <Pill disabled={!upscaleAvailable}
                  title={upscaleAvailable ? undefined : t("Upscale ยังไม่เปิดให้บริการ", "Upscale isn't available yet")}
                  onClick={() => upscaleAvailable && result?.id && handleUpscale()}>
                  {isUpscaling ? t("⟳ กำลังขยาย", "⟳ Upscaling") : t("ขยายภาพ", "Upscale")}
                </Pill>
              )}
              <Pill onClick={() => { window.location.href = "/gallery"; }}>{t("ประวัติ", "History")}</Pill>
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
                    {t(`สั่งงานถัดไปต่อได้เลย — ระบบทำพร้อมกันได้ ${MAX_PARALLEL_JOBS} งาน`, `Go ahead and order the next one — up to ${MAX_PARALLEL_JOBS} run at once`)}
                  </div>
                )}
              </div>
            ) : result?.status === "completed" && result.resultUrl ? (
              <div style={{ width: "100%" }}>
                {result.resultUrls && result.resultUrls.length > 1 && !resultIsAudio ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 16 }}>
                    {result.resultUrls.map((url, i) => (
                      <div key={i} style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={t(`ผลลัพธ์ ${i + 1}`, `Result ${i + 1}`)} style={{ width: "100%", display: "block", objectFit: "contain" }} />
                        <button type="button" onClick={() => handleDownload(url)} aria-label={t(`ดาวน์โหลดภาพที่ ${i + 1}`, `Download image ${i + 1}`)}
                          style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 8, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", fontSize: 13 }}>↓</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 16, border: "1px solid rgba(255,255,255,0.06)" }}>
                    {originalImage ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
                        <div style={{ position: "relative" }}>
                          <span style={{ position: "absolute", top: 8, left: 8, zIndex: 2, padding: "3px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", fontSize: 10, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>{t("ต้นฉบับ", "Original")}</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={originalImage} alt={t("ต้นฉบับ", "Original")} style={{ width: "100%", borderRadius: 12, opacity: 0.7, objectFit: "contain" }} />
                        </div>
                        <div style={{ position: "relative" }}>
                          <span style={{ position: "absolute", top: 8, left: 8, zIndex: 2, padding: "3px 8px", borderRadius: 999, background: `hsla(${160 + HUE},70%,50%,0.3)`, backdropFilter: "blur(8px)", fontSize: 10, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>{t("ผลลัพธ์", "Result")}</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={result.resultUrl} alt={prompt} style={{ width: "100%", borderRadius: 12, objectFit: "contain" }} />
                        </div>
                      </div>
                    ) : resultTracks ? (
                      <>
                      <AudioTracks
                        key={result.id}
                        kind={result.resultLabels?.length === resultTracks.length ? "stems" : "versions"}
                        title={viewing?.prompt || songTitle || t("เพลงของคุณ", "Your song")}
                        tracks={resultTracks}
                        onDownload={(track) => handleDownload(track.url, track.label, true)}
                        actions={songNext.map(([, tool, label]) => ({ id: tool, label: t(label) }))}
                        onAction={(id, track) => {
                          const next = SONG_NEXT.find(([, tool]) => tool === id);
                          if (next) carrySongTo(next[0], next[1], track.url, track.label, result.resultLyrics?.[resultTracks.indexOf(track)]);
                        }}
                      />
                      {/* Versions of one song (Suno's two takes) go to AquaChord as
                          the first take, with the words it sang; stems have no song. */}
                      {result.resultLabels?.length !== resultTracks.length && (
                        <AquaChordHandoff key={`aquachord-${result.id}`} genId={result.id} style={{ marginTop: 14 }} />
                      )}
                      </>
                    ) : resultIsAudio ? (
                      <AudioResult src={result.resultUrl} genId={result.id} chords={canvasTab !== "speech"}
                        title={viewing?.prompt || (canvasTab === "speech" ? focusedJob?.prompt || t("เสียงพูด", "Speech") : songTitle || t("เพลงของคุณ", "Your song"))} />
                    ) : resultIsVideo ? (
                      <video src={result.resultUrl} controls autoPlay loop style={{ width: "100%", borderRadius: 12, maxHeight: 600, margin: "0 auto", display: "block" }} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={result.resultUrl} alt={prompt} style={{ width: "100%", borderRadius: 12, maxHeight: 600, objectFit: "contain", margin: "0 auto", display: "block" }} />
                    )}
                  </div>
                )}

                {/* A song's words: what Suno sang, or the lyrics the customer typed. */}
                {resultIsAudio && result?.resultLyrics && result.resultLyrics.length > 0 && (
                  <SongLyrics key={`lyrics-${result.id}`} lyrics={result.resultLyrics} style={{ marginBottom: 14 }} />
                )}
                {/* Its karaoke: timed on our server, the words lit as they are sung, on to an MV. */}
                {resultIsAudio && canvasTab === "audio" && result?.resultUrl && result.resultLyrics?.some((l) => l.trim()) && (
                  <KaraokePanel
                    key={`karaoke-${result.id}`}
                    generationId={result.id > 0 ? result.id : null}
                    tracks={(resultTracks ?? [{ url: result.resultUrl, label: t("เพลง", "Song") }]).map((tr, i) => ({
                      ...tr,
                      lyrics: result.resultLyrics?.[i] ?? "",
                    }))}
                    style={{ marginBottom: 14 }}
                  />
                )}

                {/* Action toolbar */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Pill onClick={() => handleDownload()}>{t("↓ ดาวน์โหลด", "↓ Download")}</Pill>
                    <Pill active={isFavorited} onClick={handleFavorite}>{isFavorited ? t("♥ บันทึกแล้ว", "♥ Saved") : t("♡ บันทึก", "♡ Save")}</Pill>
                    <Pill onClick={handleShare}>{t("⎋ แชร์", "⎋ Share")}</Pill>
                    {resultIsImage && (
                      <Pill onClick={handleUpscale}>{isUpscaling ? t("⟳ กำลังขยาย…", "⟳ Upscaling…") : t("⤢ ขยายภาพ", "⤢ Upscale")}</Pill>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {viewing && formBeforeOpen && (
                      <Pill onClick={restoreDraft}
                        title={t("คืน prompt การตั้งค่า และไฟล์แนบที่เขียนค้างไว้ก่อนเปิดงานนี้", "Bring back the prompt, settings and files you had before opening this")}>
                        {t("↶ กลับไปร่างเดิม", "↶ Back to my draft")}
                      </Pill>
                    )}
                    <Pill onClick={clearCanvas}>{t("↻ สร้างใหม่", "↻ Start over")}</Pill>
                  </div>
                </div>

                {/* The next step for a finished track: split it, cover it, carry it on. */}
                {resultIsAudio && canvasTab === "audio" && songNext.length > 0 && !resultTracks && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>{t("ใช้เพลงนี้ต่อ:", "Use this song:")}</span>
                    {songNext.map(([mode, tool, label]) => (
                      <Pill key={tool} onClick={() => carrySongTo(mode, tool, result.resultUrl as string, songTitle || t("เพลงจากงานนี้", "Song from this order"), result.resultLyrics?.[0])}>{t(label)}</Pill>
                    ))}
                  </div>
                )}

                {/* The next step for a finished picture — the chain a creator
                    actually follows: still → clip, still → edit, still → the
                    reference for the next still. */}
                {resultIsImage && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>{t("ใช้ภาพนี้ต่อ:", "Use this picture:")}</span>
                    <Pill onClick={() => carryResultTo("video", result.resultUrl as string)}
                      disabled={tabBlockedReason("video") !== null}
                      title={tabBlockedReason("video") ?? t("เปิดแท็บวิดีโอ ใส่ภาพนี้เป็นเฟรมแรก", "Opens the video tab with this as the first frame")}>
                      {t("▶ ทำเป็นวิดีโอ", "▶ Make a video")}
                    </Pill>
                    <Pill onClick={() => carryResultTo("edit", result.resultUrl as string)}
                      disabled={tabBlockedReason("edit") !== null} title={tabBlockedReason("edit") ?? t("เปิดแท็บแก้ไขภาพ", "Opens the edit tab")}>
                      {t("✦ แก้ไขภาพนี้", "✦ Edit this picture")}
                    </Pill>
                    <Pill onClick={() => carryResultTo("ref", result.resultUrl as string)}
                      title={t("สร้างภาพใหม่โดยอ้างอิงภาพนี้", "Make a new picture based on this one")}>
                      {t("⎘ ใช้เป็นภาพอ้างอิง", "⎘ Use as reference")}
                    </Pill>
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
                        ? t("ไฟล์นี้หมดอายุแล้ว", "This file has expired")
                        : t(
                            `เก็บไฟล์ไว้อีก ${result.daysLeft} วัน — กรุณาดาวน์โหลดเก็บไว้`,
                            `Kept for ${result.daysLeft} more ${result.daysLeft === 1 ? "day" : "days"} — please download it`,
                          )}
                    </span>
                    {result.expiresAt && (
                      <span style={{ opacity: 0.7 }}>
                        {t("(ถึง ", "(until ")}
                        {formatDate(result.expiresAt, locale, { day: "numeric", month: "short", year: locale === "th" ? "2-digit" : "numeric" })})
                      </span>
                    )}
                  </div>
                )}

                {/* Generation info */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, fontSize: 11, color: "#64748b" }}>
                  {result.creditsUsed > 0 && <span>✦ {formatCredits(result.creditsUsed, locale)}</span>}
                  {result.processingMs && <span>⌚ {(result.processingMs / 1000).toFixed(1)}s</span>}
                  <span style={{ color: "#34d399" }}>✓ {t("สำเร็จ", "Done")}</span>
                </div>
              </div>
            ) : result?.status === "failed" ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 80, height: 80, borderRadius: 20, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", display: "grid", placeItems: "center", margin: "0 auto 18px", fontSize: 36, color: "#fca5a5" }}>!</div>
                <h3 style={{ fontSize: 22, fontWeight: 300, margin: "0 0 8px", color: "#fff" }}>{t("สร้างไม่สำเร็จ", "Generation failed")}</h3>
                <p style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", marginBottom: 18 }}>{result.error ? localizeOrderError(result.error, t) : t("เกิดข้อผิดพลาด", "Something went wrong")}</p>
                <button type="button" onClick={clearCanvas}
                  style={{ padding: "10px 22px", borderRadius: 10, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`, color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                  {t("ลองอีกครั้ง", "Try again")}
                </button>
              </div>
            ) : (
              <div style={{ width: "100%" }}>
                {tab === "audio" ? (
                  // No sample songs to show yet — offer starting points instead,
                  // one tap to put a description in the prompt.
                  <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
                    <div style={{ fontSize: 44, marginBottom: 8, color: "#c4b5fd" }}>♫</div>
                    <h3 style={{ fontSize: 22, fontWeight: 300, color: "#fff", margin: "0 0 6px" }}>{t("สร้างเพลงของคุณเอง", "Make your own song")}</h3>
                    <p style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", margin: "0 0 18px" }}>
                      {t(
                        "บอกแนวเพลงกับอารมณ์ ใส่เนื้อเพลงเองได้ หรือเว้นว่างไว้เป็นเพลงบรรเลง",
                        "Describe the style and mood. Add your own lyrics, or leave them empty for an instrumental.",
                      )}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                      {MUSIC_STARTERS.map((s) => (
                        <button key={s.th} type="button" className="rp-chip rp-raised" onClick={() => setPrompt(t(s))}>
                          {t(s)}
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
                  {t(
                    <>{tab === "audio" ? "" : "ตัวอย่างผลงานที่สร้างบนแพลตฟอร์มนี้ — "}เลือกโมเดล พิมพ์ prompt แล้วกด <span style={{ color: "#a5f3fc" }}>ทอ</span> เพื่อเริ่มสร้าง{tab === "video" ? "วิดีโอ" : tab === "edit" ? "การแก้ไข" : tab === "audio" ? "เพลง" : "ภาพ"}ของคุณเอง</>,
                    <>{tab === "audio" ? "" : "Samples made on this platform — "}pick a model, type a prompt and press <span style={{ color: "#a5f3fc" }}>Weave</span> to make your own {tab === "video" ? "video" : tab === "edit" ? "edit" : tab === "audio" ? "song" : "picture"}</>,
                  )}
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
            <span className="rp-rl">{t("ล่าสุด", "Latest")} · <a href="/gallery">{t("ดูทั้งหมด →", "See all →")}</a></span>
            <div className="rp-recent-row rp-scroll">
              {history.slice(0, 16).map((g) => {
                const src = g.thumbnailUrl || g.resultUrl;
                const isVideo = g.type === "video" || g.resultUrl?.endsWith(".mp4");
                // A provider that hands back a real poster image keeps <img>.
                const srcIsVideo = isVideo && !/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(src ?? "");
                // A song has nothing to draw; it gets a note on its own colour.
                const isAudio = g.type === "audio" || AUDIO_EXT.test(src ?? "");
                return (
                  <button key={g.id} type="button" className="rp-thumb" title={`${g.prompt}\n— ${t("กดเพื่อเปิดงานนี้ พร้อม prompt การตั้งค่า และไฟล์แนบเดิม", "Open this piece with its prompt, settings and attachments")}`}
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

      <ModeOrb modes={orbModes} links={orbLinks} title={t(TAB_LABEL[tab])} glyph={TAB_GLYPH[tab]} />

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
          /* The (main) layout pads every page by pb-16; here that padding was
             64 px of document scroll under a page that fits the screen. */
          margin-bottom: -4rem;
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
        .rp-studio .rp-mlogo[data-photo="true"] { object-fit: cover; border-radius: 10px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12); filter: none; }

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
        /* camera options: a looping 3D preview of each move (the panel is portalled, outside .rp-studio) */
        .xdr-pop .rp-camgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 7px; }
        .xdr-pop .rp-camtile {
          display: flex; flex-direction: column; min-width: 0; padding: 0; border: 0; border-radius: 10px; overflow: hidden;
          background: rgba(255, 255, 255, 0.03); color: #e2e8f0; text-align: left; font: inherit; cursor: pointer;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07); transition: box-shadow 160ms ease, transform 160ms ease;
        }
        .xdr-pop .rp-camtile:hover { transform: translateY(-1px); box-shadow: inset 0 0 0 1px rgba(var(--cy), 0.45), 0 10px 18px -12px rgba(0, 0, 0, 0.9); }
        .xdr-pop .rp-camtile:focus-visible { outline: 2px solid rgba(var(--cy), 0.8); outline-offset: 1px; }
        .xdr-pop .rp-camtile[data-on="true"] { box-shadow: inset 0 0 0 2px rgba(var(--cy), 0.75), 0 0 16px -6px rgba(var(--cy), 0.6); }
        .xdr-pop .rp-camview {
          position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden;
          background: linear-gradient(180deg, #0b1030 0%, #2b2a7a 55%, #5a2a7e 100%);
        }
        .xdr-pop .rp-camview canvas { display: block; width: 100%; height: 100%; }
        .xdr-pop .rp-camview canvas[data-failed="true"] { visibility: hidden; }
        .xdr-pop .rp-camcheck {
          position: absolute; right: 5px; bottom: 5px; width: 18px; height: 18px; display: grid; place-items: center;
          border-radius: 999px; font-size: 11px; font-weight: 700; background: rgba(var(--cy), 0.92); color: #04121a;
        }
        .xdr-pop .rp-camcap { display: block; padding: 6px 8px 7px; min-width: 0; }
        .xdr-pop .rp-camcap b { display: block; font-size: 12px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .xdr-pop .rp-camcap small { display: block; margin-top: 2px; font-size: 10.5px; line-height: 1.35; color: #8391a7; }
        .xdr-pop .rp-camtile[data-on="true"] .rp-camcap b { color: #a5f3fc; }
        @media (prefers-reduced-motion: reduce) {
          .xdr-pop .rp-camtile { transition: none; }
          .xdr-pop .rp-camtile:hover { transform: none; }
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
        /* The music tab's six modes: three across, two on a phone. */
        .rp-studio .rp-mseg { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        @media (max-width: 420px) { .rp-studio .rp-mseg { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
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
        .rp-studio .rp-rmove {
          position: absolute; left: 3px; right: 3px; top: 50%; z-index: 1; transform: translateY(-50%);
          display: flex; justify-content: space-between; pointer-events: none; opacity: 0; transition: opacity 120ms;
        }
        .rp-studio .rp-rmove button {
          pointer-events: auto; width: 22px; height: 26px; border: 0; border-radius: 7px; padding: 0; cursor: pointer;
          display: grid; place-items: center; color: #e2e8f0; font-size: 16px; line-height: 1;
          background: rgba(3, 6, 18, 0.72); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
        }
        .rp-studio .rp-rmove button:disabled { visibility: hidden; }
        .rp-studio .rp-rtile:hover .rp-rmove, .rp-studio .rp-rmove:focus-within { opacity: 1; }
        @media (hover: none) { .rp-studio .rp-rmove { opacity: 1; } }
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
        /* speech: the voices as cards, each with a small waveform that plays when chosen */
        .rp-studio .rp-voices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; max-height: 252px; overflow-y: auto; padding: 2px; }
        .rp-studio .rp-voice {
          --tone: var(--cy);
          display: flex; align-items: center; gap: 10px; min-width: 0; padding: 9px 10px; border-radius: 10px;
          font: inherit; text-align: left; cursor: pointer; color: #94a3b8;
        }
        .rp-studio .rp-voice[data-g="male"] { --tone: var(--vi); }
        .rp-studio .rp-voice b { display: block; font-size: 12.5px; font-weight: 500; color: #e2e8f0; }
        .rp-studio .rp-voice small {
          display: block; font-size: 10.5px; line-height: 1.4; color: #64748b;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rp-studio .rp-voice[data-on="true"] {
          background: linear-gradient(180deg, rgba(var(--tone), 0.16), rgba(var(--tone), 0.05));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(var(--tone), 0.45), 0 6px 16px -6px rgba(var(--tone), 0.55);
        }
        .rp-studio .rp-voice[data-on="true"] small { color: #a5b4c8; }
        .rp-studio .rp-vwave { flex: none; display: flex; align-items: center; gap: 2px; width: 22px; height: 22px; }
        .rp-studio .rp-vwave i { flex: 1; height: 100%; border-radius: 2px; background: rgba(var(--tone), 0.45); transform: scaleY(0.35); }
        .rp-studio .rp-vwave i:nth-child(2), .rp-studio .rp-vwave i:nth-child(4) { transform: scaleY(0.7); }
        .rp-studio .rp-vwave i:nth-child(3) { transform: scaleY(1); }
        .rp-studio .rp-voice[data-on="true"] .rp-vwave i {
          background: rgb(var(--tone)); box-shadow: 0 0 6px rgba(var(--tone), 0.7);
          animation: rp-vwave 1.1s ease-in-out infinite;
        }
        .rp-studio .rp-voice[data-on="true"] .rp-vwave i:nth-child(2) { animation-delay: -0.25s; }
        .rp-studio .rp-voice[data-on="true"] .rp-vwave i:nth-child(3) { animation-delay: -0.5s; }
        .rp-studio .rp-voice[data-on="true"] .rp-vwave i:nth-child(4) { animation-delay: -0.75s; }
        .rp-studio .rp-voice[data-on="true"] .rp-vwave i:nth-child(5) { animation-delay: -0.4s; }
        @keyframes rp-vwave { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
        .rp-studio .rp-cmeter { height: 3px; margin: 0 2px 8px; border-radius: 2px; background: rgba(255, 255, 255, 0.06); overflow: hidden; }
        .rp-studio .rp-cmeter i {
          display: block; height: 100%; border-radius: inherit;
          background: linear-gradient(90deg, rgba(var(--cy), 0.9), rgba(var(--vi), 0.9)); transition: width 160ms;
        }
        .rp-studio .rp-cmeter[data-over="true"] i { background: #f87171; }
        @media (prefers-reduced-motion: reduce) { .rp-studio .rp-vwave i { animation: none !important; } }
        @media (max-width: 420px) { .rp-studio .rp-voices { grid-template-columns: minmax(0, 1fr); } }
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
          .rp-studio { flex-direction: column; height: auto; overflow: visible; padding: 12px 14px 112px; gap: 14px; margin-bottom: 0; }
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
