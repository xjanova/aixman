"use client";

/**
 * "แก้ท่อนเพลง" (Suno Replace Section) — the part to sing anew picked by its
 * lines, not by a guess at the seconds.
 *
 * The song's karaoke timing (karaoke.tsx useKaraoke, made free on our server
 * from the customer's own Thai lyrics) says where each line is sung; the
 * customer clicks the lines to change and `replaceSpan` (lyrics/replace.ts)
 * puts the edges in the breaths around them, taking in whole neighbouring
 * lines when the model's 10-second minimum asks for more. The words to sing
 * there start as those lines, and the whole song's words after the change are
 * built from the original lyrics with exactly those lines swapped.
 *
 * Lyrics that cannot be timed (not Thai, or the timing failed) still work:
 * "ตั้งเวลาเอง" takes the seconds by hand and the whole song's words as typed.
 */

import { useRef, useState, type CSSProperties } from "react";
import { useT } from "@/lib/i18n/client";
import { replaceSpan, spanText } from "@/lib/lyrics/replace";
import { SUNO_REPLACE_MIN_SECONDS } from "@/lib/providers/kie-suno";
import { karaokeProgressText, karaokeWorking, useKaraoke } from "./karaoke";

/** The part picked: its edges, the lines it covers (null when set by hand) and the song length it was picked on. */
export interface ReplaceWindow {
  from: number;
  to: number;
  first: number | null;
  last: number | null;
  seconds: number | null;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function ReplaceSection({
  src,
  seconds,
  original,
  onOriginal,
  value,
  onChange,
  onWords,
}: {
  /** The song as uploaded (our URL); null while it uploads or its cut is being redone. */
  src: string | null;
  /** Its length as this page knows it. */
  seconds: number | null;
  /** The song's own lyrics, as sung. */
  original: string;
  onOriginal: (text: string) => void;
  value: ReplaceWindow | null;
  onChange: (w: ReplaceWindow | null) => void;
  /** The picked lines' words, to start the new-words box from. */
  onWords: (text: string) => void;
}) {
  const t = useT();
  const [manual, setManual] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement>(null);
  const k = useKaraoke(src && original.trim() && !manual ? { kind: "studio", src, lyrics: original } : null);
  const timing = k.status?.state === "done" ? k.status.doc.timing : null;
  const picked = value && value.first !== null && value.last !== null ? value : null;

  const pick = (i: number) => {
    if (!timing) return;
    // Outside the pick: grow it to this line; inside: start again from it.
    const [a, b] = picked && (i < picked.first! || i > picked.last!) ? [Math.min(i, picked.first!), Math.max(i, picked.last!)] : [i, i];
    const span = replaceSpan(timing, a, b, timing.seconds);
    if (!span.ok) {
      setMessage(t(span.message));
      return;
    }
    setMessage(span.grew ? t(`ขยายรวมบรรทัดข้างเคียงให้ครบ ${SUNO_REPLACE_MIN_SECONDS} วินาที (ขั้นต่ำของโมเดล)`, `Took in the next line to reach ${SUNO_REPLACE_MIN_SECONDS} seconds (the model's minimum)`) : null);
    onChange({ from: span.from, to: span.to, first: span.first, last: span.last, seconds: timing.seconds });
    onWords(spanText(original, span.first, span.last));
  };

  /** Where the preview stops: just past the part, from a second before it. */
  const stopAt = useRef<number | null>(null);
  const listen = () => {
    const a = previewRef.current;
    if (!a || !value) return;
    stopAt.current = value.to + 0.5;
    a.currentTime = Math.max(0, value.from - 1);
    void a.play().catch(() => undefined);
  };

  const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 };
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
  const area: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 12px",
    borderRadius: 10,
    background: "rgba(2,6,23,0.55)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#fff",
    fontFamily: "inherit",
    fontSize: 13.5,
    lineHeight: 1.6,
    resize: "vertical",
  };
  const status = k.status;

  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" aria-pressed={!manual} style={{ ...small, background: !manual ? "rgba(167,139,250,0.25)" : small.background }}
          onClick={() => { setManual(false); onChange(null); }}>
          {t("🎯 เลือกตามบรรทัด (แม่นสุด)", "🎯 Pick by line (most precise)")}
        </button>
        <button type="button" aria-pressed={manual} style={{ ...small, background: manual ? "rgba(167,139,250,0.25)" : small.background }}
          onClick={() => { setManual(true); onChange(null); }}>
          {t("⏱ ตั้งเวลาเอง", "⏱ Set the seconds")}
        </button>
      </div>

      <label style={{ fontSize: 12, color: "#94a3b8" }}>
        {manual
          ? t("เนื้อเพลงทั้งเพลง หลังแก้ท่อนนี้แล้ว", "The whole song's lyrics, with this part already changed")
          : t("เนื้อเพลงเดิมทั้งเพลง (ตรงกับที่ร้องจริง)", "The song's whole original lyrics (as sung)")}
      </label>
      <textarea value={original} maxLength={5000} rows={6} style={area}
        onChange={(e) => { onOriginal(e.target.value); onChange(null); }}
        placeholder={t("[Verse]\nวางเนื้อเพลงเดิมที่นี่ บรรทัดละท่อน", "[Verse]\nPaste the original lyrics here, one sung line per line")} />

      {manual ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {(["from", "to"] as const).map((edge) => (
            <label key={edge} style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 6, alignItems: "center" }}>
              {edge === "from" ? t("เริ่มวินาทีที่", "From second") : t("ถึงวินาทีที่", "To second")}
              <input type="number" min={0} max={seconds ?? 480} step={0.1} inputMode="decimal"
                value={value?.[edge] ?? ""}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value) * 100) / 100;
                  const next = { from: value?.from ?? 0, to: value?.to ?? 0, first: null, last: null, seconds, [edge]: Number.isFinite(n) ? n : 0 };
                  onChange(next);
                }}
                style={{ ...area, width: 96, padding: "6px 8px" }} />
            </label>
          ))}
          <span style={{ fontSize: 11.5, color: "#64748b" }}>
            {t(`ยาว ${SUNO_REPLACE_MIN_SECONDS} วินาทีขึ้นไป ไม่เกินครึ่งเพลง`, `At least ${SUNO_REPLACE_MIN_SECONDS} s, at most half the song`)}
          </span>
        </div>
      ) : !src ? (
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("อัปโหลดเพลงก่อน แล้วระบบจะจับจังหวะเนื้อร้องให้เลือกทีละบรรทัด", "Upload the song first; then its lines are timed for you to pick")}</div>
      ) : timing ? (
        <>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {t("กดบรรทัดที่จะร้องใหม่ — กดบรรทัดอื่นเพื่อขยายช่วง กดในช่วงเพื่อเริ่มใหม่", "Click the lines to sing anew — another line widens the pick, one inside starts again")}
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, padding: 4, borderRadius: 10, background: "rgba(2,6,23,0.45)" }}>
            {timing.lines.map((l, i) => {
              const inside = picked !== null && i >= picked.first! && i <= picked.last!;
              return (
                <button key={i} type="button" onClick={() => pick(i)} aria-pressed={inside}
                  style={{
                    display: "flex", gap: 8, alignItems: "center", textAlign: "left", padding: "5px 8px", borderRadius: 8, cursor: "pointer",
                    border: inside ? "1px solid rgba(244,114,182,0.6)" : "1px solid transparent",
                    background: inside ? "rgba(244,114,182,0.16)" : "transparent", color: "#e2e8f0", fontFamily: "inherit", fontSize: 13.5,
                  }}>
                  <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11, color: "#64748b", minWidth: 50 }}>{clock(l.start)}</span>
                  <span style={{ flex: 1, color: l.estimated ? "#fcd34d" : undefined }}>{l.estimated ? "≈ " : ""}{l.text}</span>
                </button>
              );
            })}
          </div>
          {message && <div style={{ fontSize: 12, color: "#fcd34d" }}>{message}</div>}
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {status && karaokeWorking(status) && <div style={{ fontSize: 13, color: "#fbbf24" }}>{karaokeProgressText(status, t)}</div>}
          {status?.state === "failed" && <div style={{ fontSize: 13, color: "#fca5a5" }}>{status.error}</div>}
          {k.error && <div style={{ fontSize: 13, color: "#fca5a5" }}>{k.error}</div>}
          {!karaokeWorking(status) && (
            <button type="button" disabled={k.starting || !original.trim() || !k.available} onClick={() => k.start(status?.state === "failed")}
              style={{ ...small, alignSelf: "flex-start", fontWeight: 600, background: "rgba(167,139,250,0.25)", opacity: k.starting || !original.trim() || !k.available ? 0.5 : 1 }}>
              {k.starting ? t("กำลังเริ่ม…", "Starting…") : t("🎯 จับจังหวะเนื้อร้อง (ฟรี)", "🎯 Time the lyrics (free)")}
            </button>
          )}
          <div style={{ fontSize: 11.5, color: "#64748b" }}>
            {!k.available
              ? t("ตัวจับจังหวะยังไม่เปิดให้ใช้ — ใช้ “ตั้งเวลาเอง” ได้", "Lyric timing isn't open yet — use “Set the seconds”")
              : t("แยกเสียงร้องแล้วหาว่าแต่ละบรรทัดร้องตอนไหน ราว 2–5 นาที · ภาษาไทยเท่านั้น เพลงภาษาอื่นใช้ “ตั้งเวลาเอง”", "Finds where each line is sung, about 2–5 minutes · Thai lyrics only — for other languages use “Set the seconds”")}
          </div>
        </div>
      )}

      {value && value.to > value.from && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: "#f9a8d4" }}>
          <span>
            {t("ร้องใหม่ช่วง", "Sung anew:")} <b className="rp-mono">{clock(value.from)} – {clock(value.to)}</b>{" "}
            ({(value.to - value.from).toFixed(1)} {t("วิ", "s")})
          </span>
          {src && <button type="button" style={small} onClick={listen}>{t("▶ ฟังช่วงเดิม", "▶ Hear the original part")}</button>}
        </div>
      )}
      {src && (
        <audio ref={previewRef} src={src} preload="none" style={{ display: "none" }}
          onTimeUpdate={(e) => {
            if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) {
              e.currentTarget.pause();
              stopAt.current = null;
            }
          }} />
      )}
    </div>
  );
}
