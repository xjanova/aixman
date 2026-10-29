/**
 * What the pricing page shows next to each credit package, worked out from the
 * live package and model lists.
 *
 * No price or credit amount is written here. Packages come from
 * `ai_credit_packages` (the table xmanstudio also bills and pays affiliates
 * from) and work costs from `ai_models.credits_per_unit`; this file only does
 * arithmetic on what those two endpoints return.
 */

export interface PackageLike {
  credits: number;
  bonusCredits: number;
  /** Decimal columns arrive as strings from Prisma's JSON. */
  priceThb: number | string;
  isFeatured?: boolean;
}

export interface ModelLike {
  category: string;
  subcategory?: string | null;
  creditsPerUnit: number;
  /** Missing on an older API: treated as orderable. */
  canOrder?: boolean;
}

export type WorkKind = "image" | "video" | "audio";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const priceOf = (p: Pick<PackageLike, "priceThb">): number => num(p.priceThb);

export const totalCredits = (p: Pick<PackageLike, "credits" | "bonusCredits">): number =>
  Math.max(0, num(p.credits)) + Math.max(0, num(p.bonusCredits));

/** Price of one credit in the package's own currency figure, or null for a free one. */
export function pricePerCredit(price: number, credits: number): number | null {
  if (!(price > 0) || !(credits > 0)) return null;
  return price / credits;
}

/**
 * Dubbing (lip-sync) is priced by the voice's length, not per clip, so it would
 * drag "a clip" towards a figure no plain video order costs.
 */
const isLipsync = (m: ModelLike) => (m.subcategory ?? "").startsWith("lipsync");

/**
 * What one typical piece of work of each kind costs, from the models a
 * customer can order right now. The upper median: an estimate must never
 * promise more pictures than the middle of the range would give.
 * A kind with nothing orderable is left out — no estimate for what cannot be bought.
 */
export function typicalCosts(models: ModelLike[]): Partial<Record<WorkKind, number>> {
  const out: Partial<Record<WorkKind, number>> = {};
  for (const kind of ["image", "video", "audio"] as const) {
    const costs = models
      .filter(m => m.category === kind && m.canOrder !== false && !isLipsync(m))
      .map(m => num(m.creditsPerUnit))
      .filter(c => c > 0)
      .sort((a, b) => a - b);
    if (costs.length) out[kind] = costs[Math.floor(costs.length / 2)];
  }
  return out;
}

/** How many pieces of work a package's credits pay for at a given cost. */
export const howMany = (credits: number, cost: number): number =>
  cost > 0 ? Math.floor(credits / cost) : 0;

export function parseFeatures(f: unknown): string[] {
  if (Array.isArray(f)) return f.filter((x): x is string => typeof x === "string");
  if (typeof f !== "string" || !f.trim()) return [];
  try {
    const parsed = JSON.parse(f);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** "500 + 50 โบนัส เครดิต", "20 เครดิตฟรี" — the card already shows these as figures. */
const RESTATES_CREDITS = /^[\d,]+(\s*\+\s*[\d,]+\s*โบนัส)?\s*เครดิต(ฟรี)?$/;
/** "ภาพ ~137 ภาพ" — admin-typed estimates at a fixed rate, replaced by live ones. */
const ESTIMATE = /^(ภาพ|วิดีโอ|คลิป|เพลง)\s*~/;

/**
 * The admin's feature lines minus the ones the card shows itself. Estimates
 * are only dropped when the card has live ones to show instead.
 */
export function extraFeatures(features: string[], showsEstimates: boolean): string[] {
  return features
    .map(f => f.trim())
    .filter(f => f && !RESTATES_CREDITS.test(f) && !(showsEstimates && ESTIMATE.test(f)));
}

export const EMBLEM_COUNT = 6;

/**
 * Which emblem (0 … EMBLEM_COUNT-1) each package wears, in the input's order.
 * Free packages get the first; paid ones are ranked by price so the dearest
 * always gets the grandest, whatever the packages are called or how many there are.
 */
export function emblemIndexes(packages: PackageLike[]): number[] {
  const top = EMBLEM_COUNT - 1;
  const paid = packages
    .map((p, i) => ({ i, price: priceOf(p) }))
    .filter(x => x.price > 0)
    .sort((a, b) => a.price - b.price || a.i - b.i);
  const out = packages.map(() => 0);
  paid.forEach((x, rank) => {
    out[x.i] = Math.max(1, top - (paid.length - 1 - rank));
  });
  return out;
}

/** The package the page recommends: the first featured paid one, else none. */
export function recommendedIndex(packages: PackageLike[]): number {
  return packages.findIndex(p => p.isFeatured && priceOf(p) > 0);
}
