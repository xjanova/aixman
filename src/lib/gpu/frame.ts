/**
 * Fit a requested frame inside a model's limits without changing its shape.
 *
 * `maxWidth` × `maxHeight` is read as a pixel budget with a longest-side cap,
 * not as two separate ceilings. MiniMax H3 is listed as 1344×768, and capping
 * each axis on its own turned the studio's 9:16 (768×1344) into a 768×768
 * square and its 1:1 (1024×1024) into 1024×768 — the model renders both shapes
 * at the same pixel count. The model's own step (multiples of 32 for H3) is
 * applied later by its catalogue binding.
 */
export function fitFrame(
  width: unknown,
  height: unknown,
  maxWidth: number | null | undefined,
  maxHeight: number | null | undefined
): { width: number; height: number } {
  const positive = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  let w = positive(width) ?? maxWidth ?? 768;
  let h = positive(height) ?? maxHeight ?? 768;
  if (maxWidth && maxHeight && maxWidth > 0 && maxHeight > 0) {
    const scale = Math.min(
      1,
      Math.sqrt((maxWidth * maxHeight) / (w * h)),
      Math.max(maxWidth, maxHeight) / Math.max(w, h)
    );
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  return { width: w, height: h };
}
