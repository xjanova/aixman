/**
 * Songs have no picture of their own, so every place that shows a generation
 * — the studio result, gallery tiles, the detail dialog, history strips —
 * draws the same stand-in: a gradient seeded from the song's text, with an
 * equaliser on top. Same seed, same colours, wherever the song appears.
 */

import type { CSSProperties } from "react";

/** A result URL that is a song rather than a still or a clip. */
export const AUDIO_EXT = /\.(flac|mp3|wav|ogg|opus|m4a)(\?|$)/i;

function hueOf(seed: string): number {
  return [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);
}

/**
 * The cover alone. `animated` bars are for the one song being listened to;
 * a wall of tiles stays still so it does not shimmer.
 */
export function AudioCover({ seed, bars = 14, animated = false, label = true, style }: {
  seed: string;
  bars?: number;
  animated?: boolean;
  label?: boolean;
  style?: CSSProperties;
}) {
  const hue = hueOf(seed);
  return (
    <div style={{
      position: "relative", display: "grid", placeItems: "center",
      background: `radial-gradient(circle at 28% 30%, hsl(${hue},80%,58%), hsl(${(hue + 70) % 360},70%,22%) 72%)`,
      ...style,
    }}>
      <div aria-hidden style={{ display: "flex", gap: "3%", alignItems: "flex-end", width: "62%", height: "44%" }}>
        {Array.from({ length: bars }).map((_, i) => (
          <span key={i} className={animated ? "xdr-motion" : undefined} style={{
            flex: 1, borderRadius: 4, background: "rgba(255,255,255,0.85)", transformOrigin: "bottom",
            height: animated ? "100%" : `${28 + ((i * 37 + hue) % 64)}%`,
            animation: animated ? `xdr-eq ${0.7 + (i % 5) * 0.16}s ease-in-out ${i * 0.06}s infinite alternate` : undefined,
          }} />
        ))}
      </div>
      {label && (
        <span style={{ position: "absolute", top: 12, left: 14, fontSize: 11, letterSpacing: "0.16em", color: "rgba(255,255,255,0.85)" }}>♫ X-DREAMER MUSIC</span>
      )}
    </div>
  );
}

/** Cover, title and a player — how a finished song is presented. */
export function AudioResult({ src, title, autoPlay = true }: { src: string; title: string; autoPlay?: boolean }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(2,6,23,0.5)" }}>
      <AudioCover seed={title} animated style={{ aspectRatio: "16/7" }} />
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 14, color: "#f1f5f9", marginBottom: 12, lineHeight: 1.45 }}>{title}</div>
        <audio src={src} controls autoPlay={autoPlay} style={{ width: "100%" }} />
      </div>
    </div>
  );
}
