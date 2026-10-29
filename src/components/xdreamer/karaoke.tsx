"use client";

/**
 * Thai karaoke in the browser — the words of a song lit one by one as it plays.
 *
 * The timing is made on our server (lyrics/karaoke-job.ts: the vocal
 * separated, then each letter of the customer's own lyrics aligned to it), free,
 * in a few minutes. The words are drawn here by the page's own Thai font, a
 * span per dictionary word, so a tone mark never floats off its letter and no
 * word turns into boxes. What the aligner got wrong the customer fixes by ear:
 * the whole song earlier or later, or one line started where they paused.
 *
 *   useKaraoke     where a song's timing stands, start it, follow it, save edits
 *   KaraokeStage   the player: two rows of lines, the sung part sweeping in
 *   KaraokePanel   the studio's "คาราโอเกะ" box under a finished song
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { lineAt, moveLine, shiftTiming, wordProgress, type KaraokeLine, type KaraokeTiming } from "@/lib/lyrics/karaoke";
import { KARAOKE_THEMES, type KaraokeTheme } from "@/lib/lyrics/karaoke-look";

// ─── Where a timing stands ──────────────────────────────────────────────

export interface KaraokeDocView {
  songUrl: string;
  timing: KaraokeTiming;
  /** The song with the lead vocal taken out (a minus-one), when it was made. */
  instrumentalUrl: string | null;
}

export type KaraokeStatusView =
  | { state: "none" }
  | { state: "queued" | "separating" | "aligning"; since: number }
  | { state: "failed"; error: string }
  | { state: "done"; doc: KaraokeDocView };

/** A song in the studio (the caller's upload or result), or an MV project's song and lyrics. */
export type KaraokeSpec =
  | { kind: "studio"; src: string; lyrics: string }
  | { kind: "story"; projectId: number; lyrics: string };

interface Reply {
  id?: string;
  available?: boolean;
  status?: KaraokeStatusView;
}

type Call = { ok: true; data: Reply } | { ok: false; error: string };

