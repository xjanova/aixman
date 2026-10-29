/**
 * What a KIE.ai order costs the customer, in credits.
 *
 * KIE prices most models by a tier (1K / 2K / 4K, 720p / 1080p, a speed) and
 * many video models by the second as well, so one `creditsPerUnit` cannot say
 * what an order costs. The model sync (kie-sync.ts) writes a table of credits
 * per tier and length into the row's `defaultParams.kie`; GenerationService
 * charges from it and the studio shows the same number from it.
 *
 * Only credits live in the table. `defaultParams` is sent to anyone by
 * `/api/models`, so the vendor's USD price must never be written there.
 *
 * Pure and dependency-free so the studio can import it.
 */

export interface KiePriceTier {
  id: string;
  /** Thai or brand label on the studio chip. */
  label: string;
  isDefault?: boolean;
}

export interface KiePriceTable {
  /** Which order param carries the tier: the image tab's quality chips or the video tab's resolution chips. */
  tierParam: 'quality' | 'resolution' | null;
  tiers: KiePriceTier[];
  /** Lengths offered, in seconds; null = the price does not depend on a length. */
  durations: number[] | null;
  /**
   * Credits per tier. With `durations`, keyed by the length; with
   * `perSecond`, a single `'1'` key the length multiplies; otherwise `'*'`.
   */
  credits: Record<string, Record<string, number>>;
  /** Priced per second of an uploaded voice or clip (portraits, re-dubs, upscales). */
  perSecond?: boolean;
  /** Priced per this many characters of text (speech): `credits[tier]['1']` per block, pro rata. */
  perChars?: number;
  /** Credits per attached picture past `freeImages` (KIE bills some inputs). */
  imageCredits?: number;
  freeImages?: number;
}

/** What a credit is worth and how much above cost we sell. */
export interface KieBasis {
  usdToThb: number;
  /** The cheapest paid rate a customer can buy a credit at. */
  thbPerCredit: number;
  markup: number;
}

/**
 * Seed convention: twice the vendor's cost at the cheapest package rate
 * (Enterprise ฿2,499 for 6,500 credits) and ฿36 to the dollar. The sync
 * replaces the rate with the live packages' cheapest one.
 */
export const DEFAULT_KIE_BASIS: KieBasis = { usdToThb: 36, thbPerCredit: 2499 / 6500, markup: 2 };

/** Credits for a vendor price in USD, never below one. */
export function kieCredits(usd: number, basis: KieBasis = DEFAULT_KIE_BASIS): number {
  if (!Number.isFinite(usd) || usd <= 0) return 1;
  const perCredit = basis.thbPerCredit > 0 ? basis.thbPerCredit : DEFAULT_KIE_BASIS.thbPerCredit;
  // A hair of float noise above a whole number is not another credit.
  return Math.max(1, Math.ceil((usd * basis.usdToThb * basis.markup) / perCredit - 1e-9));
}

/**
 * What credits bring in, in USD, at the cheapest rate a customer buys them —
 * the least an order charged that many can have paid us.
 */
export function creditsUsd(credits: number, basis: KieBasis = DEFAULT_KIE_BASIS): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  const perCredit = basis.thbPerCredit > 0 ? basis.thbPerCredit : DEFAULT_KIE_BASIS.thbPerCredit;
  const usdToThb = basis.usdToThb > 0 ? basis.usdToThb : DEFAULT_KIE_BASIS.usdToThb;
  return (credits * perCredit) / usdToThb;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The table from a row's `defaultParams`, or null when it has none or it is malformed. */
export function readKiePriceTable(defaultParams: unknown): KiePriceTable | null {
  const raw = isRecord(defaultParams) ? defaultParams.kie : undefined;
  if (!isRecord(raw) || !Array.isArray(raw.tiers) || !isRecord(raw.credits)) return null;
  const tiers = raw.tiers.filter(
    (t): t is KiePriceTier => isRecord(t) && typeof t.id === 'string' && typeof t.label === 'string'
  );
  if (tiers.length === 0) return null;
  const credits: Record<string, Record<string, number>> = {};
  for (const tier of tiers) {
    const row = raw.credits[tier.id];
    if (!isRecord(row)) return null;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(row)) {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) clean[k] = n;
    }
    if (Object.keys(clean).length === 0) return null;
    credits[tier.id] = clean;
  }
  const durations = Array.isArray(raw.durations)
    ? raw.durations.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : null;
  const tierParam = raw.tierParam === 'quality' || raw.tierParam === 'resolution' ? raw.tierParam : null;
  const imageCredits = Number(raw.imageCredits);
  const freeImages = Number(raw.freeImages);
  const perChars = Number(raw.perChars);
  return {
    tierParam,
    tiers: tiers.map((t) => ({ id: t.id, label: t.label, isDefault: t.isDefault === true })),
    durations: durations && durations.length > 0 ? durations : null,
    credits,
    perSecond: raw.perSecond === true,
    perChars: Number.isInteger(perChars) && perChars > 0 ? perChars : undefined,
    imageCredits: Number.isInteger(imageCredits) && imageCredits > 0 ? imageCredits : undefined,
    freeImages: Number.isInteger(freeImages) && freeImages >= 0 ? freeImages : undefined,
  };
}

/** The tier an order gets: the one asked for if offered, else the default. */
export function pickKieTier(table: KiePriceTable, wanted: unknown): KiePriceTier {
  return (
    table.tiers.find((t) => t.id === wanted) ?? table.tiers.find((t) => t.isDefault) ?? table.tiers[0]
  );
}

/** The length an order gets: the one asked for if offered, else the shortest. */
export function pickKieDuration(table: KiePriceTable, wanted: unknown): number | null {
  if (!table.durations) return null;
  const n = Number(wanted);
  return table.durations.includes(n) ? n : table.durations[0];
}

export interface KieQuoteInput {
  tier?: unknown;
  seconds?: unknown;
  /** Pictures attached (references and frames). */
  images?: number;
  /** Characters of text to speak (`speechChars`). */
  chars?: number;
}

/**
 * Characters a speech order is priced by: the text as it will be sent,
 * counted in code points (a Thai vowel mark is a character, as KIE counts it).
 */
export function speechChars(text: unknown): number {
  return typeof text === 'string' ? [...text.trim()].length : 0;
}

/** Credits for one order. The studio and GenerationService both call this. */
export function kieQuote(table: KiePriceTable, order: KieQuoteInput): number {
  const tier = pickKieTier(table, order.tier);
  const row = table.credits[tier.id] ?? {};
  let credits: number;
  if (table.perChars) {
    // Pro rata, so a one-line greeting is not billed a thousand characters.
    const chars = Math.max(1, Math.floor(Number(order.chars) || 0));
    credits = Math.max(1, Math.ceil(((row['1'] ?? 1) * chars) / table.perChars - 1e-9));
  } else if (table.perSecond) {
    const seconds = Math.max(1, Math.ceil(Number(order.seconds) || 0));
    credits = (row['1'] ?? 1) * seconds;
  } else if (table.durations) {
    const seconds = pickKieDuration(table, order.seconds) ?? table.durations[0];
    credits = row[String(seconds)] ?? Math.max(...Object.values(row));
  } else {
    credits = row['*'] ?? Math.max(...Object.values(row));
  }
  const extra = Math.max(0, (order.images ?? 0) - (table.freeImages ?? 0));
  return credits + extra * (table.imageCredits ?? 0);
}
