/**
 * The X-DREAMER mark: an X woven from three threads each way, over and under
 * like cloth, with a spark off the top right. Geometry in ./logo-paths.
 *
 * Gradient and mask ids are per instance (useId), since one page can draw the
 * mark more than once and SVG ids are document-wide.
 */

import { useId } from "react";
import { A_OVER, A_STOPS, A_THREADS, B_OVER, B_STOPS, B_THREADS, SPARK, SPARK_FILL } from "./logo-paths";

export function XdreamerMark({
  size = 36,
  spark = true,
  title,
  className,
}: {
  size?: number;
  /** The star off the top-right thread; drop it below ~24px, where it is a speck. */
  spark?: boolean;
  /** Accessible name. Without one the mark is decorative (aria-hidden). */
  title?: string;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ga = `xm-a-${id}`;
  const gb = `xm-b-${id}`;
  const ma = `xm-ma-${id}`;
  const mb = `xm-mb-${id}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={ga} gradientUnits="userSpaceOnUse" x1="13" y1="51" x2="51" y2="13">
          <stop offset="0" stopColor={A_STOPS[0]} />
          <stop offset="1" stopColor={A_STOPS[1]} />
        </linearGradient>
        <linearGradient id={gb} gradientUnits="userSpaceOnUse" x1="13" y1="13" x2="51" y2="51">
          <stop offset="0" stopColor={B_STOPS[0]} />
          <stop offset="1" stopColor={B_STOPS[1]} />
        </linearGradient>
        <mask id={ma} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d={B_OVER} stroke="#000" strokeWidth="8" />
        </mask>
        <mask id={mb} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d={A_OVER} stroke="#000" strokeWidth="8" />
        </mask>
      </defs>
      <g fill="none" strokeLinecap="round" strokeWidth="4.5">
        <path d={B_THREADS} stroke={`url(#${gb})`} mask={`url(#${mb})`} />
        <path d={A_THREADS} stroke={`url(#${ga})`} mask={`url(#${ma})`} />
      </g>
      {spark && <path d={SPARK} fill={SPARK_FILL} />}
    </svg>
  );
}

/** Mark and name together, as the navs and the footer show them. */
export function XdreamerLockup({ size = 36, fontSize = 15 }: { size?: number; fontSize?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3) }}>
      <XdreamerMark size={size} spark={size >= 24} />
      <span
        style={{
          fontFamily: "var(--font-unbounded), var(--font-inter), sans-serif",
          fontWeight: 600,
          fontSize,
          letterSpacing: "0.1em",
          color: "#F8FAFC",
          whiteSpace: "nowrap",
        }}
      >
        X-DREAMER
      </span>
    </span>
  );
}
