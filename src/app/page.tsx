/**
 * X-DREAMER landing page
 *
 * Server component: fetches the active credit packages from CreditService
 * (DB), normalises them into the Tier shape XdreamerLanding draws, and loads
 * the page's own faces — Bai Jamjuree for headings, IBM Plex Sans Thai Looped
 * for reading. The wordmark's Unbounded comes from the root layout.
 */

import { Bai_Jamjuree, IBM_Plex_Sans_Thai_Looped } from "next/font/google";
import XdreamerLanding, { type Tier } from "@/components/xdreamer/landing";
import { CreditService } from "@/lib/services/credits";
import { formatNumber, formatThb, translator, type Locale } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { packageFeatures, packageLabel } from "@/lib/i18n/package-text";

const heading = Bai_Jamjuree({
  variable: "--font-heading",
  subsets: ["thai", "latin"],
  weight: ["600", "700"],
  display: "swap",
});

const reading = IBM_Plex_Sans_Thai_Looped({
  variable: "--font-reading",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/** A package as the DB holds it: the admin's Thai text and plain numbers. */
type RawPackage = {
  slug: string;
  name: string;
  badge: string | null;
  priceThb: number;
  credits: number;
  bonus: number;
  features: string[];
  featured: boolean;
};

/**
 * What the packages were when the page was redrawn, shown only if the DB
 * cannot be read — the same numbers /api/packages served, never invented ones.
 * Kept in the DB's own (Thai) words, so both languages go through toTier.
 */
const FALLBACK_PACKAGES: RawPackage[] = [
  { slug: "trial", name: "ทดลองใช้", badge: "ฟรี", priceThb: 0, credits: 20, bonus: 0, features: ["ภาพ ~5-7 ภาพ", "วิดีโอ ~1 คลิป", "สำหรับสมาชิกใหม่"], featured: false },
  { slug: "starter", name: "Starter", badge: null, priceThb: 99, credits: 100, bonus: 0, features: ["ภาพ ~25-33 ภาพ", "วิดีโอ ~5-8 คลิป", "ไม่มีวันหมดอายุ"], featured: false },
  { slug: "creator", name: "Creator", badge: "ยอดนิยม", priceThb: 399, credits: 500, bonus: 50, features: ["ภาพ ~137 ภาพ", "วิดีโอ ~36 คลิป", "ประหยัด 20%", "ไม่มีวันหมดอายุ"], featured: true },
  { slug: "pro", name: "Pro", badge: "คุ้มที่สุด", priceThb: 999, credits: 1500, bonus: 250, features: ["ภาพ ~437 ภาพ", "วิดีโอ ~116 คลิป", "ประหยัด 33%", "ไม่มีวันหมดอายุ"], featured: true },
  { slug: "enterprise", name: "Enterprise", badge: "สำหรับทีม", priceThb: 2499, credits: 5000, bonus: 1500, features: ["ภาพ ~1,625 ภาพ", "วิดีโอ ~433 คลิป", "ประหยัด 50%", "ซัพพอร์ตพิเศษ"], featured: false },
];

function featureList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** One package card's text in the visitor's language. */
function toTier(p: RawPackage, locale: Locale): Tier {
  const t = translator(locale);
  const credits = formatNumber(p.credits, locale);
  return {
    slug: p.slug,
    name: packageLabel(p.name, locale),
    badge: packageLabel(p.badge, locale),
    price: p.priceThb === 0 ? t("ฟรี", "Free") : formatThb(p.priceThb, locale),
    credits: p.bonus > 0
      ? `${credits} + ${formatNumber(p.bonus, locale)} ${t("โบนัส", "bonus")}`
      : t(`${credits} เครดิต`, `${credits} ${p.credits === 1 ? "credit" : "credits"}`),
    // The card states the credits itself; a feature line that repeats
    // them ("500 + 50 โบนัส เครดิต", "20 เครดิตฟรี") would say it twice.
    // Filtered on the admin's Thai, before it is translated.
    feats: packageFeatures(p.features.filter((f) => !f.includes("เครดิต")), locale),
    featured: p.featured,
    free: p.priceThb === 0,
  };
}

async function loadTiers(locale: Locale): Promise<Tier[]> {
  const fallback = () => FALLBACK_PACKAGES.map((p) => toTier(p, locale));
  try {
    const packages = await CreditService.getPackages();
    if (!packages || packages.length === 0) return fallback();

    return packages.map((p) => {
      const slug = String(p.slug ?? p.id);
      return toTier({
        slug,
        name: String(p.name ?? slug),
        badge: p.badge ? String(p.badge) : null,
        priceThb: Number(p.priceThb ?? 0),
        credits: Number(p.credits ?? 0),
        bonus: Number(p.bonusCredits ?? 0),
        features: featureList(p.features),
        featured: Boolean(p.isFeatured),
      }, locale);
    });
  } catch (e) {
    console.error("[xdreamer/page] loadTiers failed, using fallback:", e);
    return fallback();
  }
}

export default async function HomePage() {
  const tiers = await loadTiers(await getLocale());
  return (
    <div className={`${heading.variable} ${reading.variable}`}>
      <XdreamerLanding tiers={tiers} />
    </div>
  );
}
