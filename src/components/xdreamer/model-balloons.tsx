"use client";

/**
 * The studio's model picker: every model floats up as a balloon over the
 * stage, its maker's own showcase playing inside — a looping clip for a video
 * model, a slowly drifting picture for an image one — so a customer chooses
 * by what each model makes, at a size that can be seen.
 *
 * It covers the stage beside the composer (the whole screen on a narrow one),
 * closes on Esc, the ✕ or a click on the sky, and only plays the clips that
 * are on screen. With reduced motion nothing floats and clips show their
 * first picture.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ModelPreview } from "@/lib/model-samples";

export interface BalloonModel {
  id: number;
  name: string;
  provider: { name: string };
  subcategory?: string | null;
  description?: string | null;
  creditsPerUnit: number;
  isFeatured?: boolean;
  canOrder?: boolean;
  status?: string;
  unavailableReason?: string | null;
  tuningMessage?: string | null;
  preview?: ModelPreview | null;
}

/** Room the composer keeps on a wide screen; below this the sky takes the whole screen. */
const MIN_SKY_WIDTH = 560;
/** The picked balloon's lift before the sky closes. */
const PICK_MS = 240;

function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function ModelBalloons({
  models, selectedId, art, title, keepClear, onPick, onClose,
}: {
  /** In the order to show them (orderable first). */
  models: BalloonModel[];
  selectedId: number | null;
  /** The category art for a model with no picture. */
  art: string;
  title: string;
  /** The composer: the sky opens beside it when the screen is wide enough. */
  keepClear: React.RefObject<HTMLElement | null>;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const [left, setLeft] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  // The parent re-renders often (timers, polling); its callbacks are read
  // through refs so the open-once effects below do not re-run and refocus.
  const closeRef = useRef(onClose);
  const pickRef = useRef(onPick);
  useEffect(() => {
    closeRef.current = onClose;
    pickRef.current = onPick;
  });

  // Beside the composer when there is room, else over everything.
  useEffect(() => {
    const place = () => {
      const r = keepClear.current?.getBoundingClientRect();
      const edge = r ? Math.round(r.right + 12) : 0;
      setLeft(r && window.innerWidth - edge >= MIN_SKY_WIDTH ? edge : 0);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [keepClear]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus moves into the sky, and back to whatever opened it when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, []);

  // Clips play only while their balloon is on screen, and not at all for a
  // visitor who asked for less motion or less data (they keep the poster).
  // Keyed on the clips, not on `models`: the studio hands over a new array on
  // every render, and an observer rebuilt that often never reports anything.
  const clips = models.map((m) => m.preview?.video ?? "").join("|");
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const still = saveData || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const v = en.target as HTMLVideoElement;
        if (en.isIntersecting && !still) v.play().catch(() => {});
        else v.pause();
      }
    }, { root: field, rootMargin: "60px" });
    field.querySelectorAll("video").forEach((v) => io.observe(v));
    return () => io.disconnect();
  }, [clips]);

  useEffect(() => {
    if (picked === null) return;
    const t = setTimeout(() => pickRef.current(picked), PICK_MS);
    return () => clearTimeout(t);
  }, [picked]);

  const firstFocus = models.find((m) => m.id === selectedId) ?? models.find((m) => m.canOrder !== false);

  return createPortal(
    <div className="xdr-sky" data-leaving={picked !== null ? "true" : "false"}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="xdr-sky-panel" role="dialog" aria-modal="true" aria-label={title} style={{ left: left || 12 }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <header className="xdr-sky-head">
          <div>
            <h2>{title}</h2>
            <p>{models.length} โมเดล · แตะลูกที่ชอบ ดูจากผลงานจริงของแต่ละเจ้า</p>
          </div>
          <button type="button" className="xdr-sky-close" onClick={onClose} aria-label="ปิด">✕</button>
        </header>
        <div ref={fieldRef} className="xdr-sky-field"
          onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          {models.length === 0 && <div className="xdr-sky-empty">ไม่มีโมเดลสำหรับหมวดนี้</div>}
          {models.map((m, i) => {
            // A model that cannot be ordered right now stays in the sky,
            // deflated and grey, with the reason — picking it is blocked.
            const blocked = m.canOrder === false;
            const reason = m.unavailableReason ?? m.tuningMessage ?? "ยังใช้งานไม่ได้ ลองใหม่ภายหลัง";
            const on = selectedId === m.id;
            const p = m.preview;
            const vars = {
              "--i": i,
              "--hue": hueOf(m.provider.name),
              "--y": `${((i % 3) - 1) * 16}px`,
              "--bob": `${3.4 + ((i * 0.37) % 1.6)}s`,
              "--lag": `${-((i * 0.53) % 3)}s`,
              "--tilt": `${1.4 + (i % 3) * 0.5}deg`,
            } as React.CSSProperties;
            return (
              <button key={m.id} ref={m === firstFocus ? firstRef : undefined} type="button"
                className="xdr-balloon" style={vars} disabled={blocked}
                data-on={on ? "true" : "false"} data-big={m.isFeatured && !blocked ? "true" : "false"}
                data-picked={picked === m.id ? "true" : "false"} aria-pressed={on}
                title={blocked ? reason : m.description ?? m.name}
                onClick={() => { if (!blocked && picked === null) setPicked(m.id); }}>
                <span className="xdr-bfloat">
                  <span className="xdr-bglobe">
                    {p?.video ? (
                      <video className="xdr-bmedia" src={p.video} poster={p.src} muted loop playsInline preload="metadata" />
                    ) : p ? (
                      // eslint-disable-next-line @next/next/no-img-element -- bundled sample or an admin's URL
                      <img className="xdr-bmedia" data-drift="true" src={p.src} alt="" decoding="async"
                        onError={(e) => { e.currentTarget.src = art; e.currentTarget.dataset.art = "true"; }} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- fixed category art
                      <img className="xdr-bmedia" data-art="true" src={art} alt="" />
                    )}
                    <span className="xdr-bshine" aria-hidden="true" />
                    <span className="xdr-bprice">✦ {m.creditsPerUnit}</span>
                    {m.isFeatured && !blocked && <span className="xdr-bstar">แนะนำ</span>}
                    {blocked && <span className="xdr-bstate">{m.status === "tuning" ? "กำลังปรับแต่ง" : "ยังใช้ไม่ได้"}</span>}
                    {on && <span className="xdr-bcheck" aria-hidden="true">✓</span>}
                  </span>
                  <span className="xdr-bknot" aria-hidden="true" />
                  <svg className="xdr-bstring" viewBox="0 0 20 34" aria-hidden="true">
                    <path d="M10 0 C 4 8, 16 14, 10 22 S 6 30, 10 34" fill="none" />
                  </svg>
                  <span className="xdr-btag">
                    <b>{m.name}</b>
                    <small>{blocked ? reason : `${m.provider.name}${m.subcategory ? ` · ${m.subcategory}` : ""}`}</small>
                    {p?.credit && <small className="xdr-bcredit">{p.credit}</small>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <style jsx>{`
        .xdr-sky {
          position: fixed; inset: 0; z-index: 80;
          background: radial-gradient(120% 90% at 70% 10%, rgba(76, 29, 149, 0.35), rgba(2, 6, 23, 0.72));
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          animation: xdr-sky-in 260ms ease-out both;
        }
        .xdr-sky[data-leaving="true"] { animation: xdr-sky-out ${PICK_MS}ms ease-in both; }
        .xdr-sky-panel {
          position: absolute; top: 12px; right: 12px; bottom: 12px; display: flex; flex-direction: column; min-width: 0;
          border-radius: 22px; overflow: hidden;
          background:
            radial-gradient(80% 60% at 80% 0%, rgba(34, 211, 238, 0.14), transparent 70%),
            radial-gradient(70% 60% at 10% 100%, rgba(236, 72, 153, 0.12), transparent 70%),
            linear-gradient(180deg, rgba(15, 18, 52, 0.9), rgba(6, 9, 26, 0.94));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(103, 232, 249, 0.2), 0 30px 80px -20px rgba(0, 0, 0, 0.9);
        }
        .xdr-sky-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 6px; }
        .xdr-sky-head h2 { margin: 0; font-size: 20px; font-weight: 700; color: #f8fafc; }
        .xdr-sky-head p { margin: 4px 0 0; font-size: 12.5px; color: #94a3b8; }
        .xdr-sky-close {
          flex-shrink: 0; width: 38px; height: 38px; border-radius: 999px; border: 0; cursor: pointer; font-size: 16px;
          color: #e2e8f0; background: rgba(255, 255, 255, 0.07); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
        }
        .xdr-sky-close:hover { background: rgba(255, 255, 255, 0.14); }
        .xdr-sky-field {
          flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 26px 18px 40px;
          display: flex; flex-wrap: wrap; justify-content: center; align-content: flex-start; gap: 18px 22px;
        }
        .xdr-sky-empty { margin: auto; color: #94a3b8; font-size: 14px; }

        .xdr-balloon {
          --d: clamp(118px, 12.5vw, 196px);
          position: relative; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer;
          width: calc(var(--d) + 24px); display: flex; justify-content: center;
          transform: translateY(var(--y));
          animation: xdr-rise 900ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
          animation-delay: calc(var(--i) * 45ms);
        }
        .xdr-balloon[data-big="true"] { --d: clamp(130px, 14vw, 220px); }
        .xdr-balloon:disabled { --d: clamp(100px, 10vw, 158px); cursor: not-allowed; }
        .xdr-balloon:focus-visible { outline: none; }
        .xdr-balloon:focus-visible .xdr-bglobe { box-shadow: 0 0 0 3px rgba(103, 232, 249, 0.9), 0 18px 40px -14px hsla(var(--hue), 90%, 60%, 0.7); }
        .xdr-bfloat {
          display: flex; flex-direction: column; align-items: center;
          animation: xdr-bob var(--bob) ease-in-out var(--lag) infinite alternate;
          transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .xdr-balloon:hover:not(:disabled) .xdr-bfloat { transform: scale(1.07); }
        .xdr-balloon[data-picked="true"] .xdr-bfloat { transform: translateY(-40px) scale(1.12); }
        .xdr-bglobe {
          position: relative; display: block; width: var(--d); height: calc(var(--d) * 1.06); overflow: hidden;
          border-radius: 50% 50% 48% 48% / 52% 52% 48% 48%;
          background: radial-gradient(circle at 35% 30%, hsla(var(--hue), 80%, 70%, 0.5), hsla(var(--hue), 60%, 25%, 0.9));
          box-shadow:
            inset 0 0 0 2px hsla(var(--hue), 90%, 75%, 0.35),
            0 18px 40px -14px hsla(var(--hue), 90%, 60%, 0.65);
          transition: box-shadow 200ms ease;
        }
        .xdr-balloon:hover:not(:disabled) .xdr-bglobe {
          box-shadow: inset 0 0 0 2px hsla(var(--hue), 95%, 80%, 0.6), 0 22px 50px -12px hsla(var(--hue), 95%, 62%, 0.9);
        }
        .xdr-balloon[data-on="true"] .xdr-bglobe {
          box-shadow: inset 0 0 0 3px rgba(103, 232, 249, 0.95), 0 0 0 4px rgba(103, 232, 249, 0.25), 0 22px 50px -12px rgba(34, 211, 238, 0.8);
        }
        .xdr-bmedia { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
        .xdr-bmedia[data-drift="true"] { animation: xdr-drift 16s ease-in-out var(--lag) infinite alternate; }
        .xdr-bmedia[data-art="true"] { object-fit: contain; padding: 24%; animation: none; filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.55)); }
        .xdr-balloon:disabled .xdr-bmedia { filter: grayscale(0.9) brightness(0.55); }
        .xdr-bshine {
          position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
          background:
            radial-gradient(28% 20% at 30% 20%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 70%),
            radial-gradient(90% 90% at 50% 40%, transparent 55%, rgba(2, 6, 23, 0.45) 100%);
        }
        .xdr-bprice, .xdr-bstar, .xdr-bstate, .xdr-bcheck {
          position: absolute; z-index: 1; font-size: 10.5px; font-weight: 700; line-height: 1; padding: 4px 7px; border-radius: 999px;
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        }
        .xdr-bprice { bottom: 14%; left: 50%; transform: translateX(-50%); background: rgba(2, 6, 23, 0.62); color: #fde68a; white-space: nowrap; }
        .xdr-bstar { top: 14%; left: 50%; transform: translateX(-50%); background: rgba(251, 191, 36, 0.25); color: #fde68a; box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.4); }
        .xdr-bstate { top: 44%; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.8); color: #fbbf24; white-space: nowrap; }
        .xdr-bcheck { top: 12%; right: 14%; width: 24px; height: 24px; padding: 0; display: grid; place-items: center; font-size: 13px; background: rgba(103, 232, 249, 0.95); color: #04121a; }
        .xdr-bknot {
          width: 12px; height: 9px; margin-top: -2px;
          background: hsla(var(--hue), 60%, 45%, 1); clip-path: polygon(50% 0, 100% 100%, 0 100%);
        }
        .xdr-bstring {
          width: 20px; height: 30px; stroke: rgba(226, 232, 240, 0.45); stroke-width: 1.2;
          transform-origin: 50% 0; animation: xdr-sway calc(var(--bob) * 0.8) ease-in-out var(--lag) infinite alternate;
        }
        .xdr-btag {
          display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: calc(var(--d) + 24px);
          padding: 6px 11px 7px; border-radius: 12px; text-align: center;
          background: rgba(10, 14, 38, 0.78); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        }
        .xdr-btag b { font-size: 12.5px; font-weight: 600; color: #f1f5f9; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .xdr-btag small { font-size: 10.5px; color: #8391a7; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .xdr-btag .xdr-bcredit { font-size: 9.5px; color: #64748b; }
        .xdr-balloon[data-on="true"] .xdr-btag b { color: #a5f3fc; }
        .xdr-balloon:disabled .xdr-btag { opacity: 0.7; }

        @keyframes xdr-sky-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes xdr-sky-out { to { opacity: 0; } }
        @keyframes xdr-rise {
          from { opacity: 0; transform: translateY(calc(var(--y) + 70vh)) scale(0.7); }
          70% { opacity: 1; }
          to { opacity: 1; transform: translateY(var(--y)) scale(1); }
        }
        @keyframes xdr-bob {
          from { translate: 0 -7px; rotate: calc(var(--tilt) * -1); }
          to { translate: 0 7px; rotate: var(--tilt); }
        }
        @keyframes xdr-sway { from { transform: rotate(-9deg); } to { transform: rotate(9deg); } }
        @keyframes xdr-drift {
          from { transform: scale(1.04) translate(-2%, -1%); }
          to { transform: scale(1.16) translate(2%, 1.5%); }
        }
        @media (max-width: 640px) {
          .xdr-sky-panel { top: 0; right: 0; bottom: 0; left: 0 !important; border-radius: 0; }
          .xdr-sky-field { gap: 14px 10px; padding: 18px 8px 32px; }
          .xdr-balloon { --d: 128px; }
          .xdr-balloon[data-big="true"] { --d: 140px; }
          .xdr-balloon:disabled { --d: 106px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .xdr-sky, .xdr-balloon, .xdr-bfloat, .xdr-bstring, .xdr-bmedia[data-drift="true"] { animation: none; }
          .xdr-bfloat { transition: none; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
