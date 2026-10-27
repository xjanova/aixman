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
import { ASPECTS, CAMERA_MOVES, FILM_LENGTHS, LIMITS, LOOKS, MOODS, SHOT_SIZES } from "@/lib/story/cinematic";

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
  kinds: Record<AssetKind, { label: string; max: number }>;
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
  /** What pictures it takes, in Thai (reference-caps.ts). */
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

const STATUS_LABEL: Record<Shot["status"], { text: string; color: string }> = {
  pending: { text: "ยังไม่สร้าง", color: "#94a3b8" },
  rendering: { text: "กำลังสร้าง…", color: "#fbbf24" },
  done: { text: "เสร็จแล้ว", color: "#34d399" },
  failed: { text: "ไม่สำเร็จ", color: "#f87171" },
};

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* Network calls return failures as values — see the React Compiler note in referral/page.tsx. */
async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json();
    return res.ok ? { ok: true, data: data as T } : { ok: false, error: String(data.error || "ไม่สำเร็จ") };
  } catch {
    return { ok: false, error: "เชื่อมต่อไม่ได้" };
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
  const [uploading, setUploading] = useState<number | null>(null);
  const set = (k: number, patch: Partial<Character>) => onChange(value.map((c, i) => (i === k ? { ...c, ...patch } : c)));

  const pick = async (k: number, file: File | undefined) => {
    if (!file) return;
    setUploading(k);
    const r = await uploadFile(file, "image");
    setUploading(null);
    if (!r.ok) toast("error", r.error);
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
            ) : uploading === k ? "กำลังอัปโหลด…" : "อัปโหลดภาพ\nหน้าตรง"}
            <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => pick(k, e.target.files?.[0])} />
          </label>
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
            <input style={field} maxLength={LIMITS.characterName} placeholder="ชื่อตัวละคร" value={c.name} onChange={(e) => set(k, { name: e.target.value })} />
            <input style={field} maxLength={LIMITS.characterDescription} placeholder="หน้าตา การแต่งกาย (อังกฤษได้ผลดีที่สุด) เช่น young woman, pink twin tails, red dress" value={c.description} onChange={(e) => set(k, { description: e.target.value })} />
          </div>
          <button style={{ ...btn, padding: "6px 10px" }} onClick={() => onChange(value.filter((_, i) => i !== k))} title="เอาตัวละครนี้ออก">✕</button>
        </div>
      ))}
      {value.length < LIMITS.characters && (
        <button style={{ ...btn, alignSelf: "flex-start" }} onClick={() => onChange([...value, { name: "", description: "", referenceUrl: null }])}>
          + เพิ่มตัวละคร
        </button>
      )}
      <div style={{ fontSize: 12, color: "#94a3b8" }}>
        ภาพตัวละครจะเป็นเฟรมแรกของทุกช็อตที่ตัวละครนั้นนำ หน้าจึงเหมือนเดิมทุกช็อต — ใช้ภาพหน้าตรง เห็นหน้าชัด ระยะครึ่งตัวหรือใกล้กว่า
      </div>
    </div>
  );
}

// ─── New project ────────────────────────────────────────────────────────

