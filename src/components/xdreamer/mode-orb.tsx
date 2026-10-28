"use client";

/**
 * The studio's mode menu: a glass orb that floats over the page instead of a
 * column of tabs, so the composer and the canvas get the whole width.
 *
 * Pointing at it (a mouse) or tapping it opens the modes around it — a dock
 * that magnifies the icon under the pointer on a wide screen, a list with
 * labels on a phone. Dragging it moves it anywhere on the screen; where it was
 * left is kept per browser (fractions of the viewport, so a resized window
 * keeps it in the same corner) and is a convenience, never state that matters.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface OrbItem {
  key: string;
  label: string;
  /** Square artwork, drawn at 38–72 px. */
  icon: string;
  active?: boolean;
  /** Why it cannot be used right now; dimmed with this as its tooltip. */
  blocked?: string | null;
  onPick?: () => void;
  /** A page of its own (3D studio, gallery) rather than a mode of this one. */
  href?: string;
}

const STORE = "xdr-studio-orb-v1";
/** Set once the orb has been opened or moved: the "point / drag" hint is for newcomers. */
const HINT_SEEN = "xdr-studio-orb-hint-v1";
type Saved = { fx: number; fy: number };

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_SEEN) === "1";
  } catch {
    return false;
  }
}

function markHintSeen(): void {
  try {
    window.localStorage.setItem(HINT_SEEN, "1");
  } catch {
    // Storage blocked: the hint shows again next visit, for a few seconds.
  }
}

function readSaved(): Saved | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE) ?? "null");
    return v && Number.isFinite(v.fx) && Number.isFinite(v.fy) ? { fx: v.fx, fy: v.fy } : null;
  } catch {
    return null;
  }
}

function writeSaved(v: Saved): void {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    // Private window or storage blocked: the orb just starts in its corner next time.
  }
}

/** The visible area, without the page's scrollbar — innerWidth counts it, and a dock clamped to that ran under it. */
function viewport(): { w: number; h: number } {
  const root = document.documentElement;
  return { w: root.clientWidth || window.innerWidth, h: root.clientHeight || window.innerHeight };
}

/** The site's nav bar is 80 px; the orb never hides under it. */
const TOP_LIMIT = 120;
const ORB = 76;

