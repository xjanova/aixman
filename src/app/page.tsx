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

/**
 * What the packages were when the page was redrawn, shown only if the DB
 * cannot be read — the same numbers /api/packages served, never invented ones.
 */
const FALLBACK_TIERS: Tier[] = [
  { slug: "trial", name: "ทดลองใช้", badge: "ฟรี", price: "ฟรี", credits: "20 เครดิต", feats: ["ภาพ ~5-7 ภาพ", "วิดีโอ ~1 คลิป", "สำหรับสมาชิกใหม่"], featured: false, free: true },
  { slug: "starter", name: "Starter", badge: null, price: "฿99", credits: "100 เครดิต", feats: ["ภาพ ~25-33 ภาพ", "วิดีโอ ~5-8 คลิป", "ไม่มีวันหมดอายุ"], featured: false, free: false },
  { slug: "creator", name: "Creator", badge: "ยอดนิยม", price: "฿399", credits: "500 + 50 โบนัส", feats: ["ภาพ ~137 ภาพ", "วิดีโอ ~36 คลิป", "ประหยัด 20%", "ไม่มีวันหมดอายุ"], featured: true, free: false },
  { slug: "pro", name: "Pro", badge: "คุ้มที่สุด", price: "฿999", credits: "1,500 + 250 โบนัส", feats: ["ภาพ ~437 ภาพ", "วิดีโอ ~116 คลิป", "ประหยัด 33%", "ไม่มีวันหมดอายุ"], featured: true, free: false },
  { slug: "enterprise", name: "Enterprise", badge: "สำหรับทีม", price: "฿2,499", credits: "5,000 + 1,500 โบนัส", feats: ["ภาพ ~1,625 ภาพ", "วิดีโอ ~433 คลิป", "ประหยัด 50%", "ซัพพอร์ตพิเศษ"], featured: false, free: false },
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

async function loadTiers(): Promise<Tier[]> {
  try {
    const packages = await CreditService.getPackages();
    if (!packages || packages.length === 0) return FALLBACK_TIERS;

    return packages.map((p) => {
      const slug = String(p.slug ?? p.id);
      const priceThb = Number(p.priceThb ?? 0);
      const credits = Number(p.credits ?? 0);
      const bonus = Number(p.bonusCredits ?? 0);
      return {
        slug,
        name: String(p.name ?? slug),
        badge: p.badge ? String(p.badge) : null,
        price: priceThb === 0 ? "ฟรี" : `฿${priceThb.toLocaleString("en-US")}`,
        credits: bonus > 0
          ? `${credits.toLocaleString("en-US")} + ${bonus.toLocaleString("en-US")} โบนัส`
          : `${credits.toLocaleString("en-US")} เครดิต`,
        // The card states the credits itself; a feature line that repeats
        // them ("500 + 50 โบนัส เครดิต", "20 เครดิตฟรี") would say it twice.
        feats: featureList(p.features).filter((f) => !f.includes("เครดิต")),
        featured: Boolean(p.isFeatured),
        free: priceThb === 0,
      };
    });
  } catch (e) {
    console.error("[xdreamer/page] loadTiers failed, using fallback:", e);
    return FALLBACK_TIERS;
  }
}

export default async function HomePage() {
  const tiers = await loadTiers();
  return (
    <div className={`${heading.variable} ${reading.variable}`}>
      <XdreamerLanding tiers={tiers} />
    </div>
  );
}
