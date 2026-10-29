"use client";

/**
 * Several audio files from one order — a song's two versions, or the stems a
 * split returned — as one card: each file with its name, its own player and
 * its own download, so the customer keeps only what they need. Stems can be
 * ticked and fetched together, and any file can be carried on to the next
 * tool (cover it, add a band to the vocals …).
 *
 * Plain <audio> players: R2 sends no CORS header, so nothing here reads the
 * bytes; the downloads go through the caller (the generation's download route).
 */

import { useRef, useState } from "react";
import { AudioCover } from "./audio";

export interface AudioTrack {
  url: string;
  label: string;
}

export interface TrackAction {
  id: string;
  label: string;
}

function hueOf(seed: string): number {
  return [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);
}

export function AudioTracks({ tracks, title, kind, onDownload, actions, onAction }: {
  tracks: AudioTrack[];
  title: string;
  /** Versions of one song, or the stems of one (tick to download several). */
  kind: "versions" | "stems";
  onDownload: (track: AudioTrack, index: number) => Promise<boolean> | void;
  /** What a file may be carried on to; none = no menu. */
  actions?: TrackAction[];
  onAction?: (actionId: string, track: AudioTrack) => void;
}) {
  const players = useRef<(HTMLAudioElement | null)[]>([]);
  const [playing, setPlaying] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [fetching, setFetching] = useState(false);
  const stems = kind === "stems";

  // One file at a time: starting a stem pauses the one before it.
  const onPlay = (i: number) => {
    players.current.forEach((p, j) => { if (j !== i && p && !p.paused) p.pause(); });
    setPlaying(i);
  };

  const toggle = (i: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  const allPicked = picked.size === tracks.length;

  // In turn, not at once: a browser lets one page start a few downloads, and
  // asks once before more.
  const downloadPicked = async () => {
    if (fetching || picked.size === 0) return;
    setFetching(true);
    for (const i of [...picked].sort((a, b) => a - b)) {
      // Each download reports its own failure; the rest still go.
      await Promise.resolve(onDownload(tracks[i], i)).catch(() => false);
      await new Promise((r) => setTimeout(r, 350));
    }
    setFetching(false);
  };

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(2,6,23,0.5)" }}>
      <div style={{ position: "relative" }}>
        <AudioCover seed={title} animated={playing !== null} label={false} style={{ aspectRatio: "16/5" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, padding: "12px 16px", background: "linear-gradient(180deg, transparent 30%, rgba(2,6,23,0.75))" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.16em", color: "rgba(255,255,255,0.8)", textTransform: "uppercase" }}>
              {stems ? "♫ แยกสเต็ม" : "♫ X-DREAMER MUSIC"}
            </div>
            <div style={{ fontSize: 14.5, color: "#f8fafc", fontWeight: 600, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          </div>
          <span style={{ flexShrink: 0, padding: "4px 10px", borderRadius: 999, fontSize: 11, color: "#e0f2fe", background: "rgba(14,165,233,0.22)", border: "1px solid rgba(125,211,252,0.35)", backdropFilter: "blur(8px)" }}>
            {stems ? `${tracks.length} ไฟล์` : `${tracks.length} เวอร์ชัน`}
          </span>
        </div>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {tracks.map((t, i) => {
          const hue = hueOf(t.label);
          const on = playing === i;
          return (
            <li key={t.url} style={{
              display: "grid", gridTemplateColumns: stems ? "auto auto 1fr" : "auto 1fr", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 12,
              background: on ? `linear-gradient(90deg, hsla(${hue},70%,45%,0.18), rgba(255,255,255,0.03))` : "rgba(255,255,255,0.03)",
              border: on ? `1px solid hsla(${hue},80%,65%,0.35)` : "1px solid rgba(255,255,255,0.06)",
              transition: "background .2s, border-color .2s",
            }}>
              {stems && (
                <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} aria-label={`เลือก ${t.label}`}
                  style={{ width: 16, height: 16, accentColor: `hsl(${hue},80%,60%)`, cursor: "pointer" }} />
              )}
              <span aria-hidden="true" style={{
                width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: "#fff",
                background: `radial-gradient(circle at 30% 30%, hsl(${hue},80%,62%), hsl(${(hue + 50) % 360},70%,30%))`,
                boxShadow: on ? `0 0 14px hsla(${hue},90%,60%,0.55)` : "none",
              }}>{i + 1}</span>
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 600, marginRight: "auto" }}>{t.label}</b>
                  {actions && actions.length > 0 && onAction && (
                    <select value="" aria-label={`ใช้ ${t.label} ต่อ`}
                      onChange={(e) => { const id = e.target.value; e.target.value = ""; if (id) onAction(id, t); }}
                      style={{
                        height: 28, padding: "0 8px", borderRadius: 8, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer",
                        color: "#cbd5e1", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                      }}>
                      <option value="">ใช้ต่อ…</option>
                      {actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={() => void onDownload(t, i)} aria-label={`ดาวน์โหลด ${t.label}`} title="ดาวน์โหลดไฟล์นี้"
                    style={{
                      height: 28, padding: "0 10px", borderRadius: 8, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer",
                      color: "#e0f2fe", background: `hsla(${hue},70%,50%,0.16)`, border: `1px solid hsla(${hue},80%,65%,0.32)`,
                    }}>↓ โหลด</button>
                </div>
                <audio ref={(el) => { players.current[i] = el; }} src={t.url} controls preload="none"
                  onPlay={() => onPlay(i)} onPause={() => setPlaying((p) => (p === i ? null : p))} onEnded={() => setPlaying((p) => (p === i ? null : p))}
                  style={{ width: "100%", height: 32 }} />
              </div>
            </li>
          );
        })}
      </ul>

      {stems && tracks.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "4px 16px 14px" }}>
          <button type="button" onClick={() => setPicked(allPicked ? new Set() : new Set(tracks.map((_, i) => i)))}
            style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: "#a5f3fc", cursor: "pointer", fontFamily: "inherit" }}>
            {allPicked ? "ยกเลิกที่เลือก" : "เลือกทั้งหมด"}
          </button>
          <button type="button" disabled={picked.size === 0 || fetching} onClick={() => void downloadPicked()}
            style={{
              height: 34, padding: "0 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
              cursor: picked.size === 0 || fetching ? "not-allowed" : "pointer", opacity: picked.size === 0 ? 0.5 : 1,
              color: "#04111d", background: "linear-gradient(135deg,#67e8f9,#a78bfa)", border: "none",
              boxShadow: picked.size > 0 ? "0 6px 18px rgba(103,232,249,0.25)" : "none",
            }}>
            {fetching ? "กำลังดาวน์โหลด…" : `↓ ดาวน์โหลดที่เลือก (${picked.size})`}
          </button>
        </div>
      )}
    </div>
  );
}
