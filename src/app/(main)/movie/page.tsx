"use client";

/**
 * /movie — โหมดหนัง and โหมด MV.
 *
 * Film: a story → AI splits it into shots (framing, camera, Thai line) → the
 * customer edits → each shot is rendered with its character's picture as the
 * first frame, on the model they pick per shot.
 * MV: a song (uploaded, or made here) + its full lyrics + a mood → shots laid
 * along the song's timeline → edit → render.
 *
 * Every shot is an ordinary studio order (/api/story/[id]/render), so it is
 * charged, refunded and shown in the gallery like one. Joining the shots into
 * one film is phase 2.
 *
 * A project keeps a reference library (characters, props, places — each with
 * pictures), is told in acts → scenes → shots, and each shot may open on a
 * picture composed from its references by an image model that takes several
 * (src/lib/story/library.ts). Every act, scene and shot re-plans and
 * re-renders on its own.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHero } from "@/components/xdreamer/page-hero";
import { useToast } from "@/components/ui/toast-provider";
import { loginHref } from "@/lib/safe-callback";
import { ASPECTS, CAMERA_MOVES, FILM_LENGTHS, LIMITS, LOOKS, MOODS, SHOT_SIZES, safeCamera } from "@/lib/story/cinematic";
import { CameraPreview } from "@/components/camera-preview/CameraPreview";
import { isCameraMoveId, isShotSizeId, MOVE_HINTS, SIZE_HINTS } from "@/lib/camera-shots";
import { useLocale, useT } from "@/lib/i18n/client";
import { formatCredits, formatDate, formatNumber, type Msg } from "@/lib/i18n/locale";
import { KaraokeStage, karaokeProgressText, karaokeWorking, useKaraoke } from "@/components/xdreamer/karaoke";
import { KARAOKE_POSITIONS, KARAOKE_THEMES, type KaraokeLook, type KaraokePosition, type KaraokeTheme } from "@/lib/lyrics/karaoke-look";

interface Character {
  id?: number;
  name: string;
  description: string;
  referenceUrl: string | null;
}
type AssetKind = "character" | "prop" | "location";
interface Asset {
  id: number;
  kind: AssetKind;
  name: string;
  description: string;
  pictures: string[];
  origin: string;
  image: { state: "rendering" | "done" | "failed" | null; error: string | null };
}
interface Act {
  id: number;
  number: number;
  title: string;
  summary: string;
}
interface Scene {
  id: number;
  actId: number | null;
  number: number;
  title: string;
  summary: string;
  locationId: number | null;
  timeOfDay: string | null;
}
interface PictureModel {
  id: number;
  key: string;
  name: string;
  refs: number;
  label: string;
  orderable: boolean;
  reason: string | null;
  credits: number;
}
interface Pictures {
  keyframeModelId: number | null;
  pictureModelId: number | null;
  models: PictureModel[];
  times: Record<string, string>;
  kinds: Record<AssetKind, { label: string; one: string; max: number }>;
  maxPictures: number;
}
interface Shot {
  id: number;
  number: number;
  sceneId: number | null;
  propIds: number[];
  /** The shot's own place; null = its scene's. */
  locationId: number | null;
  /** The opening picture composed from the shot's references. */
  keyframe: {
    state: "rendering" | "done" | "failed" | null;
    url: string | null;
    error: string | null;
    use: boolean;
    wanted: number;
    sent: number;
  };
  visual: string;
  line: string;
  sound: string;
  shotSize: string;
  camera: string;
  durationSec: number;
  startSec: number | null;
  characterIds: number[];
  speakerId: number | null;
  modelId: number | null;
  credits: number | null;
  status: "pending" | "rendering" | "done" | "failed";
  mediaUrl: string | null;
  generationId: number | null;
  error: string | null;
  /** MV only: the shot re-dubbed to its slice of the song's vocal. */
  lipsync?: {
    state: "none" | "rendering" | "done" | "stale" | "failed";
    url: string | null;
    error: string | null;
    use: boolean;
    blocked: string | null;
    credits: number | null;
    suggested: boolean;
  };
}
interface Project {
  id: number;
  mode: "film" | "mv";
  title: string;
  brief: string;
  look: string;
  /** Film: a FILM_LENGTHS key. */
  filmLength: string | null;
  mood: string | null;
  aspect: string;
  songUrl: string | null;
  songSeconds: number | null;
  status: string;
  characters: (Character & { id: number })[];
  library: Asset[];
  acts: Act[];
  scenes: Scene[];
  shots: Shot[];
}
interface Model {
  id: number;
  key: string;
  name: string;
  orderable: boolean;
  /** What pictures it takes, in the visitor's language (reference-caps.ts). */
  references: string;
}
interface EditSettings {
  clipAudio: boolean;
  clipVolume: number;
  music: "off" | "song" | "generate";
  musicVolume: number;
  duck: boolean;
  subtitles: boolean;
  coverFakeSubs: boolean;
  transition: "cut" | "fade";
  titleCard: boolean;
  lipsync: boolean;
  /** MV: the lyrics swept word by word as they are sung, instead of plain subtitles. */
  karaoke: boolean;
  karaokeLook: KaraokeLook;
  karaokeAudio: "song" | "instrumental";
}
interface Vocals {
  state: "none" | "separating" | "done" | "failed" | "stale";
  source: "upload" | "separated" | null;
  url: string | null;
  error: string | null;
  auto: boolean;
  dubbing: boolean;
}
interface ProjectView {
  project: Project;
  models: Model[];
  edit: EditSettings;
  music: { available: boolean; credits: number | null; stale: boolean; status: "none" | "rendering" | "done" | "failed"; url: string | null };
  film: { status: "none" | "assembling" | "done"; credits: number; url: string | null; seconds: number | null; error: string | null };
  vocals: Vocals | null;
  pictures: Pictures;
  /** A plan running after the response, or the last plan's outcome. */
  planning: { state: "planning" | "failed" | "done"; error: string | null; shots: number | null; rules: boolean } | null;
}
interface ProjectRow {
  id: number;
  mode: "film" | "mv";
  title: string;
  status: string;
  aspect: string;
  updatedAt: string;
  cover: string | null;
  shots: number;
}
interface Song {
  id: number;
  /** Which take of the order (Suno makes two). */
  track: number;
  title: string;
  url: string;
  lyrics: string;
}

const card: React.CSSProperties = {
  padding: 20,
  borderRadius: 18,
  background: "rgba(15,23,42,0.5)",
  border: "1px solid rgba(255,255,255,0.06)",
  backdropFilter: "blur(18px)",
};
const btn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "inherit",
};
const primary: React.CSSProperties = {
  ...btn,
  background: "linear-gradient(135deg, rgba(168,85,247,0.85), rgba(236,72,153,0.85))",
  border: "1px solid rgba(255,255,255,0.2)",
  fontWeight: 600,
};
const field: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 10,
  background: "rgba(2,6,23,0.55)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#fff",
  fontFamily: "inherit",
  fontSize: 14,
  boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" };
const chip = (on: boolean): React.CSSProperties => ({
  ...btn,
  padding: "7px 12px",
  background: on ? "rgba(168,85,247,0.35)" : "rgba(255,255,255,0.04)",
  border: on ? "1px solid rgba(216,180,254,0.7)" : "1px solid rgba(255,255,255,0.1)",
});

const STATUS_LABEL: Record<Shot["status"], { text: Msg; color: string }> = {
  pending: { text: { th: "ยังไม่สร้าง", en: "Not made yet" }, color: "#94a3b8" },
  rendering: { text: { th: "กำลังสร้าง…", en: "Making…" }, color: "#fbbf24" },
  done: { text: { th: "เสร็จแล้ว", en: "Done" }, color: "#34d399" },
  failed: { text: { th: "ไม่สำเร็จ", en: "Failed" }, color: "#f87171" },
};

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** An English count with its noun: "1 shot", "3 shots". Thai has no plural. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const RULES_PLANNER: Msg = {
  th: "ใช้ตัววางช็อตพื้นฐาน (ผู้ช่วย AI ไม่ว่าง) แก้ไขแต่ละช็อตได้ตามต้องการ",
  en: "Planned by the basic planner (the AI assistant was busy) — edit any shot as you like",
};
const FAILED: Msg = { th: "ไม่สำเร็จ", en: "That didn't work" };
const OFFLINE: Msg = { th: "เชื่อมต่อไม่ได้", en: "Couldn't connect" };

/* Network calls return failures as values — see the React Compiler note in referral/page.tsx. */
// The server's error is already in the visitor's language; our own fallbacks are pairs.
async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string | Msg }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json();
    return res.ok ? { ok: true, data: data as T } : { ok: false, error: data.error ? String(data.error) : FAILED };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

const sendJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function uploadFile(file: File, kind: "image" | "audio") {
  const form = new FormData();
  form.append("file", file);
  return getJson<{ url: string; durationSeconds: number | null }>(`/api/uploads?kind=${kind}`, { method: "POST", body: form });
}

// ─── Characters ─────────────────────────────────────────────────────────

function CharacterEditor({ value, onChange }: { value: Character[]; onChange: (next: Character[]) => void }) {
  const { toast } = useToast();
  const t = useT();
  const [uploading, setUploading] = useState<number | null>(null);
  const set = (k: number, patch: Partial<Character>) => onChange(value.map((c, i) => (i === k ? { ...c, ...patch } : c)));

  const pick = async (k: number, file: File | undefined) => {
    if (!file) return;
    setUploading(k);
    const r = await uploadFile(file, "image");
    setUploading(null);
    if (!r.ok) toast("error", t(r.error));
    else set(k, { referenceUrl: r.data.url });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {value.map((c, k) => (
        <div key={c.id ?? `new-${k}`} style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <label style={{ width: 96, height: 96, borderRadius: 12, overflow: "hidden", flexShrink: 0, cursor: "pointer", background: "rgba(2,6,23,0.55)", border: "1px dashed rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
            {c.referenceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.referenceUrl} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : uploading === k ? t("กำลังอัปโหลด…", "Uploading…") : t("อัปโหลดภาพ\nหน้าตรง", "Upload a\nfront-on photo")}
            <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => pick(k, e.target.files?.[0])} />
          </label>
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
            <input style={field} maxLength={LIMITS.characterName} placeholder={t("ชื่อตัวละคร", "Character name")} value={c.name} onChange={(e) => set(k, { name: e.target.value })} />
            <input style={field} maxLength={LIMITS.characterDescription} placeholder={t("หน้าตา การแต่งกาย (อังกฤษได้ผลดีที่สุด) เช่น young woman, pink twin tails, red dress", "Looks and clothing, e.g. young woman, pink twin tails, red dress")} value={c.description} onChange={(e) => set(k, { description: e.target.value })} />
          </div>
          <button style={{ ...btn, padding: "6px 10px" }} onClick={() => onChange(value.filter((_, i) => i !== k))} title={t("เอาตัวละครนี้ออก", "Remove this character")}>✕</button>
        </div>
      ))}
      {value.length < LIMITS.characters && (
        <button style={{ ...btn, alignSelf: "flex-start" }} onClick={() => onChange([...value, { name: "", description: "", referenceUrl: null }])}>
          {t("+ เพิ่มตัวละคร", "+ Add character")}
        </button>
      )}
      <div style={{ fontSize: 12, color: "#94a3b8" }}>
        {t(
          "ภาพตัวละครจะเป็นเฟรมแรกของทุกช็อตที่ตัวละครนั้นนำ หน้าจึงเหมือนเดิมทุกช็อต — ใช้ภาพหน้าตรง เห็นหน้าชัด ระยะครึ่งตัวหรือใกล้กว่า",
          "A character's picture is the first frame of every shot they lead, so their face stays the same in every shot — use a front-on photo with the face clearly visible, waist-up or closer"
        )}
      </div>
    </div>
  );
}

// ─── New project ────────────────────────────────────────────────────────

