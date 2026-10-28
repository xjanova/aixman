"use client";

/**
 * An uploaded voice or song drawn as its waveform, with a selection the
 * customer drags to keep only the part they want — the studio's lip-sync and
 * cover uploads.
 *
 * Everything happens on the File the picker handed over. Once a track is on
 * R2 the browser can play it but never read its samples (no CORS header, see
 * audio-wave.tsx), so the picker is the one moment the waveform and the cut
 * are free. The cut is written here as a file of its own and that is what gets
 * uploaded: the server prices a voice-driven order by the file it stores, so
 * the length on the screen and the length on the bill are the same file.
 *
 * Selections move in tenths of a second; a selection is never shorter than
 * `minSeconds` nor longer than `maxSeconds` (the model's ceiling).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toMp3, toWav } from "./audio-wave";

export type TrimRange = { start: number; end: number };

/** Bars across the waveform; each is 2 units wide with a 1-unit gap. */
const COLUMNS = 160;

/** A WAV past this would not fit the 12 MB upload (about a minute of stereo). */
const WAV_LIMIT_BYTES = 10 * 1024 * 1024;

/** Where a fresh pick starts: from the top, as long as the model allows. */
export function initialTrim(duration: number, maxSeconds: number): TrimRange {
  return { start: 0, end: duration <= maxSeconds ? duration : maxSeconds };
}

/** The selection is the whole file — upload the original, not a re-encode. */
export function coversWhole(range: TrimRange, duration: number): boolean {
  return range.start <= 0.05 && range.end >= duration - 0.05;
}

/** One key per selection, at the precision the handles move in. */
export function trimKey(range: TrimRange): string {
  return `${range.start.toFixed(1)}-${range.end.toFixed(1)}`;
}

/**
 * The selection as a file of its own, or null when this browser could not
 * build one. WAV keeps every sample; a cut too long for a WAV upload goes as
 * MP3 at 192 kbps instead.
 */
export async function cutAudio(buffer: AudioBuffer, range: TrimRange, fileName: string): Promise<File | null> {
  try {
    const rate = buffer.sampleRate;
    const from = Math.max(0, Math.floor(range.start * rate));
    const to = Math.min(buffer.length, Math.ceil(range.end * rate));
    const channels = Math.min(buffer.numberOfChannels, 2);
    const part = new AudioBuffer({ length: Math.max(1, to - from), numberOfChannels: channels, sampleRate: rate });
    for (let c = 0; c < channels; c++) part.copyToChannel(buffer.getChannelData(c).subarray(from, to), c);
    const base = fileName.replace(/\.[a-z0-9]+$/i, "") || "audio";
    if (44 + part.length * channels * 2 <= WAV_LIMIT_BYTES) {
      return new File([toWav(part)], `${base}-cut.wav`, { type: "audio/wav" });
    }
    return new File([await toMp3(part)], `${base}-cut.mp3`, { type: "audio/mpeg" });
  } catch {
    // Out of memory on a long song, or an old browser without AudioBuffer().
    return null;
  }
}

/** Bars for the whole track, normalised to its loudest moment so a quiet take still shows its shape. */
function wavePath(buffer: AudioBuffer): string {
  const channels = Array.from({ length: Math.min(buffer.numberOfChannels, 2) }, (_, c) => buffer.getChannelData(c));
  const step = buffer.length / COLUMNS;
  const peaks: number[] = [];
  let loudest = 0;
  for (let i = 0; i < COLUMNS; i++) {
    const from = Math.floor(i * step);
    const to = Math.min(buffer.length, Math.floor((i + 1) * step));
    // Strided: a five-minute song is ~14M samples a channel for 160 bars.
    const stride = Math.max(1, Math.floor((to - from) / 400));
    let peak = 0;
    for (const data of channels) {
      for (let k = from; k < to; k += stride) {
        const v = Math.abs(data[k]);
        if (v > peak) peak = v;
      }
    }
    peaks.push(peak);
    if (peak > loudest) loudest = peak;
  }
  const scale = loudest > 0 ? 60 / loudest : 0;
  return peaks
    .map((p, i) => {
      const h = Math.max(1.5, p * scale);
      return `M${i * 3} ${(32 - h / 2).toFixed(1)}h2v${h.toFixed(1)}h-2z`;
    })
    .join("");
}

