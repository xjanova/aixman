"use client";

/**
 * A compact player for one audio file in a list — a song's version, a stem of
 * a split, the track a cover or an extension starts from: its real waveform,
 * click or drag to seek, the time, and optionally a marked second (where an
 * extension picks up).
 *
 * Built for many on one page (a split returns up to 12 stems), where
 * AudioWave — which keeps every decoded sample for its WAV/MP3 downloads —
 * would hold hundreds of MB. Here a file is decoded at 8 kHz, reduced to its
 * peaks and let go; decodes run one at a time and only for players that come
 * on screen; peaks are kept per file, so a remount draws at once.
 *
 * The bytes come through /api/studio/audio/file (R2 sends no CORS header).
 * When that refuses — a file under some older key — the player falls back to
 * the file itself: it still plays and seeks, over a plain bar.
 *
 * A different file needs a new `key`: nothing here resets when `url` changes.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "@/lib/i18n/client";
import { readableAudioUrl } from "@/lib/own-audio";

/** Peaks kept per file: plenty for any width it is drawn at. */
const COLUMNS = 480;
const BAR_W = 2;
const BAR_GAP = 1;

// ── Peaks: module scope, so the React compiler never meets the try/catch ──

const peakCache = new Map<string, Promise<Float32Array | null>>();
let decodeQueue: Promise<unknown> = Promise.resolve();

async function lightContext(): Promise<OfflineAudioContext | null> {
  const Offline =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) return null;
  // 8 kHz is enough to draw and a sixth of the memory of 48 kHz; a browser
  // that will not go that low gets the next rate it accepts.
  for (const rate of [8000, 22050, 44100]) {
    try {
      return new Offline(1, 1, rate);
    } catch {
      /* rate refused — try the next */
    }
  }
  return null;
}

/** Loudness per column, 0..1, quiet files lifted (at most 3×) so a soft stem still reads. */
function reduce(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(COLUMNS);
  const channels = Math.min(buffer.numberOfChannels, 2);
  const step = buffer.length / COLUMNS;
  let loudest = 0;
  for (let c = 0; c < COLUMNS; c++) {
    const start = Math.floor(c * step);
    const end = Math.min(buffer.length, Math.floor((c + 1) * step));
    const stride = Math.max(1, Math.floor((end - start) / 256));
    let peak = 0;
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = start; i < end; i += stride) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
    }
    out[c] = peak;
    if (peak > loudest) loudest = peak;
  }
  const gain = loudest > 0 ? Math.min(3, 1 / loudest) : 1;
  for (let c = 0; c < COLUMNS; c++) out[c] = Math.min(1, out[c] * gain);
  return out;
}

/** A stalled download must not hold up every wave behind it in the queue. */
const FETCH_LIMIT_MS = 120_000;

async function decodePeaks(src: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(src, typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(FETCH_LIMIT_MS) } : undefined);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    const ctx = await lightContext();
    if (!ctx) return null;
    return reduce(await ctx.decodeAudioData(bytes));
  } catch {
    return null;
  }
}

/** One decode at a time across every player on the page; each file once. */
function peaksOf(src: string): Promise<Float32Array | null> {
  const known = peakCache.get(src);
  if (known) return known;
  const run = decodeQueue.then(() => decodePeaks(src));
  decodeQueue = run;
  peakCache.set(src, run);
  // A failure is not kept: the next mount may find the route answering.
  void run.then((p) => { if (!p) peakCache.delete(src); });
  if (peakCache.size > 48) {
    const oldest = peakCache.keys().next().value;
    if (oldest !== undefined) peakCache.delete(oldest);
  }
  return run;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

/** Stand-in bars while the real ones load, the same for a file every time. */
function skeleton(seed: string, n: number): number[] {
  let h = 17;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return 0.25 + ((h >>> 16) % 1000) / 2500;
  });
}