function NewProject({ onCreated, fromSong }: { onCreated: (id: number) => void; fromSong?: { id: number; track: number } | null }) {
  const { toast } = useToast();
  const t = useT();
  const { locale } = useLocale();
  // From the studio's "ทำ MV คาราโอเกะ": an MV of that song, picked once the list is in.
  const [mode, setMode] = useState<"film" | "mv">(fromSong ? "mv" : "film");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [look, setLook] = useState("film");
  const [filmLength, setFilmLength] = useState("auto");
  const [mood, setMood] = useState("romantic");
  const [aspect, setAspect] = useState("16:9");
  const [characters, setCharacters] = useState<Character[]>([{ name: "", description: "", referenceUrl: null }]);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [song, setSong] = useState<{ kind: "upload"; url: string; name: string; seconds: number | null } | { kind: "mine"; id: number; track: number; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingSong, setUploadingSong] = useState(false);

  useEffect(() => {
    if (mode !== "mv" || songs) return;
    let active = true;
    getJson<{ songs: Song[] }>("/api/story/songs").then((r) => {
      if (!active) return;
      const list = r.ok ? r.data.songs : [];
      setSongs(list);
      const wanted = fromSong ? list.find((s) => s.id === fromSong.id && s.track === fromSong.track) : undefined;
      if (wanted) {
        setSong({ kind: "mine", id: wanted.id, track: wanted.track, title: wanted.title });
        setBrief((b) => b.trim() ? b : wanted.lyrics);
      }
    });
    return () => {
      active = false;
    };
  }, [mode, songs, fromSong]);

  const pickSong = async (file: File | undefined) => {
    if (!file) return;
    setUploadingSong(true);
    const r = await uploadFile(file, "audio");
    setUploadingSong(false);
    if (!r.ok) return toast("error", t(r.error));
    setSong({ kind: "upload", url: r.data.url, name: file.name, seconds: r.data.durationSeconds });
  };

  const chooseMine = (s: Song) => {
    setSong({ kind: "mine", id: s.id, track: s.track, title: s.title });
    // Fill the lyrics the song was made with, but never over the customer's own.
    if (s.lyrics && !brief.trim()) setBrief(s.lyrics);
  };

  const create = async () => {
    if (busy) return;
    if (mode === "mv" && !song) return toast("error", t("เลือกเพลงก่อน", "Pick a song first"));
    if (!brief.trim()) return toast("error", mode === "mv" ? t("ใส่เนื้อเพลงให้ครบก่อน", "Add the full lyrics first") : t("เขียนเรื่องย่อก่อน", "Write the story first"));
    setBusy(true);
    const r = await getJson<{ id: number }>(
      "/api/story",
      sendJson("POST", {
        mode,
        title,
        brief,
        look,
        filmLength: mode === "film" ? filmLength : undefined,
        mood,
        aspect,
        characters: characters.filter((c) => c.name.trim() || c.referenceUrl),
        song: song?.kind === "upload" ? { uploadUrl: song.url } : song?.kind === "mine" ? { generationId: song.id, track: song.track } : undefined,
      })
    );
    setBusy(false);
    if (!r.ok) return toast("error", t(r.error));
    onCreated(r.data.id);
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={chip(mode === "film")} onClick={() => setMode("film")}>{t("🎬 โหมดหนัง", "🎬 Film mode")}</button>
        <button style={chip(mode === "mv")} onClick={() => setMode("mv")}>{t("🎵 โหมด MV", "🎵 MV mode")}</button>
      </div>

      <div>
        <span style={label}>{t("ชื่อโปรเจกต์ (เว้นว่างได้ AI จะตั้งให้)", "Project name (optional — AI will name it)")}</span>
        <input style={field} maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {mode === "mv" && (
        <div>
          <span style={label}>{t(`เพลง (ยาวไม่เกิน ${LIMITS.maxSongSeconds / 60} นาที)`, `Song (up to ${LIMITS.maxSongSeconds / 60} minutes)`)}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ ...btn, display: "inline-block" }}>
              {uploadingSong ? t("กำลังอัปโหลด…", "Uploading…") : t("อัปโหลดเพลงเอง", "Upload your own song")}
              <input type="file" accept="audio/*" style={{ display: "none" }} onChange={(e) => pickSong(e.target.files?.[0])} />
            </label>
            {song && (
              <span style={{ fontSize: 13, color: "#d8b4fe" }}>
                ✓ {song.kind === "upload" ? `${song.name}${song.seconds ? ` · ${fmtTime(song.seconds)}` : ""}` : song.title}
              </span>
            )}
          </div>
          {songs && songs.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{t("หรือเลือกเพลงที่สร้างบนเว็บ:", "Or pick a song you made here:")}</span>
              {songs.map((s) => (
                <button key={`${s.id}-${s.track}`} style={{ ...chip(song?.kind === "mine" && song.id === s.id && song.track === s.track), textAlign: "left" }} onClick={() => chooseMine(s)}>
                  🎵 {s.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <span style={label}>
          {mode === "mv"
            ? t("เนื้อเพลงฉบับเต็ม — ใส่ [Verse] [Chorus] [Solo] ได้ ระบบวางช็อตตามจังหวะเพลง", "Full lyrics — [Verse] [Chorus] [Solo] tags are fine; shots are laid out along the song")
            : t("เรื่องย่อหรือบท — ใส่บทพูดใน \"เครื่องหมายคำพูด\" ตัวละครจะพูดเป็นภาษาไทย", "Story or script — put spoken lines in \"quotation marks\" and the characters will say them")}
        </span>
        <textarea style={{ ...field, minHeight: 180, resize: "vertical" }} maxLength={LIMITS.brief} value={brief} onChange={(e) => setBrief(e.target.value)} />
        <div style={{ fontSize: 11, color: "#64748b", textAlign: "right" }}>{formatNumber(brief.length, locale)} / {formatNumber(LIMITS.brief, locale)}</div>
      </div>

      {mode === "mv" ? (
        <div>
          <span style={label}>{t("อารมณ์ MV", "MV mood")}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(MOODS).map(([key, m]) => (
              <button key={key} style={chip(mood === key)} onClick={() => setMood(key)}>{t(m.label)}</button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <span style={label}>{t("สไตล์ภาพ", "Visual style")}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(LOOKS).map(([key, l]) => (
              <button key={key} style={chip(look === key)} onClick={() => setLook(key)}>{t(l.label)}</button>
            ))}
          </div>
        </div>
      )}

      {mode === "film" && (
        <div>
          <span style={label}>{t("ความยาวหนัง", "Film length")}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(FILM_LENGTHS).map(([key, l]) => (
              <button key={key} style={chip(filmLength === key)} onClick={() => setFilmLength(key)}>{t(l.label)}</button>
            ))}
          </div>
          {FILM_LENGTHS[filmLength]?.seconds && (
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
              {t(
                `ประมาณ ${Math.round(FILM_LENGTHS[filmLength].seconds! / 8)} ช็อต · AI แต่งเรื่องเพิ่มจากเรื่องย่อให้ยาวพอ · คิดเครดิตตอนสร้างแต่ละช็อต`,
                `About ${Math.round(FILM_LENGTHS[filmLength].seconds! / 8)} shots · AI extends the story to fill the length · credits are charged as each shot is made`
              )}
            </p>
          )}
        </div>
      )}

      <div>
        <span style={label}>{t("สัดส่วนภาพ", "Aspect ratio")}</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(ASPECTS).map(([key, a]) => (
            <button key={key} style={chip(aspect === key)} onClick={() => setAspect(key)}>{t(a.label)}</button>
          ))}
        </div>
      </div>

      <div>
        <span style={label}>{mode === "mv" ? t("นักร้อง / ตัวละครใน MV", "Singers / characters in the MV") : t("ตัวละคร", "Characters")}</span>
        <CharacterEditor value={characters} onChange={setCharacters} />
      </div>

      <button style={{ ...primary, alignSelf: "flex-start", opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={create}>
        {busy
          ? mode === "mv" ? t("กำลังอ่านเพลง…", "Reading the song…") : t("กำลังสร้าง…", "Creating…")
          : t("สร้างโปรเจกต์ (ยังไม่ตัดเครดิต)", "Create project (no credits charged yet)")}
      </button>
    </div>
  );
}

// ─── One shot ───────────────────────────────────────────────────────────

/**
 * The shot's size and camera move played on a small 3D scene, so the two
 * dropdowns above it show what they mean. It plays the camera the shot will
 * really get: a push-in that `safeCamera` holds still is shown held still.
 */
function ShotCameraPreview({ shotSize, camera, ledByCharacter }: { shotSize: string; camera: string; ledByCharacter: boolean }) {
  const t = useT();
  const used = safeCamera(shotSize, camera, ledByCharacter);
  const move = isCameraMoveId(used) ? used : "static";
  const size = isShotSizeId(shotSize) ? shotSize : undefined;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <CameraPreview shot={{ move, size }} style={{
        width: 192, aspectRatio: "16 / 9", display: "block", borderRadius: 10, flexShrink: 0,
        background: "linear-gradient(180deg, #0b1030 0%, #2b2a7a 55%, #5a2a7e 100%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
      }} />
      <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6, minWidth: 0, flex: "1 1 180px" }}>
        <div style={{ color: "#e2e8f0" }}>
          {SHOT_SIZES[shotSize] ? t(SHOT_SIZES[shotSize].label) : shotSize} · {CAMERA_MOVES[move] ? t(CAMERA_MOVES[move].label) : move}
        </div>
        <div>{size ? t(SIZE_HINTS[size]) : ""}{size ? " · " : ""}{t(MOVE_HINTS[move])}</div>
        {used !== camera && (
          <div style={{ color: "#fbbf24" }}>
            {t(
              "ช็อตกว้างที่เปิดด้วยตัวละครจะใช้กล้องนิ่งแทนการดันเข้า เพื่อให้หน้าตัวละครไม่เพี้ยน",
              "A wide shot that opens on a character keeps the camera still instead of pushing in, so the face doesn't drift"
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ShotCard({
  shot,
  project,
  models,
  onSave,
  onRender,
  onDelete,
  vocals,
  onLipsync,
  onDubUse,
  pictures,
  onKeyframe,
  onKeyframeUse,
}: {
  shot: Shot;
  project: Project;
  models: Model[];
  onSave: (patch: Partial<Shot>) => Promise<boolean>;
  onRender: () => void;
  onDelete: () => void;
  vocals: Vocals | null;
  onLipsync: () => void;
  onDubUse: (use: boolean) => void;
  pictures: Pictures;
  onKeyframe: () => void;
  onKeyframeUse: (use: boolean) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [draft, setDraft] = useState(shot);
  const [saving, setSaving] = useState(false);
  // The server copy the draft started from. A fresh copy (polling, another
  // shot saved) replaces the draft only when the customer has not edited it,
  // or right after their own save — so typing is never wiped by a poll.
  const base = useRef(shot);
  const takeNext = useRef(false);
  useEffect(() => {
    if (shot === base.current) return;
    const untouched = sameEdit(draft, base.current);
    base.current = shot;
    if (untouched || takeNext.current) {
      takeNext.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(shot);
    }
  }, [shot, draft]);
  const dirty = !sameEdit(draft, shot);

  const locked = shot.status === "rendering";
  const set = (patch: Partial<Shot>) => setDraft((d) => ({ ...d, ...patch }));
  const save = async () => {
    setSaving(true);
    takeNext.current = true;
    const ok = await onSave(pickEditable(draft));
    if (!ok) takeNext.current = false;
    setSaving(false);
  };
  const model = models.find((m) => m.id === draft.modelId);
  const st = STATUS_LABEL[shot.status];
  const toggleCast = (id: number) =>
    set({ characterIds: draft.characterIds.includes(id) ? draft.characterIds.filter((x) => x !== id) : [...draft.characterIds, id] });
  const toggleProp = (id: number) => set({ propIds: draft.propIds.includes(id) ? draft.propIds.filter((x) => x !== id) : [...draft.propIds, id] });
  const props = project.library.filter((a) => a.kind === "prop");
  const places = project.library.filter((a) => a.kind === "location");
  const scenePlace = places.find((a) => a.id === project.scenes.find((sc) => sc.id === shot.sceneId)?.locationId);
  const kf = shot.keyframe;
  const kfBusy = kf.state === "rendering";
  const keyModel = pictures.models.find((m) => m.id === pictures.keyframeModelId);

  return (
    <div style={{ ...card, padding: 16, display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600 }}>
          {t(`ช็อต ${shot.number}`, `Shot ${shot.number}`)}
          {project.mode === "mv" && shot.startSec !== null && (
            <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 12 }}> · {fmtTime(shot.startSec)}–{fmtTime(shot.startSec + shot.durationSec)}</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: st.color }}>{t(st.text)}</span>
      </div>

      {shot.mediaUrl && (
        <video src={shot.mediaUrl} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: 360, borderRadius: 12, background: "#000" }} />
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", padding: 10, borderRadius: 12, background: "rgba(2,6,23,0.35)" }}>
        <div style={{ width: 160, aspectRatio: project.aspect.replace(":", " / "), maxHeight: 200, borderRadius: 10, overflow: "hidden", background: "rgba(2,6,23,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b", textAlign: "center", flexShrink: 0 }}>
          {kf.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={kf.url} target="_blank" rel="noreferrer"><img src={kf.url} alt={t("ภาพเปิดช็อต", "Opening picture")} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></a>
          ) : kf.state === "rendering" ? t("กำลังสร้างภาพเปิด…", "Making the opening picture…") : t("ยังไม่มีภาพเปิด", "No opening picture yet")}
        </div>
        <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#94a3b8" }}>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{t("ภาพเปิดช็อต", "Opening picture")}</div>
          <div>
            {t("รวมตัวละคร ของ และสถานที่ของช็อตเป็นภาพเดียว แล้วคลิปเริ่มจากภาพนี้", "Puts the shot's characters, props and place into one picture; the clip starts from it")}
            {kf.wanted > 0 && keyModel
              ? t(
                  ` · ส่งภาพอ้างอิง ${kf.sent}/${kf.wanted} ภาพ (${keyModel.name} ${keyModel.label.replace("รับภาพอ้างอิงได้ ", "รับได้ ")})`,
                  ` · sending ${kf.sent}/${kf.wanted} reference pictures (${keyModel.name} takes up to ${keyModel.refs})`
                )
              : kf.wanted === 0
                ? t(" · ช็อตนี้ยังไม่มีภาพอ้างอิง (ใส่ภาพในคลังก่อน)", " · this shot has no reference pictures yet (add some to the library first)")
                : ""}
          </div>
          {kf.state === "failed" && kf.error && <div style={{ color: "#fca5a5" }}>{kf.error}</div>}
          {kf.url && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={kf.use} disabled={locked} onChange={(e) => onKeyframeUse(e.target.checked)} />
              {t("ใช้ภาพนี้เป็นเฟรมแรกของคลิป (ปิด = ใช้ภาพตัวละครนำ)", "Use this picture as the clip's first frame (off = the lead character's picture)")}
            </label>
          )}
          <div>
            <button
              style={{ ...btn, padding: "6px 12px", opacity: !keyModel || kf.state === "rendering" || dirty ? 0.5 : 1 }}
              disabled={!keyModel || kf.state === "rendering" || dirty}
              title={
                !keyModel
                  ? t("ยังไม่มีโมเดลภาพที่รับภาพอ้างอิงเปิดให้ใช้", "No image model that takes reference pictures is open yet")
                  : dirty ? t("บันทึกการแก้ไขก่อน", "Save your changes first") : undefined
              }
              onClick={onKeyframe}
            >
              {kf.state === "rendering" ? t("กำลังสร้าง…", "Making…") : kf.url ? t("🖼 สร้างภาพเปิดใหม่", "🖼 Remake opening picture") : t("🖼 สร้างภาพเปิด", "🖼 Make opening picture")}
              {keyModel && ` · ${formatCredits(keyModel.credits, locale)}`}
            </button>
          </div>
        </div>
      </div>
      {shot.status === "failed" && shot.error && <div style={{ fontSize: 13, color: "#fca5a5" }}>{shot.error}</div>}
      {shot.lipsync && shot.status === "done" && <DubRow shot={shot} vocals={vocals} onLipsync={onLipsync} onDubUse={onDubUse} />}

      <fieldset disabled={locked} style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, opacity: locked ? 0.6 : 1 }}>
        <div>
          <span style={label}>{t("ภาพที่เห็น (อังกฤษได้ผลดีที่สุด)", "What we see")}</span>
          <textarea style={{ ...field, minHeight: 70, resize: "vertical" }} maxLength={LIMITS.visual} value={draft.visual} onChange={(e) => set({ visual: e.target.value })} />
        </div>
        <div>
          <span style={label}>{project.mode === "mv"
            ? t("เนื้อเพลงช่วงนี้ (ใช้เป็นข้อมูล ไม่ให้โมเดลร้อง)", "Lyrics for this part (for reference — the model doesn't sing them)")
            : t("บทพูด (ภาษาไทย เว้นว่าง = ไม่มีพูด)", "Spoken line (leave blank for no dialogue)")}</span>
          <input style={field} maxLength={LIMITS.line} value={draft.line} onChange={(e) => set({ line: e.target.value })} />
        </div>
        {project.mode === "film" && (
          <div>
            <span style={label}>{t("เสียงประกอบ", "Sound effects")}</span>
            <input style={field} maxLength={LIMITS.sound} placeholder={t("เช่น ฝนตก ลมพัด เสียงเทียนไหม้", "e.g. rain, wind, a candle crackling")} value={draft.sound} onChange={(e) => set({ sound: e.target.value })} />
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div>
            <span style={label}>{t("ระยะภาพ", "Shot size")}</span>
            <select style={field} value={draft.shotSize} onChange={(e) => set({ shotSize: e.target.value })}>
              {Object.entries(SHOT_SIZES).map(([k, s]) => <option key={k} value={k}>{t(s.label)}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>{t("กล้อง", "Camera")}</span>
            <select style={field} value={draft.camera} onChange={(e) => set({ camera: e.target.value })}>
              {Object.entries(CAMERA_MOVES).map(([k, c]) => <option key={k} value={k}>{t(c.label)}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>{t("ความยาว (วินาที)", "Length (seconds)")}</span>
            <input style={field} type="number" min={LIMITS.minShotSeconds} max={LIMITS.maxShotSeconds} step={project.mode === "mv" ? 0.5 : 1} value={draft.durationSec} onChange={(e) => set({ durationSec: Number(e.target.value) })} />
          </div>
          <div>
            <span style={label}>{t("โมเดล", "Model")}</span>
            <select style={field} value={draft.modelId ?? ""} onChange={(e) => set({ modelId: Number(e.target.value) || null })}>
              <option value="">{t("— เลือก —", "— Pick —")}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.orderable}>
                  {m.name} — {m.references}{m.orderable ? "" : t(" (ยังไม่เปิด)", " (not open yet)")}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ShotCameraPreview shotSize={draft.shotSize} camera={draft.camera} ledByCharacter={draft.characterIds.length > 0} />
        {project.characters.length > 0 && (
          <div>
            <span style={label}>{t("ตัวละครในช็อต (คนแรก = ภาพเฟรมแรก)", "Characters in the shot (the first one's picture is the first frame)")}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {project.characters.map((c) => (
                <button key={c.id} type="button" style={chip(draft.characterIds.includes(c.id))} onClick={() => toggleCast(c.id)}>
                  {draft.characterIds[0] === c.id ? "★ " : ""}{c.name}
                </button>
              ))}
              {project.mode === "film" && draft.line.trim() && (
                <select style={{ ...field, width: "auto" }} value={draft.speakerId ?? ""} onChange={(e) => set({ speakerId: Number(e.target.value) || null })}>
                  <option value="">{t("ผู้พูด: ไม่ระบุ", "Speaker: none")}</option>
                  {project.characters.filter((c) => draft.characterIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{t("ผู้พูด: ", "Speaker: ")}{c.name}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
        {props.length > 0 && (
          <div>
            <span style={label}>{t("ของ / อาวุธในช็อต", "Props / weapons in the shot")}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {props.map((a) => (
                <button key={a.id} type="button" style={chip(draft.propIds.includes(a.id))} onClick={() => toggleProp(a.id)}>{a.name}</button>
              ))}
            </div>
          </div>
        )}
        {places.length > 0 && (
          <div>
            <span style={label}>{t("สถานที่", "Place")}</span>
            <select style={field} value={draft.locationId ?? ""} onChange={(e) => set({ locationId: Number(e.target.value) || null })}>
              <option value="">{scenePlace ? t(`ตามฉาก (${scenePlace.name})`, `Same as the scene (${scenePlace.name})`) : t("ไม่ระบุ", "None")}</option>
              {places.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
      </fieldset>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {dirty && !locked && (
          <button style={btn} disabled={saving} onClick={save}>{saving ? t("กำลังบันทึก…", "Saving…") : t("บันทึกการแก้ไข", "Save changes")}</button>
        )}
        <button
          style={{ ...primary, opacity: locked || dirty || kfBusy || !model?.orderable ? 0.5 : 1 }}
          disabled={locked || dirty || kfBusy || !model?.orderable}
          title={
            dirty
              ? t("บันทึกการแก้ไขก่อน", "Save your changes first")
              : kfBusy ? t("รอภาพเปิดช็อตเสร็จก่อน คลิปจะได้เริ่มจากภาพนั้น", "Wait for the opening picture, so the clip can start from it") : undefined
          }
          onClick={onRender}
        >
          {shot.status === "done" ? t("สร้างใหม่", "Remake") : shot.status === "failed" ? t("ลองอีกครั้ง", "Try again") : t("สร้างช็อตนี้", "Make this shot")}
          {shot.credits !== null && ` · ${formatCredits(shot.credits, locale)}`}
        </button>
        {shot.generationId && <Link href="/gallery" style={{ fontSize: 12, color: "#94a3b8" }}>{t("ดูในแกลเลอรี", "View in gallery")}</Link>}
        <span style={{ flex: 1 }} />
        <button style={{ ...btn, padding: "6px 10px", color: "#fca5a5" }} disabled={locked || kfBusy} onClick={onDelete}>{t("ลบช็อต", "Delete shot")}</button>
      </div>
    </div>
  );
}

/** One MV shot's lip-sync: its state, the dub, and the button that orders it. */
function DubRow({ shot, vocals, onLipsync, onDubUse }: { shot: Shot; vocals: Vocals | null; onLipsync: () => void; onDubUse: (use: boolean) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const dub = shot.lipsync!;
  const ready = vocals?.state === "done" && vocals.dubbing;
  const why =
    dub.blocked ??
    (!vocals?.dubbing
      ? t("ตัวลิปซิงก์ยังไม่เปิด", "Lip-sync isn't open yet")
      : vocals.state !== "done" ? t("แยกเสียงร้องก่อน (ส่วนลิปซิงก์ด้านบน)", "Separate the vocals first (lip-sync section above)") : null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 12, background: "rgba(2,6,23,0.4)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span>{t("🎤 ลิปซิงก์", "🎤 Lip-sync")}</span>
        {dub.state === "rendering" && <span style={{ color: "#fbbf24" }}>{t("กำลังทำ… (เปิดเครื่องครั้งแรกอาจนานหลายนาที)", "Working… (the first machine can take several minutes to start)")}</span>}
        {dub.state === "done" && <span style={{ color: "#34d399" }}>{t("เสร็จแล้ว", "Done")}</span>}
        {dub.state === "stale" && <span style={{ color: "#fbbf24" }}>{t("ช็อตถูกสร้างใหม่ — คลิปลิปซิงก์เดิมไม่ตรงแล้ว", "The shot was remade — the old lip-sync clip no longer matches")}</span>}
        {dub.state === "failed" && <span style={{ color: "#fca5a5" }}>{dub.error ?? t("ไม่สำเร็จ", "Failed")}</span>}
        {dub.state === "none" && !dub.suggested && <span style={{ color: "#64748b" }}>{t("ช็อตนี้ไม่ได้แนะนำ (ไม่มีเนื้อร้องหรือมุมกว้าง)", "Not suggested for this shot (no singing, or a wide angle)")}</span>}
        <span style={{ flex: 1 }} />
        {dub.state !== "rendering" && (
          <button style={{ ...btn, padding: "6px 12px", opacity: ready && !dub.blocked ? 1 : 0.5 }} disabled={!ready || Boolean(dub.blocked)} title={why ?? undefined} onClick={onLipsync}>
            {dub.state === "none" ? t("ลิปซิงก์ช็อตนี้", "Lip-sync this shot") : t("ทำใหม่", "Redo")}
            {dub.credits !== null && ` · ${formatCredits(dub.credits, locale)}`}
          </button>
        )}
      </div>
      {why && dub.state !== "rendering" && <div style={{ fontSize: 12, color: "#64748b" }}>{why}</div>}
      {dub.state === "done" && dub.url && (
        <>
          <video src={dub.url} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: 300, borderRadius: 10, background: "#000" }} />
          <Toggle on={dub.use} onChange={onDubUse} label={t("ใช้คลิปลิปซิงก์นี้ตอนตัดต่อ", "Use this lip-sync clip in the cut")}
            hint={t("ปิด = ใช้คลิปเดิมที่ไม่ได้ขยับปากตามเพลง", "Off = the original clip, without lips moving to the song")}
          />
        </>
      )}
    </div>
  );
}

function pickEditable(s: Shot) {
  return {
    visual: s.visual,
    line: s.line,
    sound: s.sound,
    shotSize: s.shotSize,
    camera: s.camera,
    durationSec: s.durationSec,
    characterIds: s.characterIds,
    speakerId: s.speakerId,
    modelId: s.modelId,
    propIds: s.propIds,
    locationId: s.locationId,
  };
}

const sameEdit = (a: Shot, b: Shot) => JSON.stringify(pickEditable(a)) === JSON.stringify(pickEditable(b));

// ─── Reference library ──────────────────────────────────────────────────

const KIND_ICON: Record<AssetKind, string> = { character: "🧑", prop: "🗡️", location: "🏞️" };
const KIND_HINT: Record<AssetKind, Msg> = {
  character: {
    th: "หน้าตา การแต่งกาย (อังกฤษได้ผลดีที่สุด) เช่น young Thai woman, long black hair, red silk dress",
    en: "Looks and clothing, e.g. young Thai woman, long black hair, red silk dress",
  },
  prop: { th: "รูปร่าง วัสดุ สี เช่น curved steel sword, gold hilt with a red tassel", en: "Shape, material, colour, e.g. curved steel sword, gold hilt with a red tassel" },
  location: {
    th: "บรรยากาศ สถาปัตยกรรม เช่น ruined stone temple in a misty jungle, moss on the steps",
    en: "Atmosphere and architecture, e.g. ruined stone temple in a misty jungle, moss on the steps",
  },
};

/** One library item: its pictures, its words, and an AI picture on demand. */
function AssetCard({ asset, pictures, busy, onAction }: { asset: Asset; pictures: Pictures; busy: string | null; onAction: (body: Record<string, unknown>, key: string) => Promise<boolean> }) {
  const { toast } = useToast();
  const t = useT();
  const { locale } = useLocale();
  const [name, setName] = useState(asset.name);
  const [desc, setDesc] = useState(asset.description);
  const [uploading, setUploading] = useState(false);
  const dirty = name !== asset.name || desc !== asset.description;
  const model = pictures.models.find((m) => m.id === pictures.pictureModelId);
  const drawing = asset.image.state === "rendering";
  const full = asset.pictures.length >= pictures.maxPictures;

  const setPictures = (list: string[]) => onAction({ action: "update", assetId: asset.id, pictures: list }, `asset-${asset.id}`);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const r = await uploadFile(file, "image");
    setUploading(false);
    if (!r.ok) return toast("error", t(r.error));
    await setPictures([...asset.pictures, r.data.url]);
  };
  const draw = async () => {
    if (!model) return toast("error", t("ยังไม่มีโมเดลภาพเปิดให้ใช้ตอนนี้", "No image model is open right now"));
    if (!desc.trim()) return toast("error", t("เขียนคำอธิบายรูปลักษณ์ก่อน AI จึงวาดได้", "Describe how it looks first, so AI can draw it"));
    const angle = asset.pictures.length > 0 ? t(" (มุมใหม่ ภาพเดิมยังอยู่)", " (a new angle; the current pictures stay)") : "";
    const ask = t(
      `ให้ AI วาดภาพ ${asset.name}${angle}? ใช้ ${model.credits} เครดิตด้วย ${model.name} (ถ้าไม่สำเร็จคืนเครดิตอัตโนมัติ)`,
      `Have AI draw ${asset.name}${angle}? Uses ${formatCredits(model.credits, locale)} with ${model.name} (refunded automatically if it fails)`
    );
    if (!confirm(ask)) return;
    if (await onAction({ action: "picture", assetId: asset.id }, `asset-${asset.id}`)) {
      toast("success", t("สั่งวาดแล้ว", "Drawing ordered"), t("ภาพจะขึ้นเองเมื่อเสร็จ", "The picture appears by itself when it's done"));
    }
  };
  const remove = async () => {
    const ask = t(
      `ลบ "${asset.name}" ออกจากคลัง? ช็อตและฉากที่ใช้อยู่จะไม่อ้างอิงรายการนี้อีก`,
      `Remove "${asset.name}" from the library? Shots and scenes that use it will no longer refer to it.`
    );
    if (!confirm(ask)) return;
    await onAction({ action: "delete", assetId: asset.id }, `asset-${asset.id}`);
  };

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", padding: 12, borderRadius: 14, background: "rgba(2,6,23,0.35)" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 360 }}>
        {asset.pictures.map((url, k) => (
          <div key={url} style={{ position: "relative", width: 76, height: 76, borderRadius: 10, overflow: "hidden", border: k === 0 ? "2px solid #c084fc" : "1px solid rgba(255,255,255,0.1)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={asset.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button type="button" title={t("ลบภาพนี้", "Delete this picture")} disabled={busy !== null} onClick={() => confirm(t("ลบภาพนี้?", "Delete this picture?")) && setPictures(asset.pictures.filter((u) => u !== url))} style={{ position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: 10, border: "none", background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
            {k > 0 && (
              <button type="button" title={t("ใช้เป็นภาพหลัก", "Make this the main picture")} disabled={busy !== null} onClick={() => setPictures([url, ...asset.pictures.filter((u) => u !== url)])} style={{ position: "absolute", bottom: 2, left: 2, padding: "1px 5px", borderRadius: 6, border: "none", background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 10, cursor: "pointer" }}>{t("★ หลัก", "★ Main")}</button>
            )}
          </div>
        ))}
        {!full && (
          <label style={{ width: 76, height: 76, borderRadius: 10, cursor: "pointer", border: "1px dashed rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
            {uploading ? t("กำลังอัปโหลด…", "Uploading…") : drawing ? t("AI กำลังวาด…", "AI is drawing…") : t("+ ภาพ", "+ Picture")}
            <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} disabled={uploading || busy !== null} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
        <input style={field} maxLength={LIMITS.characterName} placeholder={t("ชื่อ", "Name")} value={name} onChange={(e) => setName(e.target.value)} />
        <textarea style={{ ...field, minHeight: 56, resize: "vertical" }} maxLength={LIMITS.characterDescription} placeholder={t(KIND_HINT[asset.kind])} value={desc} onChange={(e) => setDesc(e.target.value)} />
        {asset.image.state === "failed" && asset.image.error && <div style={{ fontSize: 12, color: "#fca5a5" }}>{asset.image.error}</div>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {dirty && <button style={{ ...btn, padding: "6px 12px" }} disabled={busy !== null} onClick={() => onAction({ action: "update", assetId: asset.id, name, description: desc }, `asset-${asset.id}`)}>{t("บันทึก", "Save")}</button>}
          <button style={{ ...btn, padding: "6px 12px", opacity: dirty || drawing || full || !model ? 0.5 : 1 }} disabled={dirty || drawing || full || !model || busy !== null} title={dirty ? t("บันทึกก่อน", "Save first") : full ? t(`มีภาพครบ ${pictures.maxPictures} ภาพแล้ว`, `It already has ${pictures.maxPictures} pictures`) : undefined} onClick={draw}>
            {drawing ? t("AI กำลังวาด…", "AI is drawing…") : asset.pictures.length ? t("✨ ให้ AI วาดมุมใหม่", "✨ Have AI draw a new angle") : t("✨ ให้ AI วาดภาพ", "✨ Have AI draw it")}
            {model && ` · ${formatCredits(model.credits, locale)}`}
          </button>
          <span style={{ flex: 1 }} />
          <button style={{ ...btn, padding: "6px 10px", color: "#fca5a5" }} disabled={busy !== null || drawing} onClick={remove}>{t("ลบ", "Delete")}</button>
        </div>
      </div>
    </div>
  );
}

/** The project's library, and which image models compose and draw pictures. */
function LibraryPanel({ view, busy, onAction, onPictures }: {
  view: ProjectView;
  busy: string | null;
  onAction: (body: Record<string, unknown>, key: string) => Promise<boolean>;
  onPictures: (patch: Partial<Pick<Pictures, "keyframeModelId" | "pictureModelId">>) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [tab, setTab] = useState<AssetKind>("character");
  const pics = view.pictures;
  const items = view.project.library.filter((a) => a.kind === tab);
  const kind = pics.kinds[tab];
  const hasKeyModel = pics.models.some((m) => m.id === pics.keyframeModelId);
  return (
    <details style={card} open={view.project.library.length === 0 || undefined}>
      <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 600 }}>
        📚 {t("คลังอ้างอิง", "Reference library")}{" "}
        <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 400 }}>
          · {t("ตัวละคร", "Characters")} {view.project.library.filter((a) => a.kind === "character").length} · {t("ของ", "Props")}{" "}
          {view.project.library.filter((a) => a.kind === "prop").length} · {t("สถานที่", "Places")} {view.project.library.filter((a) => a.kind === "location").length}
        </span>
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {t(
            `ตัวละคร ของ/อาวุธ และสถานที่ที่ใช้ซ้ำทั้งเรื่อง ใส่ภาพไว้ (อัปโหลดเองหรือให้ AI วาด) แล้วระบบจะส่งภาพเหล่านี้ให้โมเดลรวมเป็น “ภาพเปิดช็อต” — หน้าตา ของ และฉากจึงเหมือนเดิมทุกช็อต รายการละไม่เกิน ${pics.maxPictures} ภาพ (ภาพแรก = ภาพหลัก)`,
            `The characters, props/weapons and places the whole story reuses. Give them pictures (your own uploads, or drawn by AI) and these are sent to the model to compose each shot's “opening picture” — so faces, props and settings stay the same in every shot. Up to ${pics.maxPictures} pictures per item (the first is the main one).`
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          <div>
            <span style={label}>{t("โมเดลรวมภาพเปิดช็อต (ต้องรับภาพอ้างอิงได้)", "Model that composes opening pictures (must take reference pictures)")}</span>
            <select style={field} value={pics.keyframeModelId ?? ""} disabled={busy !== null} onChange={(e) => onPictures({ keyframeModelId: Number(e.target.value) || null })}>
              {!hasKeyModel && <option value="">{t("— ยังไม่มีโมเดลที่ใช้ได้ —", "— No usable model yet —")}</option>}
              {pics.models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.orderable || m.refs === 0}>
                  {m.name} — {m.label} · {formatCredits(m.credits, locale)}{m.orderable ? "" : ` (${m.reason})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span style={label}>{t("โมเดลวาดภาพในคลัง", "Model that draws library pictures")}</span>
            <select style={field} value={pics.pictureModelId ?? ""} disabled={busy !== null} onChange={(e) => onPictures({ pictureModelId: Number(e.target.value) || null })}>
              {pics.pictureModelId === null && <option value="">{t("— ยังไม่มีโมเดลที่ใช้ได้ —", "— No usable model yet —")}</option>}
              {pics.models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.orderable}>
                  {m.name} — {m.label} · {formatCredits(m.credits, locale)}{m.orderable ? "" : ` (${m.reason})`}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!hasKeyModel && (
          <div style={{ fontSize: 12, color: "#fcd34d" }}>
            {t(
              "ตอนนี้ยังไม่มีโมเดลภาพที่รับภาพอ้างอิงเปิดให้ใช้ — คลิปจะเริ่มจากภาพตัวละครนำเหมือนเดิม (ของและสถานที่ใช้คำบรรยายแทน)",
              "No image model that takes reference pictures is open right now — clips start from the lead character's picture as before (props and places are described in words instead)"
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(pics.kinds) as AssetKind[]).map((k) => (
            <button key={k} type="button" style={chip(tab === k)} onClick={() => setTab(k)}>
              {KIND_ICON[k]} {pics.kinds[k].label} ({view.project.library.filter((a) => a.kind === k).length})
            </button>
          ))}
        </div>
        {items.length === 0 && (
          <div style={{ fontSize: 13, color: "#64748b" }}>
            {t(
              `ยังไม่มี${kind.label} — เพิ่มเอง หรือกด “✨ ให้ AI แตกช็อต” ให้ AI เสนอสถานที่และของสำคัญของเรื่องให้`,
              `No ${kind.label.toLowerCase()} yet — add your own, or press “✨ Have AI break it into shots” and AI will suggest the story's key places and props`
            )}
          </div>
        )}
        {items.map((a) => (
          <AssetCard key={`${a.id}:${a.name}:${a.description}`} asset={a} pictures={pics} busy={busy} onAction={onAction} />
        ))}
        {items.length < kind.max && (
          <button style={{ ...btn, alignSelf: "flex-start" }} disabled={busy !== null} onClick={() => onAction({ action: "add", kind: tab, name: "", description: "" }, "asset-add")}>
            {t(`+ เพิ่ม${kind.label}`, `+ Add ${kind.one.toLowerCase()}`)}
          </button>
        )}
      </div>
    </details>
  );
}

// ─── Acts and scenes ────────────────────────────────────────────────────

interface ScopeActions {
  busy: string | null;
  planning: boolean;
  onPlan: (sceneIds: number[], what: Msg) => void;
  onKeyframes: (shots: Shot[]) => void;
  onRender: (shots: Shot[]) => void;
}

const THIS_SCENE: Msg = { th: "ฉากนี้", en: "this scene" };
const WHOLE_ACT: Msg = { th: "ทั้งองก์", en: "the whole act" };

// A shot whose opening picture is still being made waits for it.
const renderableOf = (shots: Shot[]) => shots.filter((s) => (s.status === "pending" || s.status === "failed") && s.keyframe.state !== "rendering");

/** The buttons that act on every shot of a scene or an act. */
function ScopeButtons({ shots, sceneIds, what, actions, hasKeyModel }: { shots: Shot[]; sceneIds: number[]; what: Msg; actions: ScopeActions; hasKeyModel: boolean }) {
  const t = useT();
  const rendering = shots.some((s) => s.status === "rendering");
  const todo = renderableOf(shots);
  const small = { ...btn, padding: "5px 10px", fontSize: 12 };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {sceneIds.length > 0 && (
        <button style={small} disabled={actions.busy !== null || actions.planning || rendering} title={rendering ? t("รอช็อตที่กำลังสร้างให้เสร็จก่อน", "Wait for the shots being made to finish first") : undefined} onClick={() => actions.onPlan(sceneIds, what)}>
          {t(`✨ วางช็อต${what.th}ใหม่`, `✨ Re-plan ${what.en}`)}
        </button>
      )}
      {shots.length > 0 && hasKeyModel && (
        <button style={small} disabled={actions.busy !== null} onClick={() => actions.onKeyframes(shots)}>{t(`🖼 ภาพเปิดทั้ง${what.th}`, `🖼 Opening pictures for ${what.en}`)}</button>
      )}
      {todo.length > 0 && (
        <button style={small} disabled={actions.busy !== null} onClick={() => actions.onRender(todo)}>
          {t(`🎬 สร้างคลิปที่เหลือ ${todo.length} ช็อต`, `🎬 Make the remaining ${plural(todo.length, "clip")}`)}
        </button>
      )}
    </div>
  );
}

function SceneHeader({ scene, acts, places, times, shots, actions, hasKeyModel, onStructure, onAddShot }: {
  scene: Scene;
  acts: Act[];
  places: Asset[];
  times: Record<string, string>;
  shots: Shot[];
  actions: ScopeActions;
  hasKeyModel: boolean;
  onStructure: (body: Record<string, unknown>) => Promise<boolean>;
  onAddShot: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: scene.title, summary: scene.summary, locationId: scene.locationId, timeOfDay: scene.timeOfDay, actId: scene.actId });
  const place = places.find((a) => a.id === scene.locationId);
  const seconds = shots.reduce((n, s) => n + s.durationSec, 0);
  const save = async () => {
    if (await onStructure({ action: "update-scene", sceneId: scene.id, ...draft })) setEditing(false);
  };
  const remove = async () => {
    const rendering = shots.some((s) => s.status === "rendering");
    if (rendering) return alert(t("มีช็อตในฉากนี้กำลังสร้างอยู่ รอให้เสร็จก่อน", "A shot in this scene is being made. Wait for it to finish first."));
    const ask = shots.length
      ? t(
          `ลบฉาก ${scene.number} พร้อมช็อตในฉาก ${shots.length} ช็อต? (คลิปที่สร้างแล้วยังอยู่ในแกลเลอรี)`,
          `Delete scene ${scene.number} and its ${plural(shots.length, "shot")}? (Clips already made stay in your gallery.)`
        )
      : t(`ลบฉาก ${scene.number}?`, `Delete scene ${scene.number}?`);
    if (!confirm(ask)) return;
    await onStructure({ action: "delete-scene", sceneId: scene.id, withShots: true });
  };
  return (
    <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input style={field} maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t("ชื่อฉาก", "Scene title")} />
          <textarea style={{ ...field, minHeight: 60 }} maxLength={1200} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder={t("เกิดอะไรขึ้นในฉากนี้ (ใช้ตอนให้ AI วางช็อตใหม่)", "What happens in this scene (used when AI re-plans its shots)")} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            <select style={field} value={draft.locationId ?? ""} onChange={(e) => setDraft({ ...draft, locationId: Number(e.target.value) || null })}>
              <option value="">{t("สถานที่: ไม่ระบุ", "Place: none")}</option>
              {places.map((a) => <option key={a.id} value={a.id}>{t("สถานที่: ", "Place: ")}{a.name}</option>)}
            </select>
            <select style={field} value={draft.timeOfDay ?? ""} onChange={(e) => setDraft({ ...draft, timeOfDay: e.target.value || null })}>
              <option value="">{t("เวลา: ไม่ระบุ", "Time: none")}</option>
              {Object.entries(times).map(([k, time]) => <option key={k} value={k}>{t("เวลา: ", "Time: ")}{time}</option>)}
            </select>
            {acts.length > 0 && (
              <select style={field} value={draft.actId ?? ""} onChange={(e) => setDraft({ ...draft, actId: Number(e.target.value) || null })}>
                <option value="">{t("องก์: ไม่ระบุ", "Act: none")}</option>
                {acts.map((a) => <option key={a.id} value={a.id}>{t(`องก์ ${a.number}: `, `Act ${a.number}: `)}{a.title}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={primary} disabled={actions.busy !== null} onClick={save}>{t("บันทึกฉาก", "Save scene")}</button>
            <button style={btn} onClick={() => setEditing(false)}>{t("ยกเลิก", "Cancel")}</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600 }}>{t(`ฉาก ${scene.number}`, `Scene ${scene.number}`)} · {scene.title}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {place ? `📍 ${place.name}` : t("📍 ไม่ระบุสถานที่", "📍 No place set")}{scene.timeOfDay ? ` · ${times[scene.timeOfDay] ?? ""}` : ""} ·{" "}
              {t(`${shots.length} ช็อต`, plural(shots.length, "shot"))} {fmtTime(seconds)}
            </div>
            <span style={{ flex: 1 }} />
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12 }} onClick={() => setEditing(true)}>{t("✎ แก้ฉาก", "✎ Edit scene")}</button>
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12, color: "#fca5a5" }} disabled={actions.busy !== null} onClick={remove}>{t("ลบฉาก", "Delete scene")}</button>
          </div>
          {scene.summary && <div style={{ fontSize: 13, color: "#cbd5e1" }}>{scene.summary}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <ScopeButtons shots={shots} sceneIds={[scene.id]} what={THIS_SCENE} actions={actions} hasKeyModel={hasKeyModel} />
            <button style={{ ...btn, padding: "5px 10px", fontSize: 12 }} disabled={actions.busy !== null} onClick={onAddShot}>{t("+ ช็อตในฉากนี้", "+ Shot in this scene")}</button>
          </div>
        </>
      )}
    </div>
  );
}

function ActHeader({ act, shots, sceneIds, actions, hasKeyModel, onStructure }: {
  act: Act;
  shots: Shot[];
  sceneIds: number[];
  actions: ScopeActions;
  hasKeyModel: boolean;
  onStructure: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(act.title);
  const [summary, setSummary] = useState(act.summary);
  const save = async () => {
    if (await onStructure({ action: "update-act", actId: act.id, title, summary })) setEditing(false);
  };
  return (
    <div style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 8, borderColor: "rgba(56,189,248,0.25)" }}>
      {editing ? (
        <>
          <input style={field} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea style={{ ...field, minHeight: 56 }} maxLength={1200} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t("สรุปองก์", "Act summary")} />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={primary} disabled={actions.busy !== null} onClick={save}>{t("บันทึกองก์", "Save act")}</button>
            <button style={btn} onClick={() => setEditing(false)}>{t("ยกเลิก", "Cancel")}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#7dd3fc" }}>{t(`องก์ ${act.number}`, `Act ${act.number}`)} · {act.title}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {t(`${sceneIds.length} ฉาก · ${shots.length} ช็อต`, `${plural(sceneIds.length, "scene")} · ${plural(shots.length, "shot")}`)} ·{" "}
              {fmtTime(shots.reduce((n, s) => n + s.durationSec, 0))}
            </div>
            <span style={{ flex: 1 }} />
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12 }} onClick={() => setEditing(true)}>{t("✎ แก้องก์", "✎ Edit act")}</button>
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12 }} disabled={actions.busy !== null} onClick={() => onStructure({ action: "add-scene", actId: act.id })}>{t("+ ฉาก", "+ Scene")}</button>
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12, color: "#fca5a5" }} disabled={actions.busy !== null} onClick={() =>
                confirm(t(`ลบองก์ ${act.number}? ฉากและช็อตในองก์ยังอยู่ (ย้ายไปไม่ระบุองก์)`, `Delete act ${act.number}? Its scenes and shots stay (they move out of any act).`)) &&
                onStructure({ action: "delete-act", actId: act.id })
              }
            >
              {t("ลบองก์", "Delete act")}
            </button>
          </div>
          {act.summary && <div style={{ fontSize: 13, color: "#cbd5e1" }}>{act.summary}</div>}
          <ScopeButtons shots={shots} sceneIds={sceneIds} what={WHOLE_ACT} actions={actions} hasKeyModel={hasKeyModel} />
        </>
      )}
    </div>
  );
}

// ─── The cut (phase 2) ──────────────────────────────────────────────────

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, accentColor: "#a855f7", width: 16, height: 16 }} />
      <span>
        <span style={{ fontSize: 14 }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>{hint}</span>}
      </span>
    </label>
  );
}