export function ModeOrb({ modes, links, title, glyph }: {
  modes: OrbItem[];
  links: OrbItem[];
  /** The mode in use, for the hint and the orb's label. */
  title: string;
  /** The mode's line icon, drawn on the orb. */
  glyph: React.ReactNode;
}) {
  const [vp, setVp] = useState(() => (typeof window === "undefined" ? { w: 1440, h: 900 } : viewport()));
  const [saved, setSaved] = useState<Saved | null>(() => (typeof window === "undefined" ? null : readSaved()));
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  /** The mouse's x relative to the orb's centre, for the magnification. */
  const [mx, setMx] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  /** Set when a press turned into a drag, so the click that follows is not a tap. */
  const draggedRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The hint pill beside the orb: until it is first used, and for a few seconds a visit. */
  const [hint, setHint] = useState(() => typeof window !== "undefined" && !hintSeen());

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [hint]);

  const used = () => {
    if (!hint) return;
    setHint(false);
    markHintSeen();
  };

  useEffect(() => {
    const onResize = () => setVp(viewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Closed by Escape, and by a tap anywhere else (a touch screen has no "leave").
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const narrow = vp.w < 640;
  const stacked = vp.w < 1100;
  const clampX = (x: number) => Math.min(vp.w - ORB / 2 - 8, Math.max(ORB / 2 + 8, x));
  const clampY = (y: number) => Math.min(vp.h - ORB / 2 - 8, Math.max(TOP_LIMIT, y));
  // The bottom-right corner, where the recent strip leaves it room; above the
  // order bar when the page is stacked.
  const home = stacked ? { x: vp.w - 56, y: vp.h - 150 } : { x: vp.w - 76, y: vp.h - 46 };
  const x = dragAt?.x ?? clampX(saved ? saved.fx * vp.w : home.x);
  const y = dragAt?.y ?? clampY(saved ? saved.fy * vp.h : home.y);
  const dragging = dragAt !== null;
  const shown = open && !dragging;
  const up = y > 260;

  // ── Wide screens: a dock across the orb, magnified under the mouse ─────
  const all = [...modes, ...links];
  const base = 46, peak = 72, reach = 140, gap = 12, pad = 13;
  const layout = (sizes: number[]) => {
    const at: number[] = [];
    let cursor = 0;
    sizes.forEach((s, i) => {
      if (i === modes.length) cursor += 1 + gap; // the separator before the links
      at.push(cursor);
      cursor += s + gap;
    });
    return { at, total: cursor - gap, sep: at[modes.length] - gap / 2 - 0.5 };
  };
  const sizeAt = (d: number) => (d < reach ? base + (peak - base) * Math.cos(((d / reach) * Math.PI) / 2) : base);
  const flat = layout(all.map(() => base));
  // Kept on screen at its widest — the mouse over an icon — not at rest: the
  // dock grows from its centre, and clamped at rest its far end ran off the
  // screen as soon as it magnified. Fixed while open, so nothing slides under
  // the pointer.
  const widest = Math.max(...all.map((_, j) => layout(all.map((__, i) => sizeAt(Math.abs(flat.at[i] - flat.at[j])))).total));
  const width0 = widest + 2 * pad;
  let shift = 0;
  if (x - width0 / 2 < 14) shift = 14 - (x - width0 / 2);
  if (x + width0 / 2 + shift > vp.w - 14) shift = vp.w - 14 - (x + width0 / 2);
  const sizes = all.map((_, i) => {
    if (!shown || mx === null) return base;
    return sizeAt(Math.abs(mx - (shift + flat.at[i] - flat.total / 2 + base / 2)));
  });
  const dock = layout(sizes);
  // Opens from the middle out, closes from the ends in.
  const rank = (i: number) => Math.abs(i - (all.length - 1) / 2);

  const onEnter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || dragging || narrow) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setOpen(true);
    used();
  };
  const onHover = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !open || dragging || narrow) return;
    setMx(e.clientX - x);
  };
  const onLeave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || narrow) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setMx(null);
    }, 260);
  };

  const onOrbDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY, ox: x, oy: y, moved: false };
    draggedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onOrbMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    p.moved = true;
    setOpen(false);
    setMx(null);
    setDragAt({ x: clampX(p.ox + dx), y: clampY(p.oy + dy) });
  };
  const onOrbUp = () => {
    const p = press.current;
    press.current = null;
    if (!p?.moved || !dragAt) return;
    draggedRef.current = true;
    const next = { fx: dragAt.x / vp.w, fy: dragAt.y / vp.h };
    setSaved(next);
    writeSaved(next);
    setDragAt(null);
    used();
  };
  const onOrbClick = () => {
    // The click that ends a drag is not a tap.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setOpen((o) => !o);
    setMx(null);
    used();
  };

  const pick = (item: OrbItem) => {
    if (item.blocked) return;
    item.onPick?.();
    setOpen(false);
    setMx(null);
  };

  const hintRight = x < vp.w - 340;
  // Phone list: on the orb's side of the screen, growing away from the edge it sits on.
  const listRight = x > vp.w / 2;

  return (
    <>
      {narrow && <div className="orb-scrim" data-open={shown ? "true" : "false"} onClick={() => setOpen(false)} aria-hidden="true" />}
      <div
        ref={rootRef}
        className="fd"
        data-open={shown ? "true" : "false"}
        data-up={up ? "true" : "false"}
        data-drag={dragging ? "true" : "false"}
        style={{ left: x, top: y }}
        onPointerEnter={onEnter}
        onPointerMove={onHover}
        onPointerLeave={onLeave}
        role="group"
        aria-label="เมนูโหมด ลากย้ายได้"
      >
        {!narrow && (
          <>
            <div className="fd-bar" aria-hidden="true" style={{
              left: `calc(50% + ${Math.round(shown ? shift - dock.total / 2 - pad : -ORB / 2)}px)`,
              width: Math.round(shown ? dock.total + 2 * pad : ORB),
              opacity: shown ? 1 : 0,
            }} />
            {all.map((item, i) => {
              const left = shift + dock.at[i] - dock.total / 2;
              const centre = left + sizes[i] / 2;
              const dy = (up ? 1 : -1) * (61 + sizes[i] / 2);
              const style: React.CSSProperties = {
                left: `calc(50% + ${Math.round(left)}px)`,
                transform: shown ? "translate(0px, 0px) scale(1)" : `translate(${Math.round(-centre)}px, ${Math.round(dy)}px) scale(0.3)`,
                opacity: shown ? 1 : 0,
                transitionDelay: `${shown ? rank(i) * 40 : (3 - rank(i)) * 16}ms, ${shown ? rank(i) * 40 : (3 - rank(i)) * 16}ms, 0ms`,
              };
              const body = (
                <>
                  <span className="tip">{item.label}{item.blocked ? ` · ${item.blocked}` : ""}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element -- art drawn at a size that changes every frame */}
                  <img src={item.icon} alt="" width={Math.round(sizes[i])} height={Math.round(sizes[i])} draggable={false} />
                  {item.active && <span className="dot" aria-hidden="true" />}
                </>
              );
              const cls = `di${item.blocked ? " off" : ""}`;
              if (item.href && !item.blocked) {
                return (
                  <Link key={item.key} href={item.href} className={cls} style={style} aria-label={item.label}
                    tabIndex={shown ? 0 : -1} aria-hidden={shown ? undefined : true}>{body}</Link>
                );
              }
              return (
                <button key={item.key} type="button" className={cls} style={style}
                  onClick={() => pick(item)} disabled={Boolean(item.blocked)}
                  aria-label={item.blocked ? `${item.label} — ${item.blocked}` : item.label}
                  aria-current={item.active ? "true" : undefined}
                  tabIndex={shown ? 0 : -1} aria-hidden={shown ? undefined : true}>{body}</button>
              );
            })}
            <span className="dsep" aria-hidden="true" style={{ left: `calc(50% + ${Math.round(shift + dock.sep - dock.total / 2)}px)`, opacity: shown ? 1 : 0 }} />
          </>
        )}

        {narrow && (
          <div className="menu" role="menu" aria-label="เลือกสิ่งที่จะสร้าง" data-right={listRight ? "true" : "false"}>
            {[...all].reverse().map((item, n) => {
              const i = all.length - 1 - n;
              const style: React.CSSProperties = {
                transform: shown ? "translateY(0px) scale(1)" : `translateY(${(up ? 1 : -1) * (all.length - i) * 22}px) scale(0.3)`,
                opacity: shown ? 1 : 0,
                transitionDelay: `${shown ? i * 34 : (all.length - i) * 14}ms`,
              };
              const body = (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- small fixed art */}
                  <img src={item.icon} alt="" width={40} height={40} draggable={false} />
                  <span>{item.label}{item.blocked && <small>{item.blocked}</small>}</span>
                </>
              );
              const cls = `mi${item.active ? " on" : ""}${item.blocked ? " off" : ""}`;
              if (item.href && !item.blocked) {
                return (
                  <Link key={item.key} href={item.href} role="menuitem" className={cls} style={style}
                    tabIndex={shown ? 0 : -1} aria-hidden={shown ? undefined : true}>{body}</Link>
                );
              }
              return (
                <button key={item.key} type="button" role="menuitem" className={cls} style={style}
                  onClick={() => pick(item)} disabled={Boolean(item.blocked)}
                  tabIndex={shown ? 0 : -1} aria-hidden={shown ? undefined : true}>{body}</button>
              );
            })}
          </div>
        )}

        <span className="oshadow" aria-hidden="true" />
        <button type="button" className="orb"
          onPointerDown={onOrbDown} onPointerMove={onOrbMove} onPointerUp={onOrbUp} onPointerCancel={onOrbUp}
          onClick={onOrbClick}
          aria-label={`เมนูโหมด (ตอนนี้: ${title}) — แตะเพื่อเปิด ลากเพื่อย้าย`} aria-expanded={shown}>
          <span className="ball" /><span className="spec" /><span className="track" /><span className="run"><i /></span>
          <span className="gl">{glyph}</span>
        </button>
        {!narrow && (
          <span className="hint" aria-hidden="true" data-side={hintRight ? "right" : "left"} style={{ opacity: hint && !shown && !dragging ? 1 : 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9l-3 3 3 3" /><path d="M9 5l3-3 3 3" /><path d="M15 19l-3 3-3-3" /><path d="M19 9l3 3-3 3" /><path d="M2 12h20" /><path d="M12 2v20" /></svg>
            {title} · ชี้เพื่อเปลี่ยน ลากเพื่อย้าย
          </span>
        )}
      </div>

      <style jsx>{`
        @property --a { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
        @keyframes orb-led { to { --a: 360deg; } }
        @keyframes orb-float { 50% { transform: translateY(-4px); } }
        .fd {
          --cy: 103, 232, 249;
          --vi: 167, 139, 250;
          position: fixed; width: ${ORB}px; height: ${ORB}px; transform: translate(-50%, -50%); z-index: 45;
        }
        .fd-bar {
          position: absolute; height: 72px; border-radius: 20px; bottom: calc(50% + 48px);
          background: linear-gradient(180deg, rgba(24, 36, 72, 0.72), rgba(8, 13, 32, 0.8));
          backdrop-filter: blur(26px) saturate(170%); -webkit-backdrop-filter: blur(26px) saturate(170%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 -1px 0 rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(var(--cy), 0.16),
            0 26px 50px -18px rgba(0, 0, 0, 0.95), 0 0 40px -12px rgba(34, 211, 238, 0.35);
          transition: left 340ms cubic-bezier(0.2, 0.9, 0.25, 1), width 340ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 220ms ease;
          pointer-events: none;
        }
        .fd[data-open="true"] .fd-bar { pointer-events: auto; }
        .fd[data-up="false"] .fd-bar { bottom: auto; top: calc(50% + 48px); }
        .fd-bar::after {
          content: ""; position: absolute; left: 18%; right: 18%; top: -1px; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(var(--cy), 0.85), transparent);
        }
        .fd :global(.di) {
          position: absolute; bottom: calc(50% + 61px); display: flex; flex-direction: column; align-items: center; width: max-content;
          background: none; border: 0; padding: 0; cursor: pointer; font: inherit; color: inherit; text-decoration: none;
          transform-origin: 50% 100%; pointer-events: none;
          transition: transform 480ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 260ms ease, left 110ms ease-out;
        }
        .fd[data-open="true"] :global(.di) { pointer-events: auto; }
        .fd[data-up="false"] :global(.di) { bottom: auto; top: calc(50% + 61px); transform-origin: 50% 0; }
        /* Not the site-wide max-width: 100% — an item hung right of the orb's
           76 px box has no width to be 100% of, and its icon shrank to nothing. */
        .fd :global(.di img) { display: block; max-width: none; filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.55)); transition: width 110ms ease-out, height 110ms ease-out; }
        .fd :global(.di.off) { cursor: not-allowed; }
        .fd :global(.di.off img) { filter: grayscale(0.85) brightness(0.5) drop-shadow(0 8px 12px rgba(0, 0, 0, 0.55)); }
        .fd :global(.dot) { position: absolute; bottom: -8px; width: 4px; height: 4px; border-radius: 50%; background: #a5f3fc; box-shadow: 0 0 8px #67e8f9; }
        .fd[data-up="false"] :global(.dot) { bottom: auto; top: -8px; }
        .fd :global(.tip) {
          position: absolute; bottom: calc(100% + 10px); white-space: nowrap; font-size: 12px; padding: 5px 10px; border-radius: 7px;
          background: rgba(7, 12, 28, 0.94); box-shadow: inset 0 0 0 1px rgba(var(--cy), 0.28); color: #f1f5f9;
          opacity: 0; transform: translateY(4px); transition: opacity 120ms, transform 120ms; pointer-events: none;
        }
        .fd[data-up="false"] :global(.tip) { bottom: auto; top: calc(100% + 10px); transform: translateY(-4px); }
        .fd :global(.di:hover .tip), .fd :global(.di:focus-visible .tip) { opacity: 1; transform: none; }
        .fd :global(.di:focus-visible) { outline: none; }
        .fd :global(.di:focus-visible img) { filter: drop-shadow(0 0 10px rgba(var(--cy), 0.9)); }
        .dsep {
          position: absolute; width: 1px; height: 40px; bottom: calc(50% + 77px);
          background: linear-gradient(transparent, rgba(var(--cy), 0.4), transparent); transition: opacity 260ms ease, left 110ms ease-out;
        }
        .fd[data-up="false"] .dsep { bottom: auto; top: calc(50% + 77px); }
        .orb {
          position: absolute; inset: 0; border: 0; padding: 0; background: none; cursor: grab; border-radius: 50%;
          touch-action: none; animation: orb-float 5s ease-in-out infinite;
        }
        .orb:focus-visible { outline: 2px solid rgba(var(--cy), 0.9); outline-offset: 12px; }
        .fd[data-drag="true"] .orb { cursor: grabbing; animation: none; transform: scale(1.08); }
        .fd[data-open="true"] .orb { animation: none; }
        .ball {
          position: absolute; inset: 0; border-radius: 50%; background: url(/studio/orb-v1.webp) center / 112% no-repeat;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 0 26px rgba(34, 211, 238, 0.45), 0 0 60px rgba(139, 92, 246, 0.35), 0 16px 26px -8px rgba(0, 0, 0, 0.8);
        }
        .spec {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(38% 30% at 34% 26%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 70%),
            radial-gradient(70% 70% at 50% 50%, transparent 62%, rgba(3, 6, 18, 0.35) 100%);
          mix-blend-mode: screen;
        }
        .track { position: absolute; inset: -9px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(var(--cy), 0.16); }
        .run { position: absolute; inset: -9px; border-radius: 50%; filter: drop-shadow(0 0 3px rgba(103, 232, 249, 0.95)); }
        .run i {
          position: absolute; inset: 0; border-radius: 50%; padding: 1.5px;
          background: conic-gradient(from var(--a), transparent 0 62%, rgba(var(--cy), 0.95) 74%, #fff 75%, rgba(var(--vi), 0.9) 77%, transparent 88%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
          animation: orb-led 3.2s linear infinite;
        }
        .gl {
          position: absolute; inset: 0; display: grid; place-items: center; color: #fff; pointer-events: none;
          filter: drop-shadow(0 0 6px rgba(103, 232, 249, 0.9)) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
        }
        .gl :global(svg) { width: 24px; height: 24px; }
        .oshadow {
          position: absolute; left: 50%; top: calc(100% + 6px); width: 64px; height: 12px; margin-left: -32px; border-radius: 50%;
          background: radial-gradient(closest-side, rgba(34, 211, 238, 0.35), transparent); pointer-events: none;
        }
        .hint {
          position: absolute; top: 50%; left: calc(100% + 16px); white-space: nowrap; display: flex; align-items: center; gap: 8px;
          font-size: 12px; color: #cbd5e1; padding: 6px 11px; border-radius: 9px; pointer-events: none; transform: translateY(-50%);
          background: linear-gradient(180deg, rgba(17, 27, 56, 0.82), rgba(7, 11, 27, 0.86));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(var(--cy), 0.2), 0 10px 24px -12px rgba(0, 0, 0, 0.9);
          transition: opacity 200ms ease;
        }
        .hint[data-side="left"] { left: auto; right: calc(100% + 16px); }
        .hint svg { color: rgba(var(--cy), 0.8); }

        /* ── Phone: a list with labels, over a scrim ── */
        .orb-scrim {
          position: fixed; inset: 0; z-index: 44; background: rgba(3, 6, 18, 0.66);
          backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
          opacity: 0; pointer-events: none; transition: opacity 260ms ease;
        }
        .orb-scrim[data-open="true"] { opacity: 1; pointer-events: auto; }
        .menu {
          position: absolute; bottom: calc(100% + 14px); left: 4px; display: flex; flex-direction: column;
          align-items: flex-start; gap: 10px; pointer-events: none;
        }
        .menu[data-right="true"] { left: auto; right: 4px; align-items: flex-end; }
        .fd[data-up="false"] .menu { bottom: auto; top: calc(100% + 14px); flex-direction: column-reverse; }
        .fd[data-open="true"] .menu { pointer-events: auto; }
        .menu :global(.mi) {
          display: flex; align-items: center; gap: 12px; background: none; border: 0; padding: 0; font: inherit;
          color: #f1f5f9; font-size: 14px; text-decoration: none; cursor: pointer;
          transition: transform 460ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease;
        }
        .menu[data-right="true"] :global(.mi) { flex-direction: row-reverse; }
        .menu :global(.mi img) { display: block; flex-shrink: 0; filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.55)); }
        .menu :global(.mi span) {
          padding: 6px 11px; border-radius: 9px; white-space: nowrap;
          background: linear-gradient(180deg, rgba(17, 27, 56, 0.92), rgba(7, 11, 27, 0.94));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(var(--cy), 0.2), 0 10px 22px -12px rgba(0, 0, 0, 0.9);
        }
        .menu :global(.mi.on span) {
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(var(--cy), 0.6), inset 0 -2px 0 rgba(var(--cy), 0.9), 0 0 16px -4px rgba(var(--cy), 0.7);
        }
        .menu :global(.mi.off img) { filter: grayscale(0.85) brightness(0.55); }
        .menu :global(.mi.off span) { color: #94a3b8; }
        .menu :global(.mi small) { font-size: 11px; color: #64748b; margin-left: 6px; }
        @media (prefers-reduced-motion: reduce) {
          .orb, .run i { animation: none; }
          .fd-bar, .fd :global(.di), .menu :global(.mi) { transition: opacity 120ms ease; }
        }
      `}</style>
    </>
  );
}