async function call(url: string, init: RequestInit | undefined, fallback: string): Promise<Call> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: data as Reply } : { ok: false, error: typeof data.error === "string" ? data.error : fallback };
  } catch {
    return { ok: false, error: fallback };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const WORKING = new Set(["queued", "separating", "aligning"]);
export const karaokeWorking = (s: KaraokeStatusView | null) => s !== null && WORKING.has(s.state);

interface HookState {
  key: string;
  id: string | null;
  status: KaraokeStatusView | null;
  available: boolean;
  error: string | null;
  starting: boolean;
  /** Bumped by every reply, so the next poll is scheduled even when nothing moved. */
  replies: number;
}

const fresh = (key: string): HookState => ({ key, id: null, status: null, available: true, error: null, starting: false, replies: 0 });

/**
 * A song's karaoke timing: what exists already (asked as soon as the song and
 * words are known, a moment after typing stops), `start` to make it, polled
 * while it runs, `save` for lines the customer moved. Starts nothing by itself.
 */
export function useKaraoke(spec: KaraokeSpec | null) {
  const t = useT();
  const failed = t("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง", "Couldn't connect. Please try again.");
  const src = spec?.kind === "studio" ? spec.src : null;
  const projectId = spec?.kind === "story" ? spec.projectId : null;
  const lyrics = spec?.lyrics ?? "";
  const key = spec ? `${projectId ?? ""}|${src ?? ""}|${lyrics}` : "";
  const [st, setSt] = useState<HookState>(() => fresh(key));
  // A song or words changed: what was known is of the old ones.
  const cur = st.key === key ? st : fresh(key);

  const ask = (body: Record<string, unknown> | null): Promise<Call> =>
    projectId !== null
      ? call(`/api/story/${projectId}/karaoke`, body ? json("POST", body) : undefined, failed)
      : call("/api/studio/karaoke", json("POST", { src, lyrics, ...body }), failed);

  // A reply for a song or words since changed is dropped: it would overwrite what is known of the new ones.
  const settle = (r: Call) =>
    setSt((s) =>
      s.key !== key
        ? s
        : r.ok
          ? { ...s, starting: false, error: null, id: r.data.id ?? s.id, status: r.data.status ?? s.status, available: r.data.available ?? s.available, replies: s.replies + 1 }
          : { ...s, starting: false, error: r.error, replies: s.replies + 1 }
    );

  // What already exists for this song and these words.
  useEffect(() => {
    if (!key || (src === null && projectId === null)) return;
    let live = true;
    const timer = setTimeout(() => {
      const req = projectId !== null
        ? call(`/api/story/${projectId}/karaoke`, undefined, failed)
        : call("/api/studio/karaoke", json("POST", { src, lyrics, peek: true }), failed);
      req.then((r) => {
        if (!live) return;
        setSt((s) => {
          const base = s.key === key ? s : fresh(key);
          // A refusal of the words (no Thai, too long) is shown only once they ask.
          return r.ok ? { ...base, id: r.data.id ?? null, status: r.data.status ?? null, available: r.data.available ?? true } : base;
        });
      });
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, src, projectId, lyrics, failed]);

  // Followed while it runs.
  const working = karaokeWorking(cur.status);
  const id = cur.id;
  const replies = cur.replies;
  useEffect(() => {
    if (!working || !id) return;
    let live = true;
    const timer = setTimeout(async () => {
      const r = projectId !== null
        ? await call(`/api/story/${projectId}/karaoke`, undefined, failed)
        : await call(`/api/studio/karaoke?id=${id}`, undefined, failed);
      if (!live) return;
      setSt((s) => (s.key !== key ? s : r.ok && r.data.status ? { ...s, status: r.data.status, replies: s.replies + 1 } : { ...s, replies: s.replies + 1 }));
    }, 4000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [working, id, replies, key, projectId, failed]);

  const start = async (force = false) => {
    if (!key || cur.starting) return;
    setSt({ ...cur, starting: true, error: null });
    settle(await ask({ force }));
  };

  /** Lines the customer moved, saved over the timing; false (with the reason shown) when refused. */
  const save = async (timing: KaraokeTiming): Promise<boolean> => {
    if (!id) return false;
    const r = await call("/api/studio/karaoke", json("PUT", { id, timing }), failed);
    settle(r);
    return r.ok;
  };

  return { status: cur.status, error: cur.error, starting: cur.starting, available: cur.available, start, save };
}

/** What the timing is doing, in a few words, with the minutes it has taken. */
export function karaokeProgressText(status: KaraokeStatusView, t: ReturnType<typeof useT>): string {
  if (!karaokeWorking(status) || !("since" in status)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - status.since) / 60_000));
  const took = minutes > 0 ? t(` · ${minutes} นาทีแล้ว`, ` · ${minutes} min so far`) : "";
  if (status.state === "queued") return t("รอคิว…", "Waiting in line…") + took;
  if (status.state === "separating") return t("กำลังแยกเสียงร้องออกจากดนตรี…", "Separating the vocal from the music…") + took;
  return t("กำลังจับจังหวะทีละคำ…", "Timing the words one by one…") + took;
}

// ─── The player ─────────────────────────────────────────────────────────

/** Shown this long before its first word, and kept this long after its last. */
const LEAD = 2.5;
const TAIL = 0.45;
/** A gap this long gets a count-in before the next line. */
const COUNT_GAP = 5;

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** The lines on the two rows at `now` (row = line index % 2), and a count-in when one is due. */
function rowsAt(timing: KaraokeTiming, now: number): { rows: (number | null)[]; count: number } {
  const lines = timing.lines;
  const rows: (number | null)[] = [null, null];
  const i = lineAt(timing, now);
  let count = 0;
  for (const k of [i, i + 1]) {
    if (k < 0 || k >= lines.length) continue;
    const l = lines[k];
    const prevEnd = k > 0 ? lines[k - 1].end : 0;
    const nextStart = k + 1 < lines.length ? lines[k + 1].start : Infinity;
    // The line sung stays until a long gap; the next waits beside it, or comes LEAD early after a long gap.
    const shown = k === i ? now <= l.end + TAIL || nextStart - l.end < COUNT_GAP : l.start - prevEnd < COUNT_GAP || now >= l.start - LEAD;
    if (!shown) continue;
    rows[k % 2] = k;
    if (k !== i && l.start - prevEnd >= COUNT_GAP && now < l.start) count = Math.min(3, Math.ceil(l.start - now));
  }
  return { rows, count };
}

function SungLine({ line, now, theme, dim }: { line: KaraokeLine; now: number; theme: KaraokeTheme; dim: boolean }) {
  const c = KARAOKE_THEMES[theme];
  return (
    <div style={{ opacity: dim ? 0.72 : 1, transition: "opacity 0.25s" }}>
      {line.words.map((w, j) => {
        const p = Math.round(wordProgress(w, now) * 1000) / 10;
        return (
          <span
            key={j}
            style={{
              backgroundImage: `linear-gradient(90deg, ${c.sung} ${p}%, ${c.unsung} ${p}%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              // Room above and below for Thai upper vowels and tone marks: the
              // clipped background is the span's box, and marks reach past it.
              padding: "0.3em 0",
              whiteSpace: "pre-wrap",
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
}

/**
 * A song played with its words lit as they are sung. With `onSave`, the
 * customer can move the timing — the whole song, or one line to where they
 * paused — and save it for the MV and the next visit.
 */
export function KaraokeStage({
  src,
  timing,
  theme: theme0 = "gold",
  onTheme,
  onSave,
  style,
}: {
  src: string;
  timing: KaraokeTiming;
  theme?: KaraokeTheme;
  /** With this, the theme is the caller's (an MV's setting) and a pick goes to it. */
  onTheme?: (theme: KaraokeTheme) => void;
  onSave?: (timing: KaraokeTiming) => Promise<boolean>;
  style?: CSSProperties;
}) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(0);
  const [ownTheme, setOwnTheme] = useState<KaraokeTheme>(theme0);
  const theme = onTheme ? theme0 : ownTheme;
  const setTheme = onTheme ?? setOwnTheme;
  const [draft, setDraft] = useState<{ base: KaraokeTiming; timing: KaraokeTiming; offset: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  // Edits are of the timing they started from; a new one from the server drops them.
  const edit = draft && draft.base === timing ? draft : null;
  const shown = edit?.timing ?? timing;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let raf = 0;
    const tick = () => {
      setNow(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const play = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      setNow(a.currentTime);
    };
    a.addEventListener("play", play);
    a.addEventListener("pause", stop);
    a.addEventListener("seeked", stop);
    a.addEventListener("ended", stop);
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener("play", play);
      a.removeEventListener("pause", stop);
      a.removeEventListener("seeked", stop);
      a.removeEventListener("ended", stop);
    };
  }, []);

  const { rows, count } = rowsAt(shown, now);
  const singing = lineAt(shown, now);
  const c = KARAOKE_THEMES[theme];

  // The line list follows the song while it is open.
  useEffect(() => {
    if (!editing || singing < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-line="${singing}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [editing, singing]);

  const seek = (at: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, at);
    setNow(a.currentTime);
  };
  const offset = edit?.offset ?? 0;
  const change = (next: KaraokeTiming, by: number) => setDraft({ base: timing, timing: next, offset: by });
  const shift = (by: number) => change(shiftTiming(shown, by), Math.round((offset + by) * 100) / 100);
  // A moment early for the reaction to the voice.
  const startHere = (k: number) => change(moveLine(shown, k, Math.max(0, (audioRef.current?.currentTime ?? now) - 0.12)), offset);
  const doSave = async () => {
    if (!edit || !onSave || saving) return;
    setSaving(true);
    const ok = await onSave(edit.timing);
    setSaving(false);
    if (ok) setDraft(null);
  };
  const estimated = shown.lines.filter((l) => l.estimated).length;

  const small: CSSProperties = {
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 11.5,
    cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#e2e8f0",
    fontFamily: "inherit",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, ...style }}>
      <div
        aria-live="off"
        style={{
          position: "relative",
          minHeight: 190,
          borderRadius: 14,
          overflow: "hidden",
          padding: "26px 18px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 10,
          textAlign: "center",
          background: `radial-gradient(120% 90% at 50% 110%, ${c.glow}33, transparent 60%), linear-gradient(180deg, rgba(2,6,23,0.92), rgba(15,23,42,0.88))`,
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ height: 14, fontSize: 14, letterSpacing: 6, color: c.sung, opacity: count ? 1 : 0 }}>{"●".repeat(count)}</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            fontSize: "clamp(20px, 4.4vw, 34px)",
            fontWeight: 700,
            lineHeight: 1.55,
            // On the words only: a dark halo to read them over anything, and the theme's glow.
            filter: `drop-shadow(0 2px 5px rgba(0,0,0,0.85)) drop-shadow(0 0 14px ${c.glow}55)`,
          }}
        >
          {rows.map((k, r) => (
            <div key={r} style={{ minHeight: "1.6em", textAlign: r === 0 ? "left" : "right", paddingInline: "4%" }}>
              {k !== null && <SungLine line={shown.lines[k]} now={now} theme={theme} dim={k !== singing} />}
            </div>
          ))}
        </div>
        {rows[0] === null && rows[1] === null && now < (shown.lines[0]?.start ?? 0) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 500, color: "#94a3b8" }}>
            {t("▶ กดเล่นแล้วร้องตามได้เลย", "▶ Press play and sing along")}
          </div>
        )}
      </div>

      <audio ref={audioRef} src={src} controls preload="metadata" style={{ width: "100%" }} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {(Object.keys(KARAOKE_THEMES) as KaraokeTheme[]).map((k) => (
          <button key={k} type="button" onClick={() => setTheme(k)} aria-pressed={theme === k}
            style={{ ...small, borderColor: theme === k ? KARAOKE_THEMES[k].sung : "rgba(255,255,255,0.14)", color: theme === k ? KARAOKE_THEMES[k].sung : "#cbd5e1" }}>
            ● {t(KARAOKE_THEMES[k].label)}
          </button>
        ))}
        {onSave && (
          <button type="button" onClick={() => setEditing((e) => !e)} aria-expanded={editing} style={{ ...small, marginLeft: "auto" }}>
            {editing ? t("▾ ปรับจังหวะ", "▾ Adjust timing") : t("▸ ปรับจังหวะ", "▸ Adjust timing")}
            {estimated > 0 && !editing ? t(` (${estimated} บรรทัดควรเช็ก)`, ` (${estimated} to check)`) : ""}
          </button>
        )}
      </div>

      {onSave && editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 12, background: "rgba(2,6,23,0.45)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={small} onClick={() => shift(0.1)}>{t("ตัวหนังสือมาก่อนเสียง → ช้าลง 0.1 วิ", "Words ahead of the voice → 0.1 s later")}</button>
            <button type="button" style={small} onClick={() => shift(-0.1)}>{t("ตัวหนังสือมาหลังเสียง → เร็วขึ้น 0.1 วิ", "Words behind the voice → 0.1 s earlier")}</button>
            {offset !== 0 && <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{offset > 0 ? "+" : ""}{offset.toFixed(1)} {t("วิ", "s")}</span>}
          </div>
          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
            {t(
              "บรรทัดไหนเริ่มผิดที่: เล่นเพลง กดหยุดตรงที่บรรทัดนั้นเริ่มร้อง แล้วกด 📍 ที่บรรทัดนั้น · ≈ = บรรทัดที่ระบบหาเสียงร้องไม่เจอ วางไว้โดยประมาณ",
              "A line that starts in the wrong place: play, pause where that line starts to be sung, then press 📍 on it · ≈ = a line the voice wasn't found singing, placed roughly"
            )}
          </div>
          <div ref={listRef} style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {shown.lines.map((l, k) => (
              <div key={k} data-line={k}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 8, background: k === singing ? "rgba(167,139,250,0.16)" : "transparent" }}>
                <button type="button" onClick={() => seek(l.start - 1)} title={t("ฟังจากบรรทัดนี้", "Play from this line")}
                  style={{ ...small, padding: "2px 8px", fontFamily: "var(--font-mono), monospace", minWidth: 64 }}>
                  {clock(l.start)}
                </button>
                <span style={{ flex: 1, fontSize: 13.5, color: l.estimated ? "#fcd34d" : "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.estimated ? "≈ " : ""}{l.text}
                </span>
                <button type="button" onClick={() => startHere(k)} title={t("ให้บรรทัดนี้เริ่มตรงที่เพลงหยุดอยู่", "Start this line where the song is paused")} style={{ ...small, padding: "2px 8px" }}>
                  📍
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={doSave} disabled={!edit || saving}
              style={{ ...small, opacity: edit && !saving ? 1 : 0.5, background: edit ? "rgba(52,211,153,0.18)" : small.background, borderColor: edit ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.14)" }}>
              {saving ? t("กำลังบันทึก…", "Saving…") : t("บันทึกจังหวะ", "Save timing")}
            </button>
            {edit && (
              <button type="button" onClick={() => setDraft(null)} style={small}>{t("ยกเลิกที่แก้", "Undo changes")}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── The studio's karaoke box ───────────────────────────────────────────

export interface KaraokeTrack {
  url: string;
  label: string;
  /** What it sings (output-lyrics.ts): Suno's own words, or the customer's. */
  lyrics: string;
}

/**
 * "คาราโอเกะ" under a finished song: time it (free), sing along, fix the
 * timing, take the minus-one, and open an MV that sweeps the same words on
 * screen. Each take of a song has its own timing.
 */
export function KaraokePanel({ generationId, tracks, style }: { generationId: number | null; tracks: KaraokeTrack[]; style?: CSSProperties }) {
  const t = useT();
  const router = useRouter();
  const sung = tracks.map((tr, i) => ({ ...tr, i })).filter((tr) => tr.lyrics.trim());
  const [pick, setPick] = useState(sung[0]?.i ?? 0);
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<Record<number, string>>({});
  const [editWords, setEditWords] = useState(false);
  const track = sung.find((tr) => tr.i === pick) ?? sung[0] ?? null;
  const lyrics = track ? words[track.i] ?? track.lyrics : "";
  const k = useKaraoke(track && open ? { kind: "studio", src: track.url, lyrics } : null);
  if (!track) return null;

  const status = k.status;
  const doc = status?.state === "done" ? status.doc : null;
  const box: CSSProperties = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(15,23,42,0.55)",
    padding: "12px 14px",
    ...style,
  };
  const pill = (on = false): CSSProperties => ({
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    cursor: "pointer",
    border: on ? "1px solid rgba(216,180,254,0.7)" : "1px solid rgba(255,255,255,0.14)",
    background: on ? "rgba(167,139,250,0.25)" : "rgba(255,255,255,0.04)",
    color: "#e2e8f0",
    fontFamily: "inherit",
  });

  return (
    <section aria-label={t("คาราโอเกะ", "Karaoke")} style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          style={{ background: "none", border: "none", color: "#e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
          {open ? "▾" : "▸"} {t("🎤 คาราโอเกะภาษาไทย", "🎤 Thai karaoke")}
        </button>
        {!open && <span style={{ fontSize: 11.5, color: "#64748b" }}>{t("เนื้อร้องวิ่งทีละคำ · ทำ MV คาราโอเกะต่อได้", "Words light up as they're sung · make a karaoke MV from it")}</span>}
        {open && sung.length > 1 &&
          sung.map((tr) => (
            <button key={tr.i} type="button" onClick={() => setPick(tr.i)} aria-pressed={tr.i === track.i} style={pill(tr.i === track.i)}>
              {tr.label}
            </button>
          ))}
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {!doc && (
            <>
              <button type="button" onClick={() => setEditWords((e) => !e)} style={{ ...pill(), alignSelf: "flex-start" }}>
                {editWords ? t("▾ เนื้อที่ใช้จับจังหวะ", "▾ Words to time") : t("▸ แก้เนื้อให้ตรงกับที่ร้อง", "▸ Make the words match what's sung")}
              </button>
              {editWords && (
                <textarea value={lyrics} maxLength={6000} rows={8}
                  onChange={(e) => setWords((w) => ({ ...w, [track.i]: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, resize: "vertical" }} />
              )}
              <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
                {t(
                  "ระบบแยกเสียงร้องออกมา แล้วจับว่าแต่ละคำร้องตอนไหน ฟรี ใช้เวลาราว 2–5 นาที ปิดหน้านี้ได้ · เนื้อต้องตรงกับที่ร้องจริง บรรทัดที่ร้องซ้ำให้พิมพ์ซ้ำ",
                  "We separate the vocal and find when each word is sung — free, about 2–5 minutes, and you can close this page · the words must match what is sung; type a repeated line again"
                )}
              </div>
            </>
          )}

          {status && karaokeWorking(status) && (
            <div style={{ fontSize: 13, color: "#fbbf24" }}>{karaokeProgressText(status, t)}</div>
          )}
          {status?.state === "failed" && <div style={{ fontSize: 13, color: "#fca5a5" }}>{status.error}</div>}
          {k.error && <div style={{ fontSize: 13, color: "#fca5a5" }}>{k.error}</div>}
          {!k.available && <div style={{ fontSize: 12.5, color: "#94a3b8" }}>{t("ตัวจับจังหวะยังไม่เปิดให้ใช้", "Karaoke timing isn't open yet")}</div>}

          {!doc && !karaokeWorking(status) && k.available && (
            <button type="button" disabled={k.starting} onClick={() => k.start(status?.state === "failed")}
              style={{ ...pill(true), alignSelf: "flex-start", fontWeight: 600, opacity: k.starting ? 0.6 : 1 }}>
              {k.starting ? t("กำลังเริ่ม…", "Starting…") : status?.state === "failed" ? t("ลองใหม่", "Try again") : t("🎤 ทำคาราโอเกะ (ฟรี)", "🎤 Make the karaoke (free)")}
            </button>
          )}

          {doc && (
            <>
              <KaraokeStage key={track.url} src={track.url} timing={doc.timing} onSave={k.save} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {generationId !== null && (
                  <button type="button" style={{ ...pill(true), fontWeight: 600 }}
                    onClick={() => router.push(`/movie?new=mv&song=${generationId}&track=${track.i}`)}>
                    {t("🎬 ทำ MV คาราโอเกะ", "🎬 Make a karaoke MV")}
                  </button>
                )}
                {doc.instrumentalUrl && (
                  <a href={doc.instrumentalUrl} download target="_blank" rel="noopener noreferrer" style={{ ...pill(), textDecoration: "none" }}>
                    {t("⬇ ดนตรีไม่มีเสียงร้อง (minus one)", "⬇ Backing track without the vocal")}
                  </a>
                )}
                <button type="button" style={pill()}
                  onClick={() => {
                    if (confirm(t("จับจังหวะใหม่ทั้งเพลง? ที่ปรับเองไว้จะหายไป", "Time the whole song again? Your own adjustments will be lost."))) k.start(true);
                  }}>
                  {t("↻ จับจังหวะใหม่", "↻ Time it again")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
