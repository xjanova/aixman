"use client";

/**
 * /pricing — credit packages.
 *
 * Every price and credit amount comes from `GET /api/packages`
 * (`ai_credit_packages`, which xmanstudio also bills and pays affiliates
 * from); nothing here hard-codes one. The "about N pictures" figures are
 * worked out from the live model list by `@/lib/pricing-display`.
 *
 * Two real ways to pay, unchanged:
 *   - XMAN Studio checkout (`{XMAN}/checkout/ai-credits/{slug}?ref=ai`:
 *     PromptPay, bank transfer, TPIX; credits arrive through
 *     `/api/webhooks/xman-credit` once the order is paid);
 *   - the shared wallet, here and now (`POST /api/credits/purchase`).
 *
 * Paying in TPIX coin at the partner discount has its own page (/tpix); this
 * one only carries the campaign banner that leads there.
 *
 * Artwork in /public/pricing-art was generated with ChatGPT for this page
 * (see its CREDITS.md).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";

import { PageHero } from "@/components/xdreamer/page-hero";
import {
  emblemIndexes,
  extraFeatures,
  howMany,
  parseFeatures,
  priceOf,
  pricePerCredit,
  recommendedIndex,
  totalCredits,
  typicalCosts,
  type WorkKind,
} from "@/lib/pricing-display";
import { TPIX_CAMPAIGN_DISCOUNT } from "@/lib/tpix/chain";
import { useLocale, useT } from "@/lib/i18n/client";
import { formatCredits, formatNumber, formatThb, type Locale, type Msg, type Translate } from "@/lib/i18n/locale";
import { packageFeatures, packageLabel } from "@/lib/i18n/package-text";

const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

/** Accent hue per emblem rank: seed gold, emerald, cyan, violet, amethyst, gold. */
const TIER_HUE = [42, 168, 196, 266, 286, 40];

interface Package {
  id: number;
  name: string;
  slug: string;
  credits: number;
  bonusCredits: number;
  priceThb: number | string;
  priceUsd: number | string;
  badge: string | null;
  isFeatured: boolean;
  features: string | string[];
  sortOrder: number;
}

interface Model {
  id: number;
  name: string;
  category: string;
  subcategory?: string | null;
  creditsPerUnit: number;
  canOrder?: boolean;
}

interface WalletInfo {
  balance: number;
  isActive: boolean;
  hasWallet: boolean;
  credits: number;
}

type PurchaseResult =
  | { status: "ok"; credits: number; walletBalance: number }
  | { status: "duplicate" }
  | { status: "error"; message: string };

/**
 * Buy one credit package with the wallet and report the outcome as a value.
 *
 * Outside the component deliberately: it owns the try/catch that the caller
 * cannot have (see `confirmWalletPurchase`), so the caller needs no error
 * handling — and therefore no `finally` — of its own.
 */
async function purchasePackage(slug: string, idempotencyKey: string, t: Translate): Promise<PurchaseResult> {
  try {
    const res = await fetch("/api/credits/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageSlug: slug, idempotencyKey }),
    });
    if (res.status === 401) {
      return { status: "error", message: t("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง", "Your session has expired. Please sign in again and retry.") };
    }
    const data = await res.json();
    if (!res.ok) return { status: "error", message: data.error || t("ซื้อไม่สำเร็จ", "Purchase failed") };
    if (data.duplicate) return { status: "duplicate" };
    return { status: "ok", credits: data.credits, walletBalance: data.walletBalance };
  } catch {
    return { status: "error", message: t("เกิดข้อผิดพลาด กรุณาลองใหม่", "Something went wrong. Please try again.") };
  }
}

const fmtNum = (n: number, locale: Locale) => formatNumber(Math.round(n), locale);
const checkoutHref = (slug: string) => `${XMAN_URL}/checkout/ai-credits/${encodeURIComponent(slug)}?ref=ai`;

/** `unit.en` is the singular; every one of them takes a plain -s. */
const WORK: { kind: WorkKind; label: Msg; unit: Msg; icon: string }[] = [
  { kind: "image", label: { th: "ภาพ", en: "Images" }, unit: { th: "ภาพ", en: "image" }, icon: "/studio/ic-image-v1.webp" },
  { kind: "video", label: { th: "วิดีโอ", en: "Videos" }, unit: { th: "คลิป", en: "clip" }, icon: "/studio/ic-video-v1.webp" },
  { kind: "audio", label: { th: "เพลง", en: "Music" }, unit: { th: "เพลง", en: "song" }, icon: "/studio/ic-music-v1.webp" },
];

const workUnit = (unit: Msg, n: number, t: Translate) => t(unit.th, n === 1 ? unit.en : `${unit.en}s`);

const CATEGORY_INFO: Record<string, { label: Msg; icon: string }> = {
  image: { label: { th: "สร้างภาพ", en: "Images" }, icon: "/studio/ic-image-v1.webp" },
  video: { label: { th: "สร้างวิดีโอ", en: "Videos" }, icon: "/studio/ic-video-v1.webp" },
  lipsync: { label: { th: "พากย์ทับคลิป / ลิปซิงก์", en: "Dubbing / lip-sync" }, icon: "/studio/ic-lipsync-v1.webp" },
  audio: { label: { th: "เพลงและเสียง", en: "Music & audio" }, icon: "/studio/ic-music-v1.webp" },
  edit: { label: { th: "แก้ไขภาพ", en: "Image editing" }, icon: "/studio/ic-edit-v1.webp" },
  model3d: { label: { th: "โมเดล 3D", en: "3D models" }, icon: "/studio/ic-3d-v1.webp" },
};

const FAQ: { q: Msg; a: Msg }[] = [
  {
    q: { th: "เครดิตมีวันหมดอายุไหม?", en: "Do credits expire?" },
    a: {
      th: "ไม่มีครับ เครดิตอยู่ในบัญชีจนกว่าจะใช้ ซื้อแพ็กเกจเป็นการจ่ายครั้งเดียว ไม่มีรอบบิลรายเดือน และไม่มีการตัดเงินอัตโนมัติ ซื้อเพิ่มเมื่อไรก็รวมกับยอดเดิมทันที",
      en: "No. Credits stay in your account until you use them. A package is a one-time payment: no monthly billing and no automatic charges. Whatever you buy later is added to your balance straight away.",
    },
  },
  {
    q: { th: "ชำระเงินได้ช่องทางไหนบ้าง?", en: "How can I pay?" },
    a: {
      th: "กด “ซื้อแพ็กเกจนี้” เพื่อชำระผ่านระบบของ XMAN Studio ด้วย PromptPay หรือโอนผ่านธนาคารแล้วแนบสลิป หรือถ้ามียอดใน Wallet ของ XMAN Studio อยู่แล้ว เข้าสู่ระบบแล้วกด “ซื้อด้วย Wallet” ได้ทันทีบนหน้านี้",
      en: "Tap “Buy this package” to pay through XMAN Studio with PromptPay or a bank transfer with your slip attached. If you already have a balance in your XMAN Studio Wallet, sign in and tap “Buy with Wallet” right here on this page.",
    },
  },
  {
    q: { th: "จ่ายแล้วเครดิตเข้าเมื่อไร?", en: "When do my credits arrive?" },
    a: {
      th: "ซื้อด้วย Wallet เครดิตเข้าทันที ส่วน PromptPay และโอนธนาคาร เครดิตจะเข้าบัญชีอัตโนมัติเมื่อยืนยันยอดชำระแล้ว ดูสถานะคำสั่งซื้อได้ที่ xman4289.com และดูยอดเครดิตได้ที่หน้าโปรไฟล์",
      en: "With Wallet, instantly. With PromptPay or a bank transfer, credits are added automatically once the payment is confirmed. Track your order at xman4289.com and see your credit balance on your profile.",
    },
  },
  {
    q: { th: "ถ้าสร้างงานไม่สำเร็จ เสียเครดิตไหม?", en: "Do I lose credits if a creation fails?" },
    a: {
      th: "ไม่เสียครับ งานที่ล้มเหลวหรือหมดเวลา ระบบคืนเครดิตให้อัตโนมัติ ดูรายการคืนได้ในประวัติเครดิต",
      en: "No. When a job fails or times out, your credits are refunded automatically. You can see every refund in your credit history.",
    },
  },
  {
    q: { th: "เครดิตใช้กับอะไรได้บ้าง?", en: "What can I use credits for?" },
    a: {
      th: "ทุกโมเดลในสตูดิโอ ทั้งภาพ วิดีโอ เพลง พากย์ทับคลิป และ 3D รวมถึงโหมดหนัง/MV และ API สำหรับนักพัฒนา แต่ละโมเดลใช้เครดิตต่างกัน ดูได้จากตารางด้านบนและในหน้าสตูดิโอก่อนกดสร้าง",
      en: "Every model in the Studio: images, video, music, dubbing and 3D, plus Movie/MV mode and the developer API. Each model uses a different number of credits; see the table above, and the Studio shows the price before you create.",
    },
  },
  {
    q: { th: "ต้องสมัครบัญชีใหม่ไหม?", en: "Do I need a new account?" },
    a: {
      th: "ใช้บัญชีเดียวกับ XMAN Studio (xman4289.com) ถ้ายังไม่มี สมัครฟรีที่นั่น แล้วเข้าสู่ระบบที่นี่ด้วยอีเมลและรหัสผ่านเดียวกัน สมาชิกใหม่ได้รับเครดิตต้อนรับเมื่อเข้าใช้ครั้งแรก",
      en: "No. You use the same account as XMAN Studio (xman4289.com). If you don't have one yet, sign up there for free, then sign in here with the same email and password. New members get welcome credits on their first visit.",
    },
  },
];