function Volume({ value, onCommit, disabled }: { value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const t = useT();
  const [v, setV] = useState(value);
  const commit = () => v !== value && onCommit(v);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", marginLeft: 26, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ fontSize: 12, color: "#94a3b8" }}>{t("ความดัง", "Volume")}</span>
      <input type="range" min={0} max={1.5} step={0.05} value={v} disabled={disabled} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <span style={{ fontSize: 12, color: "#94a3b8", width: 36 }}>{Math.round(v * 100)}%</span>
    </span>
  );
}

function FilmPanel({ view, busy, onEdit, onMusic, onAssemble }: {
  view: ProjectView;
  busy: string | null;
  onEdit: (patch: Partial<EditSettings>) => void;
  onMusic: () => void;
  onAssemble: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { project, edit, music, film } = view;
  const finished = project.shots.filter((s) => s.status === "done" && s.mediaUrl);
  const done = finished.length;
  const isMv = project.mode === "mv";
  const musicOn = edit.music !== "off";
  const [delivery, setDelivery] = useState<"separate" | "film">(film.url ? "film" : "separate");
  const option = (on: boolean): React.CSSProperties => ({
    ...chip(on),
    flex: 1,
    minWidth: 200,
    padding: "12px 14px",
    textAlign: "left",
    borderRadius: 14,
  });
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 17, fontWeight: 600 }}>{t("รับงานแบบไหน", "How do you want it?")}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={option(delivery === "separate")} onClick={() => setDelivery("separate")}>
          <div style={{ fontWeight: 600 }}>{t("📁 ไฟล์แยกทีละช็อต", "📁 A separate file per shot")}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{t("ฟรี · นำไปตัดต่อเองในโปรแกรมที่ถนัด", "Free · edit them yourself in your favourite editor")}</div>
        </button>
        <button style={option(delivery === "film")} onClick={() => setDelivery("film")}>
          <div style={{ fontWeight: 600 }}>{t("🎞️ ตัดต่อเป็นหนังไฟล์เดียว", "🎞️ Cut into one film file")}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {film.credits > 0 ? formatCredits(film.credits, locale) : done ? t("ฟรี", "Free") : t("คิดตามความยาว", "Priced by length")} ·{" "}
            {t("ระบบต่อช็อต ใส่เสียง เพลง ซับให้", "We join the shots and add sound, music and subtitles")}
          </div>
        </button>
      </div>

      {delivery === "separate" ? (
        done === 0 ? (
          <div style={{ fontSize: 13, color: "#94a3b8" }}>{t("ยังไม่มีช็อตที่สร้างเสร็จ", "No shots are finished yet")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {finished.map((s) => (
              <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, flexWrap: "wrap" }}>
                <span style={{ width: 64 }}>{t(`ช็อต ${s.number}`, `Shot ${s.number}`)}</span>
                <span style={{ color: "#94a3b8", flex: 1, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.line || s.visual}</span>
                <a href={s.mediaUrl!} download={`shot-${String(s.number).padStart(2, "0")}.mp4`} target="_blank" rel="noopener noreferrer" style={{ ...btn, padding: "5px 10px", textDecoration: "none" }}>{t("⬇ ดาวน์โหลด", "⬇ Download")}</a>
                {s.lipsync?.state === "done" && s.lipsync.url && (
                  <a href={s.lipsync.url} download={`shot-${String(s.number).padStart(2, "0")}-lipsync.mp4`} target="_blank" rel="noopener noreferrer" style={{ ...btn, padding: "5px 10px", textDecoration: "none" }}>{t("⬇ ลิปซิงก์", "⬇ Lip-sync")}</a>
                )}
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {t("ไฟล์คือคลิปจากโมเดลตรง ๆ (มีเสียงในคลิป ยังไม่มีซับ/เพลง)", "The files are the model's clips as they came (with their own sound, no subtitles or music yet)")}
            </div>
          </div>
        )
      ) : (<>
      <div style={{ fontSize: 12, color: "#64748b" }}>{t("เปิด/ปิดได้ทุกอย่าง — ระบบนำช็อตที่เสร็จแล้วมาต่อกันตามลำดับ", "Switch anything on or off — the finished shots are joined in order")}</div>

      {isMv && project.songUrl && <KaraokeCut project={project} edit={edit} onEdit={onEdit} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Toggle on={edit.clipAudio} onChange={(v) => onEdit({ clipAudio: v })} label={t("เสียงจากคลิป", "Sound from the clips")} hint={t("บทพูดไทยและเสียงบรรยากาศที่โมเดลสร้างมากับภาพ", "The lines and ambient sound the model made with the picture")} />
          <Volume key={`c${edit.clipVolume}`} value={edit.clipVolume} disabled={!edit.clipAudio} onCommit={(v) => onEdit({ clipVolume: v })} />
          <Toggle
            on={musicOn}
            onChange={(v) => onEdit({ music: v ? (isMv ? "song" : "generate") : "off" })}
            label={isMv ? t("เพลงของ MV", "The MV's song") : t("ดนตรีประกอบ (สร้างจาก ACE-Step)", "Background music (made with ACE-Step)")}
            hint={isMv ? t("ช็อตวางตามจังหวะเพลงนี้", "The shots follow this song's timing") : t("ดนตรีบรรเลงตามสไตล์เรื่อง ยาวเท่าหนัง", "Instrumental music in the story's style, as long as the film")}
          />
          <Volume key={`m${edit.musicVolume}`} value={edit.musicVolume} disabled={!musicOn} onCommit={(v) => onEdit({ musicVolume: v })} />
          {musicOn && edit.clipAudio && (
            <Toggle on={edit.duck} onChange={(v) => onEdit({ duck: v })} label={t("ลดเพลงลงตอนมีเสียงพูด", "Lower the music under dialogue")} hint={t("ให้บทพูดฟังชัด", "So the lines are easy to hear")} />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!(isMv && edit.karaoke) && (
            <Toggle on={edit.subtitles} onChange={(v) => onEdit({ subtitles: v })} label={isMv ? t("ซับเนื้อเพลง", "Lyric subtitles") : t("ซับไทย", "Subtitles")}
              hint={isMv ? t("จากเนื้อเพลงของแต่ละช็อต", "From each shot's lyrics") : t("จากบทพูดของแต่ละช็อต", "From each shot's lines")}
            />
          )}
          <Toggle on={edit.coverFakeSubs} onChange={(v) => onEdit({ coverFakeSubs: v })} label={t("เบลอตัวหนังสือมั่วที่ LTX ใส่มา", "Blur the garbled text LTX burns in")} hint={t("เฉพาะช็อตที่สร้างด้วย LTX-2.5", "Only shots made with LTX-2.5")} />
          <Toggle on={edit.transition === "fade"} onChange={(v) => onEdit({ transition: v ? "fade" : "cut" })} label={t("เฟดระหว่างช็อต", "Fade between shots")} hint={t("ปิด = ตัดชนตรง ๆ", "Off = straight cuts")} />
          <Toggle on={edit.titleCard} onChange={(v) => onEdit({ titleCard: v })} label={t("ชื่อเรื่องตอนเปิด", "Title card at the start")} hint={project.title} />
        </div>
      </div>

      {!isMv && musicOn && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: 12, borderRadius: 12, background: "rgba(2,6,23,0.4)" }}>
          {music.status === "done" && music.url && <audio src={music.url} controls preload="none" style={{ flex: 1, minWidth: 220 }} />}
          {music.status === "rendering" && <span style={{ fontSize: 13, color: "#fbbf24" }}>{t("กำลังสร้างดนตรีประกอบ…", "Making the background music…")}</span>}
          {music.status === "failed" && <span style={{ fontSize: 13, color: "#fca5a5" }}>{t("สร้างดนตรีไม่สำเร็จ (คืนเครดิตแล้ว)", "Couldn't make the music (credits refunded)")}</span>}
          {music.status === "none" && <span style={{ fontSize: 13, color: "#94a3b8" }}>{t("ยังไม่มีดนตรีประกอบ", "No background music yet")}</span>}
          {music.stale && music.status === "done" && <span style={{ fontSize: 12, color: "#fbbf24" }}>{t("เพลงสั้นกว่าหนังตอนนี้ (จะวนซ้ำ)", "The music is shorter than the film now (it will loop)")}</span>}
          {music.status !== "rendering" && (
            <button style={btn} disabled={busy !== null || !music.available || project.shots.length === 0} onClick={onMusic}>
              {busy === "music" ? t("กำลังสั่ง…", "Ordering…") : music.status === "none" ? t("สร้างดนตรีประกอบ", "Make background music") : t("สร้างใหม่", "Remake")}
              {music.credits !== null && ` · ${formatCredits(music.credits, locale)}`}
            </button>
          )}
          {!music.available && <span style={{ fontSize: 12, color: "#94a3b8" }}>{t("ตัวสร้างเพลงยังไม่เปิด", "The music maker isn't open yet")}</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          style={{ ...primary, opacity: busy || film.status === "assembling" || done === 0 ? 0.6 : 1 }}
          disabled={busy !== null || film.status === "assembling" || done === 0}
          onClick={onAssemble}
        >
          {film.status === "assembling" ? t("กำลังตัดต่อ… (ไม่กี่นาที)", "Cutting… (a few minutes)") : film.status === "done" ? t("ตัดต่อใหม่", "Re-cut") : t("🎬 ตัดต่อเป็นหนัง", "🎬 Cut into a film")}
          {film.status !== "assembling" && film.credits > 0 && ` · ${formatCredits(film.credits, locale)}`}
        </button>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{t("ช็อตที่เสร็จ", "Shots finished")} {done} / {project.shots.length}</span>
      </div>
      {film.error && film.status !== "assembling" && <div style={{ fontSize: 13, color: "#fca5a5" }}>{film.error}</div>}
      {film.status === "done" && film.url && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <video src={film.url} controls playsInline preload="metadata" style={{ width: "100%", borderRadius: 12, background: "#000" }} />
          <a href={film.url} download target="_blank" rel="noopener noreferrer" style={{ ...btn, alignSelf: "flex-start", textDecoration: "none" }}>{t("⬇ ดาวน์โหลดหนัง", "⬇ Download the film")}{film.seconds ? ` (${fmtTime(film.seconds)})` : ""}</a>
        </div>
      )}
      </>)}
    </div>
  );
}

// ─── MV karaoke ─────────────────────────────────────────────────────────

/**
 * The karaoke switch of the cut: the song's lyrics timed word by word (free,
 * on our server, the same timing the studio makes), how they look, and
 * whether the film plays the song or its minus-one. Plain lyric subtitles give
 * way to it.
 */
function KaraokeCut({ project, edit, onEdit }: { project: Project; edit: EditSettings; onEdit: (patch: Partial<EditSettings>) => void }) {
  const t = useT();
  const k = useKaraoke(edit.karaoke ? { kind: "story", projectId: project.id, lyrics: project.brief } : null);
  const status = k.status;
  const doc = status?.state === "done" ? status.doc : null;
  const look = edit.karaokeLook;
  const setLook = (patch: Partial<KaraokeLook>) => onEdit({ karaokeLook: { ...look, ...patch } });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 12, background: "rgba(2,6,23,0.4)", border: edit.karaoke ? "1px solid rgba(250,204,21,0.35)" : "1px solid transparent" }}>
      <Toggle on={edit.karaoke} onChange={(v) => onEdit({ karaoke: v })} label={t("🎤 MV คาราโอเกะ", "🎤 Karaoke MV")}
        hint={t("เนื้อร้องภาษาไทยวิ่งทีละคำตามเสียงร้องจริง ใช้ฟอนต์ของเราเอง ไม่มีตัวสี่เหลี่ยม · แทนซับเนื้อเพลงธรรมดา", "Thai lyrics light up word by word with the real vocal, in our own font — no boxes · replaces the plain lyric subtitles")} />
      {edit.karaoke && (
        <>
          {status && karaokeWorking(status) && <div style={{ fontSize: 13, color: "#fbbf24" }}>{karaokeProgressText(status, t)}</div>}
          {status?.state === "failed" && <div style={{ fontSize: 13, color: "#fca5a5" }}>{status.error}</div>}
          {k.error && <div style={{ fontSize: 13, color: "#fca5a5" }}>{k.error}</div>}
          {!doc && !karaokeWorking(status) && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button style={{ ...primary, opacity: k.starting || !k.available ? 0.6 : 1 }} disabled={k.starting || !k.available} onClick={() => k.start(status?.state === "failed")}>
                {k.starting ? t("กำลังเริ่ม…", "Starting…") : t("🎯 จับจังหวะเนื้อร้อง (ฟรี)", "🎯 Time the lyrics (free)")}
              </button>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {k.available
                  ? t("ใช้เนื้อเพลงของโปรเจกต์ (ต้องตรงกับที่ร้อง) · ราว 2–5 นาที ปิดหน้านี้ได้", "Uses the project's lyrics (they must match what is sung) · about 2–5 minutes; you can close this page")
                  : t("ตัวจับจังหวะยังไม่เปิดให้ใช้", "Karaoke timing isn't open yet")}
              </span>
            </div>
          )}
          {doc && (
            <KaraokeStage key={doc.songUrl} src={project.songUrl!} timing={doc.timing} theme={look.theme} onTheme={(theme) => setLook({ theme })} onSave={k.save} />
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#94a3b8", minWidth: 70 }}>{t("ตำแหน่ง", "Position")}</span>
            {(Object.keys(KARAOKE_POSITIONS) as KaraokePosition[]).map((p) => (
              <button key={p} style={chip(look.position === p)} onClick={() => setLook({ position: p })}>{t(KARAOKE_POSITIONS[p])}</button>
            ))}
          </div>
          {!doc && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#94a3b8", minWidth: 70 }}>{t("สี", "Colours")}</span>
              {(Object.keys(KARAOKE_THEMES) as KaraokeTheme[]).map((k2) => (
                <button key={k2} style={{ ...chip(look.theme === k2), color: KARAOKE_THEMES[k2].sung }} onClick={() => setLook({ theme: k2 })}>● {t(KARAOKE_THEMES[k2].label)}</button>
              ))}
            </div>
          )}
          <Toggle on={look.nextLine} onChange={(v) => setLook({ nextLine: v })} label={t("โชว์บรรทัดถัดไปรอไว้", "Show the next line waiting")} hint={t("สองแถวสลับกันแบบตู้คาราโอเกะ", "Two rows taking turns, like a karaoke box")} />
          <Toggle on={look.countdown} onChange={(v) => setLook({ countdown: v })} label={t("จุดนับถอยหลังก่อนร้อง", "Count-in dots before singing")} hint={t("หลังช่วงดนตรียาว ๆ", "After a long instrumental gap")} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#94a3b8", minWidth: 70 }}>{t("เสียงใน MV", "MV audio")}</span>
            <button style={chip(edit.karaokeAudio === "song")} onClick={() => onEdit({ karaokeAudio: "song" })}>{t("เพลงเต็ม", "The full song")}</button>
            <button style={{ ...chip(edit.karaokeAudio === "instrumental"), opacity: doc && !doc.instrumentalUrl ? 0.5 : 1 }} disabled={!!doc && !doc.instrumentalUrl}
              onClick={() => onEdit({ karaokeAudio: "instrumental" })}>
              {t("ดนตรีไม่มีเสียงร้อง (ร้องเอง)", "Backing track only (sing it yourself)")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── MV lip-sync ────────────────────────────────────────────────────────

/** Shots a bulk dub would order: finished, singing, dub-able, and without a usable dub. */
const toDub = (shots: Shot[]) =>
  shots.filter((s) => s.status === "done" && s.lipsync && s.lipsync.suggested && !s.lipsync.blocked && ["none", "failed", "stale"].includes(s.lipsync.state));

function SingPanel({ view, busy, onSeparate, onStem, onDubAll, onEdit }: {
  view: ProjectView;
  busy: string | null;
  onSeparate: () => void;
  onStem: (file: File) => void;
  onDubAll: (shots: Shot[]) => void;
  onEdit: (patch: Partial<EditSettings>) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const vocals = view.vocals!;
  const shots = view.project.shots;
  const pending = toDub(shots);
  const cost = pending.reduce((n, s) => n + (s.lipsync?.credits ?? 0), 0);
  const dubbed = shots.filter((s) => s.lipsync?.state === "done").length;
  const flying = shots.filter((s) => s.lipsync?.state === "rendering").length;
  const stemInput = useRef<HTMLInputElement>(null);
  const working = vocals.state === "separating";
  const canDub = vocals.state === "done" && vocals.dubbing && pending.length > 0 && busy === null;
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 17, fontWeight: 600 }}>{t("🎤 ลิปซิงก์เสียงร้อง", "🎤 Vocal lip-sync")}</div>
      <div style={{ fontSize: 12, color: "#64748b" }}>
        {t(
          "ให้นักร้องในคลิปขยับปากตรงกับเพลง: ระบบแยกเสียงร้องออกจากเพลง ตัดเฉพาะช่วงของแต่ละช็อต แล้วทำลิปซิงก์ทีละช็อต (คิดเครดิตตามความยาวช็อต ไม่สำเร็จคืนเครดิต) · ได้ผลดีกับช็อตใกล้–ครึ่งตัวที่เห็นหน้าชัดตลอด",
          "Make the singers in the clips move their lips with the song: the vocals are separated from the song, each shot's part is cut out, and the shots are lip-synced one by one (credits by shot length, refunded if it fails) · Works best on close-up to waist-up shots where the face is clearly visible throughout"
        )}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: 12, borderRadius: 12, background: "rgba(2,6,23,0.4)" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("1. เสียงร้อง", "1. Vocals")}</span>
        {vocals.state === "done" && vocals.url && <audio src={vocals.url} controls preload="none" style={{ flex: 1, minWidth: 220 }} />}
        {vocals.state === "done" && <span style={{ fontSize: 12, color: "#94a3b8" }}>{vocals.source === "upload" ? t("จากไฟล์ที่อัปโหลด", "From your uploaded file") : t("แยกจากเพลงแล้ว", "Separated from the song")}</span>}
        {working && <span style={{ fontSize: 13, color: "#fbbf24" }}>{t("กำลังแยกเสียงร้อง… ประมาณ 2–5 นาที ปิดหน้านี้ได้", "Separating the vocals… about 2–5 minutes; you can close this page")}</span>}
        {vocals.state === "none" && <span style={{ fontSize: 13, color: "#94a3b8" }}>{t("ยังไม่มี", "None yet")}</span>}
        {vocals.state === "stale" && <span style={{ fontSize: 13, color: "#fbbf24" }}>{t("เสียงร้องเป็นของเพลงเดิม — แยกใหม่", "These vocals are from the old song — separate them again")}</span>}
        {vocals.state === "failed" && vocals.error && <span style={{ fontSize: 13, color: "#fca5a5" }}>{vocals.error}</span>}
        {!working && (
          <>
            {vocals.auto && (
              <button style={btn} disabled={busy !== null} onClick={onSeparate}>
                {busy === "separate" ? t("กำลังเริ่ม…", "Starting…") : vocals.state === "done" ? t("แยกใหม่", "Separate again") : t("แยกเสียงร้องจากเพลง (ฟรี)", "Separate the vocals from the song (free)")}
              </button>
            )}
            <button style={btn} disabled={busy !== null} onClick={() => stemInput.current?.click()}>
              {busy === "stem" ? t("กำลังอัปโหลด…", "Uploading…") : t("อัปโหลดไฟล์เสียงร้องแยก", "Upload a separate vocal file")}
            </button>
            <input
              ref={stemInput}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onStem(file);
              }}
            />
          </>
        )}
      </div>
      {!vocals.auto && vocals.state !== "done" && (
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("อัปโหลดแทร็กเสียงร้องล้วน (vocal stem) ของเพลงนี้ ยาวเท่าเพลง", "Upload this song's vocals-only track (vocal stem), the same length as the song")}</div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("2. ลิปซิงก์", "2. Lip-sync")}</span>
        <button style={{ ...primary, opacity: canDub ? 1 : 0.5 }} disabled={!canDub} onClick={() => onDubAll(pending)}>
          {busy === "lipsync" ? t("กำลังสั่ง…", "Ordering…") : t(`ลิปซิงก์ช็อตที่ร้อง ${pending.length} ช็อต`, `Lip-sync ${plural(pending.length, "singing shot")}`)}
          {pending.length > 0 && ` · ${formatCredits(cost, locale)}`}
        </button>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          {t(`เสร็จ ${dubbed} ช็อต`, `${plural(dubbed, "shot")} done`)}
          {flying > 0 ? t(` · กำลังทำ ${flying}`, ` · ${flying} in progress`) : ""} · {t("เลือกทำ/ไม่ทำทีละช็อตได้ที่การ์ดช็อต", "Turn it on or off per shot on each shot's card")}
        </span>
      </div>
      {!vocals.dubbing && <div style={{ fontSize: 12, color: "#94a3b8" }}>{t("ตัวลิปซิงก์ยังไม่เปิดให้ใช้", "Lip-sync isn't open yet")}</div>}

      <Toggle on={view.edit.lipsync} onChange={(v) => onEdit({ lipsync: v })} label={t("ใช้คลิปลิปซิงก์ตอนตัดต่อหนัง", "Use the lip-sync clips in the cut")} hint={t("ปิด = ตัดต่อจากคลิปเดิมทั้งหมด", "Off = cut from the original clips only")} />
    </div>
  );
}

