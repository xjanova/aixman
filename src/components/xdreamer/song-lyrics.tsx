"use client";

/**
 * "เนื้อเพลง" — the words of a finished song, under its player in the studio
 * and the gallery. One entry per delivered track (output-lyrics.ts): Suno's
 * two versions can sing different words when it wrote them itself, so the
 * versions get a switch only when their words differ. Section tags
 * ([Verse], [Chorus] …) stay — they are how the song is laid out.
 */

import { useState, type CSSProperties } from "react";
import { useT } from "@/lib/i18n/client";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SongLyrics({ lyrics, style }: { lyrics: string[]; style?: CSSProperties }) {
  const t = useT();
  const [pick, setPick] = useState(0);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const versions = lyrics.map((l, i) => ({ i, text: l.trim() })).filter((v) => v.text);
  if (versions.length === 0) return null;
  const differ = new Set(versions.map((v) => v.text)).size > 1;
  const shown = differ ? (versions.find((v) => v.i === pick) ?? versions[0]) : versions[0];

  const onCopy = async () => {
    const ok = await copyText(shown.text);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section
      aria-label={t("เนื้อเพลง", "Lyrics")}
      style={{
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(15,23,42,0.55)",
        padding: "12px 14px",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{ background: "none", border: "none", color: "#e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}
        >
          {open ? "▾" : "▸"} {t("เนื้อเพลง", "Lyrics")}
        </button>
        {differ &&
          versions.map((v) => (
            <button
              key={v.i}
              type="button"
              onClick={() => setPick(v.i)}
              aria-pressed={shown.i === v.i}
              style={{
                padding: "3px 10px",
                borderRadius: 999,
                fontSize: 11,
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.14)",
                background: shown.i === v.i ? "rgba(167,139,250,0.25)" : "transparent",
                color: "#e2e8f0",
              }}
            >
              {t(`เวอร์ชัน ${v.i + 1}`, `Version ${v.i + 1}`)}
            </button>
          ))}
        <button
          type="button"
          onClick={onCopy}
          style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: copied ? "#86efac" : "#cbd5e1" }}
        >
          {copied ? t("คัดลอกแล้ว", "Copied") : t("คัดลอก", "Copy")}
        </button>
      </div>
      {open && (
        <pre
          style={{
            margin: "10px 0 0",
            maxHeight: 320,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "inherit",
            fontSize: 13.5,
            lineHeight: 1.7,
            color: "rgba(226,232,240,0.92)",
          }}
        >
          {shown.text}
        </pre>
      )}
    </section>
  );
}
