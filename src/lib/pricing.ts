/**
 * Credits for a generation whose cost grows with its length.
 *
 * Most models are sold flat per generation, and that is right when a provider
 * bills flat. A self-hosted video model does not: its cost is GPU seconds, and
 * attention makes those grow faster than the clip. Measured on the first real
 * rental (A100, MiniMax H3 at 1344x768): 5 s took 107 s of GPU, 15 s took 556 s
 * — 5.2x the render for 3x the footage. (15/5)^1.5 = 5.196, so the curve below
 * with exponent 1.5 tracks what the render actually costs. Flat pricing sold
 * the 15 s clip at a fifth of its cost.
 *
 * Pure and dependency-free so the studio can show the same number the server
 * will charge.
 */

export interface DurationCurve {
  /** Length the base price covers, in seconds. */
  unitSeconds: number;
  /** How cost grows past it: 1 = per second, 1.5 = what H3's render measured. */
  exponent: number;
}

export function creditsForDuration(
  baseCredits: number,
  curve: DurationCurve | null | undefined,
  seconds: number | null | undefined
): number {
  if (!curve || !seconds || !Number.isFinite(seconds) || seconds <= curve.unitSeconds) return baseCredits;
  return Math.ceil(baseCredits * Math.pow(seconds / curve.unitSeconds, curve.exponent));
}