function NewProject({ onCreated }: { onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"film" | "mv">("film");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [look, setLook] = useState("film");
  const [filmLength, setFilmLength] = useState("auto");
  const [mood, setMood] = useState("romantic");
  const [aspect, setAspect] = useState("16:9");
  const [characters, setCharacters] = useState<Character[]>([{ name: "", description: "", referenceUrl: null }]);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [song, setSong] = useState<{ kind: "upload"; url: string; name: string; seconds: number | null } | { kind: "mine"; id: number; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingSong, setUploadingSong] = useState(false);

  useEffect(() => {
    if (mode !== "mv" || songs) return;
    let active = true;
    getJson<{ songs: Song[] }>("/api/story/songs").then((r) => {
      if (active) setSongs(r.ok ? r.data.songs : []);
    });
    return () => {
      active = false;
    };
  }, [mode, songs]);

  const pickSong = async (file: File | undefined) => {
    if (!file) return;
    setUploadingSong(true);
    const r = await uploadFile(file, "audio");
    setUploadingSong(false);
    if (!r.ok) return toast("error", r.error);
    setSong({ kind: "upload", url: r.data.url, name: file.name, seconds: r.data.durationSeconds });
  };

  const chooseMine = (s: Song) => {
    setSong({ kind: "mine", id: s.id, title: s.title });
    // Fill the lyrics the song was made with, but never over the customer's own.
    if (s.lyrics && !brief.trim()) setBrief(s.lyrics);
  };

  const create = async () => {
    if (busy) return;
    if (mode === "mv" && !song) return toast("error", "เลือกเพลงก่อน");
    if (!brief.trim()) return toast("error", mode === "mv" ? "ใส่เนื้อเพลงให้ครบก่อน" : "เขียนเรื่องย่อก่อน");
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
        song: song?.kind === "upload" ? { uploadUrl: song.url } : song?.kind === "mine" ? { generationId: song.id } : undefined,
      })
    );
    setBusy(false);
    if (!r.ok) return toast("error", r.error);
    onCreated(r.data.id);
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={chip(mode === "film")} onClick={() => setMode("film")}>🎬 โหมดหนัง</button>
        <button style={chip(mode === "mv")} onClick={() => setMode("mv")}>🎵 โหมด MV</button>
      </div>

      <div>
        <span style={label}>ชื่อโปรเจกต์ (เว้นว่างได้ AI จะตั้งให้)</span>
        <input style={field} maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {mode === "mv" && (
        <div>
          <span style={label}>เพลง (ยาวไม่เกิน {LIMITS.maxSongSeconds / 60} นาที)</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ ...btn, display: "inline-block" }}>
              {uploadingSong ? "กำลังอัปโหลด…" : "อัปโหลดเพลงเอง"}
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
              <span style={{ fontSize: 12, color: "#94a3b8" }}>หรือเลือกเพลงที่สร้างบนเว็บ:</span>
              {songs.map((s) => (
                <button key={s.id} style={{ ...chip(song?.kind === "mine" && song.id === s.id), textAlign: "left" }} onClick={() => chooseMine(s)}>
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
            ? "เนื้อเพลงฉบับเต็ม — ใส่ [Verse] [Chorus] [Solo] ได้ ระบบวางช็อตตามจังหวะเพลง"
            : "เรื่องย่อหรือบท — ใส่บทพูดใน \"เครื่องหมายคำพูด\" ตัวละครจะพูดเป็นภาษาไทย"}
        </span>
        <textarea style={{ ...field, minHeight: 180, resize: "vertical" }} maxLength={LIMITS.brief} value={brief} onChange={(e) => setBrief(e.target.value)} />
        <div style={{ fontSize: 11, color: "#64748b", textAlign: "right" }}>{brief.length.toLocaleString()} / {LIMITS.brief.toLocaleString()}</div>
      </div>

      {mode === "mv" ? (
        <div>
          <span style={label}>อารมณ์ MV</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(MOODS).map(([key, m]) => (
              <button key={key} style={chip(mood === key)} onClick={() => setMood(key)}>{m.label}</button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <span style={label}>สไตล์ภาพ</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(LOOKS).map(([key, l]) => (
              <button key={key} style={chip(look === key)} onClick={() => setLook(key)}>{l.label}</button>
            ))}
          </div>
        </div>
      )}

      {mode === "film" && (
        <div>
          <span style={label}>ความยาวหนัง</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(FILM_LENGTHS).map(([key, l]) => (
              <button key={key} style={chip(filmLength === key)} onClick={() => setFilmLength(key)}>{l.label}</button>
            ))}
          </div>
          {FILM_LENGTHS[filmLength]?.seconds && (
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
              ประมาณ {Math.round(FILM_LENGTHS[filmLength].seconds! / 8)} ช็อต · AI แต่งเรื่องเพิ่มจากเรื่องย่อให้ยาวพอ · คิดเครดิตตอนสร้างแต่ละช็อต
            </p>
          )}
        </div>
      )}

      <div>
        <span style={label}>สัดส่วนภาพ</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(ASPECTS).map(([key, a]) => (
            <button key={key} style={chip(aspect === key)} onClick={() => setAspect(key)}>{a.label}</button>
          ))}
        </div>
      </div>

      <div>
        <span style={label}>{mode === "mv" ? "นักร้อง / ตัวละครใน MV" : "ตัวละคร"}</span>
        <CharacterEditor value={characters} onChange={setCharacters} />
      </div>

      <button style={{ ...primary, alignSelf: "flex-start", opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={create}>
        {busy ? (mode === "mv" ? "กำลังอ่านเพลง…" : "กำลังสร้าง…") : "สร้างโปรเจกต์ (ยังไม่ตัดเครดิต)"}
      </button>
    </div>
  );
}

// ─── One shot ───────────────────────────────────────────────────────────

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
          ช็อต {shot.number}
          {project.mode === "mv" && shot.startSec !== null && (
            <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 12 }}> · {fmtTime(shot.startSec)}–{fmtTime(shot.startSec + shot.durationSec)}</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: st.color }}>{st.text}</span>
      </div>

      {shot.mediaUrl && (
        <video src={shot.mediaUrl} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: 360, borderRadius: 12, background: "#000" }} />
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", padding: 10, borderRadius: 12, background: "rgba(2,6,23,0.35)" }}>
        <div style={{ width: 160, aspectRatio: project.aspect.replace(":", " / "), maxHeight: 200, borderRadius: 10, overflow: "hidden", background: "rgba(2,6,23,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b", textAlign: "center", flexShrink: 0 }}>
          {kf.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={kf.url} target="_blank" rel="noreferrer"><img src={kf.url} alt="ภาพเปิดช็อต" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></a>
          ) : kf.state === "rendering" ? "กำลังสร้างภาพเปิด…" : "ยังไม่มีภาพเปิด"}
        </div>
        <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#94a3b8" }}>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>ภาพเปิดช็อต</div>
          <div>
            รวมตัวละคร ของ และสถานที่ของช็อตเป็นภาพเดียว แล้วคลิปเริ่มจากภาพนี้
            {kf.wanted > 0 && keyModel ? ` · ส่งภาพอ้างอิง ${kf.sent}/${kf.wanted} ภาพ (${keyModel.name} ${keyModel.label.replace("รับภาพอ้างอิงได้ ", "รับได้ ")})` : kf.wanted === 0 ? " · ช็อตนี้ยังไม่มีภาพอ้างอิง (ใส่ภาพในคลังก่อน)" : ""}
          </div>
          {kf.state === "failed" && kf.error && <div style={{ color: "#fca5a5" }}>{kf.error}</div>}
          {kf.url && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={kf.use} disabled={locked} onChange={(e) => onKeyframeUse(e.target.checked)} />
              ใช้ภาพนี้เป็นเฟรมแรกของคลิป (ปิด = ใช้ภาพตัวละครนำ)
            </label>
          )}
          <div>
            <button
              style={{ ...btn, padding: "6px 12px", opacity: !keyModel || kf.state === "rendering" || dirty ? 0.5 : 1 }}
              disabled={!keyModel || kf.state === "rendering" || dirty}
              title={!keyModel ? "ยังไม่มีโมเดลภาพที่รับภาพอ้างอิงเปิดให้ใช้" : dirty ? "บันทึกการแก้ไขก่อน" : undefined}
              onClick={onKeyframe}
            >
              {kf.state === "rendering" ? "กำลังสร้าง…" : kf.url ? "🖼 สร้างภาพเปิดใหม่" : "🖼 สร้างภาพเปิด"}
              {keyModel && ` · ${keyModel.credits} เครดิต`}
            </button>
          </div>
        </div>
      </div>
      {shot.status === "failed" && shot.error && <div style={{ fontSize: 13, color: "#fca5a5" }}>{shot.error}</div>}
      {shot.lipsync && shot.status === "done" && <DubRow shot={shot} vocals={vocals} onLipsync={onLipsync} onDubUse={onDubUse} />}

      <fieldset disabled={locked} style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, opacity: locked ? 0.6 : 1 }}>
        <div>
          <span style={label}>ภาพที่เห็น (อังกฤษได้ผลดีที่สุด)</span>
          <textarea style={{ ...field, minHeight: 70, resize: "vertical" }} maxLength={LIMITS.visual} value={draft.visual} onChange={(e) => set({ visual: e.target.value })} />
        </div>
        <div>
          <span style={label}>{project.mode === "mv" ? "เนื้อเพลงช่วงนี้ (ใช้เป็นข้อมูล ไม่ให้โมเดลร้อง)" : "บทพูด (ภาษาไทย เว้นว่าง = ไม่มีพูด)"}</span>
          <input style={field} maxLength={LIMITS.line} value={draft.line} onChange={(e) => set({ line: e.target.value })} />
        </div>
        {project.mode === "film" && (
          <div>
            <span style={label}>เสียงประกอบ</span>
            <input style={field} maxLength={LIMITS.sound} placeholder="เช่น ฝนตก ลมพัด เสียงเทียนไหม้" value={draft.sound} onChange={(e) => set({ sound: e.target.value })} />
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div>
            <span style={label}>ระยะภาพ</span>
            <select style={field} value={draft.shotSize} onChange={(e) => set({ shotSize: e.target.value })}>
              {Object.entries(SHOT_SIZES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>กล้อง</span>
            <select style={field} value={draft.camera} onChange={(e) => set({ camera: e.target.value })}>
              {Object.entries(CAMERA_MOVES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>ความยาว (วินาที)</span>
            <input style={field} type="number" min={LIMITS.minShotSeconds} max={LIMITS.maxShotSeconds} step={project.mode === "mv" ? 0.5 : 1} value={draft.durationSec} onChange={(e) => set({ durationSec: Number(e.target.value) })} />
          </div>
          <div>
            <span style={label}>โมเดล</span>
            <select style={field} value={draft.modelId ?? ""} onChange={(e) => set({ modelId: Number(e.target.value) || null })}>
              <option value="">— เลือก —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.orderable}>
                  {m.name} — {m.references}{m.orderable ? "" : " (ยังไม่เปิด)"}
                </option>
              ))}
            </select>
          </div>
        </div>
        {project.characters.length > 0 && (
          <div>
            <span style={label}>ตัวละครในช็อต (คนแรก = ภาพเฟรมแรก)</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {project.characters.map((c) => (
                <button key={c.id} type="button" style={chip(draft.characterIds.includes(c.id))} onClick={() => toggleCast(c.id)}>
                  {draft.characterIds[0] === c.id ? "★ " : ""}{c.name}
                </button>
              ))}
              {project.mode === "film" && draft.line.trim() && (
                <select style={{ ...field, width: "auto" }} value={draft.speakerId ?? ""} onChange={(e) => set({ speakerId: Number(e.target.value) || null })}>
                  <option value="">ผู้พูด: ไม่ระบุ</option>
                  {project.characters.filter((c) => draft.characterIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>ผู้พูด: {c.name}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
        {props.length > 0 && (
          <div>
            <span style={label}>ของ / อาวุธในช็อต</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {props.map((a) => (
                <button key={a.id} type="button" style={chip(draft.propIds.includes(a.id))} onClick={() => toggleProp(a.id)}>{a.name}</button>
              ))}
            </div>
          </div>
        )}
        {places.length > 0 && (
          <div>
            <span style={label}>สถานที่</span>
            <select style={field} value={draft.locationId ?? ""} onChange={(e) => set({ locationId: Number(e.target.value) || null })}>
              <option value="">{scenePlace ? `ตามฉาก (${scenePlace.name})` : "ไม่ระบุ"}</option>
              {places.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
      </fieldset>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {dirty && !locked && (
          <button style={btn} disabled={saving} onClick={save}>{saving ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button>
        )}
        <button
          style={{ ...primary, opacity: locked || dirty || kfBusy || !model?.orderable ? 0.5 : 1 }}
          disabled={locked || dirty || kfBusy || !model?.orderable}
          title={dirty ? "บันทึกการแก้ไขก่อน" : kfBusy ? "รอภาพเปิดช็อตเสร็จก่อน คลิปจะได้เริ่มจากภาพนั้น" : undefined}
          onClick={onRender}
        >
          {shot.status === "done" ? "สร้างใหม่" : shot.status === "failed" ? "ลองอีกครั้ง" : "สร้างช็อตนี้"}
          {shot.credits !== null && ` · ${shot.credits} เครดิต`}
        </button>
        {shot.generationId && <Link href="/gallery" style={{ fontSize: 12, color: "#94a3b8" }}>ดูในแกลเลอรี</Link>}
        <span style={{ flex: 1 }} />
        <button style={{ ...btn, padding: "6px 10px", color: "#fca5a5" }} disabled={locked || kfBusy} onClick={onDelete}>ลบช็อต</button>
      </div>
    </div>
  );
}

/** One MV shot's lip-sync: its state, the dub, and the button that orders it. */
function DubRow({ shot, vocals, onLipsync, onDubUse }: { shot: Shot; vocals: Vocals | null; onLipsync: () => void; onDubUse: (use: boolean) => void }) {
  const dub = shot.lipsync!;
  const ready = vocals?.state === "done" && vocals.dubbing;
  const why = dub.blocked ?? (!vocals?.dubbing ? "ตัวลิปซิงก์ยังไม่เปิด" : vocals.state !== "done" ? "แยกเสียงร้องก่อน (ส่วนลิปซิงก์ด้านบน)" : null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 12, background: "rgba(2,6,23,0.4)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span>🎤 ลิปซิงก์</span>
        {dub.state === "rendering" && <span style={{ color: "#fbbf24" }}>กำลังทำ… (เปิดเครื่องครั้งแรกอาจนานหลายนาที)</span>}
        {dub.state === "done" && <span style={{ color: "#34d399" }}>เสร็จแล้ว</span>}
        {dub.state === "stale" && <span style={{ color: "#fbbf24" }}>ช็อตถูกสร้างใหม่ — คลิปลิปซิงก์เดิมไม่ตรงแล้ว</span>}
        {dub.state === "failed" && <span style={{ color: "#fca5a5" }}>{dub.error ?? "ไม่สำเร็จ"}</span>}
        {dub.state === "none" && !dub.suggested && <span style={{ color: "#64748b" }}>ช็อตนี้ไม่ได้แนะนำ (ไม่มีเนื้อร้องหรือมุมกว้าง)</span>}
        <span style={{ flex: 1 }} />
        {dub.state !== "rendering" && (
          <button style={{ ...btn, padding: "6px 12px", opacity: ready && !dub.blocked ? 1 : 0.5 }} disabled={!ready || Boolean(dub.blocked)} title={why ?? undefined} onClick={onLipsync}>
            {dub.state === "none" ? "ลิปซิงก์ช็อตนี้" : "ทำใหม่"}
            {dub.credits !== null && ` · ${dub.credits} เครดิต`}
          </button>
        )}
      </div>
      {why && dub.state !== "rendering" && <div style={{ fontSize: 12, color: "#64748b" }}>{why}</div>}
      {dub.state === "done" && dub.url && (
        <>
          <video src={dub.url} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: 300, borderRadius: 10, background: "#000" }} />
          <Toggle on={dub.use} onChange={onDubUse} label="ใช้คลิปลิปซิงก์นี้ตอนตัดต่อ" hint="ปิด = ใช้คลิปเดิมที่ไม่ได้ขยับปากตามเพลง" />
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
const KIND_HINT: Record<AssetKind, string> = {
  character: "หน้าตา การแต่งกาย (อังกฤษได้ผลดีที่สุด) เช่น young Thai woman, long black hair, red silk dress",
  prop: "รูปร่าง วัสดุ สี เช่น curved steel sword, gold hilt with a red tassel",
  location: "บรรยากาศ สถาปัตยกรรม เช่น ruined stone temple in a misty jungle, moss on the steps",
};

/** One library item: its pictures, its words, and an AI picture on demand. */
function AssetCard({ asset, pictures, busy, onAction }: { asset: Asset; pictures: Pictures; busy: string | null; onAction: (body: Record<string, unknown>, key: string) => Promise<boolean> }) {
  const { toast } = useToast();
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
    if (!r.ok) return toast("error", r.error);
    await setPictures([...asset.pictures, r.data.url]);
  };
  const draw = async () => {
    if (!model) return toast("error", "ยังไม่มีโมเดลภาพเปิดให้ใช้ตอนนี้");
    if (!desc.trim()) return toast("error", "เขียนคำอธิบายรูปลักษณ์ก่อน AI จึงวาดได้");
    const angle = asset.pictures.length > 0 ? " (มุมใหม่ ภาพเดิมยังอยู่)" : "";
    if (!confirm(`ให้ AI วาดภาพ ${asset.name}${angle}? ใช้ ${model.credits} เครดิตด้วย ${model.name} (ถ้าไม่สำเร็จคืนเครดิตอัตโนมัติ)`)) return;
    if (await onAction({ action: "picture", assetId: asset.id }, `asset-${asset.id}`)) toast("success", "สั่งวาดแล้ว", "ภาพจะขึ้นเองเมื่อเสร็จ");
  };
  const remove = async () => {
    if (!confirm(`ลบ "${asset.name}" ออกจากคลัง? ช็อตและฉากที่ใช้อยู่จะไม่อ้างอิงรายการนี้อีก`)) return;
    await onAction({ action: "delete", assetId: asset.id }, `asset-${asset.id}`);
  };

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", padding: 12, borderRadius: 14, background: "rgba(2,6,23,0.35)" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 360 }}>
        {asset.pictures.map((url, k) => (
          <div key={url} style={{ position: "relative", width: 76, height: 76, borderRadius: 10, overflow: "hidden", border: k === 0 ? "2px solid #c084fc" : "1px solid rgba(255,255,255,0.1)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={asset.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button type="button" title="ลบภาพนี้" disabled={busy !== null} onClick={() => confirm("ลบภาพนี้?") && setPictures(asset.pictures.filter((u) => u !== url))} style={{ position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: 10, border: "none", background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
            {k > 0 && (
              <button type="button" title="ใช้เป็นภาพหลัก" disabled={busy !== null} onClick={() => setPictures([url, ...asset.pictures.filter((u) => u !== url)])} style={{ position: "absolute", bottom: 2, left: 2, padding: "1px 5px", borderRadius: 6, border: "none", background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 10, cursor: "pointer" }}>★ หลัก</button>
            )}
          </div>
        ))}
        {!full && (
          <label style={{ width: 76, height: 76, borderRadius: 10, cursor: "pointer", border: "1px dashed rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
            {uploading ? "กำลังอัปโหลด…" : drawing ? "AI กำลังวาด…" : "+ ภาพ"}
            <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} disabled={uploading || busy !== null} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
        <input style={field} maxLength={LIMITS.characterName} placeholder="ชื่อ" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea style={{ ...field, minHeight: 56, resize: "vertical" }} maxLength={LIMITS.characterDescription} placeholder={KIND_HINT[asset.kind]} value={desc} onChange={(e) => setDesc(e.target.value)} />
        {asset.image.state === "failed" && asset.image.error && <div style={{ fontSize: 12, color: "#fca5a5" }}>{asset.image.error}</div>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {dirty && <button style={{ ...btn, padding: "6px 12px" }} disabled={busy !== null} onClick={() => onAction({ action: "update", assetId: asset.id, name, description: desc }, `asset-${asset.id}`)}>บันทึก</button>}
          <button style={{ ...btn, padding: "6px 12px", opacity: dirty || drawing || full || !model ? 0.5 : 1 }} disabled={dirty || drawing || full || !model || busy !== null} title={dirty ? "บันทึกก่อน" : full ? `มีภาพครบ ${pictures.maxPictures} ภาพแล้ว` : undefined} onClick={draw}>
            {drawing ? "AI กำลังวาด…" : asset.pictures.length ? "✨ ให้ AI วาดมุมใหม่" : "✨ ให้ AI วาดภาพ"}{model && ` · ${model.credits} เครดิต`}
          </button>
          <span style={{ flex: 1 }} />
          <button style={{ ...btn, padding: "6px 10px", color: "#fca5a5" }} disabled={busy !== null || drawing} onClick={remove}>ลบ</button>
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
  const [tab, setTab] = useState<AssetKind>("character");
  const pics = view.pictures;
  const items = view.project.library.filter((a) => a.kind === tab);
  const kind = pics.kinds[tab];
  const hasKeyModel = pics.models.some((m) => m.id === pics.keyframeModelId);
  return (
    <details style={card} open={view.project.library.length === 0 || undefined}>
      <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 600 }}>
        📚 คลังอ้างอิง <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 400 }}>· ตัวละคร {view.project.library.filter((a) => a.kind === "character").length} · ของ {view.project.library.filter((a) => a.kind === "prop").length} · สถานที่ {view.project.library.filter((a) => a.kind === "location").length}</span>
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          ตัวละคร ของ/อาวุธ และสถานที่ที่ใช้ซ้ำทั้งเรื่อง ใส่ภาพไว้ (อัปโหลดเองหรือให้ AI วาด) แล้วระบบจะส่งภาพเหล่านี้ให้โมเดลรวมเป็น “ภาพเปิดช็อต” — หน้าตา ของ และฉากจึงเหมือนเดิมทุกช็อต รายการละไม่เกิน {pics.maxPictures} ภาพ (ภาพแรก = ภาพหลัก)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          <div>
            <span style={label}>โมเดลรวมภาพเปิดช็อต (ต้องรับภาพอ้างอิงได้)</span>
            <select style={field} value={pics.keyframeModelId ?? ""} disabled={busy !== null} onChange={(e) => onPictures({ keyframeModelId: Number(e.target.value) || null })}>
              {!hasKeyModel && <option value="">— ยังไม่มีโมเดลที่ใช้ได้ —</option>}
              {pics.models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.orderable || m.refs === 0}>
                  {m.name} — {m.label} · {m.credits} เครดิต{m.orderable ? "" : ` (${m.reason})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span style={label}>โมเดลวาดภาพในคลัง</span>
            <select style={field} value={pics.pictureModelId ?? ""} disabled={busy !== null} onChange={(e) => onPictures({ pictureModelId: Number(e.target.value) || null })}>
              {pics.pictureModelId === null && <option value="">— ยังไม่มีโมเดลที่ใช้ได้ —</option>}
              {pics.models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.orderable}>
                  {m.name} — {m.label} · {m.credits} เครดิต{m.orderable ? "" : ` (${m.reason})`}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!hasKeyModel && (
          <div style={{ fontSize: 12, color: "#fcd34d" }}>
            ตอนนี้ยังไม่มีโมเดลภาพที่รับภาพอ้างอิงเปิดให้ใช้ — คลิปจะเริ่มจากภาพตัวละครนำเหมือนเดิม (ของและสถานที่ใช้คำบรรยายแทน)
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(pics.kinds) as AssetKind[]).map((k) => (
            <button key={k} type="button" style={chip(tab === k)} onClick={() => setTab(k)}>
              {KIND_ICON[k]} {pics.kinds[k].label} ({view.project.library.filter((a) => a.kind === k).length})
            </button>
          ))}
        </div>
        {items.length === 0 && <div style={{ fontSize: 13, color: "#64748b" }}>ยังไม่มี{kind.label} — เพิ่มเอง หรือกด “✨ ให้ AI แตกช็อต” ให้ AI เสนอสถานที่และของสำคัญของเรื่องให้</div>}
        {items.map((a) => (
          <AssetCard key={`${a.id}:${a.name}:${a.description}`} asset={a} pictures={pics} busy={busy} onAction={onAction} />
        ))}
        {items.length < kind.max && (
          <button style={{ ...btn, alignSelf: "flex-start" }} disabled={busy !== null} onClick={() => onAction({ action: "add", kind: tab, name: "", description: "" }, "asset-add")}>
            + เพิ่ม{kind.label}
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
  onPlan: (sceneIds: number[], what: string) => void;
  onKeyframes: (shots: Shot[]) => void;
  onRender: (shots: Shot[]) => void;
}

// A shot whose opening picture is still being made waits for it.
const renderableOf = (shots: Shot[]) => shots.filter((s) => (s.status === "pending" || s.status === "failed") && s.keyframe.state !== "rendering");

/** The buttons that act on every shot of a scene or an act. */
function ScopeButtons({ shots, sceneIds, what, actions, hasKeyModel }: { shots: Shot[]; sceneIds: number[]; what: string; actions: ScopeActions; hasKeyModel: boolean }) {
  const rendering = shots.some((s) => s.status === "rendering");
  const todo = renderableOf(shots);
  const small = { ...btn, padding: "5px 10px", fontSize: 12 };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {sceneIds.length > 0 && (
        <button style={small} disabled={actions.busy !== null || actions.planning || rendering} title={rendering ? "รอช็อตที่กำลังสร้างให้เสร็จก่อน" : undefined} onClick={() => actions.onPlan(sceneIds, what)}>
          ✨ วางช็อต{what}ใหม่
        </button>
      )}
      {shots.length > 0 && hasKeyModel && (
        <button style={small} disabled={actions.busy !== null} onClick={() => actions.onKeyframes(shots)}>🖼 ภาพเปิดทั้ง{what}</button>
      )}
      {todo.length > 0 && (
        <button style={small} disabled={actions.busy !== null} onClick={() => actions.onRender(todo)}>🎬 สร้างคลิปที่เหลือ {todo.length} ช็อต</button>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: scene.title, summary: scene.summary, locationId: scene.locationId, timeOfDay: scene.timeOfDay, actId: scene.actId });
  const place = places.find((a) => a.id === scene.locationId);
  const seconds = shots.reduce((n, s) => n + s.durationSec, 0);
  const save = async () => {
    if (await onStructure({ action: "update-scene", sceneId: scene.id, ...draft })) setEditing(false);
  };
  const remove = async () => {
    const rendering = shots.some((s) => s.status === "rendering");
    if (rendering) return alert("มีช็อตในฉากนี้กำลังสร้างอยู่ รอให้เสร็จก่อน");
    if (!confirm(shots.length ? `ลบฉาก ${scene.number} พร้อมช็อตในฉาก ${shots.length} ช็อต? (คลิปที่สร้างแล้วยังอยู่ในแกลเลอรี)` : `ลบฉาก ${scene.number}?`)) return;
    await onStructure({ action: "delete-scene", sceneId: scene.id, withShots: true });
  };
  return (
    <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input style={field} maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="ชื่อฉาก" />
          <textarea style={{ ...field, minHeight: 60 }} maxLength={1200} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder="เกิดอะไรขึ้นในฉากนี้ (ใช้ตอนให้ AI วางช็อตใหม่)" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            <select style={field} value={draft.locationId ?? ""} onChange={(e) => setDraft({ ...draft, locationId: Number(e.target.value) || null })}>
              <option value="">สถานที่: ไม่ระบุ</option>
              {places.map((a) => <option key={a.id} value={a.id}>สถานที่: {a.name}</option>)}
            </select>
            <select style={field} value={draft.timeOfDay ?? ""} onChange={(e) => setDraft({ ...draft, timeOfDay: e.target.value || null })}>
              <option value="">เวลา: ไม่ระบุ</option>
              {Object.entries(times).map(([k, t]) => <option key={k} value={k}>เวลา: {t}</option>)}
            </select>
            {acts.length > 0 && (
              <select style={field} value={draft.actId ?? ""} onChange={(e) => setDraft({ ...draft, actId: Number(e.target.value) || null })}>
                <option value="">องก์: ไม่ระบุ</option>
                {acts.map((a) => <option key={a.id} value={a.id}>องก์ {a.number}: {a.title}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={primary} disabled={actions.busy !== null} onClick={save}>บันทึกฉาก</button>
            <button style={btn} onClick={() => setEditing(false)}>ยกเลิก</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600 }}>ฉาก {scene.number} · {scene.title}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {place ? `📍 ${place.name}` : "📍 ไม่ระบุสถานที่"}{scene.timeOfDay ? ` · ${times[scene.timeOfDay] ?? ""}` : ""} · {shots.length} ช็อต {fmtTime(seconds)}
            </div>
            <span style={{ flex: 1 }} />
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12 }} onClick={() => setEditing(true)}>✎ แก้ฉาก</button>
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12, color: "#fca5a5" }} disabled={actions.busy !== null} onClick={remove}>ลบฉาก</button>
          </div>
          {scene.summary && <div style={{ fontSize: 13, color: "#cbd5e1" }}>{scene.summary}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <ScopeButtons shots={shots} sceneIds={[scene.id]} what="ฉากนี้" actions={actions} hasKeyModel={hasKeyModel} />
            <button style={{ ...btn, padding: "5px 10px", fontSize: 12 }} disabled={actions.busy !== null} onClick={onAddShot}>+ ช็อตในฉากนี้</button>
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
          <textarea style={{ ...field, minHeight: 56 }} maxLength={1200} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="สรุปองก์" />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={primary} disabled={actions.busy !== null} onClick={save}>บันทึกองก์</button>
            <button style={btn} onClick={() => setEditing(false)}>ยกเลิก</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#7dd3fc" }}>องก์ {act.number} · {act.title}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{sceneIds.length} ฉาก · {shots.length} ช็อต · {fmtTime(shots.reduce((n, s) => n + s.durationSec, 0))}</div>
            <span style={{ flex: 1 }} />
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12 }} onClick={() => setEditing(true)}>✎ แก้องก์</button>
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12 }} disabled={actions.busy !== null} onClick={() => onStructure({ action: "add-scene", actId: act.id })}>+ ฉาก</button>
            <button style={{ ...btn, padding: "4px 10px", fontSize: 12, color: "#fca5a5" }} disabled={actions.busy !== null} onClick={() => confirm(`ลบองก์ ${act.number}? ฉากและช็อตในองก์ยังอยู่ (ย้ายไปไม่ระบุองก์)`) && onStructure({ action: "delete-act", actId: act.id })}>ลบองก์</button>
          </div>
          {act.summary && <div style={{ fontSize: 13, color: "#cbd5e1" }}>{act.summary}</div>}
          <ScopeButtons shots={shots} sceneIds={sceneIds} what="ทั้งองก์" actions={actions} hasKeyModel={hasKeyModel} />
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
  const [v, setV] = useState(value);
  const commit = () => v !== value && onCommit(v);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", marginLeft: 26, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ fontSize: 12, color: "#94a3b8" }}>ความดัง</span>
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
      <div style={{ fontSize: 17, fontWeight: 600 }}>รับงานแบบไหน</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={option(delivery === "separate")} onClick={() => setDelivery("separate")}>
          <div style={{ fontWeight: 600 }}>📁 ไฟล์แยกทีละช็อต</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>ฟรี · นำไปตัดต่อเองในโปรแกรมที่ถนัด</div>
        </button>
        <button style={option(delivery === "film")} onClick={() => setDelivery("film")}>
          <div style={{ fontWeight: 600 }}>🎞️ ตัดต่อเป็นหนังไฟล์เดียว</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {film.credits > 0 ? `${film.credits} เครดิต` : done ? "ฟรี" : "คิดตามความยาว"} · ระบบต่อช็อต ใส่เสียง เพลง ซับให้
          </div>
        </button>
      </div>

      {delivery === "separate" ? (
        done === 0 ? (
          <div style={{ fontSize: 13, color: "#94a3b8" }}>ยังไม่มีช็อตที่สร้างเสร็จ</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {finished.map((s) => (
              <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, flexWrap: "wrap" }}>
                <span style={{ width: 64 }}>ช็อต {s.number}</span>
                <span style={{ color: "#94a3b8", flex: 1, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.line || s.visual}</span>
                <a href={s.mediaUrl!} download={`shot-${String(s.number).padStart(2, "0")}.mp4`} target="_blank" rel="noopener noreferrer" style={{ ...btn, padding: "5px 10px", textDecoration: "none" }}>⬇ ดาวน์โหลด</a>
                {s.lipsync?.state === "done" && s.lipsync.url && (
                  <a href={s.lipsync.url} download={`shot-${String(s.number).padStart(2, "0")}-lipsync.mp4`} target="_blank" rel="noopener noreferrer" style={{ ...btn, padding: "5px 10px", textDecoration: "none" }}>⬇ ลิปซิงก์</a>
                )}
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#64748b" }}>ไฟล์คือคลิปจากโมเดลตรง ๆ (มีเสียงในคลิป ยังไม่มีซับ/เพลง)</div>
          </div>
        )
      ) : (<>
      <div style={{ fontSize: 12, color: "#64748b" }}>เปิด/ปิดได้ทุกอย่าง — ระบบนำช็อตที่เสร็จแล้วมาต่อกันตามลำดับ</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Toggle on={edit.clipAudio} onChange={(v) => onEdit({ clipAudio: v })} label="เสียงจากคลิป" hint="บทพูดไทยและเสียงบรรยากาศที่โมเดลสร้างมากับภาพ" />
          <Volume key={`c${edit.clipVolume}`} value={edit.clipVolume} disabled={!edit.clipAudio} onCommit={(v) => onEdit({ clipVolume: v })} />
          <Toggle
            on={musicOn}
            onChange={(v) => onEdit({ music: v ? (isMv ? "song" : "generate") : "off" })}
            label={isMv ? "เพลงของ MV" : "ดนตรีประกอบ (สร้างจาก ACE-Step)"}
            hint={isMv ? "ช็อตวางตามจังหวะเพลงนี้" : "ดนตรีบรรเลงตามสไตล์เรื่อง ยาวเท่าหนัง"}
          />
          <Volume key={`m${edit.musicVolume}`} value={edit.musicVolume} disabled={!musicOn} onCommit={(v) => onEdit({ musicVolume: v })} />
          {musicOn && edit.clipAudio && (
            <Toggle on={edit.duck} onChange={(v) => onEdit({ duck: v })} label="ลดเพลงลงตอนมีเสียงพูด" hint="ให้บทพูดฟังชัด" />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Toggle on={edit.subtitles} onChange={(v) => onEdit({ subtitles: v })} label={isMv ? "ซับเนื้อเพลง" : "ซับไทย"} hint={isMv ? "จากเนื้อเพลงของแต่ละช็อต" : "จากบทพูดของแต่ละช็อต"} />
          <Toggle on={edit.coverFakeSubs} onChange={(v) => onEdit({ coverFakeSubs: v })} label="เบลอตัวหนังสือมั่วที่ LTX ใส่มา" hint="เฉพาะช็อตที่สร้างด้วย LTX-2.5" />
          <Toggle on={edit.transition === "fade"} onChange={(v) => onEdit({ transition: v ? "fade" : "cut" })} label="เฟดระหว่างช็อต" hint="ปิด = ตัดชนตรง ๆ" />
          <Toggle on={edit.titleCard} onChange={(v) => onEdit({ titleCard: v })} label="ชื่อเรื่องตอนเปิด" hint={project.title} />
        </div>
      </div>

      {!isMv && musicOn && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: 12, borderRadius: 12, background: "rgba(2,6,23,0.4)" }}>
          {music.status === "done" && music.url && <audio src={music.url} controls preload="none" style={{ flex: 1, minWidth: 220 }} />}
          {music.status === "rendering" && <span style={{ fontSize: 13, color: "#fbbf24" }}>กำลังสร้างดนตรีประกอบ…</span>}
          {music.status === "failed" && <span style={{ fontSize: 13, color: "#fca5a5" }}>สร้างดนตรีไม่สำเร็จ (คืนเครดิตแล้ว)</span>}
          {music.status === "none" && <span style={{ fontSize: 13, color: "#94a3b8" }}>ยังไม่มีดนตรีประกอบ</span>}
          {music.stale && music.status === "done" && <span style={{ fontSize: 12, color: "#fbbf24" }}>เพลงสั้นกว่าหนังตอนนี้ (จะวนซ้ำ)</span>}
          {music.status !== "rendering" && (
            <button style={btn} disabled={busy !== null || !music.available || project.shots.length === 0} onClick={onMusic}>
              {busy === "music" ? "กำลังสั่ง…" : music.status === "none" ? "สร้างดนตรีประกอบ" : "สร้างใหม่"}
              {music.credits !== null && ` · ${music.credits} เครดิต`}
            </button>
          )}
          {!music.available && <span style={{ fontSize: 12, color: "#94a3b8" }}>ตัวสร้างเพลงยังไม่เปิด</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          style={{ ...primary, opacity: busy || film.status === "assembling" || done === 0 ? 0.6 : 1 }}
          disabled={busy !== null || film.status === "assembling" || done === 0}
          onClick={onAssemble}
        >
          {film.status === "assembling" ? "กำลังตัดต่อ… (ไม่กี่นาที)" : film.status === "done" ? "ตัดต่อใหม่" : "🎬 ตัดต่อเป็นหนัง"}
          {film.status !== "assembling" && film.credits > 0 && ` · ${film.credits} เครดิต`}
        </button>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>ช็อตที่เสร็จ {done} / {project.shots.length}</span>
      </div>
      {film.error && film.status !== "assembling" && <div style={{ fontSize: 13, color: "#fca5a5" }}>{film.error}</div>}
      {film.status === "done" && film.url && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <video src={film.url} controls playsInline preload="metadata" style={{ width: "100%", borderRadius: 12, background: "#000" }} />
          <a href={film.url} download target="_blank" rel="noopener noreferrer" style={{ ...btn, alignSelf: "flex-start", textDecoration: "none" }}>⬇ ดาวน์โหลดหนัง{film.seconds ? ` (${fmtTime(film.seconds)})` : ""}</a>
        </div>
      )}
      </>)}
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
      <div style={{ fontSize: 17, fontWeight: 600 }}>🎤 ลิปซิงก์เสียงร้อง</div>
      <div style={{ fontSize: 12, color: "#64748b" }}>
        ให้นักร้องในคลิปขยับปากตรงกับเพลง: ระบบแยกเสียงร้องออกจากเพลง ตัดเฉพาะช่วงของแต่ละช็อต แล้วทำลิปซิงก์ทีละช็อต (คิดเครดิตตามความยาวช็อต ไม่สำเร็จคืนเครดิต) · ได้ผลดีกับช็อตใกล้–ครึ่งตัวที่เห็นหน้าชัดตลอด
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: 12, borderRadius: 12, background: "rgba(2,6,23,0.4)" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>1. เสียงร้อง</span>
        {vocals.state === "done" && vocals.url && <audio src={vocals.url} controls preload="none" style={{ flex: 1, minWidth: 220 }} />}
        {vocals.state === "done" && <span style={{ fontSize: 12, color: "#94a3b8" }}>{vocals.source === "upload" ? "จากไฟล์ที่อัปโหลด" : "แยกจากเพลงแล้ว"}</span>}
        {working && <span style={{ fontSize: 13, color: "#fbbf24" }}>กำลังแยกเสียงร้อง… ประมาณ 2–5 นาที ปิดหน้านี้ได้</span>}
        {vocals.state === "none" && <span style={{ fontSize: 13, color: "#94a3b8" }}>ยังไม่มี</span>}
        {vocals.state === "stale" && <span style={{ fontSize: 13, color: "#fbbf24" }}>เสียงร้องเป็นของเพลงเดิม — แยกใหม่</span>}
        {vocals.state === "failed" && vocals.error && <span style={{ fontSize: 13, color: "#fca5a5" }}>{vocals.error}</span>}
        {!working && (
          <>
            {vocals.auto && (
              <button style={btn} disabled={busy !== null} onClick={onSeparate}>
                {busy === "separate" ? "กำลังเริ่ม…" : vocals.state === "done" ? "แยกใหม่" : "แยกเสียงร้องจากเพลง (ฟรี)"}
              </button>
            )}
            <button style={btn} disabled={busy !== null} onClick={() => stemInput.current?.click()}>
              {busy === "stem" ? "กำลังอัปโหลด…" : "อัปโหลดไฟล์เสียงร้องแยก"}
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
        <div style={{ fontSize: 12, color: "#64748b" }}>อัปโหลดแทร็กเสียงร้องล้วน (vocal stem) ของเพลงนี้ ยาวเท่าเพลง</div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>2. ลิปซิงก์</span>
        <button style={{ ...primary, opacity: canDub ? 1 : 0.5 }} disabled={!canDub} onClick={() => onDubAll(pending)}>
          {busy === "lipsync" ? "กำลังสั่ง…" : `ลิปซิงก์ช็อตที่ร้อง ${pending.length} ช็อต`}
          {pending.length > 0 && ` · ${cost.toLocaleString()} เครดิต`}
        </button>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          เสร็จ {dubbed} ช็อต{flying > 0 ? ` · กำลังทำ ${flying}` : ""} · เลือกทำ/ไม่ทำทีละช็อตได้ที่การ์ดช็อต
        </span>
      </div>
      {!vocals.dubbing && <div style={{ fontSize: 12, color: "#94a3b8" }}>ตัวลิปซิงก์ยังไม่เปิดให้ใช้</div>}

      <Toggle on={view.edit.lipsync} onChange={(v) => onEdit({ lipsync: v })} label="ใช้คลิปลิปซิงก์ตอนตัดต่อหนัง" hint="ปิด = ตัดต่อจากคลิปเดิมทั้งหมด" />
    </div>
  );
}

// ─── Project editor ─────────────────────────────────────────────────────

function ProjectEditor({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
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
  }, [id]);

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
      toast("success", `วางช็อตแล้ว ${view.planning.shots ?? view.project.shots.length} ช็อต`, view.planning.rules ? "ใช้ตัววางช็อตพื้นฐาน (ผู้ช่วย AI ไม่ว่าง) แก้ไขแต่ละช็อตได้ตามต้องการ" : undefined);
    } else if (planState === "failed") {
      toast("error", view.planning.error ?? "วางช็อตไม่สำเร็จ");
    }
  }, [planState, view, toast]);

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
        ไม่พบโปรเจกต์นี้ <button style={btn} onClick={onBack}>กลับ</button>
      </div>
    );
  }
  if (!view) return <div style={{ ...card, color: "#94a3b8" }}>กำลังโหลด…</div>;
  const { project, models } = view;
  const planning = view.planning?.state === "planning";

  const act = async <T,>(key: string, url: string, init: RequestInit): Promise<T | null> => {
    if (busy) return null;
    setBusy(key);
    const r = await getJson<T>(url, init);
    setBusy(null);
    if (!r.ok) {
      toast("error", r.error);
      return null;
    }
    return r.data;
  };

  const plan = async () => {
    const done = project.shots.filter((s) => s.status === "done").length;
    if (project.shots.length > 0) {
      const structure = project.scenes.length ? ` องก์และฉากเดิมจะถูกวางใหม่ด้วย (คลังอ้างอิงยังอยู่ครบ)` : "";
      const warn = done > 0
        ? `ให้ AI วางเรื่องใหม่ทั้งหมด? ช็อตเดิม ${project.shots.length} ช็อตจะถูกแทนที่ (คลิปที่สร้างแล้ว ${done} คลิปยังอยู่ในแกลเลอรี)${structure}`
        : `ให้ AI วางเรื่องใหม่ทั้งหมด? ช็อตเดิม ${project.shots.length} ช็อตและที่แก้ไว้จะถูกแทนที่${structure}`;
      if (!confirm(warn)) return;
    }
    const data = await act<ProjectView & { planner: "ai" | "rules" }>("plan", `/api/story/${id}/plan`, { method: "POST" });
    if (!data) return;
    setView(data);
    if (data.planning?.state === "planning") {
      lastPlanState.current = "planning";
      return toast("success", project.mode === "mv" ? "AI กำลังวางช็อตตามเพลง" : "AI กำลังแบ่งองก์ ฉาก และวางช็อต", "ใช้เวลาราว 1–3 นาที จะขึ้นเองเมื่อเสร็จ");
    }
    toast("success", `วางช็อตแล้ว ${data.project.shots.length} ช็อต`, data.planner === "rules" ? "ใช้ตัววางช็อตพื้นฐาน (ผู้ช่วย AI ไม่ว่าง) แก้ไขแต่ละช็อตได้ตามต้องการ" : undefined);
  };

  const render = async (shots: Shot[]) => {
    const total = shots.reduce((n, s) => n + (s.credits ?? 0), 0);
    const again = shots.filter((s) => s.status === "done").length;
    const msg = shots.length === 1
      ? `สร้างช็อต ${shots[0].number}? ใช้ ${total} เครดิต${again ? " (สร้างใหม่ทับคลิปเดิม คลิปเดิมยังอยู่ในแกลเลอรี)" : ""}`
      : `สร้าง ${shots.length} ช็อต? ใช้รวม ${total.toLocaleString()} เครดิต`;
    if (!confirm(msg)) return;
    const data = await act<ProjectView & { ordered: number; stoppedBy: string | null }>(
      "render",
      `/api/story/${id}/render`,
      sendJson("POST", { shotIds: shots.map((s) => s.id) })
    );
    if (!data) return;
    setView(data);
    if (data.stoppedBy) toast("error", `สั่งได้ ${data.ordered} ช็อต แล้วหยุด`, data.stoppedBy);
    else toast("success", `สั่งสร้าง ${data.ordered} ช็อตแล้ว`, "เครื่องแรกอาจใช้เวลาเปิดเครื่องสักครู่ ปิดหน้านี้ได้ ผลงานจะอยู่ในแกลเลอรี");
  };

  // Re-plan some scenes only — a scene, or every scene of an act.
  const planScope = async (sceneIds: number[], what: string) => {
    const shots = project.shots.filter((s) => s.sceneId !== null && sceneIds.includes(s.sceneId));
    const done = shots.filter((s) => s.status === "done").length;
    if (!confirm(`ให้ AI วางช็อต${what}ใหม่? ช็อตเดิม ${shots.length} ช็อตจะถูกแทนที่${done ? ` (คลิปที่สร้างแล้ว ${done} คลิปยังอยู่ในแกลเลอรี)` : ""} ส่วนอื่นของเรื่องไม่เปลี่ยน`)) return;
    const data = await act<ProjectView>("plan", `/api/story/${id}/plan`, sendJson("POST", { sceneIds }));
    if (!data) return;
    setView(data);
    lastPlanState.current = "planning";
    toast("success", `AI กำลังวางช็อต${what}ใหม่`, "ใช้เวลาราว 1 นาที");
  };

  const keyframes = async (shots: Shot[]) => {
    const model = view.pictures.models.find((m) => m.id === view.pictures.keyframeModelId);
    if (!model) return toast("error", "ยังไม่มีโมเดลภาพที่รับภาพอ้างอิงเปิดให้ใช้");
    const todo = shots.filter((s) => s.keyframe.state !== "rendering");
    if (todo.length === 0) return;
    const again = todo.filter((s) => s.keyframe.url).length;
    if (!confirm(`สร้างภาพเปิด ${todo.length} ช็อตด้วย ${model.name}? ใช้รวม ${(model.credits * todo.length).toLocaleString()} เครดิต${again ? ` (${again} ช็อตมีภาพเดิมอยู่ จะถูกแทนที่)` : ""}`)) return;
    const data = await act<ProjectView & { ordered: number; stoppedBy: string | null }>("keyframes", `/api/story/${id}/keyframes`, sendJson("POST", { shotIds: todo.map((s) => s.id) }));
    if (!data) return;
    setView(data);
    if (data.stoppedBy) toast("error", `สั่งได้ ${data.ordered} ภาพ แล้วหยุด`, data.stoppedBy);
    else toast("success", `สั่งสร้างภาพเปิด ${data.ordered} ภาพแล้ว`, "ภาพจะขึ้นเองเมื่อเสร็จ ตรวจภาพก่อนสร้างคลิป");
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
    if (!confirm(`ลบช็อต ${shot.number}?`)) return;
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
    toast("success", "บันทึกแล้ว");
  };

  // A switch takes effect at once on screen and is saved; a refusal puts it back.
  const saveEdit = async (patch: Partial<EditSettings>) => {
    const before = view;
    setView({ ...view, edit: { ...view.edit, ...patch } });
    const r = await getJson<ProjectView>(`/api/story/${id}`, sendJson("PATCH", { edit: patch }));
    if (r.ok) setView(r.data);
    else {
      setView(before);
      toast("error", r.error);
    }
  };

  const orderMusic = async () => {
    const what = view.music.status === "none" ? "สร้างดนตรีประกอบ" : "สร้างดนตรีประกอบใหม่ (เพลงเดิมยังอยู่ในแกลเลอรี)";
    if (!confirm(`${what}? ใช้ ${view.music.credits ?? "?"} เครดิต`)) return;
    const data = await act<ProjectView>("music", `/api/story/${id}/music`, { method: "POST" });
    if (data) {
      setView(data);
      toast("success", "สั่งสร้างดนตรีแล้ว", "เสร็จแล้วจะเล่นได้ในส่วนตัดต่อ");
    }
  };

  const assemble = async () => {
    const done = project.shots.filter((s) => s.status === "done").length;
    if (done < project.shots.length && !confirm(`ยังสร้างไม่ครบ — ตัดต่อเฉพาะ ${done} จาก ${project.shots.length} ช็อตที่เสร็จแล้ว?`)) return;
    if (view.edit.music === "generate" && view.music.status !== "done") {
      return toast("error", "ดนตรีประกอบยังไม่พร้อม", "สร้างดนตรีก่อน หรือปิดดนตรีประกอบ");
    }
    const cost = view.film.credits > 0 ? `ใช้ ${view.film.credits} เครดิต (ถ้าตัดต่อไม่สำเร็จคืนเครดิตอัตโนมัติ)` : "ไม่เสียเครดิต";
    if (!confirm(`${view.film.status === "done" ? "ตัดต่อใหม่" : "ตัดต่อเป็นหนัง"}? ${cost}`)) return;
    const data = await act<ProjectView>("assemble", `/api/story/${id}/assemble`, { method: "POST" });
    if (data) setView(data);
  };

  const separate = async () => {
    if (view.vocals?.state === "done" && !confirm("แยกเสียงร้องใหม่? เสียงร้องเดิมจะถูกแทนที่ (ฟรี)")) return;
    const data = await act<ProjectView>("separate", `/api/story/${id}/vocals`, sendJson("POST", { action: "separate" }));
    if (data) {
      setView(data);
      toast("success", "เริ่มแยกเสียงร้องแล้ว", "ประมาณ 2–5 นาที ปิดหน้านี้ได้");
    }
  };

  const uploadStem = async (file: File) => {
    if (busy) return;
    if (view.vocals?.state === "done" && !confirm("ใช้ไฟล์นี้แทนเสียงร้องเดิม?")) return;
    setBusy("stem");
    const up = await uploadFile(file, "audio");
    setBusy(null);
    if (!up.ok) return toast("error", up.error);
    const data = await act<ProjectView>("stem", `/api/story/${id}/vocals`, sendJson("POST", { uploadUrl: up.data.url }));
    if (data) {
      setView(data);
      toast("success", "ใช้ไฟล์เสียงร้องนี้แล้ว");
    }
  };

  const lipsync = async (shots: Shot[]) => {
    const total = shots.reduce((n, s) => n + (s.lipsync?.credits ?? 0), 0);
    const msg = shots.length === 1
      ? `ลิปซิงก์ช็อต ${shots[0].number}? ใช้ ${total} เครดิต (ถ้าช่วงนี้ไม่มีเสียงร้องจะไม่ทำและไม่เสียเครดิต)`
      : `ลิปซิงก์ ${shots.length} ช็อต? ใช้รวม ${total.toLocaleString()} เครดิต (ช่วงที่ไม่มีเสียงร้องจะข้ามและไม่เสียเครดิต)`;
    if (!confirm(msg)) return;
    const data = await act<ProjectView & { ordered: number }>("lipsync", `/api/story/${id}/lipsync`, sendJson("POST", { shotIds: shots.map((s) => s.id) }));
    if (data) {
      setView(data);
      toast("success", `กำลังสั่งลิปซิงก์ ${data.ordered} ช็อต`, "เครื่องแรกอาจใช้เวลาเปิดเครื่องสักครู่ ปิดหน้านี้ได้");
    }
  };

  const dubUse = async (shot: Shot, use: boolean) => {
    const data = await act<ProjectView>(`dub-${shot.id}`, `/api/story/${id}/shots/${shot.id}`, sendJson("PATCH", { lipsyncUse: use }));
    if (data) setView(data);
  };

  const remove = async () => {
    if (!confirm(`ลบโปรเจกต์ "${project.title}"? สตอรีบอร์ดจะหายถาวร (คลิปที่สร้างแล้วยังอยู่ในแกลเลอรี)`)) return;
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
        {loose.length > 0 && project.acts.length > 0 && <div style={{ fontSize: 13, color: "#94a3b8" }}>ฉากที่ไม่อยู่ในองก์ใด</div>}
        {loose.map(sceneBlock)}
        {stray.length > 0 && <div style={{ fontSize: 13, color: "#94a3b8" }}>ช็อตที่ยังไม่อยู่ในฉากใด</div>}
        {stray.map(shotCard)}
      </>
    );
  };

  const renderable = renderableOf(project.shots);
  const allCredits = renderable.reduce((n, s) => n + (s.credits ?? 0), 0);
  const doneCount = project.shots.filter((s) => s.status === "done").length;
  const totalSeconds = project.shots.reduce((n, s) => n + s.durationSec, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button style={btn} onClick={onBack}>← โปรเจกต์ทั้งหมด</button>
          <div style={{ fontSize: 20, fontWeight: 600, flex: 1, minWidth: 200 }}>
            {project.mode === "mv" ? "🎵" : "🎬"} {project.title}
          </div>
          <button style={{ ...btn, color: "#fca5a5" }} disabled={busy !== null} onClick={remove}>ลบโปรเจกต์</button>
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>
          {ASPECTS[project.aspect]?.label} · {project.mode === "mv" ? MOODS[project.mood ?? ""]?.label : LOOKS[project.look]?.label}
          {project.songSeconds ? ` · เพลงยาว ${fmtTime(project.songSeconds)}` : ""}
          {project.shots.length > 0 && ` · ${project.shots.length} ช็อต รวม ${fmtTime(totalSeconds)} · เสร็จ ${doneCount}`}
        </div>
        {project.songUrl && <audio src={project.songUrl} controls preload="none" style={{ width: "100%" }} />}

        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "#d8b4fe" }}>แก้{project.mode === "mv" ? "เนื้อเพลง" : "เรื่องย่อ"}</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <textarea style={{ ...field, minHeight: 140, resize: "vertical" }} maxLength={LIMITS.brief} value={brief ?? project.brief} onChange={(e) => setBrief(e.target.value)} />
            <div style={{ fontSize: 12, color: "#94a3b8" }}>ตัวละคร ของ และสถานที่ แก้ได้ใน “คลังอ้างอิง” ด้านล่าง</div>
            {brief !== null && (
              <div style={{ display: "flex", gap: 8 }}>
                <button style={primary} disabled={busy !== null} onClick={saveSettings}>บันทึก</button>
                <button style={btn} onClick={() => setBrief(null)}>ยกเลิก</button>
              </div>
            )}
          </div>
        </details>

        {project.mode === "film" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>ความยาวที่ให้ AI วาง:</span>
            {Object.entries(FILM_LENGTHS).map(([key, l]) => (
              <button key={key} style={chip((project.filmLength ?? "auto") === key)} disabled={busy !== null || planning} onClick={() => setFilmLength(key)}>{l.label}</button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...primary, opacity: busy || rendering || planning ? 0.6 : 1 }} disabled={busy !== null || rendering || planning} onClick={plan} title={rendering ? "รอช็อตที่กำลังสร้างให้เสร็จก่อน" : undefined}>
            {planning ? "AI กำลังวาง… (1–3 นาที)" : busy === "plan" ? "กำลังส่งให้ AI…" : project.shots.length ? "✨ ให้ AI วางเรื่องใหม่ทั้งหมด" : project.mode === "mv" ? "✨ ให้ AI แตกช็อต" : "✨ ให้ AI แบ่งองก์ ฉาก และช็อต"}
          </button>
          {renderable.length > 0 && (
            <button style={btn} disabled={busy !== null} onClick={() => render(renderable)}>
              {busy === "render" ? "กำลังสั่ง…" : `สร้างช็อตที่เหลือ ${renderable.length} ช็อต · ${allCredits.toLocaleString()} เครดิต`}
            </button>
          )}
          <button style={btn} disabled={busy !== null} onClick={addShot}>+ เพิ่มช็อตเอง</button>
          {project.mode === "film" && (
            <button style={btn} disabled={busy !== null} onClick={() => structureAction(project.acts.length ? { action: "add-act" } : { action: "add-scene" })}>
              {project.acts.length ? "+ เพิ่มองก์" : "+ เพิ่มฉาก"}
            </button>
          )}
          <button style={btn} disabled={busy !== null} onClick={() => load()}>รีเฟรช</button>
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          แต่ละช็อตคิดเครดิตตอนกดสร้าง ถ้าสร้างไม่สำเร็จจะคืนเครดิตอัตโนมัติ · ช็อตที่เสร็จแล้วนำไปตัดต่อเป็นหนังไฟล์เดียวได้ด้านล่าง
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
          ยังไม่มีช็อต — กด “✨ ให้ AI {project.mode === "mv" ? "แตกช็อต" : "แบ่งองก์ ฉาก และช็อต"}” ให้ระบบวางให้จาก{project.mode === "mv" ? "เพลงและเนื้อเพลง" : "เรื่องย่อ"} แล้วค่อยแก้ทีละองก์ ทีละฉาก ทีละช็อต
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
  const router = useRouter();
  const search = useSearchParams();
  const openId = Number(search.get("p")) || null;
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [creating, setCreating] = useState(false);

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
        eyebrow="· สตูดิโอหนัง & MV"
        title="เล่าเรื่องเป็น"
        emphasis="หนังทั้งเรื่อง"
        hue={300}
        size="slim"
        sub="เขียนเรื่องหรือใส่เพลง → AI แบ่งเป็นองก์ ฉาก และช็อตพร้อมมุมกล้องและบทพูดไทย → ตัวละคร ของ และสถานที่จากคลังอ้างอิงเหมือนเดิมทุกช็อต → แก้และสร้างใหม่ได้ทีละองก์ ทีละฉาก ทีละช็อต"
      />
      <div style={{ padding: "0 16px 80px", maxWidth: 1000, margin: "0 auto", color: "#f1f5f9", display: "flex", flexDirection: "column", gap: 20 }}>
        {openId ? (
          <ProjectEditor key={openId} id={openId} onBack={() => open(null)} />
        ) : creating ? (
          <>
            <button style={{ ...btn, alignSelf: "flex-start" }} onClick={() => setCreating(false)}>← กลับ</button>
            <NewProject onCreated={(id) => open(id)} />
          </>
        ) : (
          <>
            <button style={{ ...primary, alignSelf: "flex-start" }} onClick={() => setCreating(true)}>+ โปรเจกต์ใหม่</button>
            {projects === null ? (
              <div style={{ color: "#94a3b8" }}>กำลังโหลด…</div>
            ) : projects.length === 0 ? (
              <div style={{ ...card, color: "#94a3b8" }}>ยังไม่มีโปรเจกต์ — เริ่มจากเรื่องสั้น ๆ หรือเพลงที่ชอบได้เลย</div>
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
                        {p.mode === "mv" ? "MV" : "หนัง"} · {p.shots} ช็อต · {new Date(p.updatedAt).toLocaleDateString("th-TH")}
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
