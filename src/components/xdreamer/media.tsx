"use client";

/**
 * MediaTile — a still that upgrades itself to video when a clip is present.
 *
 * The still is always the base layer. The <video> is only mounted once the
 * tile is "armed" (hovered on a mouse, scrolled into view on touch), and only
 * fades in once it genuinely reaches `canplay`. That gives three things for
 * free:
 *
 *   1. A missing .mp4 is invisible — no broken frame, no layout shift, the
 *      poster simply stays. Assets can land one at a time.
 *   2. A wall of nine tiles doesn't pull nine video files on first paint.
 *   3. `prefers-reduced-motion` users never get autoplaying video at all.
 */

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

/**
 * Subscribe to a media query without setting state inside an effect.
 * The server snapshot is always `false`, so the first client render matches
 * the server HTML and React re-renders once hydration settles.
 */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

type MediaTileProps = {
  image: string;
  video?: string;
  alt: string;
  /** "eager" loads + plays straight away (hero). "auto" waits to be armed. */
  policy?: "eager" | "auto";
  sizes?: string;
  priority?: boolean;
  objectPosition?: string;
  /** Extra dimming applied over the media — hero uses this for text contrast. */
  overlay?: string;
};

export function MediaTile({
  image,
  video,
  alt,
  policy = "auto",
  sizes = "100vw",
  priority = false,
  objectPosition = "center",
  overlay,
}: MediaTileProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");

  const showVideo = Boolean(video) && !failed && !reducedMotion && (policy === "eager" || armed);

  // Arm the "auto" tiles: on a mouse that means the first hover, on touch it
  // means the tile becoming the thing on screen.
  useEffect(() => {
    if (!video || failed || reducedMotion || policy === "eager") return;
    const el = wrapRef.current;
    if (!el) return;

    if (finePointer) {
      const arm = () => setArmed(true);
      el.addEventListener("pointerenter", arm, { once: true });
      return () => el.removeEventListener("pointerenter", arm);
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setArmed(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [video, policy, failed, reducedMotion, finePointer]);

  // Reveal the clip once it can actually paint.
  //
  // Listening for `canplay` alone is not enough. The hero's <video> exists in
  // the very first commit, so it can finish buffering before this effect
  // attaches a listener — the event is then already gone and the clip stays
  // invisible on top of its poster forever. So also read `readyState`
  // directly. Deliberately a timer and not requestAnimationFrame: rAF is
  // starved when the page isn't compositing, which is exactly the case that
  // hid this bug in the first place.
  useEffect(() => {
    const v = videoRef.current;
    if (!showVideo || !v) return;

    const markReady = () => setReady(true);
    v.addEventListener("loadeddata", markReady);
    v.addEventListener("canplay", markReady);
    const t = setTimeout(() => {
      if (v.readyState >= 2 /* HAVE_CURRENT_DATA */) markReady();
    }, 0);

    return () => {
      clearTimeout(t);
      v.removeEventListener("loadeddata", markReady);
      v.removeEventListener("canplay", markReady);
    };
  }, [showVideo]);

  // On a mouse, playback follows the cursor; elsewhere it follows the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    const v = videoRef.current;
    if (!showVideo || !el || !v) return;

    const play = () => void v.play().catch(() => {});
    const pause = () => v.pause();

    if (policy === "auto" && finePointer) {
      el.addEventListener("pointerenter", play);
      el.addEventListener("pointerleave", pause);
      play(); // the pointerenter that armed this tile has already fired
      return () => {
        el.removeEventListener("pointerenter", play);
        el.removeEventListener("pointerleave", pause);
      };
    }

    const io = new IntersectionObserver(
      (entries) => (entries[0]?.isIntersecting ? play() : pause()),
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [showVideo, policy, finePointer]);

  const cover: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition,
  };

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Image src={image} alt={alt} fill sizes={sizes} priority={priority} style={{ objectFit: "cover", objectPosition }} />
      {showVideo && (
        <video
          ref={videoRef}
          src={video}
          muted
          loop
          playsInline
          preload="auto"
          // The hero is in view by definition, so let the browser start it
          // rather than waiting on the viewport observer below.
          autoPlay={policy === "eager"}
          onError={() => setFailed(true)}
          style={{ ...cover, opacity: ready ? 1 : 0, transition: "opacity 700ms ease", pointerEvents: "none" }}
        />
      )}
      {overlay && <div style={{ position: "absolute", inset: 0, background: overlay, pointerEvents: "none" }} />}
    </div>
  );
}

/** Small "this one moves" marker used on the showcase wall. */
export function ModeBadge({ mode, hue }: { mode: "image" | "video"; hue: number }) {
  const isVideo = mode === "video";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        padding: "4px 9px",
        borderRadius: 999,
        background: isVideo ? `hsla(${hue},85%,60%,0.22)` : "rgba(255,255,255,0.12)",
        border: `1px solid ${isVideo ? `hsla(${hue},85%,70%,0.45)` : "rgba(255,255,255,0.16)"}`,
        backdropFilter: "blur(8px)",
        color: "#fff",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      <span style={{ fontSize: 9 }}>{isVideo ? "▶" : "▧"}</span>
      {isVideo ? "video" : "image"}
    </span>
  );
}
