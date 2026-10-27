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
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHero } from "@/components/xdreamer/page-hero";
import { useToast } from "@/components/ui/toast-provider";
import { loginHref } from "@/lib/safe-callback";
import { ASPECTS, CAMERA_MOVES, LIMITS, LOOKS, MOODS, SHOT_SIZES } from "@/lib/story/cinematic";

interface Character {
  id?: number;
  name: string;
  description: string;
  referenceUrl: string | null;
}
interface Shot {
  id: number;
  number: number;
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
}
interface Project {
  id: number;
  mode: "film" | "mv";
  title: string;
  brief: string;
  look: string;
  mood: string | null;
  aspect: string;
  songUrl: string | null;
  songSeconds: number | null;
  status: string;
  characters: (Character & { id: number })[];
  shots: Shot[];
}
interface Model {
  id: number;
  key: string;
  name: string;
  orderable: boolean;
}
interface ProjectView {
  project: Project;
  models: Model[];
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
}: {
  shot: Shot;
  project: Project;
  models: Model[];
  onSave: (patch: Partial<Shot>) => Promise<boolean>;
  onRender: () => void;
  onDelete: () => void;
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
      {shot.status === "failed" && shot.error && <div style={{ fontSize: 13, color: "#fca5a5" }}>{shot.error}</div>}

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
                  {m.name}{m.orderable ? "" : " (ยังไม่เปิด)"}
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
      </fieldset>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {dirty && !locked && (
          <button style={btn} disabled={saving} onClick={save}>{saving ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button>
        )}
        <button
          style={{ ...primary, opacity: locked || dirty || !model?.orderable ? 0.5 : 1 }}
          disabled={locked || dirty || !model?.orderable}
          title={dirty ? "บันทึกการแก้ไขก่อน" : undefined}
          onClick={onRender}
        >
          {shot.status === "done" ? "สร้างใหม่" : shot.status === "failed" ? "ลองอีกครั้ง" : "สร้างช็อตนี้"}
          {shot.credits !== null && ` · ${shot.credits} เครดิต`}
        </button>
        {shot.generationId && <Link href="/gallery" style={{ fontSize: 12, color: "#94a3b8" }}>ดูในแกลเลอรี</Link>}
        <span style={{ flex: 1 }} />
        <button style={{ ...btn, padding: "6px 10px", color: "#fca5a5" }} disabled={locked} onClick={onDelete}>ลบช็อต</button>
      </div>
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
  };
}

const sameEdit = (a: Shot, b: Shot) => JSON.stringify(pickEditable(a)) === JSON.stringify(pickEditable(b));

// ─── Project editor ─────────────────────────────────────────────────────

