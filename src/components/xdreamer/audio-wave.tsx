"use client";

/**
 * The player used for every song in the studio — the track a customer uploads
 * to be covered, and the one the model hands back.
 *
 * Why it decodes the bytes itself rather than leaning on <audio>:
 *
 * 1. A real waveform needs samples, and samples only come from decodeAudioData.
 * 2. Results live on R2, which serves no `Access-Control-Allow-Origin`, so the
 *    browser can *play* those URLs but cannot `fetch` them. Anything that needs
 *    the bytes — the waveform, converting on download — has to come through a
 *    same-origin route. `/api/studio/audio/[id]` is that route.
 * 3. An uploaded track is already in hand as a File before it is ever sent
 *    anywhere, so it is decoded locally and never re-downloaded.
 *
 * The decode is also what makes the download menu possible: WAV and MP3 are
 * written from the PCM this component already holds, so neither needs ffmpeg
 * on the server.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Peaks are stored as min/max pairs per column so quiet passages still read. */
type Peaks = { min: Float32Array; max: Float32Array };

const BAR_W = 3;
const BAR_GAP = 1;

function peaksFrom(buffer: AudioBuffer, columns: number): Peaks {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const channels = Math.min(buffer.numberOfChannels, 2);
  const step = buffer.length / columns;

  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * step);
    const end = Math.min(buffer.length, Math.floor((c + 1) * step));
    let lo = 0;
    let hi = 0;
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      // Stride large files: a 5-minute song is ~14M samples per channel and
      // every one of them would be read for a picture 900 columns wide.
      const stride = Math.max(1, Math.floor((end - start) / 512));
      for (let i = start; i < end; i += stride) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[c] = lo;
    max[c] = hi;
  }
  return { min, max };
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 16-bit PCM WAV. Written by hand so no dependency is needed for the format. */
function toWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));

  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  str(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, frames * channels * 2, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

/**
 * MP3 at 192 kbps. The encoder is pulled in only when someone actually asks
 * for an MP3 — it is a sizeable module and most listeners never download.
 */
async function toMp3(buffer: AudioBuffer, onProgress?: (f: number) => void): Promise<Blob> {
  const mod = await import("@breezystack/lamejs");
  const lame = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const channels = Math.min(buffer.numberOfChannels, 2);
  const encoder = new lame.Mp3Encoder(channels, buffer.sampleRate, 192);

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : null;
  const block = 1152;
  const parts: Uint8Array[] = [];

  const toInt16 = (src: Float32Array, from: number, len: number) => {
    const out = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const v = Math.max(-1, Math.min(1, src[from + i] ?? 0));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  };

  for (let i = 0; i < buffer.length; i += block) {
    const len = Math.min(block, buffer.length - i);
    const l = toInt16(left, i, len);
    const chunk = right
      ? encoder.encodeBuffer(l, toInt16(right, i, len))
      : encoder.encodeBuffer(l);
    if (chunk.length) parts.push(new Uint8Array(chunk));
    if (onProgress && i % (block * 400) === 0) {
      onProgress(i / buffer.length);
      // Let the frame paint, or the progress number never moves.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  onProgress?.(1);
  return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately cancels the save in Firefox; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Fetch (or take) the bytes and decode them, returning null on any failure.
 *
 * It lives out here rather than inside the effect on purpose. The React
 * compiler cannot lower awaits, throws or conditionals inside a try/catch and
 * bails on the entire component when it meets them — and a bailed component
 * stops being linted, which is how a ref read during render sat in this file
 * unreported. At module scope the compiler never looks, and the effect that
 * calls this stays plain enough to keep checking.
 */
async function loadAudio(source: Blob | string): Promise<{ blob: Blob; decoded: AudioBuffer } | null> {
  let blob: Blob | null = null;
  if (typeof source === "string") {
    const res = await fetch(source);
    if (!res.ok) return null;
    blob = await res.blob();
  } else {
    blob = source;
  }

  const Ctx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    return { blob, decoded: await ctx.decodeAudioData(await blob.arrayBuffer()) };
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}

export type AudioWaveProps = {
  /** Bytes to decode. A File straight from the picker, or a same-origin URL. */
  source: Blob | string;
  /** Shown above the waveform. */
  title?: string;
  /** Basename for downloads, without extension. Downloads are off when unset. */
  downloadName?: string;
  /** Extension of the original, offered alongside WAV/MP3. */
  originalExt?: string;
  height?: number;
  /** Start playing as soon as it is decoded. */
  autoPlay?: boolean;
  /** Told whether sound is actually coming out, for cover art that reacts. */
  onPlayingChange?: (playing: boolean) => void;
};

export function AudioWave({
  source,
  title,
  downloadName,
  originalExt,
  height = 84,
  autoPlay = false,
  onPlayingChange,
}: AudioWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  // ── Decode once, and hand the same bytes to <audio> ────────────────────
  useEffect(() => {
    // No reset here on purpose: setting state straight from an effect body
    // costs a render pass, and the initial state is already the loading one.
    // Callers pass a `key` tied to the source so a new track remounts instead.
    let dead = false;
    let objectUrl: string | null = null;

    void loadAudio(source).then((loaded) => {
      if (dead) return;
      if (!loaded) {
        setStatus("error");
        return;
      }
      objectUrl = URL.createObjectURL(loaded.blob);
      setPlayUrl(objectUrl);
      setBuffer(loaded.decoded);
      setDuration(loaded.decoded.duration);
      const width = canvasRef.current?.clientWidth ?? 600;
      setPeaks(peaksFrom(loaded.decoded, Math.max(40, Math.floor(width / (BAR_W + BAR_GAP)))));
      setStatus("ready");
    });

    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  // ── Paint ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const mid = h / 2;
    const played = duration > 0 ? time / duration : 0;
    const columns = peaks.max.length;
    const span = BAR_W + BAR_GAP;

    for (let c = 0; c < columns; c++) {
      const x = c * span;
      if (x > w) break;
      const top = Math.max(1.5, Math.abs(peaks.max[c]) * mid);
      const bot = Math.max(1.5, Math.abs(peaks.min[c]) * mid);
      ctx.fillStyle = x / w <= played ? "hsl(265,85%,72%)" : "rgba(148,163,184,0.42)";
      ctx.fillRect(x, mid - top, BAR_W, top + bot);
    }
  }, [peaks, time, duration]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => {
      const width = canvasRef.current?.clientWidth;
      if (!buffer || !width) return;
      setPeaks(peaksFrom(buffer, Math.max(40, Math.floor(width / (BAR_W + BAR_GAP)))));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [buffer]);

  // ── Playback clock. rAF only while playing, so a paused player is idle ──
  useEffect(() => {
    onPlayingChange?.(playing);
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      const a = audioRef.current;
      if (a) setTime(a.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, onPlayingChange]);

  const seekTo = (clientX: number) => {
    const canvas = canvasRef.current;
    const a = audioRef.current;
    if (!canvas || !a || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setTime(a.currentTime);
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const download = async (kind: "original" | "wav" | "mp3") => {
    setMenu(false);
    const base = downloadName || title || "song";
    if (kind === "original") {
      if (typeof source === "string") {
        saveBlob(await fetch(source).then((r) => r.blob()), `${base}.${originalExt || "flac"}`);
      } else {
        saveBlob(source, `${base}.${originalExt || "flac"}`);
      }
      return;
    }
    if (!buffer) return;
    // A try/finally with no catch makes the React compiler bail on this whole
    // component, and an encode really can fail — a long song can exhaust the
    // tab's memory part-way — so give the failure a readable ending instead of
    // a progress label frozen at some percentage forever.
    try {
      if (kind === "wav") {
        setBusy("กำลังแปลงเป็น WAV…");
        // Yield first: toWav blocks, and without this the label never paints.
        await new Promise((r) => setTimeout(r, 30));
        saveBlob(toWav(buffer), `${base}.wav`);
      } else {
        setBusy("กำลังแปลงเป็น MP3… 0%");
        saveBlob(
          await toMp3(buffer, (f) => setBusy(`กำลังแปลงเป็น MP3… ${Math.round(f * 100)}%`)),
          `${base}.mp3`
        );
      }
      setBusy(null);
    } catch {
      setBusy("แปลงไฟล์ไม่สำเร็จ — ลองดาวน์โหลดต้นฉบับแทน");
      setTimeout(() => setBusy(null), 5000);
    }
  };

  const canConvert = status === "ready" && buffer !== null;
  const ratio = duration > 0 ? time / duration : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {title && (
        <div style={{ fontSize: 12.5, color: "#e2e8f0", lineHeight: 1.45, wordBreak: "break-word" }}>{title}</div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={toggle}
          disabled={status !== "ready"}
          aria-label={playing ? "หยุด" : "เล่น"}
          style={{
            flexShrink: 0, width: 40, height: 40, borderRadius: "50%", cursor: status === "ready" ? "pointer" : "default",
            border: "1px solid hsla(265,70%,65%,0.45)", background: "hsla(265,70%,60%,0.18)",
            color: "#e9d5ff", fontSize: 14, display: "grid", placeItems: "center",
            opacity: status === "ready" ? 1 : 0.45, fontFamily: "inherit",
          }}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <canvas
            ref={canvasRef}
            onPointerDown={(e) => {
              if (status !== "ready") return;
              e.currentTarget.setPointerCapture(e.pointerId);
              seekTo(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1 && status === "ready") seekTo(e.clientX);
            }}
            style={{
              display: "block", width: "100%", height,
              cursor: status === "ready" ? "pointer" : "default",
              borderRadius: 8, background: "rgba(2,6,23,0.45)",
              touchAction: "none",
            }}
          />
          {status !== "ready" && (
            <div style={{
              position: "absolute", inset: 0, display: "grid", placeItems: "center",
              fontSize: 11.5, color: status === "error" ? "#fca5a5" : "#64748b",
            }}>
              {status === "error" ? "อ่านไฟล์เสียงไม่ได้" : "กำลังอ่านคลื่นเสียง…"}
            </div>
          )}
          {status === "ready" && duration > 0 && (
            <div aria-hidden style={{
              position: "absolute", top: 0, bottom: 0, left: `${ratio * 100}%`,
              width: 1.5, background: "hsl(265,90%,80%)", pointerEvents: "none",
            }} />
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#94a3b8" }}>
        <span style={{ fontFamily: "ui-monospace,monospace" }}>{fmt(time)} / {fmt(duration)}</span>
        {busy && <span style={{ color: "#c4b5fd" }}>{busy}</span>}

        {downloadName && (
          <div style={{ position: "relative", marginLeft: "auto" }}>
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              disabled={!canConvert || busy !== null}
              style={{
                padding: "5px 10px", borderRadius: 8, fontSize: 11, fontFamily: "inherit",
                cursor: canConvert && !busy ? "pointer" : "default",
                background: "rgba(2,6,23,0.5)", color: "#e2e8f0",
                border: "1px solid rgba(255,255,255,0.12)", opacity: canConvert && !busy ? 1 : 0.5,
              }}
            >
              ↓ ดาวน์โหลด ▾
            </button>
            {menu && (
              <div style={{
                position: "absolute", bottom: "calc(100% + 6px)", right: 0, width: 190, zIndex: 40,
                background: "rgba(15,23,42,0.97)", backdropFilter: "blur(20px)", padding: 6,
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10,
                boxShadow: "0 24px 48px -12px rgba(0,0,0,0.7)",
              }}>
                {([
                  ["original", `ต้นฉบับ (.${originalExt || "flac"})`, "ไม่แปลง คุณภาพเดิม"],
                  ["wav", "WAV", "ไม่สูญเสียคุณภาพ ไฟล์ใหญ่"],
                  ["mp3", "MP3", "192 kbps ไฟล์เล็ก"],
                ] as const).map(([kind, label, hint]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => void download(kind)}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "7px 9px",
                      borderRadius: 7, background: "transparent", border: "none", cursor: "pointer",
                      color: "#e2e8f0", fontSize: 12, fontFamily: "inherit",
                    }}
                  >
                    {label}
                    <span style={{ display: "block", fontSize: 10, color: "#64748b", marginTop: 1 }}>{hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {playUrl && (
        <audio
          ref={audioRef}
          src={playUrl}
          autoPlay={autoPlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
          style={{ display: "none" }}
        />
      )}
    </div>
  );
}