// ─── Project editor ─────────────────────────────────────────────────────

function ProjectEditor({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const t = useT();
  const { locale } = useLocale();
  const [view, setView] = useState<ProjectView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getJson<ProjectView>(`/api/story/${id}`);
    if (r.ok) setView(r.data);
    else setMissing(true);
    return r.ok;
  }, [id]);

  useEffect(() => {
    let active = true;
    getJson<ProjectView>(`/api/story/${id}`).then((r) => {
      if (!active) return;
      if (r.ok) setView(r.data);
      else setMissing(true);
    });
    return () => {
      active = false;
    };
    // The server writes labels and messages in the visitor's language: fetch again when it changes.
  }, [id, locale]);

  // Poll only while something renders; stop when the page goes away.
  const rendering = view?.project.shots.some((s) => s.status === "rendering") ?? false;
  const working =
    rendering ||
    view?.film.status === "assembling" ||
    view?.music.status === "rendering" ||
    view?.vocals?.state === "separating" ||
    view?.planning?.state === "planning" ||
    (view?.project.shots.some((s) => s.lipsync?.state === "rendering" || s.keyframe.state === "rendering") ?? false) ||
    (view?.project.library.some((a) => a.image.state === "rendering") ?? false);
  // A long film is planned after the response; say so when it lands.
  const planState = view?.planning?.state ?? null;
  const lastPlanState = useRef(planState);
  useEffect(() => {
    const was = lastPlanState.current;
    lastPlanState.current = planState;
    if (was !== "planning" || !view?.planning) return;
    if (planState === "done") {
      const n = view.planning.shots ?? view.project.shots.length;
      toast("success", t(`วางช็อตแล้ว ${n} ช็อต`, `Planned ${plural(n, "shot")}`), view.planning.rules ? t(RULES_PLANNER) : undefined);
    } else if (planState === "failed") {
      toast("error", view.planning.error ?? t("วางช็อตไม่สำเร็จ", "Couldn't plan the shots"));
    }
  }, [planState, view, toast, t]);

  useEffect(() => {
    if (!working) return;
    let active = true;
    const timer = setInterval(async () => {
      const r = await getJson<ProjectView>(`/api/story/${id}`);
      if (active && r.ok) setView(r.data);
    }, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [working, id]);

  if (missing) {
    return (
      <div style={card}>
        {t("ไม่พบโปรเจกต์นี้", "Project not found")} <button style={btn} onClick={onBack}>{t("กลับ", "Back")}</button>
      </div>
    );
  }
  if (!view) return <div style={{ ...card, color: "#94a3b8" }}>{t("กำลังโหลด…", "Loading…")}</div>;
  const { project, models } = view;
  const planning = view.planning?.state === "planning";

  const act = async <T,>(key: string, url: string, init: RequestInit): Promise<T | null> => {
    if (busy) return null;
    setBusy(key);
    const r = await getJson<T>(url, init);
    setBusy(null);
    if (!r.ok) {
      toast("error", t(r.error));
      return null;
    }
    return r.data;
  };

  const plan = async () => {
    const done = project.shots.filter((s) => s.status === "done").length;
    if (project.shots.length > 0) {
      const structure = project.scenes.length
        ? t(` องก์และฉากเดิมจะถูกวางใหม่ด้วย (คลังอ้างอิงยังอยู่ครบ)`, " The acts and scenes are re-planned too (the reference library stays as it is).")
        : "";
      const shotsNow = plural(project.shots.length, "shot");
      const warn = done > 0
        ? t(
            `ให้ AI วางเรื่องใหม่ทั้งหมด? ช็อตเดิม ${project.shots.length} ช็อตจะถูกแทนที่ (คลิปที่สร้างแล้ว ${done} คลิปยังอยู่ในแกลเลอรี)${structure}`,
            `Have AI re-plan the whole story? The current ${shotsNow} will be replaced (clips already made stay in your gallery).${structure}`
          )
        : t(
            `ให้ AI วางเรื่องใหม่ทั้งหมด? ช็อตเดิม ${project.shots.length} ช็อตและที่แก้ไว้จะถูกแทนที่${structure}`,
            `Have AI re-plan the whole story? The current ${shotsNow} and your edits will be replaced.${structure}`
          );
      if (!confirm(warn)) return;
    }
    const data = await act<ProjectView & { planner: "ai" | "rules" }>("plan", `/api/story/${id}/plan`, { method: "POST" });
    if (!data) return;
    setView(data);
    if (data.planning?.state === "planning") {
      lastPlanState.current = "planning";
      return toast(
        "success",
        project.mode === "mv" ? t("AI กำลังวางช็อตตามเพลง", "AI is laying out shots along the song") : t("AI กำลังแบ่งองก์ ฉาก และวางช็อต", "AI is splitting the story into acts, scenes and shots"),
        t("ใช้เวลาราว 1–3 นาที จะขึ้นเองเมื่อเสร็จ", "About 1–3 minutes; it appears by itself when done")
      );
    }
    const n = data.project.shots.length;
    toast("success", t(`วางช็อตแล้ว ${n} ช็อต`, `Planned ${plural(n, "shot")}`), data.planner === "rules" ? t(RULES_PLANNER) : undefined);
  };

  const render = async (shots: Shot[]) => {
    const total = shots.reduce((n, s) => n + (s.credits ?? 0), 0);
    const again = shots.filter((s) => s.status === "done").length;
    const msg = shots.length === 1
      ? t(
          `สร้างช็อต ${shots[0].number}? ใช้ ${formatNumber(total, locale)} เครดิต${again ? " (สร้างใหม่ทับคลิปเดิม คลิปเดิมยังอยู่ในแกลเลอรี)" : ""}`,
          `Make shot ${shots[0].number}? Uses ${formatCredits(total, locale)}${again ? " (replaces the current clip; the old one stays in your gallery)" : ""}`
        )
      : t(`สร้าง ${shots.length} ช็อต? ใช้รวม ${formatNumber(total, locale)} เครดิต`, `Make ${shots.length} shots? Uses ${formatCredits(total, locale)} in total`);
    if (!confirm(msg)) return;
    const data = await act<ProjectView & { ordered: number; stoppedBy: string | null }>(
      "render",
      `/api/story/${id}/render`,
      sendJson("POST", { shotIds: shots.map((s) => s.id) })
    );
    if (!data) return;
    setView(data);
    if (data.stoppedBy) toast("error", t(`สั่งได้ ${data.ordered} ช็อต แล้วหยุด`, `Ordered ${plural(data.ordered, "shot")}, then stopped`), data.stoppedBy);
    else {
      toast(
        "success",
        t(`สั่งสร้าง ${data.ordered} ช็อตแล้ว`, `Ordered ${plural(data.ordered, "shot")}`),
        t("เครื่องแรกอาจใช้เวลาเปิดเครื่องสักครู่ ปิดหน้านี้ได้ ผลงานจะอยู่ในแกลเลอรี", "The first machine may take a moment to start. You can close this page — the results go to your gallery.")
      );
    }
  };

  // Re-plan some scenes only — a scene, or every scene of an act.
  const planScope = async (sceneIds: number[], what: Msg) => {
    const shots = project.shots.filter((s) => s.sceneId !== null && sceneIds.includes(s.sceneId));
    const done = shots.filter((s) => s.status === "done").length;
    const ask = t(
      `ให้ AI วางช็อต${what.th}ใหม่? ช็อตเดิม ${shots.length} ช็อตจะถูกแทนที่${done ? ` (คลิปที่สร้างแล้ว ${done} คลิปยังอยู่ในแกลเลอรี)` : ""} ส่วนอื่นของเรื่องไม่เปลี่ยน`,
      `Have AI re-plan ${what.en}? Its ${plural(shots.length, "shot")} will be replaced${done ? " (clips already made stay in your gallery)" : ""}. The rest of the story stays as it is.`
    );
    if (!confirm(ask)) return;
    const data = await act<ProjectView>("plan", `/api/story/${id}/plan`, sendJson("POST", { sceneIds }));
    if (!data) return;
    setView(data);
    lastPlanState.current = "planning";
    toast("success", t(`AI กำลังวางช็อต${what.th}ใหม่`, `AI is re-planning ${what.en}`), t("ใช้เวลาราว 1 นาที", "About a minute"));
  };

  const keyframes = async (shots: Shot[]) => {
    const model = view.pictures.models.find((m) => m.id === view.pictures.keyframeModelId);
    if (!model) return toast("error", t("ยังไม่มีโมเดลภาพที่รับภาพอ้างอิงเปิดให้ใช้", "No image model that takes reference pictures is open yet"));
    const todo = shots.filter((s) => s.keyframe.state !== "rendering");
    if (todo.length === 0) return;
    const again = todo.filter((s) => s.keyframe.url).length;
    const ask = t(
      `สร้างภาพเปิด ${todo.length} ช็อตด้วย ${model.name}? ใช้รวม ${formatNumber(model.credits * todo.length, locale)} เครดิต${again ? ` (${again} ช็อตมีภาพเดิมอยู่ จะถูกแทนที่)` : ""}`,
      `Make opening pictures for ${plural(todo.length, "shot")} with ${model.name}? Uses ${formatCredits(model.credits * todo.length, locale)} in total${
        again ? ` (${plural(again, "shot")} already ${again === 1 ? "has a picture" : "have pictures"}, which will be replaced)` : ""
      }`
    );
    if (!confirm(ask)) return;
    const data = await act<ProjectView & { ordered: number; stoppedBy: string | null }>("keyframes", `/api/story/${id}/keyframes`, sendJson("POST", { shotIds: todo.map((s) => s.id) }));
    if (!data) return;
    setView(data);
    if (data.stoppedBy) toast("error", t(`สั่งได้ ${data.ordered} ภาพ แล้วหยุด`, `Ordered ${plural(data.ordered, "picture")}, then stopped`), data.stoppedBy);
    else {
      toast(
        "success",
        t(`สั่งสร้างภาพเปิด ${data.ordered} ภาพแล้ว`, `Ordered ${plural(data.ordered, "opening picture")}`),
        t("ภาพจะขึ้นเองเมื่อเสร็จ ตรวจภาพก่อนสร้างคลิป", "They appear by themselves when done. Check them before making the clips.")
      );
    }
  };

  const keyframeUse = async (shot: Shot, use: boolean) => {
    const data = await act<ProjectView>(`kfuse-${shot.id}`, `/api/story/${id}/shots/${shot.id}`, sendJson("PATCH", { keyframeUse: use }));
    if (data) setView(data);
  };

  const assetAction = async (body: Record<string, unknown>, key: string) => {
    const data = await act<ProjectView>(key, `/api/story/${id}/assets`, sendJson("POST", body));
    if (data) setView(data);
    return Boolean(data);
  };

  const structureAction = async (body: Record<string, unknown>) => {
    const data = await act<ProjectView>("structure", `/api/story/${id}/structure`, sendJson("POST", body));
    if (data) setView(data);
    return Boolean(data);
  };

  const setPictures = async (patch: Partial<Pick<Pictures, "keyframeModelId" | "pictureModelId">>) => {
    const data = await act<ProjectView>("pictures", `/api/story/${id}`, sendJson("PATCH", { pictures: patch }));
    if (data) setView(data);
  };

  const addShotTo = async (sceneId: number) => {
    const data = await act<ProjectView>("add", `/api/story/${id}/shots`, sendJson("POST", { sceneId }));
    if (data) setView(data);
  };

  const saveShot = async (shot: Shot, patch: Partial<Shot>) => {
    const data = await act<ProjectView>(`shot-${shot.id}`, `/api/story/${id}/shots/${shot.id}`, sendJson("PATCH", patch));
    if (data) setView(data);
    return Boolean(data);
  };

  const deleteShot = async (shot: Shot) => {
    if (!confirm(t(`ลบช็อต ${shot.number}?`, `Delete shot ${shot.number}?`))) return;
    const data = await act<ProjectView>(`del-${shot.id}`, `/api/story/${id}/shots/${shot.id}`, { method: "DELETE" });
    if (data) setView(data);
  };

  const addShot = async () => {
    const data = await act<ProjectView>("add", `/api/story/${id}/shots`, sendJson("POST", {}));
    if (data) setView(data);
  };

  const setFilmLength = async (key: string) => {
    const data = await act<ProjectView>("length", `/api/story/${id}`, sendJson("PATCH", { filmLength: key }));
    if (data) setView(data);
  };

  const saveSettings = async () => {
    const body: Record<string, unknown> = {};
    if (brief !== null) body.brief = brief;
    const data = await act<ProjectView>("settings", `/api/story/${id}`, sendJson("PATCH", body));
    if (!data) return;
    setView(data);
    setBrief(null);
    toast("success", t("บันทึกแล้ว", "Saved"));
  };

  // A switch takes effect at once on screen and is saved; a refusal puts it back.
  const saveEdit = async (patch: Partial<EditSettings>) => {
    const before = view;
    setView({ ...view, edit: { ...view.edit, ...patch } });
    const r = await getJson<ProjectView>(`/api/story/${id}`, sendJson("PATCH", { edit: patch }));
    if (r.ok) setView(r.data);
    else {
      setView(before);
      toast("error", t(r.error));
    }
  };

  const orderMusic = async () => {
    const what = view.music.status === "none"
      ? t("สร้างดนตรีประกอบ", "Make background music")
      : t("สร้างดนตรีประกอบใหม่ (เพลงเดิมยังอยู่ในแกลเลอรี)", "Make new background music (the old track stays in your gallery)");
    const price = view.music.credits === null ? t("? เครดิต", "? credits") : formatCredits(view.music.credits, locale);
    if (!confirm(t(`${what}? ใช้ ${price}`, `${what}? Uses ${price}`))) return;
    const data = await act<ProjectView>("music", `/api/story/${id}/music`, { method: "POST" });
    if (data) {
      setView(data);
      toast("success", t("สั่งสร้างดนตรีแล้ว", "Music ordered"), t("เสร็จแล้วจะเล่นได้ในส่วนตัดต่อ", "Once it's done it plays in the cut section"));
    }
  };

  const assemble = async () => {
    const done = project.shots.filter((s) => s.status === "done").length;
    const partial = t(
      `ยังสร้างไม่ครบ — ตัดต่อเฉพาะ ${done} จาก ${project.shots.length} ช็อตที่เสร็จแล้ว?`,
      `Not every shot is made yet — cut only the ${done} of ${project.shots.length} shots that are finished?`
    );
    if (done < project.shots.length && !confirm(partial)) return;
    if (view.edit.music === "generate" && view.music.status !== "done") {
      return toast("error", t("ดนตรีประกอบยังไม่พร้อม", "The background music isn't ready"), t("สร้างดนตรีก่อน หรือปิดดนตรีประกอบ", "Make the music first, or switch background music off"));
    }
    const cost = view.film.credits > 0
      ? t(`ใช้ ${view.film.credits} เครดิต (ถ้าตัดต่อไม่สำเร็จคืนเครดิตอัตโนมัติ)`, `Uses ${formatCredits(view.film.credits, locale)} (refunded automatically if the cut fails)`)
      : t("ไม่เสียเครดิต", "No credits charged");
    if (!confirm(`${view.film.status === "done" ? t("ตัดต่อใหม่", "Re-cut") : t("ตัดต่อเป็นหนัง", "Cut into a film")}? ${cost}`)) return;
    const data = await act<ProjectView>("assemble", `/api/story/${id}/assemble`, { method: "POST" });
    if (data) setView(data);
  };

  const separate = async () => {
    if (view.vocals?.state === "done" && !confirm(t("แยกเสียงร้องใหม่? เสียงร้องเดิมจะถูกแทนที่ (ฟรี)", "Separate the vocals again? The current vocals will be replaced (free)."))) return;
    const data = await act<ProjectView>("separate", `/api/story/${id}/vocals`, sendJson("POST", { action: "separate" }));
    if (data) {
      setView(data);
      toast("success", t("เริ่มแยกเสียงร้องแล้ว", "Vocal separation started"), t("ประมาณ 2–5 นาที ปิดหน้านี้ได้", "About 2–5 minutes; you can close this page"));
    }
  };

  const uploadStem = async (file: File) => {
    if (busy) return;
    if (view.vocals?.state === "done" && !confirm(t("ใช้ไฟล์นี้แทนเสียงร้องเดิม?", "Use this file instead of the current vocals?"))) return;
    setBusy("stem");
    const up = await uploadFile(file, "audio");
    setBusy(null);
    if (!up.ok) return toast("error", t(up.error));
    const data = await act<ProjectView>("stem", `/api/story/${id}/vocals`, sendJson("POST", { uploadUrl: up.data.url }));
    if (data) {
      setView(data);
      toast("success", t("ใช้ไฟล์เสียงร้องนี้แล้ว", "Now using this vocal file"));
    }
  };

  const lipsync = async (shots: Shot[]) => {
    const total = shots.reduce((n, s) => n + (s.lipsync?.credits ?? 0), 0);
    const msg = shots.length === 1
      ? t(
          `ลิปซิงก์ช็อต ${shots[0].number}? ใช้ ${formatNumber(total, locale)} เครดิต (ถ้าช่วงนี้ไม่มีเสียงร้องจะไม่ทำและไม่เสียเครดิต)`,
          `Lip-sync shot ${shots[0].number}? Uses ${formatCredits(total, locale)} (if this part has no singing, it's skipped and nothing is charged)`
        )
      : t(
          `ลิปซิงก์ ${shots.length} ช็อต? ใช้รวม ${formatNumber(total, locale)} เครดิต (ช่วงที่ไม่มีเสียงร้องจะข้ามและไม่เสียเครดิต)`,
          `Lip-sync ${shots.length} shots? Uses ${formatCredits(total, locale)} in total (parts with no singing are skipped and not charged)`
        );
    if (!confirm(msg)) return;
    const data = await act<ProjectView & { ordered: number }>("lipsync", `/api/story/${id}/lipsync`, sendJson("POST", { shotIds: shots.map((s) => s.id) }));
    if (data) {
      setView(data);
      toast(
        "success",
        t(`กำลังสั่งลิปซิงก์ ${data.ordered} ช็อต`, `Ordering lip-sync for ${plural(data.ordered, "shot")}`),
        t("เครื่องแรกอาจใช้เวลาเปิดเครื่องสักครู่ ปิดหน้านี้ได้", "The first machine may take a moment to start. You can close this page.")
      );
    }
  };

  const dubUse = async (shot: Shot, use: boolean) => {
    const data = await act<ProjectView>(`dub-${shot.id}`, `/api/story/${id}/shots/${shot.id}`, sendJson("PATCH", { lipsyncUse: use }));
    if (data) setView(data);
  };

  const remove = async () => {
    const ask = t(
      `ลบโปรเจกต์ "${project.title}"? สตอรีบอร์ดจะหายถาวร (คลิปที่สร้างแล้วยังอยู่ในแกลเลอรี)`,
      `Delete the project "${project.title}"? The storyboard will be gone for good (clips already made stay in your gallery).`
    );
    if (!confirm(ask)) return;
    const data = await act("delete", `/api/story/${id}`, { method: "DELETE" });
    if (data) onBack();
  };

  const hasKeyModel = view.pictures.models.some((m) => m.id === view.pictures.keyframeModelId);
  const scopeActions: ScopeActions = { busy, planning, onPlan: planScope, onKeyframes: keyframes, onRender: render };
  const shotCard = (s: Shot) => (
    <ShotCard
      key={s.id}
      shot={s}
      project={project}
      models={models}
      onSave={(patch) => saveShot(s, patch)}
      onRender={() => render([s])}
      onDelete={() => deleteShot(s)}
      vocals={view.vocals}
      onLipsync={() => lipsync([s])}
      onDubUse={(use) => dubUse(s, use)}
      pictures={view.pictures}
      onKeyframe={() => keyframes([s])}
      onKeyframeUse={(use) => keyframeUse(s, use)}
    />
  );
  const places = project.library.filter((a) => a.kind === "location");
  const sceneBlock = (sc: Scene) => {
    const shots = project.shots.filter((s) => s.sceneId === sc.id);
    return (
      <div key={`scene-${sc.id}`} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SceneHeader
          key={`${sc.id}:${sc.title}:${sc.summary}:${sc.locationId}:${sc.timeOfDay}:${sc.actId}`}
          scene={sc}
          acts={project.acts}
          places={places}
          times={view.pictures.times}
          shots={shots}
          actions={scopeActions}
          hasKeyModel={hasKeyModel}
          onStructure={structureAction}
          onAddShot={() => addShotTo(sc.id)}
        />
        {shots.map(shotCard)}
      </div>
    );
  };
  // Acts → their scenes → shots; then scenes in no act, then shots in no scene.
  const storyboard = () => {
    const loose = project.scenes.filter((sc) => sc.actId === null || !project.acts.some((a) => a.id === sc.actId));
    const stray = project.shots.filter((s) => s.sceneId === null || !project.scenes.some((sc) => sc.id === s.sceneId));
    if (project.scenes.length === 0) return <>{project.shots.map(shotCard)}</>;
    return (
      <>
        {project.acts.map((a) => {
          const scenes = project.scenes.filter((sc) => sc.actId === a.id);
          const shots = project.shots.filter((s) => scenes.some((sc) => sc.id === s.sceneId));
          return (
            <div key={`act-${a.id}`} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <ActHeader key={`${a.id}:${a.title}:${a.summary}`} act={a} shots={shots} sceneIds={scenes.map((sc) => sc.id)} actions={scopeActions} hasKeyModel={hasKeyModel} onStructure={structureAction} />
              {scenes.map(sceneBlock)}
            </div>
          );
        })}
        {loose.length > 0 && project.acts.length > 0 && <div style={{ fontSize: 13, color: "#94a3b8" }}>{t("ฉากที่ไม่อยู่ในองก์ใด", "Scenes in no act")}</div>}
        {loose.map(sceneBlock)}
        {stray.length > 0 && <div style={{ fontSize: 13, color: "#94a3b8" }}>{t("ช็อตที่ยังไม่อยู่ในฉากใด", "Shots not in a scene yet")}</div>}
        {stray.map(shotCard)}
      </>
    );
  };

  const renderable = renderableOf(project.shots);
  const allCredits = renderable.reduce((n, s) => n + (s.credits ?? 0), 0);
  const doneCount = project.shots.filter((s) => s.status === "done").length;
  const totalSeconds = project.shots.reduce((n, s) => n + s.durationSec, 0);
  const aspectLabel = ASPECTS[project.aspect]?.label;
  const styleLabel = project.mode === "mv" ? MOODS[project.mood ?? ""]?.label : LOOKS[project.look]?.label;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button style={btn} onClick={onBack}>{t("← โปรเจกต์ทั้งหมด", "← All projects")}</button>
          <div style={{ fontSize: 20, fontWeight: 600, flex: 1, minWidth: 200 }}>
            {project.mode === "mv" ? "🎵" : "🎬"} {project.title}
          </div>
          <button style={{ ...btn, color: "#fca5a5" }} disabled={busy !== null} onClick={remove}>{t("ลบโปรเจกต์", "Delete project")}</button>
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>
          {aspectLabel && t(aspectLabel)} · {styleLabel && t(styleLabel)}
          {project.songSeconds ? t(` · เพลงยาว ${fmtTime(project.songSeconds)}`, ` · song ${fmtTime(project.songSeconds)}`) : ""}
          {project.shots.length > 0 &&
            t(
              ` · ${project.shots.length} ช็อต รวม ${fmtTime(totalSeconds)} · เสร็จ ${doneCount}`,
              ` · ${plural(project.shots.length, "shot")}, ${fmtTime(totalSeconds)} in all · ${doneCount} done`
            )}
        </div>
        {project.songUrl && <audio src={project.songUrl} controls preload="none" style={{ width: "100%" }} />}

        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "#d8b4fe" }}>{project.mode === "mv" ? t("แก้เนื้อเพลง", "Edit the lyrics") : t("แก้เรื่องย่อ", "Edit the story")}</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <textarea style={{ ...field, minHeight: 140, resize: "vertical" }} maxLength={LIMITS.brief} value={brief ?? project.brief} onChange={(e) => setBrief(e.target.value)} />
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{t("ตัวละคร ของ และสถานที่ แก้ได้ใน “คลังอ้างอิง” ด้านล่าง", "Characters, props and places are edited in the “Reference library” below")}</div>
            {brief !== null && (
              <div style={{ display: "flex", gap: 8 }}>
                <button style={primary} disabled={busy !== null} onClick={saveSettings}>{t("บันทึก", "Save")}</button>
                <button style={btn} onClick={() => setBrief(null)}>{t("ยกเลิก", "Cancel")}</button>
              </div>
            )}
          </div>
        </details>

        {project.mode === "film" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>{t("ความยาวที่ให้ AI วาง:", "Length for AI to plan:")}</span>
            {Object.entries(FILM_LENGTHS).map(([key, l]) => (
              <button key={key} style={chip((project.filmLength ?? "auto") === key)} disabled={busy !== null || planning} onClick={() => setFilmLength(key)}>{t(l.label)}</button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...primary, opacity: busy || rendering || planning ? 0.6 : 1 }} disabled={busy !== null || rendering || planning} onClick={plan} title={rendering ? t("รอช็อตที่กำลังสร้างให้เสร็จก่อน", "Wait for the shots being made to finish first") : undefined}>
            {planning
              ? t("AI กำลังวาง… (1–3 นาที)", "AI is planning… (1–3 minutes)")
              : busy === "plan"
                ? t("กำลังส่งให้ AI…", "Sending to AI…")
                : project.shots.length
                  ? t("✨ ให้ AI วางเรื่องใหม่ทั้งหมด", "✨ Have AI re-plan the whole story")
                  : project.mode === "mv" ? t("✨ ให้ AI แตกช็อต", "✨ Have AI break it into shots") : t("✨ ให้ AI แบ่งองก์ ฉาก และช็อต", "✨ Have AI split it into acts, scenes and shots")}
          </button>
          {renderable.length > 0 && (
            <button style={btn} disabled={busy !== null} onClick={() => render(renderable)}>
              {busy === "render"
                ? t("กำลังสั่ง…", "Ordering…")
                : t(
                    `สร้างช็อตที่เหลือ ${renderable.length} ช็อต · ${formatNumber(allCredits, locale)} เครดิต`,
                    `Make the remaining ${plural(renderable.length, "shot")} · ${formatCredits(allCredits, locale)}`
                  )}
            </button>
          )}
          <button style={btn} disabled={busy !== null} onClick={addShot}>{t("+ เพิ่มช็อตเอง", "+ Add a shot yourself")}</button>
          {project.mode === "film" && (
            <button style={btn} disabled={busy !== null} onClick={() => structureAction(project.acts.length ? { action: "add-act" } : { action: "add-scene" })}>
              {project.acts.length ? t("+ เพิ่มองก์", "+ Add act") : t("+ เพิ่มฉาก", "+ Add scene")}
            </button>
          )}
          <button style={btn} disabled={busy !== null} onClick={() => load()}>{t("รีเฟรช", "Refresh")}</button>
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {t(
            "แต่ละช็อตคิดเครดิตตอนกดสร้าง ถ้าสร้างไม่สำเร็จจะคืนเครดิตอัตโนมัติ · ช็อตที่เสร็จแล้วนำไปตัดต่อเป็นหนังไฟล์เดียวได้ด้านล่าง",
            "Each shot is charged when you make it, and refunded automatically if it fails · Finished shots can be cut into one film file below"
          )}
        </div>
      </div>

      <LibraryPanel view={view} busy={busy} onAction={assetAction} onPictures={setPictures} />

      {project.shots.length > 0 && view.vocals && (
        <SingPanel view={view} busy={busy} onSeparate={separate} onStem={uploadStem} onDubAll={lipsync} onEdit={saveEdit} />
      )}

      {project.shots.length > 0 && (
        <FilmPanel view={view} busy={busy} onEdit={saveEdit} onMusic={orderMusic} onAssemble={assemble} />
      )}

      {project.shots.length === 0 && project.scenes.length === 0 ? (
        <div style={{ ...card, color: "#94a3b8", textAlign: "center" }}>
          {project.mode === "mv"
            ? t(
                "ยังไม่มีช็อต — กด “✨ ให้ AI แตกช็อต” ให้ระบบวางให้จากเพลงและเนื้อเพลง แล้วค่อยแก้ทีละองก์ ทีละฉาก ทีละช็อต",
                "No shots yet — press “✨ Have AI break it into shots” to lay them out from the song and lyrics, then edit act by act, scene by scene, shot by shot"
              )
            : t(
                "ยังไม่มีช็อต — กด “✨ ให้ AI แบ่งองก์ ฉาก และช็อต” ให้ระบบวางให้จากเรื่องย่อ แล้วค่อยแก้ทีละองก์ ทีละฉาก ทีละช็อต",
                "No shots yet — press “✨ Have AI split it into acts, scenes and shots” to lay them out from your story, then edit act by act, scene by scene, shot by shot"
              )}
        </div>
      ) : (
        storyboard()
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────

// useSearchParams needs a Suspense boundary or the build refuses to prerender.
export default function MoviePage() {
  return (
    <Suspense fallback={null}>
      <MovieStudio />
    </Suspense>
  );
}

function MovieStudio() {
  const { data: session } = useSession();
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const openId = Number(search.get("p")) || null;
  const songId = Number(search.get("song"));
  const songTrack = Number(search.get("track") ?? 0);
  const fromSong =
    search.get("new") === "mv" && Number.isInteger(songId) && songId > 0 && Number.isInteger(songTrack) && songTrack >= 0
      ? { id: songId, track: songTrack }
      : null;
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [creating, setCreating] = useState(fromSong !== null);

  useEffect(() => {
    if (session === null) router.push(loginHref());
  }, [session, router]);

  const loadList = useCallback(async () => {
    const r = await getJson<{ projects: ProjectRow[] }>("/api/story");
    setProjects(r.ok ? r.data.projects : []);
  }, []);

  useEffect(() => {
    if (!session || openId) return;
    let active = true;
    getJson<{ projects: ProjectRow[] }>("/api/story").then((r) => {
      if (active) setProjects(r.ok ? r.data.projects : []);
    });
    return () => {
      active = false;
    };
  }, [session, openId]);

  const open = (id: number | null) => {
    setCreating(false);
    router.push(id ? `/movie?p=${id}` : "/movie");
    if (!id) loadList();
  };

  if (!session) return null;

  return (
    <>
      <PageHero
        image="/showcase/hero-reel.jpg"
        eyebrow={t("· สตูดิโอหนัง & MV", "· Film & MV studio")}
        title={t("เล่าเรื่องเป็น", "Tell your story as")}
        emphasis={t("หนังทั้งเรื่อง", "a whole film")}
        hue={300}
        size="slim"
        sub={t(
          "เขียนเรื่องหรือใส่เพลง → AI แบ่งเป็นองก์ ฉาก และช็อตพร้อมมุมกล้องและบทพูดไทย → ตัวละคร ของ และสถานที่จากคลังอ้างอิงเหมือนเดิมทุกช็อต → แก้และสร้างใหม่ได้ทีละองก์ ทีละฉาก ทีละช็อต",
          "Write a story or bring a song → AI splits it into acts, scenes and shots with camera angles and dialogue → characters, props and places from your reference library stay the same in every shot → edit and remake act by act, scene by scene, shot by shot"
        )}
      />
      <div style={{ padding: "0 16px 80px", maxWidth: 1000, margin: "0 auto", color: "#f1f5f9", display: "flex", flexDirection: "column", gap: 20 }}>
        {openId ? (
          <ProjectEditor key={openId} id={openId} onBack={() => open(null)} />
        ) : creating ? (
          <>
            <button style={{ ...btn, alignSelf: "flex-start" }} onClick={() => setCreating(false)}>{t("← กลับ", "← Back")}</button>
            <NewProject onCreated={(id) => open(id)} fromSong={fromSong} />
          </>
        ) : (
          <>
            <button style={{ ...primary, alignSelf: "flex-start" }} onClick={() => setCreating(true)}>{t("+ โปรเจกต์ใหม่", "+ New project")}</button>
            {projects === null ? (
              <div style={{ color: "#94a3b8" }}>{t("กำลังโหลด…", "Loading…")}</div>
            ) : projects.length === 0 ? (
              <div style={{ ...card, color: "#94a3b8" }}>{t("ยังไม่มีโปรเจกต์ — เริ่มจากเรื่องสั้น ๆ หรือเพลงที่ชอบได้เลย", "No projects yet — start with a short story or a song you love")}</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
                {projects.map((p) => (
                  <button key={p.id} onClick={() => open(p.id)} style={{ ...card, padding: 0, overflow: "hidden", cursor: "pointer", color: "#fff", textAlign: "left", fontFamily: "inherit" }}>
                    <div style={{ height: 120, background: "rgba(2,6,23,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>
                      {p.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : p.mode === "mv" ? "🎵" : "🎬"}
                    </div>
                    <div style={{ padding: 12 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {p.mode === "mv" ? "MV" : t("หนัง", "Film")} · {t(`${p.shots} ช็อต`, plural(p.shots, "shot"))} · {formatDate(p.updatedAt, locale)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