function ProjectEditor({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const [view, setView] = useState<ProjectView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cast, setCast] = useState<Character[] | null>(null);
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
  useEffect(() => {
    if (!rendering) return;
    let active = true;
    const timer = setInterval(async () => {
      const r = await getJson<ProjectView>(`/api/story/${id}`);
      if (active && r.ok) setView(r.data);
    }, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [rendering, id]);

  if (missing) {
    return (
      <div style={card}>
        ไม่พบโปรเจกต์นี้ <button style={btn} onClick={onBack}>กลับ</button>
      </div>
    );
  }
  if (!view) return <div style={{ ...card, color: "#94a3b8" }}>กำลังโหลด…</div>;
  const { project, models } = view;

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
      const warn = done > 0
        ? `ให้ AI วางช็อตใหม่ทั้งหมด? ช็อตเดิม ${project.shots.length} ช็อตจะถูกแทนที่ (คลิปที่สร้างแล้ว ${done} คลิปยังอยู่ในแกลเลอรี)`
        : `ให้ AI วางช็อตใหม่ทั้งหมด? ช็อตเดิม ${project.shots.length} ช็อตและที่แก้ไว้จะถูกแทนที่`;
      if (!confirm(warn)) return;
    }
    const data = await act<ProjectView & { planner: "ai" | "rules" }>("plan", `/api/story/${id}/plan`, { method: "POST" });
    if (!data) return;
    setView(data);
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

  const saveSettings = async () => {
    const body: Record<string, unknown> = {};
    if (cast) body.characters = cast.filter((c) => c.name.trim() || c.referenceUrl);
    if (brief !== null) body.brief = brief;
    const data = await act<ProjectView>("settings", `/api/story/${id}`, sendJson("PATCH", body));
    if (!data) return;
    setView(data);
    setCast(null);
    setBrief(null);
    toast("success", "บันทึกแล้ว");
  };

  const remove = async () => {
    if (!confirm(`ลบโปรเจกต์ "${project.title}"? สตอรีบอร์ดจะหายถาวร (คลิปที่สร้างแล้วยังอยู่ในแกลเลอรี)`)) return;
    const data = await act("delete", `/api/story/${id}`, { method: "DELETE" });
    if (data) onBack();
  };

  const renderable = project.shots.filter((s) => s.status === "pending" || s.status === "failed");
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
          <summary style={{ cursor: "pointer", fontSize: 13, color: "#d8b4fe" }}>แก้{project.mode === "mv" ? "เนื้อเพลง" : "เรื่องย่อ"}และตัวละคร</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <textarea style={{ ...field, minHeight: 140, resize: "vertical" }} maxLength={LIMITS.brief} value={brief ?? project.brief} onChange={(e) => setBrief(e.target.value)} />
            <CharacterEditor value={cast ?? project.characters} onChange={setCast} />
            {(cast !== null || brief !== null) && (
              <div style={{ display: "flex", gap: 8 }}>
                <button style={primary} disabled={busy !== null} onClick={saveSettings}>บันทึก</button>
                <button style={btn} onClick={() => { setCast(null); setBrief(null); }}>ยกเลิก</button>
              </div>
            )}
          </div>
        </details>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...primary, opacity: busy || rendering ? 0.6 : 1 }} disabled={busy !== null || rendering} onClick={plan} title={rendering ? "รอช็อตที่กำลังสร้างให้เสร็จก่อน" : undefined}>
            {busy === "plan" ? "AI กำลังวางช็อต… (อาจถึง 1 นาที)" : project.shots.length ? "✨ ให้ AI วางช็อตใหม่" : "✨ ให้ AI แตกช็อต"}
          </button>
          {renderable.length > 0 && (
            <button style={btn} disabled={busy !== null} onClick={() => render(renderable)}>
              {busy === "render" ? "กำลังสั่ง…" : `สร้างช็อตที่เหลือ ${renderable.length} ช็อต · ${allCredits.toLocaleString()} เครดิต`}
            </button>
          )}
          <button style={btn} disabled={busy !== null} onClick={addShot}>+ เพิ่มช็อตเอง</button>
          <button style={btn} disabled={busy !== null} onClick={() => load()}>รีเฟรช</button>
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          แต่ละช็อตคิดเครดิตตอนกดสร้าง ถ้าสร้างไม่สำเร็จจะคืนเครดิตอัตโนมัติ · การตัดต่อรวมเป็นไฟล์เดียว (ซับไทย ดนตรี) จะตามมาในเฟสถัดไป
        </div>
      </div>

      {project.shots.length === 0 ? (
        <div style={{ ...card, color: "#94a3b8", textAlign: "center" }}>
          ยังไม่มีช็อต — กด “✨ ให้ AI แตกช็อต” ให้ระบบวางให้จาก{project.mode === "mv" ? "เพลงและเนื้อเพลง" : "เรื่องย่อ"} แล้วค่อยแก้ทีละช็อต
        </div>
      ) : (
        project.shots.map((s) => (
          <ShotCard
            key={s.id}
            shot={s}
            project={project}
            models={models}
            onSave={(patch) => saveShot(s, patch)}
            onRender={() => render([s])}
            onDelete={() => deleteShot(s)}
          />
        ))
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
        sub="เขียนเรื่องหรือใส่เพลง → AI แตกเป็นช็อตพร้อมมุมกล้องและบทพูดไทย → แก้ได้ทุกช็อต → สร้างทีละช็อตด้วยตัวละครหน้าเดิม"
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