export function TrackWave({
  url, label, hue = 265, height = 40, marker = null, onPickMarker, pickLabel,
  onPlay, onStop, audioRef, onDuration, onError, style,
}: {
  /** The file's address (our bucket, or a blob: of a file in hand). */
  url: string;
  /** What the file is, for the slider and the play button. */
  label: string;
  hue?: number;
  height?: number;
  /** A second drawn on the wave — where an extension picks up. */
  marker?: number | null;
  /** With this, a button sets the marker to the second being played. */
  onPickMarker?: (second: number) => void;
  /** The button's words, given the time it would pick ("1:23"). */
  pickLabel?: (at: string) => string;
  onPlay?: () => void;
  onStop?: () => void;
  /** The <audio> element, for a list that plays one file at a time. */
  audioRef?: (el: HTMLAudioElement | null) => void;
  onDuration?: (seconds: number) => void;
  /** Neither our route nor the file itself would play: it has gone. */
  onError?: () => void;
  style?: CSSProperties;
}) {
  const t = useT();
  const readable = readableAudioUrl(url);
  // Our route refused this file: play it from where it lives, without a wave.
  const [direct, setDirect] = useState(false);
  const src = direct ? url : readable;

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const seeking = useRef(false);
  const [onScreen, setOnScreen] = useState(false);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [noWave, setNoWave] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [width, setWidth] = useState(0);

  // Decode only once the player is (nearly) on screen.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = setTimeout(() => setOnScreen(true), 0);
      return () => clearTimeout(id);
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setOnScreen(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(box);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!onScreen) return;
    let dead = false;
    void peaksOf(readable).then((p) => {
      if (dead) return;
      if (p) setPeaks(p);
      else setNoWave(true);
    });
    return () => { dead = true; };
  }, [onScreen, readable]);

  // A load that failed before React was listening (a server-rendered page)
  // is replayed once mounted, so the fallback below still runs.
  useEffect(() => {
    const a = audio.current;
    if (!a?.error) return;
    const id = setTimeout(() => a.dispatchEvent(new Event("error")), 0);
    return () => clearTimeout(id);
  }, []);

  // Redraw at the width the wave is shown at.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setWidth(canvas.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Paint ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = height;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);

    const mid = h / 2;
    const played = duration > 0 ? Math.min(1, time / duration) : 0;
    const on = `hsl(${hue},85%,70%)`;
    const off = "rgba(148,163,184,0.38)";

    if (!peaks && (noWave || direct)) {
      // No samples: a plain bar that still shows and takes the position.
      ctx.fillStyle = off;
      ctx.fillRect(0, mid - 1.5, width, 3);
      ctx.fillStyle = on;
      ctx.fillRect(0, mid - 1.5, width * played, 3);
    } else {
      const span = BAR_W + BAR_GAP;
      const n = Math.max(1, Math.floor(width / span));
      const stand = peaks ? null : skeleton(url, n);
      for (let i = 0; i < n; i++) {
        let amp: number;
        if (peaks) {
          const a = Math.floor((i * COLUMNS) / n);
          const b = Math.max(a + 1, Math.floor(((i + 1) * COLUMNS) / n));
          amp = 0;
          for (let c = a; c < b && c < COLUMNS; c++) if (peaks[c] > amp) amp = peaks[c];
        } else {
          amp = stand![i];
        }
        const bar = Math.max(1.5, amp * (mid - 1));
        const x = i * span;
        ctx.fillStyle = peaks ? ((x + BAR_W / 2) / width <= played ? on : off) : "rgba(148,163,184,0.16)";
        ctx.fillRect(x, mid - bar, BAR_W, bar * 2);
      }
    }

    if (marker !== null && duration > 0 && marker >= 0 && marker <= duration) {
      const x = Math.min(width - 1, Math.max(1, (marker / duration) * width));
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(x - 1, 0, 2, h);
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 6);
      ctx.closePath();
      ctx.fill();
    }
  }, [peaks, noWave, direct, time, duration, width, height, hue, marker, url]);

  // ── Playback clock: rAF only while playing ──
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audio.current;
      if (a) setTime(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seekAt = (clientX: number) => {
    const canvas = canvasRef.current;
    const a = audio.current;
    if (!canvas || !a || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setTime(a.currentTime);
  };

  const seekBy = (delta: number) => {
    const a = audio.current;
    if (!a || !duration) return;
    a.currentTime = Math.max(0, Math.min(duration - 0.1, a.currentTime + delta));
    setTime(a.currentTime);
  };

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };

  const stopped = () => {
    setPlaying(false);
    onStop?.();
  };

  return (
    <div ref={boxRef} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, ...style }}>
      <button type="button" onClick={toggle} aria-label={playing ? t(`หยุด ${label}`, `Pause ${label}`) : t(`เล่น ${label}`, `Play ${label}`)}
        style={{
          flexShrink: 0, width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontFamily: "inherit",
          display: "grid", placeItems: "center", fontSize: 11, color: "#fff",
          border: `1px solid hsla(${hue},80%,65%,0.45)`, background: `hsla(${hue},70%,55%,${playing ? 0.35 : 0.18})`,
          boxShadow: playing ? `0 0 14px hsla(${hue},90%,60%,0.45)` : "none",
        }}>
        {playing ? "❚❚" : "▶"}
      </button>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div role="slider" tabIndex={0} aria-label={label}
          aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}
          aria-valuetext={`${fmt(time)} / ${fmt(duration)}`}
          onPointerDown={(e) => { seeking.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekAt(e.clientX); }}
          onPointerMove={(e) => { if (seeking.current) seekAt(e.clientX); }}
          onPointerUp={(e) => { seeking.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { seeking.current = false; }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); seekBy(5); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); seekBy(-5); }
            else if (e.key === "Home") { e.preventDefault(); seekBy(-Infinity); }
            else if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); }
          }}
          style={{ cursor: duration ? "pointer" : "default", touchAction: "none", borderRadius: 6, outlineOffset: 2 }}>
          <canvas ref={canvasRef} style={{ display: "block", width: "100%", height }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
          <span>{fmt(time)} / {fmt(duration)}</span>
          {onPickMarker && duration > 0 && time >= 1 && (
            <button type="button" onClick={() => onPickMarker(Math.floor(time))}
              style={{
                marginLeft: "auto", height: 22, padding: "0 8px", borderRadius: 6, fontSize: 10.5, fontFamily: "inherit", cursor: "pointer",
                color: "#fde68a", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)",
              }}>
              {pickLabel ? pickLabel(fmt(time)) : t(`📍 ใช้วินาทีที่ ${fmt(time)}`, `📍 Use ${fmt(time)}`)}
            </button>
          )}
        </div>
      </div>

      <audio ref={(el) => { audio.current = el; audioRef?.(el); }} src={src} preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) { setDuration(d); onDuration?.(d); }
        }}
        onPlay={() => { setPlaying(true); onPlay?.(); }}
        onPause={stopped}
        onEnded={() => { setTime(0); stopped(); }}
        onError={() => { if (!direct && src !== url) setDirect(true); else onError?.(); }}
        style={{ display: "none" }} />
    </div>
  );
}
