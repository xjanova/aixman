"use client";

/**
 * "แกะคอร์ด · AquaChord" — a card under a finished song that hands it to
 * AquaChord (aquachord.online), which works out the chords, lyrics and guitar
 * tab in the customer's browser.
 *
 * The click asks /api/studio/aquachord-handoff for a 15-minute link (owner
 * check there) and opens it in a new tab; AquaChord then fetches the song, its
 * title and its lyrics itself. The opened tab keeps no handle on this page.
 *
 * Styling: X-DREAMER's glass card and gradient CTA, tinted with AquaChord's
 * own teal (#0d9488 → #2dd4bf) and bubbles. The bubbles stop for anyone who
 * asked for reduced motion.
 */

import Image from "next/image";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n/locale";

type LinkResult = { ok: true; url: string } | { ok: false; status: number };

/*
 * Outside the component and failure as a value, like lib/client-actions.ts:
 * a try/catch inside the component would make React Compiler give up on it.
 */
async function requestAquaChordLink(generationId: number): Promise<LinkResult> {
  try {
    const res = await fetch("/api/studio/aquachord-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generationId }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data: unknown = await res.json();
    const url = data && typeof data === "object" ? (data as { url?: unknown }).url : undefined;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return { ok: false, status: 500 };
    return { ok: true, url };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Whether an admin has the handoff on; asked once per page load. A failed check shows the card (the click then explains). */
let enabledCheck: Promise<boolean> | null = null;
function handoffSwitchedOn(): Promise<boolean> {
  enabledCheck ??= fetch("/api/studio/aquachord-handoff")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: unknown) => !(data && typeof data === "object" && (data as { enabled?: unknown }).enabled === false))
    .catch(() => true);
  return enabledCheck;
}

function errorText(status: number, t: Translate): string {
  switch (status) {
    case 0:
      return t("เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง", "Couldn’t connect — try again.");
    case 401:
      return t("กรุณาเข้าสู่ระบบอีกครั้ง", "Please sign in again.");
    case 403:
    case 404:
      return t("ไม่พบเพลงนี้ในบัญชีของคุณ", "This song isn’t in your account.");
    case 410:
      return t("ไฟล์เพลงนี้หมดอายุแล้ว จึงส่งไปแกะคอร์ดไม่ได้", "This song’s file has expired, so it can’t be sent.");
    case 503:
      return t("ระบบส่งเพลงไป AquaChord ยังไม่เปิดใช้งาน", "Sending songs to AquaChord isn’t available yet.");
    default:
      return t("ส่งเพลงไป AquaChord ไม่สำเร็จ ลองอีกครั้ง", "Couldn’t send the song to AquaChord — try again.");
  }
}

type Phase = { name: "idle" } | { name: "busy" } | { name: "ready"; url: string } | { name: "error"; status: number };

/** Rising bubbles: left %, size px, delay s, duration s. */
const BUBBLES: [number, number, number, number][] = [
  [8, 6, 0, 5.2], [22, 4, 1.6, 4.4], [47, 7, 0.8, 6], [63, 5, 2.4, 4.8], [78, 4, 0.4, 5.6], [91, 6, 3, 5],
];
const CHORDS = ["Am", "F", "C", "G"];

export function AquaChordHandoff({ genId, style }: { genId: number; style?: React.CSSProperties }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [switchedOn, setSwitchedOn] = useState<boolean | null>(null);
  const busy = phase.name === "busy";

  useEffect(() => {
    let live = true;
    void handoffSwitchedOn().then((on) => { if (live) setSwitchedOn(on); });
    return () => { live = false; };
  }, []);

  const send = async () => {
    if (busy) return;
    setPhase({ name: "busy" });
    const result = await requestAquaChordLink(genId);
    if (!result.ok) {
      setPhase({ name: "error", status: result.status });
      return;
    }
    window.open(result.url, "_blank", "noopener");
    setPhase({ name: "ready", url: result.url });
  };

  // Hidden until the switch is known, and while an admin has it off.
  if (switchedOn !== true) return null;

  return (
    <section className="aqc-card" aria-label={t("แกะคอร์ดใน AquaChord", "Get chords in AquaChord")} style={style}>
      <span className="aqc-bubbles" aria-hidden="true">
        {BUBBLES.map(([left, size, delay, duration], i) => (
          <i key={i} className="aqc-bubble" style={{ left: `${left}%`, width: size, height: size, animationDelay: `${delay}s`, animationDuration: `${duration}s` }} />
        ))}
      </span>

      <div className="aqc-row">
        <div className="aqc-orb" aria-hidden="true">
          <Image src="/partners/aquachord/mark-192.webp" alt="" width={40} height={45} style={{ width: 40, height: 45, objectFit: "contain" }} />
        </div>
        <div className="aqc-text">
          <div className="aqc-kicker">AQUACHORD · {t("แกะเพลงด้วย AI", "AI transcription")}</div>
          <div className="aqc-title">{t("แกะคอร์ด · AquaChord", "Chords · AquaChord")}</div>
          <div className="aqc-sub">
            {t("คอร์ด เนื้อร้อง และแท็บกีตาร์ของเพลงนี้ — เปิดในแท็บใหม่", "This song’s chords, lyrics and guitar tab — opens in a new tab")}
          </div>
          <div className="aqc-chips" aria-hidden="true">
            {CHORDS.map((c) => <span key={c} className="aqc-chip">{c}</span>)}
          </div>
        </div>
        <button type="button" className="aqc-btn" onClick={() => void send()} disabled={busy} aria-busy={busy}>
          {busy ? (
            <><span className="aqc-spin" aria-hidden="true" />{t("กำลังเตรียมเพลง…", "Preparing the song…")}</>
          ) : (
            <>{t("แกะคอร์ดใน AquaChord", "Get chords in AquaChord")}<span aria-hidden="true" className="aqc-arrow">↗</span></>
          )}
        </button>
      </div>

      {phase.name === "ready" && (
        <p className="aqc-note" role="status">
          ✓ {t("เปิด AquaChord ในแท็บใหม่แล้ว", "AquaChord opened in a new tab.")}{" "}
          <a href={phase.url} target="_blank" rel="noopener">{t("ไม่เห็นแท็บ? เปิดอีกครั้ง", "No tab? Open it again")}</a>
        </p>
      )}
      {phase.name === "error" && (
        <p className="aqc-note aqc-error" role="alert">{errorText(phase.status, t)}</p>
      )}

      <style jsx>{`
        .aqc-card {
          position: relative; overflow: hidden; border-radius: 14px; padding: 14px 16px;
          background:
            radial-gradient(120% 140% at 0% 0%, rgba(45, 212, 191, 0.2), transparent 55%),
            radial-gradient(90% 120% at 100% 100%, rgba(139, 92, 246, 0.16), transparent 60%),
            rgba(2, 6, 23, 0.55);
          border: 1px solid rgba(45, 212, 191, 0.28);
          box-shadow: inset 0 1px 0 rgba(153, 246, 228, 0.08), 0 12px 30px -18px rgba(13, 148, 136, 0.7);
        }
        .aqc-bubbles { position: absolute; inset: 0; pointer-events: none; }
        .aqc-bubble {
          position: absolute; bottom: -10px; border-radius: 50%;
          background: radial-gradient(circle at 32% 30%, rgba(255, 255, 255, 0.85), rgba(94, 234, 212, 0.35) 45%, rgba(45, 212, 191, 0.05) 70%);
          border: 1px solid rgba(153, 246, 228, 0.45);
          animation-name: aqc-rise; animation-timing-function: ease-in; animation-iteration-count: infinite;
          opacity: 0;
        }
        @keyframes aqc-rise {
          0% { transform: translateY(0) scale(0.6); opacity: 0; }
          15% { opacity: 0.9; }
          100% { transform: translateY(-110px) scale(1.05); opacity: 0; }
        }
        .aqc-row { position: relative; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .aqc-orb {
          flex-shrink: 0; width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center;
          background: radial-gradient(circle at 50% 42%, rgba(45, 212, 191, 0.35), rgba(13, 148, 136, 0.12) 58%, rgba(2, 6, 23, 0.6));
          border: 1px solid rgba(94, 234, 212, 0.3);
          box-shadow: 0 0 22px -4px rgba(45, 212, 191, 0.55);
        }
        .aqc-text { flex: 1 1 150px; min-width: 0; }
        .aqc-kicker { font-size: 10px; letter-spacing: 0.18em; color: rgba(153, 246, 228, 0.8); text-transform: uppercase; }
        .aqc-title {
          margin-top: 2px; font-size: 15.5px; font-weight: 700; line-height: 1.35;
          background: linear-gradient(90deg, #ccfbf1, #5eead4 45%, #c4b5fd);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .aqc-sub { margin-top: 2px; font-size: 12px; line-height: 1.5; color: rgba(203, 213, 225, 0.78); }
        .aqc-chips { display: flex; gap: 5px; margin-top: 7px; }
        .aqc-chip {
          padding: 1px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.02em;
          color: #99f6e4; background: rgba(45, 212, 191, 0.1); border: 1px solid rgba(45, 212, 191, 0.25);
        }
        .aqc-btn {
          flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          height: 40px; padding: 0 16px; border-radius: 11px; border: none; cursor: pointer;
          font-family: inherit; font-size: 13px; font-weight: 700; color: #032b27; white-space: nowrap;
          background: linear-gradient(135deg, #2dd4bf 0%, #5eead4 45%, #a5b4fc 100%);
          box-shadow: 0 10px 24px -10px rgba(45, 212, 191, 0.8);
          transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms, filter 200ms;
        }
        .aqc-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 16px 30px -12px rgba(45, 212, 191, 0.95); }
        .aqc-btn:focus-visible { outline: 2px solid #99f6e4; outline-offset: 2px; }
        .aqc-btn:disabled { cursor: wait; filter: saturate(0.7) brightness(0.92); }
        .aqc-arrow { font-size: 14px; }
        .aqc-spin {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid rgba(3, 43, 39, 0.25); border-top-color: #032b27;
          animation: aqc-spin 0.8s linear infinite;
        }
        @keyframes aqc-spin { to { transform: rotate(360deg); } }
        .aqc-note { position: relative; margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: #99f6e4; }
        .aqc-note a { color: #5eead4; text-decoration: underline; text-underline-offset: 2px; }
        .aqc-error { color: #fca5a5; }
        @media (max-width: 520px) {
          .aqc-btn { width: 100%; }
          .aqc-kicker { letter-spacing: 0.08em; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aqc-bubble { animation: none; opacity: 0.5; bottom: auto; top: 20%; }
          .aqc-spin { animation-duration: 2.4s; }
        }
      `}</style>
    </section>
  );
}
