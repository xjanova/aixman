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
async function purchasePackage(slug: string, idempotencyKey: string): Promise<PurchaseResult> {
  try {
    const res = await fetch("/api/credits/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageSlug: slug, idempotencyKey }),
    });
    if (res.status === 401) return { status: "error", message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง" };
    const data = await res.json();
    if (!res.ok) return { status: "error", message: data.error || "ซื้อไม่สำเร็จ" };
    if (data.duplicate) return { status: "duplicate" };
    return { status: "ok", credits: data.credits, walletBalance: data.walletBalance };
  } catch {
    return { status: "error", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" };
  }
}

const fmt = (n: number) => Math.round(n).toLocaleString("th-TH");
const checkoutHref = (slug: string) => `${XMAN_URL}/checkout/ai-credits/${encodeURIComponent(slug)}?ref=ai`;

const WORK: { kind: WorkKind; label: string; unit: string; icon: string }[] = [
  { kind: "image", label: "ภาพ", unit: "ภาพ", icon: "/studio/ic-image-v1.webp" },
  { kind: "video", label: "วิดีโอ", unit: "คลิป", icon: "/studio/ic-video-v1.webp" },
  { kind: "audio", label: "เพลง", unit: "เพลง", icon: "/studio/ic-music-v1.webp" },
];

const CATEGORY_INFO: Record<string, { label: string; icon: string }> = {
  image: { label: "สร้างภาพ", icon: "/studio/ic-image-v1.webp" },
  video: { label: "สร้างวิดีโอ", icon: "/studio/ic-video-v1.webp" },
  lipsync: { label: "พากย์ทับคลิป / ลิปซิงก์", icon: "/studio/ic-lipsync-v1.webp" },
  audio: { label: "เพลงและเสียง", icon: "/studio/ic-music-v1.webp" },
  edit: { label: "แก้ไขภาพ", icon: "/studio/ic-edit-v1.webp" },
  model3d: { label: "โมเดล 3D", icon: "/studio/ic-3d-v1.webp" },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "เครดิตมีวันหมดอายุไหม?",
    a: "ไม่มีครับ เครดิตอยู่ในบัญชีจนกว่าจะใช้ ซื้อแพ็กเกจเป็นการจ่ายครั้งเดียว ไม่มีรอบบิลรายเดือน และไม่มีการตัดเงินอัตโนมัติ ซื้อเพิ่มเมื่อไรก็รวมกับยอดเดิมทันที",
  },
  {
    q: "ชำระเงินได้ช่องทางไหนบ้าง?",
    a: "กด “ซื้อแพ็กเกจนี้” เพื่อชำระผ่านระบบของ XMAN Studio ด้วย PromptPay หรือโอนผ่านธนาคารแล้วแนบสลิป หรือถ้ามียอดใน Wallet ของ XMAN Studio อยู่แล้ว เข้าสู่ระบบแล้วกด “ซื้อด้วย Wallet” ได้ทันทีบนหน้านี้",
  },
  {
    q: "จ่ายแล้วเครดิตเข้าเมื่อไร?",
    a: "ซื้อด้วย Wallet เครดิตเข้าทันที ส่วน PromptPay และโอนธนาคาร เครดิตจะเข้าบัญชีอัตโนมัติเมื่อยืนยันยอดชำระแล้ว ดูสถานะคำสั่งซื้อได้ที่ xman4289.com และดูยอดเครดิตได้ที่หน้าโปรไฟล์",
  },
  {
    q: "ถ้าสร้างงานไม่สำเร็จ เสียเครดิตไหม?",
    a: "ไม่เสียครับ งานที่ล้มเหลวหรือหมดเวลา ระบบคืนเครดิตให้อัตโนมัติ ดูรายการคืนได้ในประวัติเครดิต",
  },
  {
    q: "เครดิตใช้กับอะไรได้บ้าง?",
    a: "ทุกโมเดลในสตูดิโอ ทั้งภาพ วิดีโอ เพลง พากย์ทับคลิป และ 3D รวมถึงโหมดหนัง/MV และ API สำหรับนักพัฒนา แต่ละโมเดลใช้เครดิตต่างกัน ดูได้จากตารางด้านบนและในหน้าสตูดิโอก่อนกดสร้าง",
  },
  {
    q: "ต้องสมัครบัญชีใหม่ไหม?",
    a: "ใช้บัญชีเดียวกับ XMAN Studio (xman4289.com) ถ้ายังไม่มี สมัครฟรีที่นั่น แล้วเข้าสู่ระบบที่นี่ด้วยอีเมลและรหัสผ่านเดียวกัน สมาชิกใหม่ได้รับเครดิตต้อนรับเมื่อเข้าใช้ครั้งแรก",
  },
];

