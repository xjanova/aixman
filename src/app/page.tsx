/**
 * X-DREAMER landing page
 *
 * Server component: fetches active credit packages from CreditService
 * (DB), normalises into the Tier shape XdreamerLanding expects, and
 * renders the X-DREAMER themed marketing page.
 *
 * Replaces the previous neumorphism landing — see page.tsx.bak in this
 * directory for the old version.
 */

import XdreamerLanding from "@/components/xdreamer/landing";
import { CreditService } from "@/lib/services/credits";

// Skip Next.js prerender + ISR cache. The page is heavy (R3F HeroScene
// + canvas patterns + dynamic imports) and prerendered HTML traps the
// build-time canvas size at 300×150 because the wrapper element has no
// measurable layout at SSR time. Render on-demand so first paint sees
// the real viewport.
export const dynamic = "force-dynamic";

// Hue palette mapping by slug (keeps brand colours stable across packages)
const HUE_BY_SLUG: Record<string, number> = {
  trial: 140,
  starter: 160,
  weaver: 200,
  creator: 220,
  pro: 260,
  studio: 280,
  enterprise: 300,
};

type Tier = {
  slug: string;
  name: string;
  price: string;
  note: string;
  feats: string[];
  hue: number;
  pop: boolean;
};

const FALLBACK_TIERS: Tier[] = [
  { slug: "trial", name: "ผู้เริ่มฝัน", price: "ฟรี", note: "ตลอดชีพ", feats: ["50 งาน/เดือน", "ความละเอียด 1K", "ชุมชนสาธารณะ", "รุ่น loom-mini"], hue: 160, pop: false },
  { slug: "creator", name: "นักทอ", price: "฿490", note: "/ เดือน", feats: ["ไม่จำกัดจำนวน", "8K resolution", "ปราสาทส่วนตัว 500 ชิ้น", "รุ่น loom-v4.2", "Video สูงสุด 30 วินาที"], hue: 220, pop: true },
  { slug: "studio", name: "สตูดิโอ", price: "฿2,490", note: "/ เดือน", feats: ["ทุกอย่างใน นักทอ", "API + webhooks", "ทีมสูงสุด 10 คน", "รุ่น loom-pro", "Commercial license", "Priority queue"], hue: 280, pop: false },
];

async function loadTiers(): Promise<Tier[]> {
  try {
    const packages = await CreditService.getPackages();
    if (!packages || packages.length === 0) return FALLBACK_TIERS;

    return packages.map((p) => {
      const slug = String(p.slug ?? p.id);
      const priceThb = Number(p.priceThb ?? 0);
      const features = Array.isArray(p.features)
        ? (p.features as string[])
        : typeof p.features === "string"
          ? (JSON.parse(p.features) as string[])
          : [];

      const featList = features.length
        ? features
        : ([`${p.credits} credits`, p.bonusCredits ? `+${p.bonusCredits} bonus` : ""].filter(Boolean) as string[]);

      return {
        slug,
        name: String(p.name ?? slug),
        price: priceThb === 0 ? "ฟรี" : `฿${priceThb.toLocaleString("en-US")}`,
        note: priceThb === 0 ? "ฟรีตลอดชีพ" : "ครั้งเดียว",
        feats: featList,
        hue: HUE_BY_SLUG[slug] ?? 220,
        pop: Boolean(p.isFeatured),
      };
    });
  } catch (e) {
    console.error("[xdreamer/page] loadTiers failed, using fallback:", e);
    return FALLBACK_TIERS;
  }
}

export default async function HomePage() {
  const tiers = await loadTiers();
  return <XdreamerLanding tiers={tiers} />;
}