function clock(sec: number, tenths = false): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${tenths ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0")}`;
}

export type TrimState = "saving" | "saved" | "failed";

export function AudioTrimmer({
  file, buffer, range, maxSeconds, minSeconds = 1, onChange, onDragging,
  accept, onPick, onClear, state, onRetry, note,
}: {
  file: File;
  buffer: AudioBuffer;
  range: TrimRange;
  maxSeconds: number;
  minSeconds?: number;
  onChange: (range: TrimRange) => void;
  /** True while a handle is held, so the cut is not uploaded mid-drag. */
  onDragging: (dragging: boolean) => void;
  accept: string;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  state: TrimState;
  onRetry: () => void;
  /** The price line, or a rule the selection breaks. */
  note?: React.ReactNode;
}) {
  const gradientId = useId();
  const duration = buffer.duration;
  const maxLen = Math.min(maxSeconds, duration);
  const minLen = Math.min(minSeconds, duration);
  const path = useMemo(() => wavePath(buffer), [buffer]);

  // Played from the File itself; derived, not stored (see AudioWave's playUrl).
  const playUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(playUrl), [playUrl]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ grip: "l" | "r" | "m"; x0: number; s0: number; e0: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState<number | null>(null);

  // The playhead, and the stop at the selection's end. rAF only while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      if (a.currentTime >= range.end || a.ended) {
        a.pause();
        setPlaying(false);
        setHead(null);
        return;
      }
      setHead(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, range.end]);

  const stop = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setHead(null);
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      stop();
      return;
    }
    a.currentTime = range.start;
    void a.play().then(() => setPlaying(true), () => undefined);
  };

  const fix = (v: number) => Math.min(duration, Math.max(0, Math.round(v * 10) / 10));
  const at = (clientX: number) => {
    const rect = waveRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };

  /** One edge to `x`, holding the other where it was and the length inside its limits. */
  const moveEdge = (grip: "l" | "r", x: number, s0: number, e0: number): TrimRange =>
    grip === "l"
      ? { start: fix(Math.max(0, e0 - maxLen, Math.min(x, e0 - minLen))), end: e0 }
      : { start: s0, end: fix(Math.min(duration, s0 + maxLen, Math.max(x, s0 + minLen))) };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const grip = (e.target as HTMLElement).closest<HTMLElement>("[data-grip]")?.dataset.grip as "l" | "r" | "m" | undefined;
    const x = at(e.clientX);
    stop();
    let s0 = range.start;
    let e0 = range.end;
    if (!grip) {
      // A click on open ground starts a new selection there, dragged out to the right.
      s0 = fix(Math.min(x, duration - minLen));
      e0 = fix(s0 + minLen);
      onChange({ start: s0, end: e0 });
    }
    drag.current = { grip: grip ?? "r", x0: x, s0, e0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = at(e.clientX);
    if (d.grip === "m") {
      const len = d.e0 - d.s0;
      const start = fix(Math.max(0, Math.min(duration - len, d.s0 + x - d.x0)));
      onChange({ start, end: Math.min(duration, start + len) });
      return;
    }
    onChange(moveEdge(d.grip, x, d.s0, d.e0));
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onDragging(false);
  };

  /** Arrow keys on a handle: a tenth of a second, a whole one with Shift. */
  const onGripKey = (grip: "l" | "r") => (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    stop();
    const step = (e.shiftKey ? 1 : 0.1) * dir;
    onChange(moveEdge(grip, (grip === "l" ? range.start : range.end) + step, range.start, range.end));
  };

  const pct = (v: number) => (duration > 0 ? (v / duration) * 100 : 0);
  const len = range.end - range.start;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => clock(duration * f));

  return (
    <div className="abox">
      <div className="ahead">
        <span className="afile" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
        </span>
        <span className="aname">
          <b title={file.name}>{file.name}</b>
          <span className="mono">{clock(duration, true)} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
        </span>
        <label className="abtn">
          เปลี่ยนไฟล์
          <input type="file" accept={accept} onChange={onPick} hidden />
        </label>
        <button type="button" className="abtn x" onClick={() => { stop(); onClear(); }} aria-label="เอาไฟล์เสียงออก">×</button>
      </div>

      <div
        ref={waveRef}
        className="wave"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="คลื่นเสียง ลากเพื่อเลือกช่วงที่จะใช้"
      >
        <svg className="dim" viewBox={`0 0 ${COLUMNS * 3} 64`} preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>
        <svg className="lit" viewBox={`0 0 ${COLUMNS * 3} 64`} preserveAspectRatio="none" aria-hidden="true"
          style={{ clipPath: `inset(0 ${(100 - pct(range.end)).toFixed(2)}% 0 ${pct(range.start).toFixed(2)}%)` }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#67e8f9" /><stop offset=".6" stopColor="#a78bfa" /><stop offset="1" stopColor="#f0abfc" />
            </linearGradient>
          </defs>
          <path d={path} fill={`url(#${gradientId})`} />
        </svg>
        <div className="sel" data-grip="m" style={{ left: `${pct(range.start)}%`, width: `${pct(len)}%` }}>
          <span className="hd l" data-grip="l" role="slider" tabIndex={0} aria-label="จุดเริ่มของช่วง"
            aria-valuemin={0} aria-valuemax={Math.round(duration * 10) / 10} aria-valuenow={range.start}
            aria-valuetext={clock(range.start, true)} onKeyDown={onGripKey("l")}><i /></span>
          <span className="hd r" data-grip="r" role="slider" tabIndex={0} aria-label="จุดจบของช่วง"
            aria-valuemin={0} aria-valuemax={Math.round(duration * 10) / 10} aria-valuenow={range.end}
            aria-valuetext={clock(range.end, true)} onKeyDown={onGripKey("r")}><i /></span>
        </div>
        {head !== null && <span className="phd" style={{ left: `${pct(head)}%` }} aria-hidden="true" />}
      </div>
      <div className="atime mono" aria-hidden="true">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>

      <div className="abar">
        <button type="button" className="play" onClick={toggle} aria-label={playing ? "หยุด" : "ฟังช่วงที่เลือก"}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" /></svg>
          )}
        </button>
        <span className="arange">ฟังช่วงที่เลือก<br /><span className="mono">{clock(range.start, true)} – {clock(range.end, true)}</span></span>
        <span className="alen">
          <b className="mono">{len.toFixed(1)} วิ</b> / สูงสุด {Math.floor(maxSeconds)}
          <span className="m"><i style={{ width: `${Math.min(100, (len / Math.max(1, maxSeconds)) * 100)}%` }} /></span>
        </span>
      </div>

      <div className="ahint" aria-live="polite">
        {state === "saving" ? (
          <span className="busy">กำลังเตรียมช่วงที่เลือก…</span>
        ) : state === "failed" ? (
          <span className="bad">อัปโหลดช่วงนี้ไม่สำเร็จ <button type="button" onClick={onRetry}>ลองอีกครั้ง</button></span>
        ) : (
          "ลากขอบสีฟ้าเพื่อตัดหัวท้าย · ลากกลางกรอบเพื่อเลื่อนทั้งช่วง · แตะที่ว่างเพื่อเริ่มช่วงใหม่"
        )}
      </div>
      {note && <div className="anote">{note}</div>}

      <audio ref={audioRef} src={playUrl} preload="auto" onPause={() => setPlaying(false)} hidden />

      <style jsx>{`
        .abox {
          --cy: 103, 232, 249;
          --vi: 167, 139, 250;
          border-radius: 13px;
          padding: 11px 12px 12px;
          background: linear-gradient(180deg, rgba(1, 3, 12, 0.72), rgba(8, 13, 30, 0.6));
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 1px 0 rgba(255, 255, 255, 0.04);
        }
        .mono { font-family: ui-monospace, "JetBrains Mono", monospace; letter-spacing: 0.02em; }
        .ahead { display: flex; align-items: center; gap: 9px; font-size: 12.5px; }
        .afile {
          width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; display: grid; place-items: center;
          color: #a5f3fc; background: rgba(var(--cy), 0.1); box-shadow: inset 0 0 0 1px rgba(var(--cy), 0.3);
        }
        .aname { min-width: 0; flex: 1; }
        .aname b { display: block; color: #f1f5f9; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .aname span { font-size: 11px; color: #64748b; }
        .abtn {
          cursor: pointer; font: inherit; font-size: 11.5px; padding: 4px 9px; border-radius: 7px; color: #cbd5e1; border: 0;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.015));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.11), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
          white-space: nowrap;
        }
        .abtn.x { padding: 4px 8px; font-size: 13px; line-height: 1; }
        .wave {
          position: relative; height: 78px; margin-top: 11px; border-radius: 9px; cursor: crosshair;
          touch-action: none; user-select: none; -webkit-user-select: none;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
        }
        .wave svg { position: absolute; left: 0; top: 7px; width: 100%; height: 64px; pointer-events: none; }
        .dim path { fill: rgba(148, 163, 184, 0.26); }
        .lit { filter: drop-shadow(0 0 4px rgba(103, 232, 249, 0.45)); }
        .sel {
          position: absolute; top: 0; bottom: 0; border-radius: 7px; cursor: grab;
          background: linear-gradient(180deg, rgba(var(--cy), 0.13), rgba(var(--vi), 0.07));
          box-shadow: inset 0 0 0 1px rgba(var(--cy), 0.6), 0 0 18px -6px rgba(var(--cy), 0.6);
        }
        .sel:active { cursor: grabbing; }
        .hd { position: absolute; top: -4px; bottom: -4px; width: 16px; cursor: ew-resize; display: grid; place-items: center; outline: none; }
        .hd.l { left: -8px; }
        .hd.r { right: -8px; }
        .hd i {
          width: 4px; height: 32px; border-radius: 3px; background: linear-gradient(180deg, #ecfeff, #67e8f9);
          box-shadow: 0 0 10px rgba(var(--cy), 0.95), 0 0 0 1px rgba(3, 6, 18, 0.6);
        }
        .hd:focus-visible i { box-shadow: 0 0 0 3px rgba(var(--cy), 0.45), 0 0 12px rgba(var(--cy), 1); }
        @media (pointer: coarse) {
          .hd { width: 28px; }
          .hd.l { left: -14px; }
          .hd.r { right: -14px; }
          .hd i { width: 6px; }
        }
        .phd {
          position: absolute; top: 3px; bottom: 3px; width: 2px; margin-left: -1px; border-radius: 2px;
          background: #fff; box-shadow: 0 0 8px #fff; pointer-events: none;
        }
        .atime { display: flex; justify-content: space-between; margin-top: 5px; font-size: 10px; color: #475569; }
        .abar { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
        .play {
          width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: 50%; cursor: pointer; display: grid; place-items: center;
          color: #03131a; background: linear-gradient(180deg, #ecfeff, #67e8f9);
          box-shadow: 0 0 14px -2px rgba(var(--cy), 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.6);
        }
        .arange { font-size: 12px; color: #94a3b8; line-height: 1.4; }
        .arange .mono { color: #f1f5f9; }
        .alen { margin-left: auto; min-width: 100px; text-align: right; font-size: 11px; color: #64748b; }
        .alen b { font-size: 13px; color: #fde68a; font-weight: 600; }
        .alen .m { display: block; height: 3px; border-radius: 2px; margin-top: 4px; overflow: hidden; background: rgba(255, 255, 255, 0.07); }
        .alen .m i { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, #67e8f9, #a78bfa); box-shadow: 0 0 6px rgba(var(--cy), 0.6); }
        .ahint { margin-top: 9px; font-size: 11.5px; color: #7d8ba1; line-height: 1.5; }
        .ahint .busy { color: #a5f3fc; }
        .ahint .bad { color: #fca5a5; }
        .ahint .bad button { margin-left: 6px; font: inherit; font-size: 11.5px; color: #fecaca; background: none; border: 0; text-decoration: underline; cursor: pointer; }
        .anote { margin-top: 6px; font-size: 11.5px; line-height: 1.5; color: #a5f3fc; }
      `}</style>
    </div>
  );
}