export default function PricingPage() {
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
        range: groups[k].min === groups[k].max ? fmt(groups[k].min) : `${fmt(groups[k].min)}–${fmt(groups[k].max)}`,
        names: groups[k].names.join(" · "),
      }));
  }, [models]);

  const paid = packages
    .map((p, i) => ({ p, i }))
    .filter(x => priceOf(x.p) > 0);
  const free = packages
    .map((p, i) => ({ p, i }))
    .filter(x => priceOf(x.p) <= 0);
  const selectedPkg = packages.find(p => p.slug === selected && priceOf(p) > 0) ?? null;

  const priceLabel = (p: Package) =>
    currency === "thb" ? `฿${fmt(priceOf(p))}` : `$${Number(p.priceUsd || 0).toFixed(2)}`;
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
    const result = await purchasePackage(pkg.slug, key);
    inFlight.current = false;
    setBuying(null);
    setConfirming(null);

    if (result.status === "error") {
      setNotice({ ok: false, text: result.message });
      return;
    }
    if (result.status === "duplicate") {
      setNotice({ ok: true, text: "รายการนี้ถูกดำเนินการไปแล้ว" });
      return;
    }
    setNotice({ ok: true, text: `ซื้อ ${pkg.name} สำเร็จ! ยอดเครดิตคงเหลือ ${fmt(Number(result.credits))} เครดิต` });
    setWallet(w => (w ? { ...w, balance: result.walletBalance, credits: result.credits } : w));
  };

  /** What the wallet button can honestly offer for this package; "none" shows no button. */
  const walletState = (pkg: Package): "ok" | "short" | "suspended" | "none" => {
    if (!wallet?.hasWallet) return "none";
    if (!wallet.isActive) return "suspended";
    return wallet.balance >= priceOf(pkg) ? "ok" : "short";
  };

  return (
    <div className="prc-root">
      <PageHero
        image="/pricing-art/hero-v1.webp"
        eyebrow="· แพ็กเกจเครดิต X-DREAMER"
        title="ปลดล็อกพลังสร้างสรรค์"
        emphasis="ระดับพรีเมียม"
        hue={315}
        objectPosition="72% center"
        sub="เครดิตเดียว ใช้ได้ทุกโมเดล ทั้งภาพ วิดีโอ เพลง และ 3D — จ่ายครั้งเดียว ไม่มีวันหมดอายุ งานไหนสร้างไม่สำเร็จ คืนเครดิตอัตโนมัติ"
      >
        <div className="prc-hero-row">
          <a href="#packages" className="prc-btn prc-btn-gold prc-btn-inline">ดูแพ็กเกจ</a>
          {wallet ? (
            <span className="prc-chip prc-chip-strong">
              <span className="prc-dot" /> เครดิตของคุณ <b>{fmt(wallet.credits)}</b>
              {wallet.hasWallet && <> · Wallet <b>฿{fmt(wallet.balance)}</b></>}
            </span>
          ) : (
            <Link href="/login?callbackUrl=%2Fpricing" className="prc-btn prc-btn-glass prc-btn-inline">เข้าสู่ระบบ</Link>
          )}
        </div>
      </PageHero>

      <div className="prc-wrap" data-bar={selectedPkg ? "true" : undefined}>
        {/* Trust strip */}
        <ul className="prc-trust" aria-label="จุดเด่น">
          <li><span>∞</span>ไม่มีวันหมดอายุ</li>
          <li><span>↺</span>สร้างไม่สำเร็จ คืนเครดิตอัตโนมัติ</li>
          <li><span>◈</span>ชำระผ่าน XMAN Studio</li>
          <li><span>✦</span>บัญชีเดียว ใช้ได้ทุกโมเดล</li>
        </ul>

        {/* Section head + currency */}
        <div className="prc-head" id="packages">
          <div>
            <div className="prc-eyebrow">เลือกระดับของคุณ</div>
            <h2 className="prc-h2">แพ็กเกจ<span className="prc-gold-text">เครดิต</span></h2>
          </div>
          <div className="prc-toggle" role="group" aria-label="สกุลเงิน">
            {([["thb", "฿ THB"], ["usd", "$ USD"]] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={currency === key}
                className={currency === key ? "on" : undefined} onClick={() => setCurrency(key)}>{label}</button>
            ))}
          </div>
        </div>
        {currency === "usd" && (
          <p className="prc-note">ราคา USD แสดงเพื่อเทียบเท่านั้น การชำระเงินจริงเรียกเก็บเป็นบาท</p>
        )}

        {/* Packages */}
        {loading ? (
          <div className="prc-grid" style={{ "--cols": 4 } as CSSProperties}>
            {[0, 1, 2, 3].map(i => <div key={i} className="prc-skel" />)}
          </div>
        ) : packages.length === 0 ? (
          <div className="prc-empty">
            <p>{loadFailed ? "โหลดแพ็กเกจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" : "ยังไม่มีแพ็กเกจเปิดขายในขณะนี้"}</p>
            <button type="button" className="prc-btn prc-btn-glass prc-btn-inline"
              onClick={() => { setLoading(true); setLoadFailed(false); setReloadKey(k => k + 1); }}>โหลดใหม่</button>
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
                const features = extraFeatures(parseFeatures(pkg.features), hasEstimates);
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
                      <div className="prc-ribbon">{isRec ? "✦ " : ""}{pkg.badge || "แนะนำ"}</div>
                    )}
                    {isSel && <div className="prc-check" aria-hidden>✓ เลือกแล้ว</div>}

                    <div className="prc-emblem">
                      <Image src={`/pricing-art/tier-${tier + 1}.webp`} alt="" width={132} height={132} sizes="132px" />
                    </div>
                    <h3 className="prc-name">{pkg.name}</h3>

                    <div className="prc-credits">
                      <b>{fmt(total)}</b>
                      <span>เครดิต</span>
                    </div>
                    {pkg.bonusCredits > 0 ? (
                      <div className="prc-bonus">{fmt(pkg.credits)} + โบนัส {fmt(pkg.bonusCredits)}</div>
                    ) : (
                      // Keeps the prices of every card on one line.
                      <div className="prc-bonus prc-bonus-none" aria-hidden>&nbsp;</div>
                    )}

                    <div className="prc-price">
                      <b>{priceLabel(pkg)}</b>
                      <span>จ่ายครั้งเดียว</span>
                    </div>
                    {per && <div className="prc-per">เฉลี่ย {per} ต่อเครดิต</div>}

                    <div className="prc-rule" aria-hidden><span>◆</span></div>

                    {hasEstimates && (
                      <div className="prc-yield">
                        <div className="prc-yield-h">ใช้ได้ประมาณ</div>
                        {WORK.filter(w => costs[w.kind]).map(w => (
                          <div key={w.kind} className="prc-yield-row">
                            <Image src={w.icon} alt="" width={26} height={26} />
                            <span>{w.label}</span>
                            <b>≈ {fmt(howMany(total, costs[w.kind]!))}</b>
                            <em>{w.unit}</em>
                          </div>
                        ))}
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
                        ซื้อแพ็กเกจนี้ <span aria-hidden>→</span>
                      </a>
                      {ws === "short" && (
                        <a href={`${XMAN_URL}/wallet/topup`} target="_blank" rel="noopener noreferrer"
                          className="prc-btn prc-btn-line" onClick={e => e.stopPropagation()}>
                          Wallet ไม่พอ · เติมเงิน
                        </a>
                      )}
                      {(ws === "ok" || ws === "suspended") && (
                        <button type="button" className="prc-btn prc-btn-line"
                          disabled={ws === "suspended" || buying !== null}
                          onClick={e => { e.stopPropagation(); setSelected(pkg.slug); askWalletPurchase(pkg); }}>
                          {buying === pkg.slug ? "กำลังซื้อ…" : ws === "suspended" ? "Wallet ถูกระงับ" : `ซื้อด้วย Wallet ฿${fmt(priceOf(pkg))}`}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            {free.map(({ p: pkg, i }) => {
              const features = extraFeatures(parseFeatures(pkg.features), hasEstimates);
              return (
                <div key={pkg.id} className="prc-trial" style={{ "--h": TIER_HUE[emblems[i]] } as CSSProperties}>
                  <Image src={`/pricing-art/tier-${emblems[i] + 1}.webp`} alt="" width={76} height={76} className="prc-trial-emblem" />
                  <div className="prc-trial-copy">
                    <div className="prc-trial-title">
                      {pkg.name} <span className="prc-gold-text">{fmt(totalCredits(pkg))} เครดิต</span>
                      {pkg.badge && <span className="prc-trial-badge">{pkg.badge}</span>}
                    </div>
                    <div className="prc-trial-sub">
                      {features.length ? features.join(" · ") : "ลองสร้างงานได้ทันที ไม่ต้องผูกบัตร"}
                    </div>
                  </div>
                  <div className="prc-trial-cta">
                    <Link href={wallet ? "/generate" : "/login?callbackUrl=%2Fgenerate"} className="prc-btn prc-btn-glass prc-btn-inline">
                      เริ่มใช้ฟรี →
                    </Link>
                    {!wallet && (
                      <a href={`${XMAN_URL}/register`} target="_blank" rel="noopener noreferrer" className="prc-link">
                        ยังไม่มีบัญชี? สมัครฟรี
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {hasEstimates && (
              <p className="prc-note">
                จำนวนภาพ/คลิป/เพลงเป็นค่าประมาณ คิดจากราคากลางของโมเดลที่เปิดให้ใช้ตอนนี้
                ({WORK.filter(w => costs[w.kind]).map(w => `${w.label} ${fmt(costs[w.kind]!)} เครดิต`).join(" · ")})
                — งานที่ยาวขึ้นหรือโมเดลระดับพรีเมียมใช้เครดิตมากกว่านี้
              </p>
            )}
          </>
        )}

        {/* How it works */}
        <section className="prc-section">
          <div className="prc-eyebrow">ซื้อง่าย 3 ขั้นตอน</div>
          <h2 className="prc-h2">จากเลือกแพ็กเกจ <span className="prc-gold-text">ถึงงานชิ้นแรก</span></h2>
          <ol className="prc-steps">
            <li>
              <b>1</b>
              <h3>เลือกแพ็กเกจ</h3>
              <p>เลือกระดับที่เหมาะกับงานของคุณ เครดิตจากทุกแพ็กเกจรวมเป็นยอดเดียว</p>
            </li>
            <li>
              <b>2</b>
              <h3>ชำระเงิน</h3>
              <p>PromptPay หรือโอนผ่านธนาคารที่ XMAN Studio หรือหักจาก Wallet ได้ทันทีบนหน้านี้</p>
            </li>
            <li>
              <b>3</b>
              <h3>เริ่มสร้างงาน</h3>
              <p>เครดิตเข้าบัญชีอัตโนมัติเมื่อยืนยันยอด แล้วเปิดสตูดิโอสร้างภาพ วิดีโอ หรือเพลงได้เลย</p>
            </li>
          </ol>
        </section>

        {/* Credit costs */}
        {creditTable.length > 0 && (
          <section className="prc-section">
            <div className="prc-eyebrow">ตารางเครดิต</div>
            <h2 className="prc-h2">แต่ละงานใช้<span className="prc-gold-text">กี่เครดิต</span></h2>
            <p className="prc-lead">ราคาต่อครั้งของโมเดลที่เปิดให้ใช้ตอนนี้ — เห็นราคาจริงอีกครั้งในสตูดิโอก่อนกดสร้างทุกครั้ง</p>
            <div className="prc-costs">
              {creditTable.map(row => (
                <div key={row.key} className="prc-cost">
                  <Image src={row.icon} alt="" width={44} height={44} />
                  <div className="prc-cost-body">
                    <div className="prc-cost-top">
                      <h3>{row.label}</h3>
                      <span>{row.range} <small>เครดิต/ครั้ง</small></span>
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
          <div className="prc-eyebrow">มั่นใจได้ทุกการซื้อ</div>
          <h2 className="prc-h2">ซื้อครั้งเดียว <span className="prc-gold-text">ใช้ได้เต็มที่</span></h2>
          <div className="prc-promises">
            <div>
              <span>∞</span>
              <h3>ไม่มีวันหมดอายุ</h3>
              <p>เครดิตอยู่ในบัญชีจนกว่าจะใช้ ไม่มีรอบบิล ไม่มีการตัดเงินอัตโนมัติ</p>
            </div>
            <div>
              <span>↺</span>
              <h3>คืนเครดิตอัตโนมัติ</h3>
              <p>งานที่ล้มเหลวหรือหมดเวลา ระบบคืนเครดิตทันที ไม่ต้องแจ้งทีมงาน</p>
            </div>
            <div>
              <span>◈</span>
              <h3>ชำระผ่าน XMAN Studio</h3>
              <p>คำสั่งซื้อและการยืนยันยอดชำระทั้งหมดอยู่บนระบบของ xman4289.com</p>
            </div>
            <div>
              <span>✦</span>
              <h3>บัญชีเดียวกัน</h3>
              <p>ใช้บัญชี XMAN Studio เข้าได้ทันที เครดิตใช้ได้ทั้งสตูดิโอ โหมดหนัง/MV และ API</p>
            </div>
          </div>

          <div className="prc-wallet">
            <Image src="/pricing-art/tier-2.webp" alt="" width={64} height={64} />
            <div>
              <h3>จ่ายด้วย Wallet ของ XMAN Studio</h3>
              {wallet ? (
                <p>
                  {wallet.hasWallet
                    ? <>ยอด Wallet คงเหลือ <b>฿{fmt(wallet.balance)}</b> · เครดิต AI <b>{fmt(wallet.credits)}</b></>
                    : <>บัญชีนี้ยังไม่มี Wallet · เครดิต AI <b>{fmt(wallet.credits)}</b></>}
                  {wallet.hasWallet && !wallet.isActive && <span className="prc-warn"> · Wallet ถูกระงับ</span>}
                  <br />กด “ซื้อด้วย Wallet” ที่แพ็กเกจ เพื่อหักเงินและรับเครดิตทันที
                </p>
              ) : (
                <p>
                  เติมเงินเข้า Wallet ที่ <a href={XMAN_URL} target="_blank" rel="noopener noreferrer">xman4289.com</a> แล้ว{" "}
                  <Link href="/login?callbackUrl=%2Fpricing">เข้าสู่ระบบ</Link> เพื่อซื้อเครดิตได้ทันทีบนหน้านี้
                </p>
              )}
            </div>
            <a href={`${XMAN_URL}/wallet/topup`} target="_blank" rel="noopener noreferrer" className="prc-btn prc-btn-glass prc-btn-inline">
              เติมเงิน Wallet
            </a>
          </div>
        </section>

        {/* FAQ */}
        <section className="prc-section">
          <div className="prc-eyebrow">คำถามที่พบบ่อย</div>
          <h2 className="prc-h2">มีคำถาม<span className="prc-gold-text">ก่อนซื้อ?</span></h2>
          <div className="prc-faq">
            {FAQ.map((f, n) => (
              <details key={f.q} open={n === 0}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          <p className="prc-note">
            ยังมีข้อสงสัย? <Link href="/contact">ติดต่อทีมงาน</Link> หรืออ่าน{" "}
            <Link href="/terms">เงื่อนไขการใช้งาน</Link>
          </p>
        </section>

        {/* Closing CTA */}
        <section className="prc-final">
          <Image src="/pricing-art/tier-6.webp" alt="" width={120} height={120} className="prc-final-emblem" />
          <h2>พร้อมสร้างผลงานชิ้นต่อไปแล้วหรือยัง?</h2>
          <p>เลือกแพ็กเกจที่ใช่ แล้วเริ่มสร้างภาพ วิดีโอ และเพลงด้วย AI ระดับโลกได้ในไม่กี่นาที</p>
          <div className="prc-final-row">
            <a href="#packages" className="prc-btn prc-btn-gold prc-btn-inline">เลือกแพ็กเกจ</a>
            <Link href="/generate" className="prc-btn prc-btn-glass prc-btn-inline">เปิดสตูดิโอ</Link>
          </div>
        </section>
      </div>

      {/* Phone: the chosen package stays in reach while scrolling */}
      {selectedPkg && (
        <div className="prc-bar" role="region" aria-label="แพ็กเกจที่เลือก">
          <Image src={`/pricing-art/tier-${emblems[packages.indexOf(selectedPkg)] + 1}.webp`} alt="" width={44} height={44} />
          <div className="prc-bar-copy">
            <b>{selectedPkg.name}</b>
            <span>{fmt(totalCredits(selectedPkg))} เครดิต · {priceLabel(selectedPkg)}</span>
          </div>
          <a href={checkoutHref(selectedPkg.slug)} className="prc-btn prc-btn-gold prc-btn-inline">ซื้อเลย</a>
          <button type="button" className="prc-bar-x" aria-label="ปิด" onClick={() => setSelected(null)}>×</button>
        </div>
      )}

      {notice && (
        <div className="prc-toast" role="status" data-ok={notice.ok || undefined} data-bar={selectedPkg ? "true" : undefined}>
          <span>{notice.text}</span>
          <button type="button" aria-label="ปิดข้อความ" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {confirming && (
        <div className="prc-modal" onClick={() => { if (!buying) setConfirming(null); }}>
          <div className="prc-modal-card" role="dialog" aria-modal="true" aria-labelledby="prc-modal-title"
            onClick={e => e.stopPropagation()}>
            <Image src={`/pricing-art/tier-${emblems[packages.indexOf(confirming.pkg)] + 1}.webp`} alt="" width={96} height={96} className="prc-modal-emblem" />
            <h3 id="prc-modal-title">ยืนยันซื้อด้วย Wallet</h3>
            <dl>
              <div><dt>แพ็กเกจ</dt><dd>{confirming.pkg.name}</dd></div>
              <div><dt>เครดิตที่ได้รับ</dt><dd>{fmt(totalCredits(confirming.pkg))} เครดิต{confirming.pkg.bonusCredits > 0 && <small> (รวมโบนัส {fmt(confirming.pkg.bonusCredits)})</small>}</dd></div>
              <div><dt>หักจาก Wallet</dt><dd className="prc-gold-text">฿{fmt(priceOf(confirming.pkg))}</dd></div>
              {wallet && <div><dt>Wallet คงเหลือหลังซื้อ</dt><dd>฿{fmt(wallet.balance - priceOf(confirming.pkg))}</dd></div>}
            </dl>
            <div className="prc-modal-row">
              <button type="button" className="prc-btn prc-btn-glass" disabled={buying !== null} onClick={() => setConfirming(null)}>ยกเลิก</button>
              <button type="button" className="prc-btn prc-btn-gold" autoFocus disabled={buying !== null} onClick={confirmWalletPurchase}>
                {buying ? "กำลังซื้อ…" : `ยืนยัน ชำระ ฿${fmt(priceOf(confirming.pkg))}`}
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
          .prc-emblem, .prc-final-emblem, .prc-skel { animation: none; }
          .prc-card, .prc-btn { transition: none; }
        }
      `}</style>
    </div>
  );
}