export default function PricingPage() {
  const t = useT();
  const { locale } = useLocale();
  const fmt = (n: number) => fmtNum(n, locale);
  const [currency, setCurrency] = useState<"thb" | "usd">("thb");
  const [packages, setPackages] = useState<Package[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // One idempotency key per confirmation: a second tap on "ยืนยัน" resends the
  // same key, so the server books it once and answers "duplicate".
  const [confirming, setConfirming] = useState<{ pkg: Package; key: string } | null>(null);
  // `buying` only disables the button after a re-render; taps landing before it
  // would each send a request (the server books one, the rest answer
  // "duplicate" and could overwrite the success message).
  const inFlight = useRef(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [tpix, setTpix] = useState<{ canBuy: boolean; discountPercent: number | null } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/packages")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => {
        if (!alive) return;
        const list = Array.isArray(data) ? data : data.packages;
        setPackages(Array.isArray(list) ? list : []);
        setLoadFailed(!Array.isArray(list));
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoadFailed(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    fetch("/api/models")
      .then(r => r.json())
      .then(d => { if (alive) setModels(Array.isArray(d.models) ? d.models : []); })
      .catch(() => {});
    fetch("/api/credits/wallet")
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        setWallet(d.loggedIn
          ? { balance: d.wallet?.balance ?? 0, isActive: d.wallet?.isActive ?? false, hasWallet: !!d.wallet, credits: d.credits ?? 0 }
          : null);
      })
      .catch(() => {});
    fetch("/api/tpix/info")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (alive && d) setTpix({ canBuy: d.canBuy === true, discountPercent: typeof d.discountPercent === "number" ? d.discountPercent : null });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !buying) setConfirming(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, buying]);

  const emblems = useMemo(() => emblemIndexes(packages), [packages]);
  const recIndex = useMemo(() => recommendedIndex(packages), [packages]);
  const costs = useMemo(() => typicalCosts(models), [models]);
  const hasEstimates = Object.keys(costs).length > 0;

  const creditTable = useMemo(() => {
    const orderable = models.filter(m => m.canOrder !== false);
    const source = orderable.length ? orderable : models;
    const groups: Record<string, { min: number; max: number; names: string[] }> = {};
    for (const m of source) {
      const key = (m.subcategory ?? "").startsWith("lipsync") ? "lipsync" : m.category;
      if (!CATEGORY_INFO[key] || !(m.creditsPerUnit > 0)) continue;
      // Not `??=`: React Compiler cannot lower it and would skip this whole component.
      if (!groups[key]) groups[key] = { min: Infinity, max: 0, names: [] };
      const g = groups[key];
      g.min = Math.min(g.min, m.creditsPerUnit);
      g.max = Math.max(g.max, m.creditsPerUnit);
      if (g.names.length < 3) g.names.push(m.name);
    }
    return Object.keys(CATEGORY_INFO)
      .filter(k => groups[k])
      .map(k => ({
        key: k,
        ...CATEGORY_INFO[k],
        range: groups[k].min === groups[k].max
          ? fmtNum(groups[k].min, locale)
          : `${fmtNum(groups[k].min, locale)}–${fmtNum(groups[k].max, locale)}`,
        names: groups[k].names.join(" · "),
      }));
  }, [models, locale]);

  const paid = packages
    .map((p, i) => ({ p, i }))
    .filter(x => priceOf(x.p) > 0);
  const free = packages
    .map((p, i) => ({ p, i }))
    .filter(x => priceOf(x.p) <= 0);
  const selectedPkg = packages.find(p => p.slug === selected && priceOf(p) > 0) ?? null;

  const priceLabel = (p: Package) =>
    currency === "thb" ? formatThb(Math.round(priceOf(p)), locale) : `$${Number(p.priceUsd || 0).toFixed(2)}`;
  const perCreditLabel = (p: Package) => {
    const per = currency === "thb"
      ? pricePerCredit(priceOf(p), totalCredits(p))
      : pricePerCredit(Number(p.priceUsd || 0), totalCredits(p));
    if (per === null) return null;
    return currency === "thb" ? `฿${per.toFixed(2)}` : `$${per.toFixed(3)}`;
  };

  const askWalletPurchase = (pkg: Package) => {
    if (buying) return;
    // `assign()` rather than `location.href = ...`: identical full-page
    // navigation, but React Compiler counts assigning to a global's property as
    // mutating a value it does not own, bails on the **whole** component, and
    // then silently stops running every compiler lint rule on this file.
    if (!wallet) { window.location.assign("/login?callbackUrl=%2Fpricing"); return; }
    setNotice(null);
    setConfirming({ pkg, key: crypto.randomUUID() });
  };

  const confirmWalletPurchase = async () => {
    if (!confirming || buying || inFlight.current) return;
    inFlight.current = true;
    const { pkg, key } = confirming;
    setBuying(pkg.slug);

    // The network work lives in `purchasePackage` outside the component, and
    // there is no try/finally here, on purpose: React Compiler cannot compile a
    // function containing `finally` and silently gives up on the **whole**
    // component, costing this page its auto-memoization and turning off every
    // compiler-based lint rule for the file, with no diagnostic to say so.
    const result = await purchasePackage(pkg.slug, key, t);
    inFlight.current = false;
    setBuying(null);
    setConfirming(null);

    if (result.status === "error") {
      setNotice({ ok: false, text: result.message });
      return;
    }
    if (result.status === "duplicate") {
      setNotice({ ok: true, text: t("รายการนี้ถูกดำเนินการไปแล้ว", "This purchase has already gone through.") });
      return;
    }
    setNotice({
      ok: true,
      text: t(
        `ซื้อ ${pkg.name} สำเร็จ! ยอดเครดิตคงเหลือ ${fmt(Number(result.credits))} เครดิต`,
        `${packageLabel(pkg.name, locale)} purchased! Your balance is now ${formatCredits(Math.round(Number(result.credits)), locale)}.`,
      ),
    });
    setWallet(w => (w ? { ...w, balance: result.walletBalance, credits: result.credits } : w));
  };

  /** What the wallet button can honestly offer for this package; "none" shows no button. */
  const walletState = (pkg: Package): "ok" | "short" | "suspended" | "none" => {
    if (!wallet?.hasWallet) return "none";
    if (!wallet.isActive) return "suspended";
    return wallet.balance >= priceOf(pkg) ? "ok" : "short";
  };

  const tpixOff = tpix?.discountPercent ?? TPIX_CAMPAIGN_DISCOUNT;

  return (
    <div className="prc-root">
      <PageHero
        image="/pricing-art/hero-v1.webp"
        eyebrow={t("· แพ็กเกจเครดิต X-DREAMER", "· X-DREAMER credit packages")}
        title={t("ปลดล็อกพลังสร้างสรรค์", "Unlock premium")}
        emphasis={t("ระดับพรีเมียม", "creative power")}
        hue={315}
        objectPosition="72% center"
        sub={t(
          "เครดิตเดียว ใช้ได้ทุกโมเดล ทั้งภาพ วิดีโอ เพลง และ 3D — จ่ายครั้งเดียว ไม่มีวันหมดอายุ งานไหนสร้างไม่สำเร็จ คืนเครดิตอัตโนมัติ",
          "One credit balance for every model: images, video, music and 3D. Pay once, never expires, and any creation that fails is refunded automatically.",
        )}
      >
        <div className="prc-hero-row">
          <a href="#packages" className="prc-btn prc-btn-gold prc-btn-inline">{t("ดูแพ็กเกจ", "See packages")}</a>
          {wallet ? (
            <span className="prc-chip prc-chip-strong">
              <span className="prc-dot" /> {t("เครดิตของคุณ", "Your credits")} <b>{fmt(wallet.credits)}</b>
              {wallet.hasWallet && <> · Wallet <b>{formatThb(Math.round(wallet.balance), locale)}</b></>}
            </span>
          ) : (
            <Link href="/login?callbackUrl=%2Fpricing" className="prc-btn prc-btn-glass prc-btn-inline">{t("เข้าสู่ระบบ", "Sign in")}</Link>
          )}
        </div>
      </PageHero>

      <div className="prc-wrap" data-bar={selectedPkg ? "true" : undefined}>
        {/* Trust strip */}
        <ul className="prc-trust" aria-label={t("จุดเด่น", "Highlights")}>
          <li><span>∞</span>{t("ไม่มีวันหมดอายุ", "Never expires")}</li>
          <li><span>↺</span>{t("สร้างไม่สำเร็จ คืนเครดิตอัตโนมัติ", "Failed creations refunded automatically")}</li>
          <li><span>◈</span>{t("ชำระผ่าน XMAN Studio", "Pay through XMAN Studio")}</li>
          <li><span>✦</span>{t("บัญชีเดียว ใช้ได้ทุกโมเดล", "One account, every model")}</li>
        </ul>

        {/* TPIX partner campaign: paying in coin lives on its own page, so this one stays simple */}
        <Link href="/tpix" className="prc-tpix">
          <span className="prc-tpix-coin" aria-hidden="true">
            <Image src="/tpix/tpix-coin.webp" alt="" width={84} height={84} />
            {tpixOff > 0 && <span className="prc-tpix-off">-{tpixOff}%</span>}
          </span>
          <span className="prc-tpix-copy">
            <span className="prc-tpix-eyebrow">
              {t("แคมเปญพาร์ทเนอร์", "Partner campaign")} · XMAN AI × TPIX Chain
              {tpix && !tpix.canBuy && <em>{t("เปิดเร็ว ๆ นี้", "Coming soon")}</em>}
            </span>
            <b>
              {t("จ่ายด้วยเหรียญ", "Pay with")} <span className="prc-tpix-grad">TPIX</span>
              {tpixOff > 0 && (
                <>
                  {" "}
                  {t(
                    <span className="prc-tpix-nw">ลดทันที <span className="prc-tpix-grad">{tpixOff}%</span></span>,
                    <span className="prc-tpix-nw"><span className="prc-tpix-grad">{tpixOff}%</span> off instantly</span>,
                  )}
                </>
              )}
            </b>
            <span className="prc-tpix-sub">
              {t(
                "ทุกแพ็กเกจ · เชื่อมกระเป๋าแล้วจ่ายบน TPIX Chain · ค่าแก๊ส 0 · เครดิตเข้าอัตโนมัติ",
                "Every package · Connect your wallet and pay on TPIX Chain · Zero gas fees · Credits arrive automatically",
              )}
            </span>
          </span>
          <span className="prc-tpix-cta">{t("ซื้อด้วย TPIX", "Buy with TPIX")} <i aria-hidden="true">→</i></span>
        </Link>

        {/* Section head + currency */}
        <div className="prc-head" id="packages">
          <div>
            <div className="prc-eyebrow">{t("เลือกระดับของคุณ", "Choose your tier")}</div>
            <h2 className="prc-h2">{t(<>แพ็กเกจ<span className="prc-gold-text">เครดิต</span></>, <>Credit <span className="prc-gold-text">packages</span></>)}</h2>
          </div>
          <div className="prc-toggle" role="group" aria-label={t("สกุลเงิน", "Currency")}>
            {([["thb", "฿ THB"], ["usd", "$ USD"]] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={currency === key}
                className={currency === key ? "on" : undefined} onClick={() => setCurrency(key)}>{label}</button>
            ))}
          </div>
        </div>
        {currency === "usd" && (
          <p className="prc-note">{t("ราคา USD แสดงเพื่อเทียบเท่านั้น การชำระเงินจริงเรียกเก็บเป็นบาท", "USD prices are for comparison only. You are charged in Thai baht.")}</p>
        )}

        {/* Packages */}
        {loading ? (
          <div className="prc-grid" style={{ "--cols": 4 } as CSSProperties}>
            {[0, 1, 2, 3].map(i => <div key={i} className="prc-skel" />)}
          </div>
        ) : packages.length === 0 ? (
          <div className="prc-empty">
            <p>
              {loadFailed
                ? t("โหลดแพ็กเกจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "Couldn't load the packages. Please try again.")
                : t("ยังไม่มีแพ็กเกจเปิดขายในขณะนี้", "No packages are on sale right now.")}
            </p>
            <button type="button" className="prc-btn prc-btn-glass prc-btn-inline"
              onClick={() => { setLoading(true); setLoadFailed(false); setReloadKey(k => k + 1); }}>{t("โหลดใหม่", "Reload")}</button>
          </div>
        ) : (
          <>
            <div className="prc-grid" role="list" style={{ "--cols": Math.min(Math.max(paid.length, 1), 4) } as CSSProperties}>
              {paid.map(({ p: pkg, i }) => {
                const tier = emblems[i];
                const isRec = i === recIndex;
                const isSel = selected === pkg.slug;
                const total = totalCredits(pkg);
                const per = perCreditLabel(pkg);
                const features = packageFeatures(extraFeatures(parseFeatures(pkg.features), hasEstimates), locale);
                const ws = walletState(pkg);
                return (
                  <article
                    key={pkg.id}
                    role="listitem"
                    className="prc-card"
                    data-rec={isRec || undefined}
                    data-featured={pkg.isFeatured || undefined}
                    data-selected={isSel || undefined}
                    style={{ "--h": TIER_HUE[tier] ?? 220 } as CSSProperties}
                    onClick={() => setSelected(pkg.slug)}
                  >
                    {isRec && (
                      <>
                        {(["tl", "tr", "bl", "br"] as const).map(c => (
                          <Image key={c} src="/pricing-art/corner-v1.webp" alt="" width={110} height={110} className={`prc-corner ${c}`} />
                        ))}
                      </>
                    )}
                    {(pkg.badge || isRec) && (
                      <div className="prc-ribbon">{isRec ? "✦ " : ""}{packageLabel(pkg.badge, locale) || t("แนะนำ", "Recommended")}</div>
                    )}
                    {isSel && <div className="prc-check" aria-hidden>✓ {t("เลือกแล้ว", "Selected")}</div>}

                    <div className="prc-emblem">
                      <Image src={`/pricing-art/tier-${tier + 1}.webp`} alt="" width={132} height={132} sizes="132px" />
                    </div>
                    <h3 className="prc-name">{packageLabel(pkg.name, locale)}</h3>

                    <div className="prc-credits">
                      <b>{fmt(total)}</b>
                      <span>{t("เครดิต", total === 1 ? "credit" : "credits")}</span>
                    </div>
                    {pkg.bonusCredits > 0 ? (
                      <div className="prc-bonus">{t(`${fmt(pkg.credits)} + โบนัส ${fmt(pkg.bonusCredits)}`, `${fmt(pkg.credits)} + ${fmt(pkg.bonusCredits)} bonus`)}</div>
                    ) : (
                      // Keeps the prices of every card on one line.
                      <div className="prc-bonus prc-bonus-none" aria-hidden>&nbsp;</div>
                    )}

                    <div className="prc-price">
                      <b>{priceLabel(pkg)}</b>
                      <span>{t("จ่ายครั้งเดียว", "one-time")}</span>
                    </div>
                    {per && <div className="prc-per">{t(`เฉลี่ย ${per} ต่อเครดิต`, `${per} per credit`)}</div>}

                    <div className="prc-rule" aria-hidden><span>◆</span></div>

                    {hasEstimates && (
                      <div className="prc-yield">
                        <div className="prc-yield-h">{t("ใช้ได้ประมาณ", "Enough for about")}</div>
                        {WORK.filter(w => costs[w.kind]).map(w => {
                          const n = howMany(total, costs[w.kind]!);
                          return (
                            <div key={w.kind} className="prc-yield-row">
                              <Image src={w.icon} alt="" width={26} height={26} />
                              <span>{t(w.label)}</span>
                              <b>≈ {fmt(n)}</b>
                              <em>{workUnit(w.unit, n, t)}</em>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {features.length > 0 && (
                      <ul className="prc-feats">
                        {features.map(f => <li key={f}>{f}</li>)}
                      </ul>
                    )}

                    <div className="prc-actions">
                      <a href={checkoutHref(pkg.slug)}
                        className={`prc-btn ${isRec || isSel ? "prc-btn-gold" : "prc-btn-glass"}`}
                        onClick={e => e.stopPropagation()}>
                        {t("ซื้อแพ็กเกจนี้", "Buy this package")} <span aria-hidden>→</span>
                      </a>
                      {ws === "short" && (
                        <a href={`${XMAN_URL}/wallet/topup`} target="_blank" rel="noopener noreferrer"
                          className="prc-btn prc-btn-line" onClick={e => e.stopPropagation()}>
                          {t("Wallet ไม่พอ · เติมเงิน", "Wallet too low · Top up")}
                        </a>
                      )}
                      {(ws === "ok" || ws === "suspended") && (
                        <button type="button" className="prc-btn prc-btn-line"
                          disabled={ws === "suspended" || buying !== null}
                          onClick={e => { e.stopPropagation(); setSelected(pkg.slug); askWalletPurchase(pkg); }}>
                          {buying === pkg.slug
                            ? t("กำลังซื้อ…", "Buying…")
                            : ws === "suspended"
                              ? t("Wallet ถูกระงับ", "Wallet suspended")
                              : t(`ซื้อด้วย Wallet ${formatThb(Math.round(priceOf(pkg)), locale)}`, `Buy with Wallet ${formatThb(Math.round(priceOf(pkg)), locale)}`)}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            {free.map(({ p: pkg, i }) => {
              const features = packageFeatures(extraFeatures(parseFeatures(pkg.features), hasEstimates), locale);
              return (
                <div key={pkg.id} className="prc-trial" style={{ "--h": TIER_HUE[emblems[i]] } as CSSProperties}>
                  <Image src={`/pricing-art/tier-${emblems[i] + 1}.webp`} alt="" width={76} height={76} className="prc-trial-emblem" />
                  <div className="prc-trial-copy">
                    <div className="prc-trial-title">
                      {packageLabel(pkg.name, locale)}{" "}
                      <span className="prc-gold-text">{t(`${fmt(totalCredits(pkg))} เครดิต`, formatCredits(Math.round(totalCredits(pkg)), locale))}</span>
                      {pkg.badge && <span className="prc-trial-badge">{packageLabel(pkg.badge, locale)}</span>}
                    </div>
                    <div className="prc-trial-sub">
                      {features.length ? features.join(" · ") : t("ลองสร้างงานได้ทันที ไม่ต้องผูกบัตร", "Start creating right away, no card needed")}
                    </div>
                  </div>
                  <div className="prc-trial-cta">
                    <Link href={wallet ? "/generate" : "/login?callbackUrl=%2Fgenerate"} className="prc-btn prc-btn-glass prc-btn-inline">
                      {t("เริ่มใช้ฟรี →", "Start free →")}
                    </Link>
                    {!wallet && (
                      <a href={`${XMAN_URL}/register`} target="_blank" rel="noopener noreferrer" className="prc-link">
                        {t("ยังไม่มีบัญชี? สมัครฟรี", "No account yet? Sign up free")}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {hasEstimates && (
              <p className="prc-note">
                {t(
                  "จำนวนภาพ/คลิป/เพลงเป็นค่าประมาณ คิดจากราคากลางของโมเดลที่เปิดให้ใช้ตอนนี้",
                  "Image, clip and song counts are estimates, based on the typical price of the models open right now",
                )}{" "}
                ({WORK.filter(w => costs[w.kind]).map(w => t(
                  `${w.label.th} ${fmt(costs[w.kind]!)} เครดิต`,
                  `${formatCredits(Math.round(costs[w.kind]!), locale)} per ${w.unit.en}`,
                )).join(" · ")}){" "}
                {t("— งานที่ยาวขึ้นหรือโมเดลระดับพรีเมียมใช้เครดิตมากกว่านี้", "— longer work and premium models use more.")}
              </p>
            )}
          </>
        )}

        {/* How it works */}
        <section className="prc-section">
          <div className="prc-eyebrow">{t("ซื้อง่าย 3 ขั้นตอน", "3 easy steps")}</div>
          <h2 className="prc-h2">
            {t(
              <>จากเลือกแพ็กเกจ <span className="prc-gold-text">ถึงงานชิ้นแรก</span></>,
              <>From package <span className="prc-gold-text">to first creation</span></>,
            )}
          </h2>
          <ol className="prc-steps">
            <li>
              <b>1</b>
              <h3>{t("เลือกแพ็กเกจ", "Choose a package")}</h3>
              <p>{t("เลือกระดับที่เหมาะกับงานของคุณ เครดิตจากทุกแพ็กเกจรวมเป็นยอดเดียว", "Pick the tier that fits your work. Credits from every package add up to one balance.")}</p>
            </li>
            <li>
              <b>2</b>
              <h3>{t("ชำระเงิน", "Pay")}</h3>
              <p>{t("PromptPay หรือโอนผ่านธนาคารที่ XMAN Studio หรือหักจาก Wallet ได้ทันทีบนหน้านี้", "PromptPay or a bank transfer at XMAN Studio, or pay from your Wallet right here on this page.")}</p>
            </li>
            <li>
              <b>3</b>
              <h3>{t("เริ่มสร้างงาน", "Start creating")}</h3>
              <p>{t("เครดิตเข้าบัญชีอัตโนมัติเมื่อยืนยันยอด แล้วเปิดสตูดิโอสร้างภาพ วิดีโอ หรือเพลงได้เลย", "Credits are added automatically once your payment is confirmed. Then open the Studio and create images, video or music.")}</p>
            </li>
          </ol>
        </section>

        {/* Credit costs */}
        {creditTable.length > 0 && (
          <section className="prc-section">
            <div className="prc-eyebrow">{t("ตารางเครดิต", "Credit costs")}</div>
            <h2 className="prc-h2">
              {t(
                <>แต่ละงานใช้<span className="prc-gold-text">กี่เครดิต</span></>,
                <>How many credits <span className="prc-gold-text">each creation uses</span></>,
              )}
            </h2>
            <p className="prc-lead">{t("ราคาต่อครั้งของโมเดลที่เปิดให้ใช้ตอนนี้ — เห็นราคาจริงอีกครั้งในสตูดิโอก่อนกดสร้างทุกครั้ง", "The price per creation of the models open right now. The Studio always shows the exact price again before you create.")}</p>
            <div className="prc-costs">
              {creditTable.map(row => (
                <div key={row.key} className="prc-cost">
                  <Image src={row.icon} alt="" width={44} height={44} />
                  <div className="prc-cost-body">
                    <div className="prc-cost-top">
                      <h3>{t(row.label)}</h3>
                      <span>{row.range} <small>{t("เครดิต/ครั้ง", "credits each")}</small></span>
                    </div>
                    <p>{row.names}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Trust */}
        <section className="prc-section">
          <div className="prc-eyebrow">{t("มั่นใจได้ทุกการซื้อ", "Buy with confidence")}</div>
          <h2 className="prc-h2">
            {t(
              <>ซื้อครั้งเดียว <span className="prc-gold-text">ใช้ได้เต็มที่</span></>,
              <>Buy once, <span className="prc-gold-text">use it fully</span></>,
            )}
          </h2>
          <div className="prc-promises">
            <div>
              <span>∞</span>
              <h3>{t("ไม่มีวันหมดอายุ", "Never expires")}</h3>
              <p>{t("เครดิตอยู่ในบัญชีจนกว่าจะใช้ ไม่มีรอบบิล ไม่มีการตัดเงินอัตโนมัติ", "Credits stay in your account until you use them. No billing cycle, no automatic charges.")}</p>
            </div>
            <div>
              <span>↺</span>
              <h3>{t("คืนเครดิตอัตโนมัติ", "Automatic refunds")}</h3>
              <p>{t("งานที่ล้มเหลวหรือหมดเวลา ระบบคืนเครดิตทันที ไม่ต้องแจ้งทีมงาน", "When a job fails or times out, your credits come back at once. No need to contact us.")}</p>
            </div>
            <div>
              <span>◈</span>
              <h3>{t("ชำระผ่าน XMAN Studio", "Pay through XMAN Studio")}</h3>
              <p>{t("คำสั่งซื้อและการยืนยันยอดชำระทั้งหมดอยู่บนระบบของ xman4289.com", "Every order and payment confirmation runs on xman4289.com.")}</p>
            </div>
            <div>
              <span>✦</span>
              <h3>{t("บัญชีเดียวกัน", "One account")}</h3>
              <p>{t("ใช้บัญชี XMAN Studio เข้าได้ทันที เครดิตใช้ได้ทั้งสตูดิโอ โหมดหนัง/MV และ API", "Sign in with your XMAN Studio account. Credits work across the Studio, Movie/MV mode and the API.")}</p>
            </div>
          </div>

          <div className="prc-wallet">
            <Image src="/pricing-art/tier-2.webp" alt="" width={64} height={64} />
            <div>
              <h3>{t("จ่ายด้วย Wallet ของ XMAN Studio", "Pay with your XMAN Studio Wallet")}</h3>
              {wallet ? (
                <p>
                  {wallet.hasWallet
                    ? t(
                      <>ยอด Wallet คงเหลือ <b>{formatThb(Math.round(wallet.balance), locale)}</b> · เครดิต AI <b>{fmt(wallet.credits)}</b></>,
                      <>Wallet balance <b>{formatThb(Math.round(wallet.balance), locale)}</b> · AI credits <b>{fmt(wallet.credits)}</b></>,
                    )
                    : t(
                      <>บัญชีนี้ยังไม่มี Wallet · เครดิต AI <b>{fmt(wallet.credits)}</b></>,
                      <>This account has no Wallet yet · AI credits <b>{fmt(wallet.credits)}</b></>,
                    )}
                  {wallet.hasWallet && !wallet.isActive && <span className="prc-warn"> · {t("Wallet ถูกระงับ", "Wallet suspended")}</span>}
                  <br />
                  {t("กด “ซื้อด้วย Wallet” ที่แพ็กเกจ เพื่อหักเงินและรับเครดิตทันที", "Tap “Buy with Wallet” on a package to pay and get your credits at once.")}
                </p>
              ) : (
                <p>
                  {t(
                    <>
                      เติมเงินเข้า Wallet ที่ <a href={XMAN_URL} target="_blank" rel="noopener noreferrer">xman4289.com</a> แล้ว{" "}
                      <Link href="/login?callbackUrl=%2Fpricing">เข้าสู่ระบบ</Link> เพื่อซื้อเครดิตได้ทันทีบนหน้านี้
                    </>,
                    <>
                      Top up your Wallet at <a href={XMAN_URL} target="_blank" rel="noopener noreferrer">xman4289.com</a>, then{" "}
                      <Link href="/login?callbackUrl=%2Fpricing">sign in</Link> to buy credits right here.
                    </>,
                  )}
                </p>
              )}
            </div>
            <a href={`${XMAN_URL}/wallet/topup`} target="_blank" rel="noopener noreferrer" className="prc-btn prc-btn-glass prc-btn-inline">
              {t("เติมเงิน Wallet", "Top up Wallet")}
            </a>
          </div>
        </section>

        {/* FAQ */}
        <section className="prc-section">
          <div className="prc-eyebrow">{t("คำถามที่พบบ่อย", "FAQ")}</div>
          <h2 className="prc-h2">
            {t(
              <>มีคำถาม<span className="prc-gold-text">ก่อนซื้อ?</span></>,
              <>Questions <span className="prc-gold-text">before you buy?</span></>,
            )}
          </h2>
          <div className="prc-faq">
            {FAQ.map((f, n) => (
              <details key={f.q.th} open={n === 0}>
                <summary>{t(f.q)}</summary>
                <p>{t(f.a)}</p>
              </details>
            ))}
          </div>
          <p className="prc-note">
            {t(
              <>
                ยังมีข้อสงสัย? <Link href="/contact">ติดต่อทีมงาน</Link> หรืออ่าน{" "}
                <Link href="/terms">เงื่อนไขการใช้งาน</Link>
              </>,
              <>
                Still have questions? <Link href="/contact">Contact us</Link> or read the{" "}
                <Link href="/terms">terms of service</Link>.
              </>,
            )}
          </p>
        </section>

        {/* Closing CTA */}
        <section className="prc-final">
          <Image src="/pricing-art/tier-6.webp" alt="" width={120} height={120} className="prc-final-emblem" />
          <h2>{t("พร้อมสร้างผลงานชิ้นต่อไปแล้วหรือยัง?", "Ready for your next creation?")}</h2>
          <p>{t("เลือกแพ็กเกจที่ใช่ แล้วเริ่มสร้างภาพ วิดีโอ และเพลงด้วย AI ระดับโลกได้ในไม่กี่นาที", "Pick the right package and start creating images, video and music with world-class AI in minutes.")}</p>
          <div className="prc-final-row">
            <a href="#packages" className="prc-btn prc-btn-gold prc-btn-inline">{t("เลือกแพ็กเกจ", "Choose a package")}</a>
            <Link href="/generate" className="prc-btn prc-btn-glass prc-btn-inline">{t("เปิดสตูดิโอ", "Open Studio")}</Link>
          </div>
        </section>
      </div>

      {/* Phone: the chosen package stays in reach while scrolling */}
      {selectedPkg && (
        <div className="prc-bar" role="region" aria-label={t("แพ็กเกจที่เลือก", "Selected package")}>
          <Image src={`/pricing-art/tier-${emblems[packages.indexOf(selectedPkg)] + 1}.webp`} alt="" width={44} height={44} />
          <div className="prc-bar-copy">
            <b>{packageLabel(selectedPkg.name, locale)}</b>
            <span>{t(`${fmt(totalCredits(selectedPkg))} เครดิต`, formatCredits(Math.round(totalCredits(selectedPkg)), locale))} · {priceLabel(selectedPkg)}</span>
          </div>
          <a href={checkoutHref(selectedPkg.slug)} className="prc-btn prc-btn-gold prc-btn-inline">{t("ซื้อเลย", "Buy now")}</a>
          <button type="button" className="prc-bar-x" aria-label={t("ปิด", "Close")} onClick={() => setSelected(null)}>×</button>
        </div>
      )}

      {notice && (
        <div className="prc-toast" role="status" data-ok={notice.ok || undefined} data-bar={selectedPkg ? "true" : undefined}>
          <span>{notice.text}</span>
          <button type="button" aria-label={t("ปิดข้อความ", "Dismiss")} onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {confirming && (
        <div className="prc-modal" onClick={() => { if (!buying) setConfirming(null); }}>
          <div className="prc-modal-card" role="dialog" aria-modal="true" aria-labelledby="prc-modal-title"
            onClick={e => e.stopPropagation()}>
            <Image src={`/pricing-art/tier-${emblems[packages.indexOf(confirming.pkg)] + 1}.webp`} alt="" width={96} height={96} className="prc-modal-emblem" />
            <h3 id="prc-modal-title">{t("ยืนยันซื้อด้วย Wallet", "Confirm Wallet purchase")}</h3>
            <dl>
              <div><dt>{t("แพ็กเกจ", "Package")}</dt><dd>{packageLabel(confirming.pkg.name, locale)}</dd></div>
              <div>
                <dt>{t("เครดิตที่ได้รับ", "Credits you get")}</dt>
                <dd>
                  {t(`${fmt(totalCredits(confirming.pkg))} เครดิต`, formatCredits(Math.round(totalCredits(confirming.pkg)), locale))}
                  {confirming.pkg.bonusCredits > 0 && (
                    <small>{t(` (รวมโบนัส ${fmt(confirming.pkg.bonusCredits)})`, ` (incl. ${fmt(confirming.pkg.bonusCredits)} bonus)`)}</small>
                  )}
                </dd>
              </div>
              <div><dt>{t("หักจาก Wallet", "Paid from Wallet")}</dt><dd className="prc-gold-text">{formatThb(Math.round(priceOf(confirming.pkg)), locale)}</dd></div>
              {wallet && (
                <div>
                  <dt>{t("Wallet คงเหลือหลังซื้อ", "Wallet after purchase")}</dt>
                  <dd>{formatThb(Math.round(wallet.balance - priceOf(confirming.pkg)), locale)}</dd>
                </div>
              )}
            </dl>
            <div className="prc-modal-row">
              <button type="button" className="prc-btn prc-btn-glass" disabled={buying !== null} onClick={() => setConfirming(null)}>{t("ยกเลิก", "Cancel")}</button>
              <button type="button" className="prc-btn prc-btn-gold" autoFocus disabled={buying !== null} onClick={confirmWalletPurchase}>
                {buying
                  ? t("กำลังซื้อ…", "Buying…")
                  : t(`ยืนยัน ชำระ ${formatThb(Math.round(priceOf(confirming.pkg)), locale)}`, `Confirm · pay ${formatThb(Math.round(priceOf(confirming.pkg)), locale)}`)}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .prc-root {
          --gold-1: #fff1c4; --gold-2: #f3cf7a; --gold-3: #c98f34;
          --ink: #030612; --line: rgba(255,255,255,0.08);
          color: #e2e8f0;
        }
        .prc-gold-text {
          background: linear-gradient(120deg, var(--gold-1), var(--gold-2) 45%, #e7a94a 75%, var(--gold-1));
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
        .prc-wrap { max-width: 1240px; margin: 0 auto; padding: 0 24px 40px; }

        /* Hero extras */
        .prc-hero-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
        .prc-chip {
          display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px;
          font-size: 13px; color: #cbd5e1; background: rgba(3,6,18,0.55); border: 1px solid rgba(243,207,122,0.25);
          backdrop-filter: blur(12px);
        }
        .prc-chip b { color: #fff; font-weight: 600; }
        .prc-dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 10px #34d399; }

        /* Buttons */
        .prc-btn {
          position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 13px 18px; border-radius: 14px; border: 1px solid transparent;
          font: inherit; font-size: 14.5px; font-weight: 600; text-decoration: none; cursor: pointer;
          transition: transform .22s cubic-bezier(.34,1.56,.64,1), box-shadow .22s, background .22s, border-color .22s, color .22s;
        }
        .prc-btn-inline { display: inline-flex; width: auto; padding: 12px 24px; }
        .prc-btn:focus-visible { outline: 2px solid var(--gold-2); outline-offset: 3px; }
        .prc-btn[disabled] { opacity: .5; cursor: default; transform: none !important; }
        .prc-btn-gold {
          color: #1f1503;
          background: linear-gradient(135deg, var(--gold-1) 0%, var(--gold-2) 38%, var(--gold-3) 72%, #f6dfa0 100%);
          box-shadow: 0 14px 34px -14px rgba(243,207,122,.8), inset 0 1px 0 rgba(255,255,255,.65);
        }
        .prc-btn-gold::after {
          content: ""; position: absolute; inset: 0; transform: translateX(-120%);
          background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.65) 50%, transparent 70%);
          transition: transform .7s ease;
        }
        .prc-btn-gold:hover { transform: translateY(-2px); box-shadow: 0 20px 44px -14px rgba(243,207,122,1), inset 0 1px 0 rgba(255,255,255,.7); }
        .prc-btn-gold:hover::after { transform: translateX(120%); }
        .prc-btn-glass {
          color: #f8fafc; background: rgba(255,255,255,.06);
          border-color: hsla(var(--h, 42), 70%, 72%, .35); backdrop-filter: blur(10px);
        }
        .prc-btn-glass:hover { transform: translateY(-2px); background: hsla(var(--h, 42), 70%, 55%, .18); border-color: hsla(var(--h, 42), 85%, 78%, .7); }
        .prc-btn-line {
          margin-top: 8px; padding: 11px 16px; font-size: 13px; background: transparent;
          color: hsl(var(--h, 42), 85%, 80%); border-color: hsla(var(--h, 42), 70%, 65%, .3);
        }
        .prc-btn-line:hover { background: hsla(var(--h, 42), 70%, 55%, .12); border-color: hsla(var(--h, 42), 80%, 72%, .6); }
        .prc-link { font-size: 13px; color: #a5f3fc; text-decoration: none; }
        .prc-link:hover { text-decoration: underline; }

        /* Trust strip */
        .prc-trust {
          list-style: none; margin: 0 0 56px; padding: 14px 18px; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 30px;
          border-radius: 18px; background: rgba(8,12,28,.55); border: 1px solid var(--line); backdrop-filter: blur(14px);
        }
        .prc-trust li { display: flex; align-items: center; gap: 10px; font-size: 13.5px; color: #cbd5e1; }
        .prc-trust li span {
          width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; font-size: 14px; color: var(--gold-2);
          background: radial-gradient(circle at 30% 30%, rgba(243,207,122,.25), rgba(243,207,122,.04)); border: 1px solid rgba(243,207,122,.3);
        }

        /* TPIX partner campaign banner (its own palette: the coin's, not the gold) */
        .prc-tpix {
          position: relative; isolation: isolate; overflow: hidden; display: flex; align-items: center; gap: 24px;
          margin: -24px 0 56px; padding: 20px 24px 20px 22px; border-radius: 22px; color: inherit; text-decoration: none;
          background:
            radial-gradient(80% 170% at 0% 50%, rgba(34,211,238,.2), transparent 55%),
            radial-gradient(60% 170% at 100% 50%, rgba(251,146,60,.16), transparent 60%),
            linear-gradient(180deg, rgba(16,20,40,.94), rgba(8,10,24,.94)) padding-box,
            linear-gradient(110deg, #22d3ee, #3b82f6 30%, #a855f7 60%, #d946ef 80%, #fb923c) border-box;
          border: 1px solid transparent; box-shadow: 0 24px 60px -26px rgba(168,85,247,.6);
          transition: transform .25s ease, box-shadow .25s ease;
        }
        .prc-tpix::before {
          content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
          background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,.08) 50%, transparent 65%);
          transform: translateX(-100%); animation: prc-tpix-sheen 6s ease-in-out infinite;
        }
        .prc-tpix:hover { transform: translateY(-2px); box-shadow: 0 30px 70px -24px rgba(168,85,247,.8); }
        .prc-tpix:focus-visible { outline: 2px solid #a5f3fc; outline-offset: 3px; }
        .prc-tpix-coin { position: relative; flex-shrink: 0; width: 84px; height: 84px; }
        .prc-tpix-coin::before {
          content: ""; position: absolute; inset: -16px; border-radius: 50%; filter: blur(8px);
          background: radial-gradient(circle, rgba(168,85,247,.55), rgba(34,211,238,.25) 45%, transparent 70%);
          animation: prc-tpix-pulse 3.2s ease-in-out infinite;
        }
        .prc-tpix-coin img { position: relative; display: block; width: 100%; height: 100%; animation: prc-tpix-float 4.2s ease-in-out infinite; }
        .prc-tpix-off {
          position: absolute; top: -8px; right: -14px; padding: 4px 8px; border-radius: 999px; transform: rotate(10deg);
          font-size: 12px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #ec4899, #fb923c);
          box-shadow: 0 6px 16px rgba(236,72,153,.45);
        }
        .prc-tpix-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .prc-tpix-eyebrow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 12.5px; font-weight: 600; color: #a5f3fc; }
        .prc-tpix-eyebrow em { font-style: normal; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; color: #fdba74; background: rgba(251,146,60,.16); }
        .prc-tpix-copy b { font-size: clamp(20px, 2.4vw, 28px); font-weight: 800; color: #fff; line-height: 1.3; }
        .prc-tpix-grad { background: linear-gradient(90deg, #22d3ee, #a855f7 55%, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .prc-tpix-nw { white-space: nowrap; }
        .prc-tpix-sub { font-size: 13.5px; line-height: 1.6; color: #b8c3d9; }
        .prc-tpix-cta {
          flex-shrink: 0; display: inline-flex; align-items: center; gap: 8px; padding: 13px 22px; border-radius: 14px;
          font-size: 15px; font-weight: 800; color: #fff; white-space: nowrap;
          background: linear-gradient(110deg, #22d3ee, #3b82f6 35%, #a855f7 70%, #fb923c); box-shadow: 0 12px 30px -10px rgba(168,85,247,.75);
        }
        .prc-tpix-cta i { font-style: normal; transition: transform .2s ease; }
        .prc-tpix:hover .prc-tpix-cta i { transform: translateX(3px); }
        @keyframes prc-tpix-sheen { 0%, 55% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes prc-tpix-pulse { 50% { opacity: .55; transform: scale(.9); } }
        @keyframes prc-tpix-float { 50% { transform: translateY(-4px) rotate(-5deg); } }

        /* Section heads */
        .prc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 44px; scroll-margin-top: 96px; }
        .prc-eyebrow { font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: var(--gold-2); margin-bottom: 10px; }
        .prc-h2 { margin: 0; font-size: clamp(26px, 3.4vw, 40px); font-weight: 300; color: #fff; letter-spacing: -.01em; line-height: 1.2; }
        .prc-lead { margin: 12px 0 0; color: #94a3b8; font-size: 14.5px; line-height: 1.6; }
        .prc-note { margin: 18px auto 0; max-width: 820px; text-align: center; font-size: 12.5px; line-height: 1.7; color: #8391a7; }
        .prc-note a, .prc-wallet a:not(.prc-btn) { color: #a5f3fc; text-decoration: none; }
        .prc-toggle { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(2,6,23,.6); border: 1px solid var(--line); }
        .prc-toggle button {
          padding: 8px 18px; border-radius: 999px; border: 0; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
          background: transparent; color: #94a3b8; transition: background .2s, color .2s;
        }
        .prc-toggle button.on { color: #1f1503; background: linear-gradient(135deg, var(--gold-1), var(--gold-2) 50%, var(--gold-3)); }
        .prc-toggle button:focus-visible { outline: 2px solid var(--gold-2); outline-offset: 2px; }

        /* Grid + cards */
        .prc-grid { display: grid; grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); gap: 26px; align-items: stretch; padding-top: 14px; }
        .prc-skel { height: 640px; border-radius: 26px; background: linear-gradient(110deg, rgba(15,23,42,.5) 30%, rgba(51,65,85,.35) 50%, rgba(15,23,42,.5) 70%) 0 0 / 300% 100%; animation: prc-shimmer 1.6s linear infinite; border: 1px solid var(--line); }
        .prc-empty { text-align: center; padding: 60px 20px; border-radius: 24px; border: 1px solid var(--line); background: rgba(8,12,28,.55); }
        .prc-empty p { margin: 0 0 16px; color: #cbd5e1; }

        .prc-card {
          position: relative; display: flex; flex-direction: column; text-align: center; cursor: pointer;
          padding: 34px 22px 22px; border-radius: 26px; border: 1px solid transparent;
          background:
            radial-gradient(120% 60% at 50% 0%, hsla(var(--h), 75%, 55%, .2), transparent 62%) padding-box,
            linear-gradient(180deg, rgba(15,21,44,.88), rgba(6,9,22,.92)) padding-box,
            linear-gradient(165deg, hsla(var(--h), 80%, 72%, .5), rgba(255,255,255,.05) 38%, rgba(255,255,255,.03) 62%, hsla(var(--h), 80%, 62%, .35)) border-box;
          box-shadow: 0 26px 60px -32px rgba(0,0,0,.9);
          transition: transform .4s cubic-bezier(.2,.8,.2,1), box-shadow .4s;
        }
        .prc-card::before {
          content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; overflow: hidden;
          background: linear-gradient(105deg, transparent 40%, hsla(var(--h), 90%, 85%, .09) 50%, transparent 60%) -200% 0 / 250% 100% no-repeat;
          transition: background-position .9s ease;
        }
        .prc-card:hover { transform: translateY(-8px); box-shadow: 0 34px 80px -30px hsla(var(--h), 85%, 55%, .55); }
        .prc-card:hover::before { background-position: 200% 0; }
        .prc-card[data-selected] {
          box-shadow: 0 0 0 2px rgba(243,207,122,.9), 0 34px 80px -30px rgba(243,207,122,.55);
        }
        .prc-card[data-rec] {
          background:
            radial-gradient(120% 60% at 50% 0%, rgba(243,207,122,.24), transparent 60%) padding-box,
            radial-gradient(90% 50% at 50% 100%, rgba(139,92,246,.18), transparent 70%) padding-box,
            linear-gradient(180deg, rgba(24,20,44,.92), rgba(8,8,22,.95)) padding-box,
            linear-gradient(160deg, #fbe7ae, #c98f34 22%, rgba(255,255,255,.08) 45%, rgba(139,92,246,.55) 70%, #f3cf7a) border-box;
          box-shadow: 0 40px 100px -36px rgba(243,207,122,.55), 0 0 0 1px rgba(243,207,122,.15);
          transform: translateY(-14px);
        }
        .prc-card[data-rec]:hover { transform: translateY(-20px); }
        .prc-card[data-rec][data-selected] { box-shadow: 0 0 0 2px rgba(243,207,122,.95), 0 40px 100px -30px rgba(243,207,122,.7); }

        .prc-corner { position: absolute; width: 110px; height: 110px; pointer-events: none; z-index: 2; filter: drop-shadow(0 0 8px rgba(243,207,122,.35)); }
        .prc-corner.tl { top: -16px; left: -16px; }
        .prc-corner.tr { top: -16px; right: -16px; transform: scaleX(-1); }
        .prc-corner.bl { bottom: -16px; left: -16px; transform: scaleY(-1); }
        .prc-corner.br { bottom: -16px; right: -16px; transform: scale(-1, -1); }

        .prc-ribbon {
          position: absolute; top: -14px; left: 50%; transform: translateX(-50%); z-index: 3; white-space: nowrap;
          padding: 6px 16px; border-radius: 999px; font-size: 11.5px; font-weight: 700; letter-spacing: .08em; color: #fff;
          background: linear-gradient(90deg, hsl(var(--h), 70%, 45%), hsl(calc(var(--h) + 30), 75%, 55%));
          box-shadow: 0 10px 24px -10px hsla(var(--h), 80%, 55%, .9);
        }
        .prc-card[data-rec] .prc-ribbon { color: #1f1503; background: linear-gradient(90deg, #f7e2a6, #e2b354 50%, #f7e2a6); box-shadow: 0 10px 28px -8px rgba(226,179,84,.9); }
        .prc-check {
          position: absolute; top: 14px; right: 14px; z-index: 3; padding: 4px 10px; border-radius: 999px;
          font-size: 11px; font-weight: 700; color: #1f1503; background: var(--gold-2);
        }

        .prc-emblem { position: relative; width: 132px; height: 132px; margin: 0 auto 6px; animation: prc-float 6s ease-in-out infinite; }
        .prc-emblem::before {
          content: ""; position: absolute; inset: 18%; border-radius: 50%;
          background: radial-gradient(circle, hsla(var(--h), 90%, 60%, .45), transparent 70%); filter: blur(16px);
        }
        .prc-emblem img { position: relative; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 10px 22px rgba(0,0,0,.6)); }
        .prc-card:hover .prc-emblem img { filter: drop-shadow(0 10px 22px rgba(0,0,0,.6)) brightness(1.12); }
        .prc-name {
          margin: 0; font-family: var(--font-unbounded), Inter, sans-serif; font-size: 15px; font-weight: 600;
          letter-spacing: .16em; text-transform: uppercase; color: hsl(var(--h), 85%, 82%);
        }
        .prc-card[data-rec] .prc-name { color: var(--gold-2); }
        .prc-credits { display: flex; align-items: baseline; justify-content: center; gap: 8px; margin-top: 14px; }
        .prc-credits b {
          font-family: var(--font-unbounded), Inter, sans-serif; font-size: clamp(34px, 3vw, 42px); font-weight: 600; letter-spacing: -.02em; line-height: 1;
          background: linear-gradient(180deg, #fff 20%, hsl(var(--h), 90%, 80%)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
        .prc-card[data-rec] .prc-credits b { background-image: linear-gradient(180deg, var(--gold-1) 15%, var(--gold-2) 60%, #d99a3c); }
        .prc-credits span { font-size: 13px; color: #94a3b8; }
        .prc-bonus { display: inline-block; margin: 10px auto 0; padding: 4px 12px; border-radius: 999px; font-size: 12px; color: hsl(var(--h), 85%, 82%); background: hsla(var(--h), 70%, 50%, .14); border: 1px solid hsla(var(--h), 70%, 65%, .25); }
        .prc-bonus-none { visibility: hidden; }
        .prc-price { display: flex; align-items: baseline; justify-content: center; gap: 8px; margin-top: 18px; }
        .prc-price b { font-family: var(--font-unbounded), Inter, sans-serif; font-size: 26px; font-weight: 500; color: #fff; letter-spacing: -.01em; }
        .prc-price span { font-size: 12px; color: #8391a7; }
        .prc-per { margin-top: 4px; font-size: 12px; color: #8391a7; }

        .prc-rule { position: relative; height: 1px; margin: 20px 4px 18px; background: linear-gradient(90deg, transparent, hsla(var(--h), 70%, 70%, .4), transparent); }
        .prc-card[data-rec] .prc-rule { background: linear-gradient(90deg, transparent, rgba(243,207,122,.6), transparent); }
        .prc-rule span { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 0 8px; font-size: 9px; color: hsl(var(--h), 80%, 75%); background: #0a0d1f; }
        .prc-card[data-rec] .prc-rule span { color: var(--gold-2); }

        .prc-yield { text-align: left; padding: 12px 14px; border-radius: 16px; background: rgba(255,255,255,.03); border: 1px solid var(--line); }
        .prc-yield-h { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #8391a7; margin-bottom: 6px; }
        .prc-yield-row { display: grid; grid-template-columns: 26px 1fr auto auto; align-items: center; gap: 10px; padding: 5px 0; font-size: 13.5px; color: #cbd5e1; }
        .prc-yield-row img { width: 26px; height: 26px; object-fit: contain; }
        .prc-yield-row b { font-family: var(--font-unbounded), Inter, sans-serif; font-size: 14px; font-weight: 600; color: #fff; }
        .prc-yield-row em { font-style: normal; font-size: 12px; color: #8391a7; min-width: 28px; }

        .prc-feats { list-style: none; margin: 16px 0 0; padding: 0; text-align: left; }
        .prc-feats li { position: relative; padding: 4px 0 4px 22px; font-size: 13px; color: rgba(226,232,240,.82); }
        .prc-feats li::before { content: "✦"; position: absolute; left: 2px; top: 4px; font-size: 11px; color: hsl(var(--h), 85%, 72%); }
        .prc-card[data-rec] .prc-feats li::before { color: var(--gold-2); }

        .prc-actions { margin-top: auto; padding-top: 22px; }

        /* Free tier */
        .prc-trial {
          display: flex; align-items: center; gap: 20px; margin-top: 30px; padding: 18px 24px; border-radius: 22px;
          background: linear-gradient(100deg, rgba(243,207,122,.08), rgba(8,12,28,.6) 40%); border: 1px solid rgba(243,207,122,.18); backdrop-filter: blur(14px);
        }
        .prc-trial-emblem { flex-shrink: 0; width: 76px; height: 76px; object-fit: contain; }
        .prc-trial-copy { flex: 1; min-width: 0; }
        .prc-trial-title { font-size: 17px; color: #fff; font-weight: 500; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .prc-trial-badge { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #1f1503; background: var(--gold-2); }
        .prc-trial-sub { margin-top: 4px; font-size: 13px; color: #94a3b8; line-height: 1.55; }
        .prc-trial-cta { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0; }

        /* Sections */
        .prc-section { margin-top: 96px; text-align: center; }
        .prc-steps { list-style: none; margin: 40px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; counter-reset: s; }
        .prc-steps li { position: relative; padding: 30px 24px 26px; border-radius: 22px; background: rgba(10,14,32,.6); border: 1px solid var(--line); backdrop-filter: blur(14px); text-align: left; }
        .prc-steps li b {
          display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; margin-bottom: 16px;
          font-family: var(--font-unbounded), Inter, sans-serif; font-size: 17px; color: #1f1503;
          background: linear-gradient(135deg, var(--gold-1), var(--gold-2) 50%, var(--gold-3)); box-shadow: 0 12px 26px -12px rgba(243,207,122,.8);
        }
        .prc-steps h3, .prc-promises h3 { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: #fff; }
        .prc-steps p, .prc-promises p { margin: 0; font-size: 13.5px; line-height: 1.65; color: #94a3b8; }

        .prc-costs { margin-top: 34px; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; text-align: left; }
        .prc-cost { display: flex; gap: 14px; align-items: flex-start; padding: 18px; border-radius: 18px; background: rgba(10,14,32,.6); border: 1px solid var(--line); transition: border-color .25s, transform .25s; }
        .prc-cost:hover { border-color: rgba(243,207,122,.3); transform: translateY(-2px); }
        .prc-cost img { width: 44px; height: 44px; object-fit: contain; flex-shrink: 0; }
        .prc-cost-body { flex: 1; min-width: 0; }
        .prc-cost-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
        .prc-cost-top h3 { margin: 0; font-size: 15px; font-weight: 600; color: #fff; }
        .prc-cost-top span { white-space: nowrap; font-family: var(--font-unbounded), Inter, sans-serif; font-size: 14px; color: var(--gold-2); }
        .prc-cost-top small { font-family: var(--font-sans); font-size: 11px; color: #8391a7; }
        .prc-cost p { margin: 6px 0 0; font-size: 12.5px; color: #8391a7; line-height: 1.5; }

        .prc-promises { margin-top: 40px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; text-align: left; }
        .prc-promises > div { padding: 26px 22px; border-radius: 22px; background: linear-gradient(180deg, rgba(243,207,122,.06), rgba(10,14,32,.6) 45%); border: 1px solid rgba(243,207,122,.14); }
        .prc-promises span {
          display: grid; place-items: center; width: 46px; height: 46px; margin-bottom: 16px; border-radius: 50%; font-size: 20px; color: var(--gold-2);
          background: radial-gradient(circle at 30% 30%, rgba(243,207,122,.28), rgba(243,207,122,.04)); border: 1px solid rgba(243,207,122,.32);
        }

        .prc-wallet {
          display: flex; align-items: center; gap: 18px; margin-top: 22px; padding: 20px 24px; border-radius: 22px; text-align: left;
          background: linear-gradient(110deg, rgba(20,184,166,.12), rgba(139,92,246,.1)); border: 1px solid rgba(165,243,252,.18); backdrop-filter: blur(14px);
        }
        .prc-wallet img { flex-shrink: 0; width: 64px; height: 64px; object-fit: contain; }
        .prc-wallet > div { flex: 1; min-width: 0; }
        .prc-wallet h3 { margin: 0 0 4px; font-size: 15px; color: #fff; font-weight: 600; }
        .prc-wallet p { margin: 0; font-size: 13.5px; line-height: 1.6; color: #a9b6c9; }
        .prc-wallet p b { color: #fff; }
        .prc-warn { color: #fca5a5; }

        .prc-faq { margin: 36px auto 0; max-width: 860px; display: grid; gap: 12px; text-align: left; }
        .prc-faq details { border-radius: 18px; background: rgba(10,14,32,.6); border: 1px solid var(--line); transition: border-color .25s, background .25s; }
        .prc-faq details[open] { border-color: rgba(243,207,122,.3); background: rgba(16,18,38,.75); }
        .prc-faq summary { list-style: none; cursor: pointer; padding: 18px 54px 18px 22px; position: relative; font-size: 15px; font-weight: 500; color: #fff; }
        .prc-faq summary::-webkit-details-marker { display: none; }
        .prc-faq summary::after {
          content: "+"; position: absolute; right: 20px; top: 50%; transform: translateY(-50%); width: 26px; height: 26px; display: grid; place-items: center;
          border-radius: 50%; font-size: 17px; color: var(--gold-2); border: 1px solid rgba(243,207,122,.35); transition: transform .25s;
        }
        .prc-faq details[open] summary::after { content: "−"; }
        .prc-faq summary:focus-visible { outline: 2px solid var(--gold-2); outline-offset: -2px; border-radius: 18px; }
        .prc-faq details p { margin: 0; padding: 0 22px 20px; font-size: 14px; line-height: 1.75; color: #a9b6c9; }

        .prc-final {
          position: relative; margin-top: 96px; padding: 56px 24px; border-radius: 30px; text-align: center; overflow: hidden;
          background:
            radial-gradient(60% 80% at 50% 0%, rgba(243,207,122,.18), transparent 70%),
            radial-gradient(50% 70% at 50% 100%, rgba(139,92,246,.22), transparent 70%),
            rgba(8,10,26,.75);
          border: 1px solid rgba(243,207,122,.22);
        }
        /* Tailwind's preflight makes every img a block, so centre them by margin */
        .prc-final-emblem { display: block; margin: 0 auto; width: 120px; height: 120px; object-fit: contain; animation: prc-float 6s ease-in-out infinite; }
        .prc-final h2 { margin: 12px 0 0; font-size: clamp(24px, 3vw, 34px); font-weight: 300; color: #fff; }
        .prc-final p { margin: 12px auto 0; max-width: 560px; font-size: 14.5px; line-height: 1.7; color: #a9b6c9; }
        .prc-final-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 26px; }

        /* Phone bar, toast, modal */
        .prc-bar { display: none; }
        .prc-toast {
          position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 70; display: flex; align-items: center; gap: 14px;
          width: max-content; max-width: min(560px, calc(100vw - 32px)); padding: 14px 16px 14px 20px; border-radius: 16px; font-size: 14px; font-weight: 500;
          color: #fca5a5; background: rgba(40,10,16,.92); border: 1px solid rgba(248,113,113,.4); backdrop-filter: blur(16px);
          box-shadow: 0 20px 50px -20px rgba(0,0,0,.8); animation: prc-rise .35s ease;
        }
        .prc-toast[data-ok] { color: #a7f3d0; background: rgba(6,32,26,.92); border-color: rgba(52,211,153,.4); }
        .prc-toast button { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; border: 0; cursor: pointer; font-size: 18px; color: inherit; background: rgba(255,255,255,.08); }
        .prc-modal { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 16px; background: rgba(2,4,12,.72); backdrop-filter: blur(6px); animation: prc-fade .2s ease; }
        .prc-modal-card {
          width: min(440px, 100%); padding: 30px 26px 24px; border-radius: 26px; text-align: center; border: 1px solid transparent;
          background:
            radial-gradient(100% 60% at 50% 0%, rgba(243,207,122,.18), transparent 60%) padding-box,
            linear-gradient(180deg, rgba(18,20,42,.97), rgba(8,9,22,.98)) padding-box,
            linear-gradient(160deg, #fbe7ae, #c98f34 30%, rgba(255,255,255,.08) 55%, rgba(139,92,246,.5)) border-box;
          box-shadow: 0 40px 100px -30px rgba(0,0,0,.9); animation: prc-rise .3s ease;
        }
        .prc-modal-emblem { display: block; margin: 0 auto; width: 96px; height: 96px; object-fit: contain; }
        .prc-modal-card h3 { margin: 6px 0 18px; font-size: 20px; font-weight: 500; color: #fff; }
        .prc-modal-card dl { margin: 0; text-align: left; border-radius: 16px; border: 1px solid var(--line); overflow: hidden; }
        .prc-modal-card dl > div { display: flex; justify-content: space-between; gap: 12px; padding: 12px 16px; font-size: 14px; }
        .prc-modal-card dl > div + div { border-top: 1px solid var(--line); }
        .prc-modal-card dt { color: #94a3b8; }
        .prc-modal-card dd { margin: 0; color: #fff; font-weight: 600; text-align: right; }
        .prc-modal-card dd small { font-weight: 400; color: #94a3b8; }
        .prc-modal-row { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; margin-top: 20px; }

        @keyframes prc-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes prc-shimmer { to { background-position: -300% 0; } }
        @keyframes prc-rise { from { opacity: 0; transform: translate(var(--tx, 0), 12px); } to { opacity: 1; transform: translate(var(--tx, 0), 0); } }
        .prc-toast { --tx: -50%; }
        @keyframes prc-fade { from { opacity: 0; } to { opacity: 1; } }

        @media (max-width: 1100px) {
          .prc-grid { grid-template-columns: repeat(min(var(--cols, 4), 2), minmax(0, 1fr)); row-gap: 40px; }
          .prc-promises { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 760px) {
          .prc-steps { grid-template-columns: 1fr; }
          .prc-costs { grid-template-columns: 1fr; }
        }
        @media (max-width: 680px) {
          .prc-wrap { padding: 0 16px 32px; }
          .prc-wrap[data-bar] { padding-bottom: 110px; }
          .prc-trust { justify-content: flex-start; gap: 10px 18px; margin-bottom: 40px; }
          .prc-trust li { font-size: 12.5px; flex: 1 1 45%; }
          .prc-tpix { flex-wrap: wrap; gap: 14px 16px; margin: -16px 0 40px; padding: 18px 16px; }
          .prc-tpix-coin { width: 60px; height: 60px; }
          .prc-tpix-off { top: auto; bottom: -12px; right: 50%; transform: translateX(50%) rotate(-4deg); font-size: 11px; padding: 3px 7px; }
          .prc-tpix-copy { flex: 1 1 calc(100% - 80px); }
          .prc-tpix-cta { flex: 1 1 100%; justify-content: center; }
          .prc-head { margin-bottom: 34px; }
          .prc-grid { grid-template-columns: 1fr; row-gap: 34px; }
          .prc-card[data-rec], .prc-card[data-rec]:hover { transform: none; }
          .prc-card:hover { transform: none; }
          .prc-corner { width: 84px; height: 84px; }
          .prc-bonus-none { display: none; }
          .prc-trial { flex-direction: column; text-align: center; padding: 22px 18px; }
          .prc-trial-title { justify-content: center; }
          .prc-promises { grid-template-columns: 1fr; }
          .prc-wallet { flex-direction: column; text-align: center; }
          .prc-section { margin-top: 72px; }
          .prc-final { margin-top: 72px; padding: 44px 18px; }
          .prc-bar {
            position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 60; display: flex; align-items: center; gap: 12px;
            padding: 10px 10px 10px 12px; border-radius: 20px; animation: prc-rise .3s ease;
            background: rgba(10,10,26,.92); border: 1px solid rgba(243,207,122,.35); backdrop-filter: blur(18px);
            box-shadow: 0 20px 50px -16px rgba(0,0,0,.9), 0 0 30px -12px rgba(243,207,122,.5);
          }
          .prc-bar img { width: 44px; height: 44px; object-fit: contain; flex-shrink: 0; }
          .prc-bar-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left; }
          .prc-bar-copy b { font-size: 14px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .prc-bar-copy span { font-size: 12px; color: var(--gold-2); white-space: nowrap; }
          .prc-bar .prc-btn { padding: 11px 16px; font-size: 13.5px; }
          .prc-bar-x { flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer; font-size: 18px; color: #94a3b8; background: rgba(255,255,255,.06); }
          .prc-toast[data-bar] { bottom: 96px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .prc-emblem, .prc-final-emblem, .prc-skel, .prc-tpix::before, .prc-tpix-coin::before, .prc-tpix-coin img { animation: none; }
          .prc-card, .prc-btn, .prc-tpix { transition: none; }
        }
      `}</style>
    </div>
  );
}
