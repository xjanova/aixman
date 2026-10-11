/**
 * The X-DREAMER mark's geometry, shared by <XdreamerMark> and the script that
 * renders the favicons and app icons (scripts/render-brand-icons.mts), so the
 * two cannot drift apart.
 *
 * A 64-unit box. Three threads run along each diagonal, 7 units apart. Thread
 * A (rising to the right) crosses over B where (i + j) is even and under it
 * where odd — cut with masks, so the gaps stay true on any background.
 */

/** Threads rising to the right. */
export const A_THREADS = "M13.6 40.5L40.5 13.6M15 49L49 15M23.5 50.4L50.4 23.5";
/** Threads falling to the right. */
export const B_THREADS = "M13.6 23.5L40.5 50.4M15 15L49 49M23.5 13.6L50.4 40.5";
/** Short pieces along B where B lies on top: they cut A's thread. */
export const B_OVER = "M24.6 24.6L29.5 29.5M24.6 34.5L29.5 39.4M34.5 24.6L39.4 29.5M34.5 34.5L39.4 39.4";
/** Short pieces along A where A lies on top: they cut B's thread. */
export const A_OVER = "M29.5 34.5L34.5 29.5M19.6 34.5L24.6 29.5M39.4 34.5L44.4 29.5M29.5 24.6L34.5 19.6M29.5 44.4L34.5 39.4";
/** The spark off the top-right thread. */
export const SPARK = "M55 4.5l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z";

export const A_STOPS = ["#10B981", "#22D3EE"] as const;
export const B_STOPS = ["#38BDF8", "#A855F7"] as const;
export const SPARK_FILL = "#F0F9FF";

/**
 * The mark as standalone SVG text, for rasterising. `inset` shrinks it inside
 * its box (maskable icons keep their content in the middle 80%); `tile` paints
 * a background square first.
 */
export function markSvg({
  size,
  spark = true,
  inset = 0,
  tile,
  simple = false,
}: {
  size: number;
  spark?: boolean;
  inset?: number;
  tile?: string;
  /** Two plain strokes instead of the weave, for 16 px where the weave blurs. */
  simple?: boolean;
}): string {
  const scale = 1 - 2 * inset;
  const offset = 64 * inset;
  const body = simple
    ? `<g fill="none" stroke-linecap="round" stroke-width="9">` +
      `<path d="M14 14L50 50" stroke="url(#b)"/><path d="M14 50L50 14" stroke="url(#a)"/></g>`
    : `<g fill="none" stroke-linecap="round" stroke-width="4.5">` +
      `<path d="${B_THREADS}" stroke="url(#b)" mask="url(#mb)"/>` +
      `<path d="${A_THREADS}" stroke="url(#a)" mask="url(#ma)"/></g>` +
      (spark ? `<path d="${SPARK}" fill="${SPARK_FILL}"/>` : "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `<defs>` +
    `<linearGradient id="a" gradientUnits="userSpaceOnUse" x1="13" y1="51" x2="51" y2="13">` +
    `<stop offset="0" stop-color="${A_STOPS[0]}"/><stop offset="1" stop-color="${A_STOPS[1]}"/></linearGradient>` +
    `<linearGradient id="b" gradientUnits="userSpaceOnUse" x1="13" y1="13" x2="51" y2="51">` +
    `<stop offset="0" stop-color="${B_STOPS[0]}"/><stop offset="1" stop-color="${B_STOPS[1]}"/></linearGradient>` +
    `<mask id="ma" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">` +
    `<rect width="64" height="64" fill="#fff"/><path d="${B_OVER}" stroke="#000" stroke-width="8"/></mask>` +
    `<mask id="mb" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">` +
    `<rect width="64" height="64" fill="#fff"/><path d="${A_OVER}" stroke="#000" stroke-width="8"/></mask>` +
    `</defs>` +
    (tile ? `<rect width="64" height="64" fill="${tile}"/>` : "") +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g>` +
    `</svg>`
  );
}
