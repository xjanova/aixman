"use client";

/**
 * /tpix — the XMAN AI × TPIX Chain partner campaign: buy AI credit packages
 * with TPIX coin, at a discount, from a real wallet on this page.
 *
 * TPIX Chain only (chain id 4289). The money is xmanstudio's TPIX Pay:
 *   1. `POST /api/tpix/orders` — xmanstudio makes the order with the TPIX
 *      discount and quotes an exact TPIX amount, held for its TTL;
 *   2. the wallet sends exactly that amount to the shop's address — only after
 *      this page has re-read the wallet's chain and found TPIX Chain;
 *   3. `POST /api/tpix/payments/{ref}/tx` points xmanstudio at the
 *      transaction; it verifies it on the chain itself and pays the order once
 *      it has enough confirmations, and the credits arrive through the usual
 *      `/api/webhooks/xman-credit`. A transfer made from another wallet app is
 *      found by its exact amount without step 3.
 * Prices and credits come from `/api/packages`; the discount and the THB→TPIX
 * rate from xmanstudio (`/api/tpix/info`). Nothing here is the price of record:
 * the quote is.
 *
 * Coin logo: TPIX's official mark (tpix.online). Background art made with
 * ChatGPT for this page (public/tpix/CREDITS.md).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";

import { emblemIndexes, priceOf, recommendedIndex, totalCredits } from "@/lib/pricing-display";
import {
  TPIX_CHAIN,
  TPIX_LINKS,
  addChainParams,
  discountedThb,
  estimateTpix,
  isAddress,
  isTpixChain,
  isTxHash,
  parseWeiHex,
  shortAddress,
  TPIX_CAMPAIGN_DISCOUNT,
  tpixToWei,
  weiToHex,
  weiToTpix,
} from "@/lib/tpix/chain";
import type { TpixPaymentStatus, TpixQuote } from "@/lib/tpix/quote";
import { useLocale, useT } from "@/lib/i18n/client";
import { formatCredits, formatNumber, formatThb, type Msg, type Translate } from "@/lib/i18n/locale";
import { packageLabel } from "@/lib/i18n/package-text";

const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";
const COIN = "/tpix/tpix-coin.webp";
const METAMASK_DAPP = "https://metamask.app.link/dapp/ai.xman4289.com/tpix";

interface Package {
  id: number;
  name: string;
  slug: string;
  credits: number;
  bonusCredits: number;
  priceThb: number | string;
  badge: string | null;
  isFeatured: boolean;
}

interface Market {
  canBuy: boolean;
  paymentsEnabled: boolean;
  discountPercent: number | null;
  rateThb: string | null;
  updatedAt: string | null;
}

interface Wallet {
  address: string;
  chainOk: boolean;
  balanceWei: bigint | null;
}

type Step = "quoting" | "pay" | "sending" | "confirming" | "paid" | "expired" | "review" | "error";

interface Flow {
  pkg: Package;
  step: Step;
  quote?: TpixQuote;
  /** Local clock deadline of the quote (ms). */
  deadline?: number;
  status?: TpixPaymentStatus;
  message?: string;
  txHash?: string;
}

// ─── wallet (EIP-1193), outside the component: each owns its try/catch ─────

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

function injected(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
}

/** Some wallets inject a moment after the page loads and say so with this event. */
function onProviderInjected(cb: () => void): () => void {
  window.addEventListener("ethereum#initialized", cb);
  return () => window.removeEventListener("ethereum#initialized", cb);
}
const providerPresent = () => injected() !== null;
const providerUnknown = () => null;

function errorCode(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const o = e as { code?: unknown; data?: { originalError?: { code?: unknown } } };
  const c = o.code ?? o.data?.originalError?.code;
  return typeof c === "number" ? c : null;
}

function walletMessage(e: unknown, fallback: string, t: Translate): string {
  const code = errorCode(e);
  if (code === 4001) return t("คุณยกเลิกรายการในกระเป๋า", "You cancelled the request in your wallet.");
  if (code === -32002) {
    return t("กระเป๋ามีคำขอค้างอยู่ เปิดกระเป๋าเพื่อตอบคำขอนั้นก่อน", "Your wallet has a pending request. Open your wallet and answer it first.");
  }
  return fallback;
}

type Done<T> = ({ ok: true } & T) | { ok: false; message: string };

async function readWallet(p: Eip1193, ask: boolean, t: Translate): Promise<Done<{ wallet: Wallet | null }>> {
  try {
    const accounts = (await p.request({ method: ask ? "eth_requestAccounts" : "eth_accounts" })) as unknown[];
    const address = Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0] : null;
    if (!address) return { ok: true, wallet: null };
    const chainOk = isTpixChain(await p.request({ method: "eth_chainId" }));
    let balanceWei: bigint | null = null;
    if (chainOk) balanceWei = parseWeiHex(await p.request({ method: "eth_getBalance", params: [address, "latest"] }));
    return { ok: true, wallet: { address, chainOk, balanceWei } };
  } catch (e) {
    return { ok: false, message: walletMessage(e, t("เชื่อมกระเป๋าไม่สำเร็จ กรุณาลองใหม่", "Couldn't connect your wallet. Please try again."), t) };
  }
}

/** Switch to TPIX Chain, adding it first when the wallet does not know it; true only when the wallet then says 4289. */
async function switchToTpix(p: Eip1193, t: Translate): Promise<Done<object>> {
  try {
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: TPIX_CHAIN.hex }] });
    } catch (e) {
      const code = errorCode(e);
      // 4902 = unknown chain; some mobile wallets answer -32603 for the same thing
      if (code !== 4902 && code !== -32603) throw e;
      await p.request({ method: "wallet_addEthereumChain", params: [addChainParams()] });
    }
    if (!isTpixChain(await p.request({ method: "eth_chainId" }))) {
      return {
        ok: false,
        message: t(
          "กระเป๋ายังไม่ได้สลับเป็น TPIX Chain กรุณาสลับเครือข่ายในกระเป๋าแล้วลองอีกครั้ง",
          "Your wallet hasn't switched to TPIX Chain. Switch networks in your wallet and try again.",
        ),
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: walletMessage(
        e,
        t("สลับเป็น TPIX Chain ไม่สำเร็จ กรุณาสลับเครือข่ายในกระเป๋าเอง", "Couldn't switch to TPIX Chain. Please switch networks in your wallet yourself."),
        t,
      ),
    };
  }
}

/**
 * Send exactly the quoted wei to the quoted address. The chain is read again
 * right before sending and the transaction names chainId 4289 too, so a wallet
 * that slipped back to another network refuses instead of paying there.
 */
async function sendQuote(p: Eip1193, quote: TpixQuote, t: Translate): Promise<Done<{ hash: string }>> {
  let value: string;
  try {
    if (tpixToWei(quote.amountTpix) !== BigInt(quote.amountWei)) throw new Error("mismatch");
    value = weiToHex(BigInt(quote.amountWei));
  } catch {
    return { ok: false, message: t("ยอดชำระไม่ถูกต้อง กรุณาขอยอดใหม่", "The payment amount is invalid. Please get a new quote.") };
  }

  const switched = await switchToTpix(p, t);
  if (!switched.ok) return switched;

  try {
    const accounts = (await p.request({ method: "eth_requestAccounts" })) as unknown[];
    const from = Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0] : null;
    if (!from) return { ok: false, message: t("ไม่พบบัญชีในกระเป๋า", "No account found in your wallet.") };
    if (!isTpixChain(await p.request({ method: "eth_chainId" }))) {
      return {
        ok: false,
        message: t(
          "กระเป๋าไม่ได้อยู่บน TPIX Chain จึงยังไม่ส่ง เพื่อไม่ให้เหรียญไปผิดเครือข่าย",
          "Your wallet isn't on TPIX Chain, so nothing was sent. Your coins won't go to the wrong network.",
        ),
      };
    }
    const hash = await p.request({
      method: "eth_sendTransaction",
      params: [{ from, to: quote.receiveAddress, value, chainId: TPIX_CHAIN.hex }],
    });
    if (!isTxHash(hash)) {
      return {
        ok: false,
        message: t(
          "กระเป๋าไม่ได้ส่งเลขธุรกรรมกลับมา ถ้าโอนไปแล้ว วางเลขธุรกรรมด้านล่างได้",
          "Your wallet didn't return a transaction hash. If you already sent the coins, paste the hash below.",
        ),
      };
    }
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, message: walletMessage(e, t("ส่งเหรียญไม่สำเร็จ กรุณาลองใหม่ในกระเป๋า", "Couldn't send the coins. Please try again in your wallet."), t) };
  }
}

// ─── our API ────────────────────────────────────────────────────────────────

/** The quote, and when it arrived by this clock (its countdown starts there). */
async function requestQuote(slug: string, t: Translate): Promise<Done<{ quote: TpixQuote; receivedAt: number }> & { status?: number }> {
  try {
    const res = await fetch("/api/tpix/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageSlug: slug }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.quote) {
      return { ok: false, status: res.status, message: data.error || t("ขอยอดชำระไม่สำเร็จ กรุณาลองใหม่", "Couldn't get a payment amount. Please try again.") };
    }
    return { ok: true, quote: data.quote as TpixQuote, receivedAt: Date.now() };
  } catch {
    return { ok: false, message: t("เชื่อมต่อไม่ได้ กรุณาลองใหม่", "Couldn't connect. Please try again.") };
  }
}

async function fetchStatus(ref: string): Promise<TpixPaymentStatus | null> {
  try {
    const res = await fetch(`/api/tpix/payments/${encodeURIComponent(ref)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.status as TpixPaymentStatus) ?? null;
  } catch {
    return null;
  }
}

async function postTx(ref: string, txHash: string, t: Translate): Promise<Done<{ message: string; status: TpixPaymentStatus | null }>> {
  try {
    const res = await fetch(`/api/tpix/payments/${encodeURIComponent(ref)}/tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || t("ส่งเลขธุรกรรมไม่สำเร็จ", "Couldn't submit the transaction hash.") };
    return { ok: true, message: data.message || "", status: (data.status as TpixPaymentStatus) ?? null };
  } catch {
    return { ok: false, message: t("เชื่อมต่อไม่ได้ กรุณาลองใหม่", "Couldn't connect. Please try again.") };
  }
}

/** Which step a status from xmanstudio puts the flow on. */
function stepFor(st: TpixPaymentStatus, current: Step): Step {
  if (st.settled) return "paid";
  switch (st.status) {
    case "confirming":
      return "confirming";
    case "held":
    case "late":
      return "review";
    case "expired":
      return "expired";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return current;
  }
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

const STEPS: { t: Msg; d: Msg }[] = [
  {
    t: { th: "เชื่อมกระเป๋า", en: "Connect your wallet" },
    d: {
      th: "MetaMask, OKX, Trust, Rabby หรือกระเป๋า EVM อื่น ระบบเพิ่มและสลับเป็น TPIX Chain ให้",
      en: "MetaMask, OKX, Trust, Rabby or any other EVM wallet. We add TPIX Chain and switch to it for you.",
    },
  },
  {
    t: { th: "เลือกแพ็กเกจ", en: "Choose a package" },
    d: {
      th: "ระบบล็อกยอดเป็น TPIX ตามราคาตลาดจริงหลังหักส่วนลด ยอดนั้นใช้ได้ 30 นาที",
      en: "We lock the TPIX amount at the live market price after the discount. That amount is valid for 30 minutes.",
    },
  },
  {
    t: { th: "ยืนยันในกระเป๋า", en: "Confirm in your wallet" },
    d: { th: "กดยืนยันการโอนครั้งเดียว ค่าแก๊สบน TPIX Chain เป็น 0", en: "Approve a single transfer. Gas on TPIX Chain is 0." },
  },
  {
    t: { th: "เครดิตเข้าอัตโนมัติ", en: "Credits arrive automatically" },
    d: {
      th: "ระบบตรวจธุรกรรมบนเชนเอง เมื่อยืนยันครบ เครดิตเข้าบัญชีทันที",
      en: "We check the transaction on the chain ourselves. Once it's confirmed, your credits arrive right away.",
    },
  },
];

const FACTS: { k: Msg; v: Msg | string; d: Msg }[] = [
  {
    k: { th: "เหรียญหลัก", en: "Native coin" },
    v: "TPIX",
    d: { th: "เหรียญประจำ TPIX Chain ใช้จ่ายค่าธรรมเนียมและชำระค่าบริการ", en: "TPIX Chain's own coin, used for network fees and payments." },
  },
  {
    k: { th: "เครือข่าย", en: "Network" },
    v: "Chain ID 4289",
    d: { th: "บล็อกเชน EVM ใช้กระเป๋าแบบเดียวกับ Ethereum ได้", en: "An EVM blockchain that works with the same wallets as Ethereum." },
  },
  {
    k: { th: "ค่าแก๊ส", en: "Gas fee" },
    v: "0",
    d: { th: "โอนเหรียญบนเชนได้โดยไม่เสียค่าแก๊ส", en: "Send coins on the chain without paying gas." },
  },
  {
    k: { th: "ความเร็ว", en: "Speed" },
    v: { th: "~2 วินาที", en: "~2 sec" },
    d: { th: "ต่อหนึ่งบล็อก ยืนยันการชำระได้ในไม่กี่วินาที", en: "per block, so payments confirm in seconds." },
  },
];

const FAQ: { q: Msg; a: Msg }[] = [
  {
    q: { th: "ส่วนลดได้อย่างไร ต้องกรอกโค้ดไหม?", en: "How do I get the discount? Do I need a code?" },
    a: {
      th: "ไม่ต้องกรอกโค้ด ส่วนลดหักให้อัตโนมัติทุกแพ็กเกจเมื่อชำระด้วยเหรียญ TPIX ราคาที่เห็นบนการ์ดคือราคาหลังหักแล้ว ส่วนการชำระด้วย PromptPay โอนธนาคาร หรือ Wallet ใช้ราคาปกติ",
      en: "No code needed. The discount is taken off every package automatically when you pay with TPIX coin, and the prices on the cards already include it. PromptPay, bank transfer and Wallet payments use the regular price.",
    },
  },
  {
    q: { th: "ต้องโอนบนเครือข่ายไหน?", en: "Which network do I send on?" },
    a: {
      th: "TPIX Chain (Chain ID 4289) เท่านั้น ห้ามโอนจากเครือข่ายอื่นเช่น BSC หรือ Ethereum เหรียญที่โอนผิดเครือข่ายจะไม่ถึงร้านและเรียกคืนไม่ได้ ปุ่ม “ชำระด้วยกระเป๋า” สลับเครือข่ายให้และจะไม่ส่งถ้ากระเป๋าไม่ได้อยู่บน TPIX Chain",
      en: "TPIX Chain (Chain ID 4289) only. Never send from another network such as BSC or Ethereum: coins sent on the wrong network never reach the shop and can't be recovered. The “Pay with wallet” button switches the network for you and won't send unless your wallet is on TPIX Chain.",
    },
  },
  {
    q: { th: "ทำไมยอด TPIX มีทศนิยมหลายหลัก?", en: "Why does the TPIX amount have so many decimals?" },
    a: {
      th: "ทศนิยมท้าย ๆ คือรหัสประจำรายการของคุณ ระบบใช้ยอดที่ตรงทุกหลักจับคู่การโอนกับคำสั่งซื้อ ถ้าโอนเองจากแอปอื่น ให้คัดลอกยอดไปวางทั้งตัวเลข อย่าปัดเศษ",
      en: "The last decimals are your order's own code: we match each transfer to its order by the exact amount. If you send from another app, copy and paste the whole number. Don't round it.",
    },
  },
  {
    q: { th: "ราคา TPIX มาจากไหน?", en: "Where does the TPIX price come from?" },
    a: {
      th: "จากพูล TPIX/USDT บน TPIX DEX คูณอัตราแลกเปลี่ยนดอลลาร์เป็นบาทแบบสด ระบบใช้ค่าที่ต่ำกว่าระหว่างราคาตอนนี้กับค่าเฉลี่ย 30 นาที เพื่อไม่ให้ราคาที่ถูกปั่นชั่วครู่มีผลกับยอดชำระ",
      en: "From the TPIX/USDT pool on TPIX DEX, times the live dollar-to-baht rate. We use the lower of the current price and the 30-minute average, so a brief price manipulation can't affect what you pay.",
    },
  },
  {
    q: { th: "จ่ายแล้วเครดิตเข้าเมื่อไร?", en: "When do my credits arrive?" },
    a: {
      th: "เมื่อธุรกรรมได้รับการยืนยันบนเชนครบตามที่ระบบกำหนด (ปกติไม่กี่วินาที) ระบบจะชำระคำสั่งซื้อและเติมเครดิตเข้าบัญชีอัตโนมัติ ปิดหน้านี้ไปก่อนก็ได้ ระบบตรวจต่อเอง",
      en: "Once the transaction has enough confirmations on the chain (usually a few seconds), we pay the order and add your credits automatically. You can close this page; we keep checking.",
    },
  },
  {
    q: { th: "ถ้าโอนช้าเกิน 30 นาที หรือโอนยอดไม่ตรง?", en: "What if I send after 30 minutes, or send the wrong amount?" },
    a: {
      th: "ระบบยังตรวจพบการโอนที่มาช้า และพักรายการไว้ให้แอดมินตรวจ ไม่ได้หายไปไหน แต่จะไม่เติมเครดิตอัตโนมัติ ทางที่ง่ายที่สุดคือกด “ขอยอดใหม่” แล้วโอนตามยอดใหม่ภายในเวลา",
      en: "We still detect a late transfer and hold it for an admin to review, so nothing is lost, but credits aren't added automatically. The easiest way is to tap “Get a new quote” and send the new amount in time.",
    },
  },
];

export default function TpixCampaignPage() {
  const t = useT();
  const { locale } = useLocale();
  const fmtInt = (n: number) => formatNumber(Math.round(n), locale);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<Market | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  /** null until the browser is asked (server render and hydration). */
  const hasProvider = useSyncExternalStore(onProviderInjected, providerPresent, providerUnknown);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletNote, setWalletNote] = useState<string | null>(null);

  const [flow, setFlow] = useState<Flow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [manual, setManual] = useState(false);
  const [txInput, setTxInput] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/packages")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list: Package[] = Array.isArray(d.packages) ? d.packages : [];
        setPackages(list.filter((p) => priceOf(p) > 0));
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    fetch("/api/tpix/info")
      .then((r) => r.json())
      .then((d) => alive && setMarket(d as Market))
      .catch(() => alive && setMarket({ canBuy: false, paymentsEnabled: false, discountPercent: null, rateThb: null, updatedAt: null }));
    fetch("/api/credits/wallet")
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 401) {
          setLoggedIn(false);
          return;
        }
        const d = await r.json();
        setLoggedIn(true);
        setCredits(typeof d.credits === "number" ? d.credits : null);
      })
      .catch(() => alive && setLoggedIn(false));
    return () => {
      alive = false;
    };
  }, []);

  const refreshWallet = useCallback(async (ask: boolean) => {
    const p = injected();
    if (!p) return;
    const r = await readWallet(p, ask, t);
    if (r.ok) {
      setWallet(r.wallet);
      setWalletNote(null);
    } else if (ask) {
      setWalletNote(r.message);
    }
  }, [t]);

  // A wallet the customer already allowed reconnects silently; changes in the wallet show at once
  useEffect(() => {
    const p = injected();
    if (!p) return;
    let alive = true;
    readWallet(p, false, t).then((r) => {
      if (alive && r.ok) setWallet(r.wallet);
    });
    const onChange = () => {
      refreshWallet(false);
    };
    p.on?.("accountsChanged", onChange);
    p.on?.("chainChanged", onChange);
    return () => {
      alive = false;
      p.removeListener?.("accountsChanged", onChange);
      p.removeListener?.("chainChanged", onChange);
    };
  }, [refreshWallet, hasProvider, t]);

  const connect = async () => {
    const p = injected();
    if (!p) {
      setWalletNote(t("ไม่พบกระเป๋าในเบราว์เซอร์นี้", "No wallet found in this browser."));
      return;
    }
    setWalletBusy(true);
    await refreshWallet(true);
    setWalletBusy(false);
  };

  const switchChain = async () => {
    const p = injected();
    if (!p) return;
    setWalletBusy(true);
    const r = await switchToTpix(p, t);
    if (!r.ok) setWalletNote(r.message);
    await refreshWallet(false);
    setWalletBusy(false);
  };

  const discount = market?.discountPercent ?? TPIX_CAMPAIGN_DISCOUNT;
  const rate = market?.rateThb ? Number(market.rateThb) : null;
  const canBuy = !!market?.canBuy;

  const emblems = useMemo(() => emblemIndexes(packages), [packages]);
  const recommended = useMemo(() => recommendedIndex(packages), [packages]);

  // ── the payment flow ──────────────────────────────────────────────────────

  const startQuote = async (pkg: Package) => {
    if (busy.current) return;
    busy.current = true;
    setManual(false);
    setTxInput("");
    setFlow({ pkg, step: "quoting" });
    const r = await requestQuote(pkg.slug, t);
    busy.current = false;
    if (!r.ok) {
      if (r.status === 401) setLoggedIn(false);
      setFlow({ pkg, step: "error", message: r.message });
      return;
    }
    setNow(r.receivedAt);
    setFlow({ pkg, step: "pay", quote: r.quote, deadline: r.receivedAt + r.quote.secondsLeft * 1000 });
  };

  const applyStatus = useCallback((st: TpixPaymentStatus | null) => {
    if (!st) return;
    setFlow((f) => {
      if (!f || !f.quote || f.quote.reference !== st.reference) return f;
      const step = stepFor(st, f.step);
      return {
        ...f,
        status: st,
        step,
        message: step === "error" ? st.label || t("รายการนี้ไม่สำเร็จ", "This payment didn't go through.") : f.message,
      };
    });
  }, [t]);

  const pay = async () => {
    const quote = flow?.quote;
    const p = injected();
    if (!quote || busy.current) return;
    if (!p) {
      window.location.assign(METAMASK_DAPP);
      return;
    }
    busy.current = true;
    setFlow((f) => (f ? { ...f, step: "sending", message: undefined } : f));
    const sent = await sendQuote(p, quote, t);
    if (!sent.ok) {
      busy.current = false;
      setFlow((f) => (f ? { ...f, step: "pay", message: sent.message } : f));
      return;
    }
    setFlow((f) => (f ? { ...f, step: "confirming", txHash: sent.hash } : f));
    const posted = await postTx(quote.reference, sent.hash, t);
    busy.current = false;
    // Not reaching the server is not fatal: the scanner finds the transfer by its exact amount
    if (posted.ok) applyStatus(posted.status);
    else {
      const note = t(
        `${posted.message} — ระบบยังตรวจหาการโอนนี้จากยอดเองอยู่`,
        `${posted.message} — we're still looking for this transfer by its amount.`,
      );
      setFlow((f) => (f ? { ...f, message: note } : f));
    }
    refreshWallet(false);
  };

  const submitManualTx = async () => {
    const quote = flow?.quote;
    const hash = txInput.trim();
    if (!quote || busy.current) return;
    if (!isTxHash(hash)) {
      const note = t("เลขธุรกรรมต้องขึ้นต้นด้วย 0x ตามด้วยตัวอักษร 64 ตัว", "A transaction hash starts with 0x followed by 64 characters.");
      setFlow((f) => (f ? { ...f, message: note } : f));
      return;
    }
    busy.current = true;
    const posted = await postTx(quote.reference, hash, t);
    busy.current = false;
    if (!posted.ok) {
      setFlow((f) => (f ? { ...f, message: posted.message } : f));
      return;
    }
    setFlow((f) => (f ? { ...f, txHash: hash, message: posted.message || undefined, step: f.step === "pay" ? "confirming" : f.step } : f));
    applyStatus(posted.status);
  };

  // Watch the quote: every few seconds while confirming, less often while waiting for a transfer
  const watching = flow?.quote && (flow.step === "pay" || flow.step === "confirming" || flow.step === "expired") ? flow.quote.reference : null;
  const fast = flow?.step === "confirming";
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    const tick = async () => {
      const st = await fetchStatus(watching);
      if (alive) applyStatus(st);
    };
    const id = window.setInterval(tick, fast ? 4000 : 9000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [watching, fast, applyStatus]);

  // The countdown
  const counting = flow?.step === "pay" || flow?.step === "sending";
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [counting]);

  // Once paid: the new balance, and the wallet's
  const paidRef = flow?.step === "paid" ? flow.quote?.reference : null;
  useEffect(() => {
    if (!paidRef) return;
    fetch("/api/credits/wallet")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && typeof d.credits === "number" && setCredits(d.credits))
      .catch(() => {});
  }, [paidRef]);

  const closeFlow = useCallback(() => {
    if (flow?.step === "sending" || busy.current) return;
    setFlow(null);
  }, [flow?.step]);

  useEffect(() => {
    if (!flow) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeFlow();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow, closeFlow]);

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(label);
        window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1600);
      },
      () => {},
    );
  };

  const secondsLeft = flow?.deadline ? Math.max(0, Math.round((flow.deadline - now) / 1000)) : 0;
  const timedOut = flow?.step === "pay" && !!flow.deadline && secondsLeft === 0;

  // ── pieces ────────────────────────────────────────────────────────────────

  const balanceFor = (needTpix: number | null) => {
    if (!wallet?.chainOk || wallet.balanceWei === null || needTpix === null) return null;
    const need = tpixToWei(needTpix.toFixed(2));
    return wallet.balanceWei >= need
      ? { ok: true, text: t("ยอดในกระเป๋าพอ", "Your wallet has enough") }
      : {
        ok: false,
        text: t(`ขาดอีกประมาณ ${weiToTpix(need - wallet.balanceWei, 2)} TPIX`, `About ${weiToTpix(need - wallet.balanceWei, 2)} TPIX short`),
      };
  };

  const buyButton = (pkg: Package, rec: boolean) => {
    if (!canBuy) {
      return <span className="tpx-btn tpx-btn-off">{t("เปิดให้ชำระเร็ว ๆ นี้", "Opening soon")}</span>;
    }
    if (loggedIn === false) {
      return (
        <Link href="/login?callbackUrl=%2Ftpix" className={`tpx-btn ${rec ? "tpx-btn-main" : "tpx-btn-glass"}`}>
          {t("เข้าสู่ระบบเพื่อซื้อ", "Sign in to buy")}
        </Link>
      );
    }
    return (
      <button type="button" className={`tpx-btn ${rec ? "tpx-btn-main" : "tpx-btn-glass"}`} onClick={() => startQuote(pkg)}>
        <Image src={COIN} alt="" width={20} height={20} /> {t("ซื้อด้วย TPIX", "Buy with TPIX")}
      </button>
    );
  };

  const walletPanel = (
    <div className="tpx-wallet" id="wallet">
      <div className="tpx-wallet-head">
        <Image src={COIN} alt="TPIX" width={40} height={40} />
        <div>
          <b>{t("กระเป๋าของคุณ", "Your wallet")}</b>
          <span>{t("รองรับเฉพาะ TPIX Chain (Chain ID 4289)", "TPIX Chain only (Chain ID 4289)")}</span>
        </div>
      </div>

      {hasProvider === false ? (
        <div className="tpx-wallet-body">
          <p>
            {t(
              "เบราว์เซอร์นี้ไม่มีกระเป๋าคริปโต เปิดหน้านี้ในแอปกระเป๋า หรือติดตั้งส่วนขยายกระเป๋าก่อน",
              "This browser has no crypto wallet. Open this page in a wallet app, or install a wallet extension first.",
            )}
          </p>
          <div className="tpx-row">
            <a className="tpx-btn tpx-btn-main" href={METAMASK_DAPP}>{t("เปิดในแอป MetaMask", "Open in MetaMask")}</a>
            <a className="tpx-btn tpx-btn-glass" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
              {t("ติดตั้ง MetaMask", "Install MetaMask")}
            </a>
          </div>
          <small>
            {t(
              "หรือเปิด ai.xman4289.com/tpix ในเบราว์เซอร์ของ OKX, Trust, Bitget Wallet",
              "Or open ai.xman4289.com/tpix in the browser of OKX, Trust or Bitget Wallet",
            )}
          </small>
        </div>
      ) : !wallet ? (
        <div className="tpx-wallet-body">
          <p>
            {t(
              "เชื่อมกระเป๋าเพื่อดูยอด TPIX และจ่ายได้ในหน้านี้ ระบบไม่ขอสิทธิ์ใช้เหรียญของคุณ ทุกการโอนต้องกดยืนยันในกระเป๋าเอง",
              "Connect your wallet to see your TPIX balance and pay on this page. We never ask for permission to spend your coins; you approve every transfer in your wallet.",
            )}
          </p>
          <button type="button" className="tpx-btn tpx-btn-main" onClick={connect} disabled={walletBusy || hasProvider === null}>
            {walletBusy ? t("กำลังเชื่อม…", "Connecting…") : t("เชื่อมกระเป๋า", "Connect wallet")}
          </button>
        </div>
      ) : (
        <div className="tpx-wallet-body">
          <div className="tpx-wallet-line">
            <span className="tpx-addr" title={wallet.address}>{shortAddress(wallet.address)}</span>
            <span className={`tpx-net ${wallet.chainOk ? "ok" : "bad"}`}>{wallet.chainOk ? "TPIX Chain" : t("เครือข่ายอื่น", "Other network")}</span>
          </div>
          {wallet.chainOk ? (
            <div className="tpx-balance">
              <span>{t("ยอดคงเหลือ", "Balance")}</span>
              <b>{wallet.balanceWei === null ? "—" : weiToTpix(wallet.balanceWei, 2)} <em>TPIX</em></b>
              {wallet.balanceWei !== null && rate ? (
                <small>≈ {formatThb(Number(weiToTpix(wallet.balanceWei, 2).replace(/,/g, "")) * rate, locale)}</small>
              ) : null}
            </div>
          ) : (
            <button type="button" className="tpx-btn tpx-btn-main" onClick={switchChain} disabled={walletBusy}>
              {walletBusy ? t("กำลังสลับ…", "Switching…") : t("สลับเป็น TPIX Chain", "Switch to TPIX Chain")}
            </button>
          )}
        </div>
      )}
      {walletNote ? <p className="tpx-note-err">{walletNote}</p> : null}
    </div>
  );

  // ── page ──────────────────────────────────────────────────────────────────

  return (
    <div className="tpx-page">
      <section className="tpx-hero">
        {/* The art keeps its own 3:2 box so the coin sits in its ring at every width */}
        <div className="tpx-art">
          <Image src="/tpix/hero-v1.webp" alt="" fill priority sizes="(max-width: 760px) 600px, 1200px" />
          <div className="tpx-hero-coin" aria-hidden="true">
            <div className="tpx-coin-glow" />
            <Image src={COIN} alt="" width={300} height={300} className="tpx-coin" priority />
            {discount > 0 ? (
              <div className="tpx-sticker">
                <small>{t("ลด", "Save")}</small>
                <b>{discount}%</b>
              </div>
            ) : null}
          </div>
        </div>
        <div className="tpx-hero-shade" />
        <div className="tpx-hero-inner">
          <div className="tpx-hero-copy">
            <div className="tpx-lockup">
              <span>XMAN AI</span>
              <i>×</i>
              <Image src={COIN} alt="" width={22} height={22} />
              <span>TPIX Chain</span>
            </div>
            <p className="tpx-eyebrow">{t("แคมเปญพาร์ทเนอร์ · Partner Campaign", "Partner campaign")}</p>
            <h1>
              {t(
                <>จ่ายด้วยเหรียญ <span className="tpx-grad">TPIX</span></>,
                <>Pay with <span className="tpx-grad">TPIX</span> coin</>,
              )}
              {discount > 0 ? (
                <>
                  <br />
                  {t(
                    <>ลดทันที <span className="tpx-grad tpx-big">{discount}%</span></>,
                    <><span className="tpx-grad tpx-big">{discount}%</span> off instantly</>,
                  )}
                </>
              ) : null}
            </h1>
            <p className="tpx-sub">
              {t(
                "ซื้อเครดิต AI ทุกแพ็กเกจด้วยเหรียญ TPIX บน TPIX Chain เชื่อมกระเป๋าแล้วจ่ายได้ในหน้านี้ ค่าแก๊ส 0 เครดิตเข้าอัตโนมัติเมื่อยืนยันบนเชน",
                "Buy any AI credit package with TPIX coin on TPIX Chain. Connect your wallet and pay right here with zero gas. Credits arrive automatically once the payment is confirmed on the chain.",
              )}
            </p>
            <div className="tpx-row">
              <a href="#packages" className="tpx-btn tpx-btn-main tpx-btn-lg">{t("เลือกแพ็กเกจ", "Choose a package")}</a>
              {wallet ? null : (
                <button type="button" className="tpx-btn tpx-btn-glass tpx-btn-lg" onClick={connect} disabled={walletBusy}>
                  {t("เชื่อมกระเป๋า", "Connect wallet")}
                </button>
              )}
            </div>
            <div className="tpx-hero-links">
              <a href={TPIX_LINKS.whitepaper} target="_blank" rel="noopener noreferrer">
                {t("TPIX คืออะไร? อ่านไวท์เปเปอร์ ↗", "What is TPIX? Read the whitepaper ↗")}
              </a>
              <a href={TPIX_LINKS.tokenSale} target="_blank" rel="noopener noreferrer">{t("ยังไม่มีเหรียญ? ซื้อ TPIX ↗", "No coins yet? Buy TPIX ↗")}</a>
            </div>
          </div>
        </div>
      </section>

      <div className="tpx-wrap">
        {market && !canBuy ? (
          <div className="tpx-soon">
            <b>{t("เปิดให้ชำระด้วย TPIX เร็ว ๆ นี้", "TPIX payments open soon")}</b>
            <span>
              {t(
                <>ระหว่างนี้ซื้อแพ็กเกจด้วย PromptPay โอนธนาคาร หรือ Wallet ได้ที่ <Link href="/pricing">หน้าแพ็กเกจ</Link> และเตรียมเหรียญไว้ได้เลย</>,
                <>Meanwhile, buy a package with PromptPay, bank transfer or Wallet on the <Link href="/pricing">pricing page</Link>, and get your coins ready.</>,
              )}
            </span>
          </div>
        ) : null}

        <div className="tpx-strip">
          <span><Image src={COIN} alt="" width={18} height={18} /> 1 TPIX ≈ {rate ? `฿${formatNumber(rate, locale, { maximumFractionDigits: 4 })}` : "—"}</span>
          <span>{t("ราคาจากพูล TPIX DEX × อัตราแลกเปลี่ยนสด", "Price from the TPIX DEX pool × live exchange rate")}</span>
          <span>{t("ค่าแก๊ส 0 · ยืนยันบนเชนอัตโนมัติ", "Zero gas · Confirmed on-chain automatically")}</span>
          {credits !== null ? <span>{t("เครดิตของคุณ", "Your credits")} <b>{fmtInt(credits)}</b></span> : null}
        </div>

        <section className="tpx-shop" id="packages">
          <h2 className="tpx-h2">
            {t(
              <>เลือกแพ็กเกจ <span className="tpx-grad">ราคา TPIX</span></>,
              <>Packages at <span className="tpx-grad">TPIX prices</span></>,
            )}
          </h2>
          <p className="tpx-lead">
            {t(
              "ราคาบนการ์ดหักส่วนลดแล้ว ยอด TPIX เป็นค่าประมาณ ยอดจริงล็อกตอนกดซื้อ",
              "Card prices include the discount. TPIX amounts are estimates; the exact amount is locked when you buy.",
            )}
          </p>
          {walletPanel}

          {loading ? (
            <div className="tpx-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="tpx-card tpx-skel" />)}</div>
          ) : packages.length === 0 ? (
            <p className="tpx-empty">{t("ยังไม่มีแพ็กเกจเปิดขายในขณะนี้", "No packages are on sale right now.")}</p>
          ) : (
            <div className="tpx-grid" data-n={Math.min(packages.length, 4)}>
              {packages.map((pkg, i) => {
                const price = priceOf(pkg);
                const { discount: off, total } = discountedThb(price, discount);
                const tpix = rate ? estimateTpix(total, rate) : null;
                const rec = i === recommended;
                const bal = balanceFor(tpix);
                return (
                  <article key={pkg.id} className="tpx-card" data-rec={rec ? "true" : undefined}>
                    {rec ? (
                      <span className="tpx-ribbon">{packageLabel(pkg.badge, locale) || t("แนะนำ", "Recommended")}</span>
                    ) : pkg.badge ? (
                      <span className="tpx-tag">{packageLabel(pkg.badge, locale)}</span>
                    ) : null}
                    <Image src={`/pricing-art/tier-${emblems[i] ?? 1}.webp`} alt="" width={88} height={88} className="tpx-emblem" />
                    <h3>{packageLabel(pkg.name, locale)}</h3>
                    <div className="tpx-credits">
                      <b>{fmtInt(totalCredits(pkg))}</b> {t("เครดิต", totalCredits(pkg) === 1 ? "credit" : "credits")}
                      {pkg.bonusCredits > 0 ? <small>{t(`รวมโบนัส ${fmtInt(pkg.bonusCredits)}`, `incl. ${fmtInt(pkg.bonusCredits)} bonus`)}</small> : null}
                    </div>
                    <div className="tpx-price">
                      {off > 0 ? <s>{formatThb(price, locale)}</s> : null}
                      <b>{formatThb(total, locale)}</b>
                      {off > 0 ? <span className="tpx-save">{t(`ประหยัด ${formatThb(off, locale)}`, `Save ${formatThb(off, locale)}`)}</span> : null}
                    </div>
                    <div className="tpx-amount">
                      <Image src={COIN} alt="" width={22} height={22} />
                      <span>
                        {tpix !== null
                          ? `≈ ${formatNumber(tpix, locale, { maximumFractionDigits: 2 })} TPIX`
                          : t("ยอด TPIX แสดงเมื่อราคาพร้อม", "TPIX amount shows once the price is ready")}
                      </span>
                    </div>
                    {bal ? <p className={`tpx-bal ${bal.ok ? "ok" : "low"}`}>{bal.text}</p> : null}
                    {buyButton(pkg, rec)}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="tpx-section">
          <h2 className="tpx-h2">{t("จ่ายด้วย TPIX ใน 4 ขั้นตอน", "Pay with TPIX in 4 steps")}</h2>
          <ol className="tpx-steps">
            {STEPS.map((s, i) => (
              <li key={s.t.th}>
                <span className="tpx-step-n">{i + 1}</span>
                <b>{t(s.t)}</b>
                <p>{t(s.d)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="tpx-section tpx-about">
          <div className="tpx-about-copy">
            <p className="tpx-eyebrow">{t("รู้จักพาร์ทเนอร์", "Meet our partner")}</p>
            <h2 className="tpx-h2">{t("TPIX คืออะไร?", "What is TPIX?")}</h2>
            <p>
              {t(
                "TPIX คือเหรียญหลักของ TPIX Chain บล็อกเชน EVM ที่พัฒนาโดย XMAN Studio สำหรับเศรษฐกิจดิจิทัลในอาเซียน ใช้กระเป๋าแบบเดียวกับ Ethereum โอนได้เร็วและไม่มีค่าแก๊ส รายละเอียดทั้งหมด ทั้งเทคโนโลยีและการจัดสรรเหรียญ อยู่ในไวท์เปเปอร์",
                "TPIX is the native coin of TPIX Chain, an EVM blockchain built by XMAN Studio for ASEAN's digital economy. It works with the same wallets as Ethereum, transfers fast and has no gas fees. The whitepaper covers everything, from the technology to the coin allocation.",
              )}
            </p>
            <div className="tpx-row">
              <a className="tpx-btn tpx-btn-main" href={TPIX_LINKS.whitepaper} target="_blank" rel="noopener noreferrer">{t("อ่านไวท์เปเปอร์ ↗", "Read the whitepaper ↗")}</a>
              <a className="tpx-btn tpx-btn-glass" href={TPIX_LINKS.site} target="_blank" rel="noopener noreferrer">{t("เว็บไซต์ TPIX ↗", "TPIX website ↗")}</a>
              <a className="tpx-btn tpx-btn-glass" href={TPIX_CHAIN.explorer} target="_blank" rel="noopener noreferrer">TPIX Explorer ↗</a>
            </div>
          </div>
          <div className="tpx-facts">
            {FACTS.map((f) => (
              <div key={f.k.th} className="tpx-fact">
                <span>{t(f.k)}</span>
                <b>{t(f.v)}</b>
                <p>{t(f.d)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="tpx-section">
          <h2 className="tpx-h2">{t("ยังไม่มีเหรียญ? ซื้อ TPIX ได้ที่นี่", "No coins yet? Get TPIX here")}</h2>
          <div className="tpx-where">
            <a className="tpx-where-card" href={TPIX_LINKS.tokenSale} target="_blank" rel="noopener noreferrer">
              <span className="tpx-chip">{t("ช่องทางทางการ", "Official")}</span>
              <b>TPIX Public Sale</b>
              <p>{t("ซื้อเหรียญ TPIX โดยตรงจากหน้าขายเหรียญทางการบน tpix.online", "Buy TPIX directly from the official sale page on tpix.online.")}</p>
              <span className="tpx-go">{t("ไปหน้าซื้อเหรียญ ↗", "Go to the coin sale ↗")}</span>
            </a>
            <a className="tpx-where-card" href={TPIX_LINKS.swap} target="_blank" rel="noopener noreferrer">
              <span className="tpx-chip">{t("บนเชน", "On-chain")}</span>
              <b>TPIX DEX</b>
              <p>{t("มี USDT บน TPIX Chain อยู่แล้ว แลกเป็น TPIX ได้ที่ TPIX DEX", "Already have USDT on TPIX Chain? Swap it for TPIX on TPIX DEX.")}</p>
              <span className="tpx-go">{t("ไปหน้าแลกเหรียญ ↗", "Go to the swap ↗")}</span>
            </a>
            <div className="tpx-where-card tpx-where-add">
              <span className="tpx-chip">{t("ตั้งค่ากระเป๋า", "Wallet setup")}</span>
              <b>{t("เพิ่ม TPIX Chain ลงกระเป๋า", "Add TPIX Chain to your wallet")}</b>
              <p>
                {t(
                  "เพิ่มเครือข่าย Chain ID 4289 ลงกระเป๋าในคลิกเดียว แล้วเหรียญ TPIX จะแสดงในกระเป๋าเอง",
                  "Add the Chain ID 4289 network to your wallet in one click, and your TPIX coins show up there on their own.",
                )}
              </p>
              <button type="button" className="tpx-btn tpx-btn-glass" onClick={hasProvider ? switchChain : connect} disabled={walletBusy}>
                {wallet?.chainOk ? t("อยู่บน TPIX Chain แล้ว ✓", "On TPIX Chain ✓") : t("เพิ่ม / สลับเป็น TPIX Chain", "Add / switch to TPIX Chain")}
              </button>
            </div>
          </div>
        </section>

        <section className="tpx-section">
          <h2 className="tpx-h2">{t("คำถามที่พบบ่อย", "FAQ")}</h2>
          <div className="tpx-faq">
            {FAQ.map((f) => (
              <details key={f.q.th}>
                <summary>{t(f.q)}</summary>
                <p>{t(f.a)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="tpx-final">
          <Image src={COIN} alt="" width={84} height={84} />
          <h2>
            {t(
              <>ใช้ TPIX สร้างงาน AI {discount > 0 ? <span className="tpx-grad">ถูกลง {discount}%</span> : null}</>,
              <>Create with AI using TPIX {discount > 0 ? <span className="tpx-grad">for {discount}% less</span> : null}</>,
            )}
          </h2>
          <p>
            {t(
              "ภาพ วิดีโอ เพลง พากย์เสียง และ 3D ด้วยเครดิตเดียวกัน ซื้อด้วยเหรียญ TPIX บน TPIX Chain",
              "Images, video, music, voice dubbing and 3D on one credit balance, bought with TPIX coin on TPIX Chain.",
            )}
          </p>
          <div className="tpx-row tpx-center">
            <a href="#packages" className="tpx-btn tpx-btn-main tpx-btn-lg">{t("เลือกแพ็กเกจ", "Choose a package")}</a>
            <Link href="/pricing" className="tpx-btn tpx-btn-glass tpx-btn-lg">{t("ช่องทางชำระอื่น", "Other ways to pay")}</Link>
          </div>
          <p className="tpx-fine">
            {t(
              <>
                ส่วนลดใช้กับการชำระด้วยเหรียญ TPIX ผ่านระบบ TPIX Pay ของ <a href={XMAN_URL} target="_blank" rel="noopener noreferrer">XMAN Studio</a> เท่านั้น
                ราคาเหรียญผันผวนได้ ยอดที่ต้องโอนคือยอดที่ล็อกไว้ตอนกดซื้อ
              </>,
              <>
                The discount applies only to payments in TPIX coin through the TPIX Pay system of{" "}
                <a href={XMAN_URL} target="_blank" rel="noopener noreferrer">XMAN Studio</a>. The coin&apos;s price can move; the amount to
                send is the one locked when you bought.
              </>,
            )}
          </p>
        </section>
      </div>

      {flow ? (
        <div className="tpx-modal" role="dialog" aria-modal="true" aria-labelledby="tpx-modal-title" onClick={(e) => e.target === e.currentTarget && closeFlow()}>
          <div className="tpx-sheet">
            <button type="button" className="tpx-x" onClick={closeFlow} aria-label={t("ปิด", "Close")} disabled={flow.step === "sending"}>×</button>
            <div className="tpx-sheet-head">
              <Image src={COIN} alt="" width={48} height={48} />
              <div>
                <h3 id="tpx-modal-title">
                  {t(`ซื้อ ${flow.pkg.name} ด้วย TPIX`, `Buy ${packageLabel(flow.pkg.name, locale)} with TPIX`)}
                </h3>
                <span>
                  {t(
                    `${fmtInt(totalCredits(flow.pkg))} เครดิต · TPIX Chain`,
                    `${formatCredits(Math.round(totalCredits(flow.pkg)), locale)} · TPIX Chain`,
                  )}
                </span>
              </div>
            </div>

            {flow.step === "quoting" ? (
              <div className="tpx-wait"><span className="tpx-spin" /> {t("กำลังล็อกยอดตามราคาตลาด…", "Locking the amount at the market price…")}</div>
            ) : null}

            {flow.quote && (flow.step === "pay" || flow.step === "sending") ? (
              <>
                <dl className="tpx-sum">
                  <div><dt>{t("ราคาแพ็กเกจ", "Package price")}</dt><dd>{formatThb(Number(flow.quote.priceThb), locale)}</dd></div>
                  {Number(flow.quote.discountThb) > 0 ? (
                    <div className="tpx-sum-off">
                      <dt>{t(`ส่วนลด TPIX ${flow.quote.discountPercent}%`, `TPIX discount ${flow.quote.discountPercent}%`)}</dt>
                      <dd>−{formatThb(Number(flow.quote.discountThb), locale)}</dd>
                    </div>
                  ) : null}
                  <div><dt>{t("ยอดชำระ", "Total")}</dt><dd>{formatThb(Number(flow.quote.totalThb), locale)}</dd></div>
                </dl>
                <div className="tpx-due">
                  <span>{t("โอนให้ตรงทุกหลัก", "Send this exact amount")}</span>
                  <b>{flow.quote.amountTpix} <em>TPIX</em></b>
                  <button type="button" onClick={() => copy("amount", flow.quote!.amountTpix)}>
                    {copied === "amount" ? t("คัดลอกแล้ว ✓", "Copied ✓") : t("คัดลอกยอด", "Copy amount")}
                  </button>
                </div>
                <div className={`tpx-timer ${timedOut ? "out" : secondsLeft < 300 ? "low" : ""}`}>
                  {timedOut
                    ? t("ยอดนี้หมดเวลาแล้ว", "This quote has expired")
                    : t(<>ยอดนี้ใช้ได้อีก <b>{clock(secondsLeft)}</b> นาที</>, <>Valid for another <b>{clock(secondsLeft)}</b></>)}
                </div>

                {timedOut ? (
                  <button type="button" className="tpx-btn tpx-btn-main tpx-btn-block" onClick={() => startQuote(flow.pkg)}>
                    {t("ขอยอดใหม่", "Get a new quote")}
                  </button>
                ) : (
                  <button type="button" className="tpx-btn tpx-btn-main tpx-btn-block" onClick={pay} disabled={flow.step === "sending"}>
                    {flow.step === "sending"
                      ? t("ยืนยันในกระเป๋าของคุณ…", "Confirm in your wallet…")
                      : hasProvider
                        ? t("ชำระด้วยกระเป๋า", "Pay with wallet")
                        : t("เปิดในแอป MetaMask เพื่อชำระ", "Open MetaMask to pay")}
                  </button>
                )}
                {flow.message ? <p className="tpx-note-err">{flow.message}</p> : null}
                <p className="tpx-warn">
                  {t(
                    "⚠ โอนบน TPIX Chain (Chain ID 4289) เท่านั้น เหรียญที่โอนจากเครือข่ายอื่นจะไม่ถึงร้าน",
                    "⚠ Send on TPIX Chain (Chain ID 4289) only. Coins sent from any other network never reach the shop.",
                  )}
                </p>

                <button type="button" className="tpx-link" onClick={() => setManual((m) => !m)}>
                  {manual ? t("ซ่อนวิธีโอนเอง", "Hide manual transfer") : t("โอนจากกระเป๋าอื่นหรือแอปมือถือ", "Send from another wallet or a mobile app")}
                </button>
                {manual ? (
                  <div className="tpx-manual">
                    <label>{t("ที่อยู่รับเหรียญของร้าน", "Shop's receiving address")}</label>
                    <div className="tpx-copyline">
                      <code>{flow.quote.receiveAddress}</code>
                      <button type="button" onClick={() => copy("address", flow.quote!.receiveAddress)}>{copied === "address" ? "✓" : t("คัดลอก", "Copy")}</button>
                    </div>
                    {flow.quote.paymentUri ? (
                      <a className="tpx-link" href={flow.quote.paymentUri}>{t("เปิดในแอปกระเป๋า (ลิงก์ชำระ EIP-681)", "Open in a wallet app (EIP-681 payment link)")}</a>
                    ) : null}
                    <p>
                      {t(
                        "โอนยอดด้านบนให้ตรงทุกหลักภายในเวลา ระบบตรวจพบเองภายในไม่กี่นาที หรือวางเลขธุรกรรมเพื่อให้ตรวจทันที",
                        "Send the exact amount above before time runs out. We'll find it within a few minutes, or paste the transaction hash to have it checked now.",
                      )}
                    </p>
                    <div className="tpx-copyline">
                      <input
                        value={txInput}
                        onChange={(e) => setTxInput(e.target.value)}
                        placeholder={t("0x… เลขธุรกรรม (tx hash)", "0x… transaction hash")}
                        spellCheck={false}
                      />
                      <button type="button" onClick={submitManualTx}>{t("ตรวจ", "Check")}</button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {flow.step === "confirming" ? (
              <div className="tpx-progress">
                <span className="tpx-spin" />
                <b>{t("กำลังยืนยันบนเชน", "Confirming on the chain")}</b>
                <p>
                  {flow.status
                    ? t(
                      `${Math.min(flow.status.confirmations, flow.status.requiredConfirmations)}/${flow.status.requiredConfirmations} บล็อก`,
                      `${Math.min(flow.status.confirmations, flow.status.requiredConfirmations)}/${flow.status.requiredConfirmations} confirmations`,
                    )
                    : t("รอธุรกรรมเข้าบล็อก", "Waiting for the transaction to be included in a block")}
                  {" · "}
                  {t("ปิดหน้าต่างนี้ได้ ระบบตรวจต่อเองและเติมเครดิตให้อัตโนมัติ", "You can close this window; we keep checking and add your credits automatically.")}
                </p>
                {flow.status?.explorerUrl || flow.txHash ? (
                  <a className="tpx-link" href={flow.status?.explorerUrl || `${TPIX_CHAIN.explorer}/tx/${flow.txHash}`} target="_blank" rel="noopener noreferrer">
                    {t("ดูธุรกรรมบน TPIX Explorer ↗", "View on TPIX Explorer ↗")}
                  </a>
                ) : null}
                {flow.message ? <p className="tpx-muted">{flow.message}</p> : null}
              </div>
            ) : null}

            {flow.step === "paid" ? (
              <div className="tpx-done">
                <div className="tpx-check">✓</div>
                <b>{t("ชำระสำเร็จ", "Payment complete")}</b>
                <p>
                  {flow.status?.creditsDelivered === false
                    ? t("ได้รับเหรียญแล้ว เครดิตกำลังเข้าบัญชี อาจใช้เวลาไม่เกินหนึ่งนาที", "Coins received. Your credits are on the way; this can take up to a minute.")
                    : t(
                      `เติม ${fmtInt(totalCredits(flow.pkg))} เครดิตเข้าบัญชีแล้ว`,
                      `${formatCredits(Math.round(totalCredits(flow.pkg)), locale)} added to your account`,
                    )}
                  {flow.status?.orderNumber ? t(` · คำสั่งซื้อ ${flow.status.orderNumber}`, ` · Order ${flow.status.orderNumber}`) : ""}
                </p>
                <div className="tpx-row tpx-center">
                  <Link href="/generate" className="tpx-btn tpx-btn-main">{t("เริ่มสร้างงาน", "Start creating")}</Link>
                  <button type="button" className="tpx-btn tpx-btn-glass" onClick={() => setFlow(null)}>{t("ปิด", "Close")}</button>
                </div>
              </div>
            ) : null}

            {flow.step === "expired" ? (
              <div className="tpx-done">
                <b>{t("ยอดนี้หมดเวลาแล้ว", "This quote has expired")}</b>
                <p>
                  {t(
                    "ถ้ายังไม่ได้โอน ขอยอดใหม่ตามราคาปัจจุบันได้เลย ถ้าโอนไปแล้ว ระบบยังตรวจพบและพักรายการไว้ให้แอดมินตรวจ",
                    "If you haven't sent anything yet, get a new quote at the current price. If you already did, we'll still find the transfer and hold it for an admin to review.",
                  )}
                </p>
                <button type="button" className="tpx-btn tpx-btn-main" onClick={() => startQuote(flow.pkg)}>{t("ขอยอดใหม่", "Get a new quote")}</button>
              </div>
            ) : null}

            {flow.step === "review" ? (
              <div className="tpx-done">
                <b>{flow.status?.label || t("ได้รับเหรียญแล้ว รอแอดมินตรวจ", "Coins received, waiting for admin review")}</b>
                <p>
                  {t(
                    <>
                      การโอนนี้ต้องให้แอดมินตรวจก่อน (เช่น โอนหลังหมดเวลา) เหรียญไม่หาย ติดตามได้ที่คำสั่งซื้อ
                      {flow.status?.orderNumber ? ` ${flow.status.orderNumber}` : ""} บน{" "}
                      <a href={`${XMAN_URL}/orders`} target="_blank" rel="noopener noreferrer">XMAN Studio</a>
                    </>,
                    <>
                      An admin needs to check this transfer first (for example, it arrived after the quote expired). Your coins are safe. Track
                      {flow.status?.orderNumber ? ` order ${flow.status.orderNumber}` : " your order"} on{" "}
                      <a href={`${XMAN_URL}/orders`} target="_blank" rel="noopener noreferrer">XMAN Studio</a>.
                    </>,
                  )}
                </p>
              </div>
            ) : null}

            {flow.step === "error" ? (
              <div className="tpx-done">
                <b>{t("ทำรายการไม่สำเร็จ", "Something went wrong")}</b>
                <p>{flow.message || t("กรุณาลองใหม่อีกครั้ง", "Please try again.")}</p>
                {loggedIn === false ? (
                  <Link href="/login?callbackUrl=%2Ftpix" className="tpx-btn tpx-btn-main">{t("เข้าสู่ระบบ", "Sign in")}</Link>
                ) : (
                  <button type="button" className="tpx-btn tpx-btn-main" onClick={() => startQuote(flow.pkg)}>{t("ลองอีกครั้ง", "Try again")}</button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .tpx-page {
          --t1: #22d3ee; --t2: #3b82f6; --t3: #a855f7; --t4: #d946ef; --t5: #fb923c;
          --tg: linear-gradient(100deg, var(--t1), var(--t2) 32%, var(--t3) 62%, var(--t5));
          --ink: #e8eefb; --mute: #94a3bf; --line: rgba(148, 163, 191, 0.16);
          margin-top: -80px;
        }
        .tpx-grad { background: var(--tg); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .tpx-big { font-size: 1.18em; }

        .tpx-hero { position: relative; overflow: hidden; min-height: 680px; display: flex; align-items: center; padding: 120px 0 72px; isolation: isolate; background: #03050f; }
        /* Ring centre in the art: 71.55% across, 41.8% down; its dark inside is 28.6% of the width */
        .tpx-art { position: absolute; z-index: -2; top: 50%; right: 0; height: 100%; aspect-ratio: 3 / 2; transform: translateY(-50%); }
        .tpx-art > img { object-fit: cover; }
        .tpx-art::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, #03050f 0%, rgba(3, 5, 15, 0) 22%); pointer-events: none; }
        .tpx-hero-shade {
          position: absolute; inset: 0; z-index: -1; pointer-events: none;
          background:
            linear-gradient(90deg, rgba(3, 5, 15, 0.9) 0%, rgba(3, 5, 15, 0.55) 34%, rgba(3, 5, 15, 0) 52%),
            linear-gradient(180deg, rgba(3, 5, 15, 0) 70%, #070b16 100%);
        }
        .tpx-hero-inner { width: 100%; max-width: 1240px; margin: 0 auto; padding: 0 24px; }
        .tpx-hero-copy { max-width: 600px; }
        .tpx-lockup { display: inline-flex; align-items: center; gap: 10px; padding: 7px 14px; border-radius: 999px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); font-family: var(--font-unbounded), sans-serif; font-size: 12.5px; font-weight: 700; letter-spacing: 0.04em; color: #fff; }
        .tpx-lockup i { font-style: normal; color: var(--t1); }
        .tpx-lockup img { display: block; }
        .tpx-eyebrow { margin: 18px 0 0; font-size: 13.5px; font-weight: 600; letter-spacing: 0.02em; color: var(--t1); }
        .tpx-hero h1 { margin: 10px 0 0; font-size: clamp(36px, 5.2vw, 64px); line-height: 1.12; font-weight: 800; color: #fff; letter-spacing: -0.01em; }
        .tpx-sub { margin: 18px 0 0; max-width: 560px; font-size: 16.5px; line-height: 1.75; color: #c3cde0; }
        .tpx-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px; }
        .tpx-center { justify-content: center; }
        .tpx-hero-links { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 20px; font-size: 14px; }
        .tpx-hero-links a { color: #b9c7ff; text-decoration: underline; text-decoration-color: rgba(185, 199, 255, 0.35); text-underline-offset: 4px; }
        .tpx-hero-links a:hover { color: #fff; }

        .tpx-hero-coin { position: absolute; left: 71.55%; top: 41.8%; width: 24.5%; aspect-ratio: 1; transform: translate(-50%, -50%); }
        .tpx-coin { position: relative; width: 100%; height: auto; display: block; filter: drop-shadow(0 30px 60px rgba(0, 0, 0, 0.55)); animation: tpx-float 6s ease-in-out infinite; }
        .tpx-coin-glow { position: absolute; inset: -18%; border-radius: 50%; background: radial-gradient(circle, rgba(168, 85, 247, 0.45), rgba(34, 211, 238, 0.18) 45%, transparent 70%); filter: blur(10px); animation: tpx-pulse 6s ease-in-out infinite; }
        .tpx-sticker {
          position: absolute; right: -6%; top: 2%; width: 31%; aspect-ratio: 1; border-radius: 50%;
          display: grid; place-content: center; text-align: center; transform: rotate(12deg);
          background: linear-gradient(135deg, #fb923c, #d946ef); color: #fff; box-shadow: 0 12px 30px rgba(217, 70, 239, 0.45), inset 0 0 0 3px rgba(255, 255, 255, 0.35);
        }
        .tpx-sticker small { font-size: clamp(11px, 1vw, 14px); font-weight: 700; line-height: 1; }
        .tpx-sticker b { font-family: var(--font-unbounded), sans-serif; font-size: clamp(20px, 2.2vw, 30px); line-height: 1.05; }
        @keyframes tpx-float { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-14px) rotate(3deg); } }
        @keyframes tpx-pulse { 0%, 100% { opacity: 0.75; transform: scale(1); } 50% { opacity: 1; transform: scale(1.06); } }

        .tpx-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 20px;
          border-radius: 14px; font-size: 15px; font-weight: 700; cursor: pointer; border: 0; text-decoration: none; white-space: nowrap;
          transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease, opacity 0.18s ease;
        }
        .tpx-btn img { display: block; }
        .tpx-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none !important; }
        .tpx-btn-lg { min-height: 54px; padding: 0 28px; font-size: 16px; border-radius: 16px; }
        .tpx-btn-block { width: 100%; }
        .tpx-btn-main { color: #fff; background: var(--tg); box-shadow: 0 10px 28px rgba(124, 58, 237, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
        .tpx-btn-main:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(124, 58, 237, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3); }
        .tpx-btn-glass { color: #e6ecff; background: rgba(255, 255, 255, 0.06); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16); backdrop-filter: blur(10px); }
        .tpx-btn-glass:hover:not(:disabled) { background: rgba(255, 255, 255, 0.11); transform: translateY(-2px); }
        .tpx-btn-off { color: #9aa6bd; background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); cursor: default; }

        .tpx-wrap { max-width: 1240px; margin: 0 auto; padding: 0 24px 40px; }
        .tpx-soon { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin: 0 0 18px; padding: 14px 18px; border-radius: 16px; background: linear-gradient(90deg, rgba(251, 146, 60, 0.14), rgba(217, 70, 239, 0.1)); border: 1px solid rgba(251, 146, 60, 0.3); color: #ffd9b8; font-size: 14px; }
        .tpx-soon b { color: #fff; }
        .tpx-soon a { color: #fff; text-decoration: underline; }
        .tpx-strip { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 40px; }
        .tpx-strip span { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 999px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); font-size: 13.5px; color: #c8d2e6; }
        .tpx-strip b { color: #fff; }

        .tpx-h2 { margin: 0; font-size: clamp(24px, 3vw, 34px); font-weight: 800; color: #fff; line-height: 1.25; }
        .tpx-lead { margin: 10px 0 0; color: var(--mute); font-size: 14.5px; }
        .tpx-shop, .tpx-wallet { scroll-margin-top: 96px; }
        /* As many columns as packages (up to 4), so a row never ends with one card on its own */
        .tpx-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin-top: 30px; }
        .tpx-grid[data-n="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .tpx-grid[data-n="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 640px; }
        .tpx-grid[data-n="1"] { grid-template-columns: minmax(0, 1fr); max-width: 340px; }
        .tpx-card {
          position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 26px 18px 20px; border-radius: 22px;
          background: linear-gradient(180deg, rgba(20, 26, 46, 0.92), rgba(10, 14, 28, 0.92)) padding-box, linear-gradient(160deg, rgba(34, 211, 238, 0.35), rgba(255, 255, 255, 0.06) 40%, rgba(168, 85, 247, 0.35)) border-box;
          border: 1px solid transparent; transition: transform 0.22s ease, box-shadow 0.22s ease;
        }
        .tpx-card:hover { transform: translateY(-4px); box-shadow: 0 22px 50px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(168, 85, 247, 0.25); }
        .tpx-card[data-rec] { background: linear-gradient(180deg, rgba(34, 22, 58, 0.95), rgba(12, 14, 30, 0.95)) padding-box, var(--tg) border-box; box-shadow: 0 24px 60px rgba(124, 58, 237, 0.28); }
        .tpx-skel { min-height: 380px; animation: tpx-pulse 1.6s ease-in-out infinite; }
        .tpx-ribbon { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); padding: 5px 14px; border-radius: 999px; background: var(--tg); color: #fff; font-size: 12px; font-weight: 800; white-space: nowrap; box-shadow: 0 8px 20px rgba(124, 58, 237, 0.4); }
        .tpx-tag { position: absolute; top: 12px; right: 12px; padding: 3px 9px; border-radius: 999px; background: rgba(255, 255, 255, 0.07); color: #cdd6ea; font-size: 11px; font-weight: 700; }
        .tpx-emblem { display: block; margin: 0 auto; width: 88px; height: 88px; object-fit: contain; filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.5)); }
        .tpx-card h3 { margin: 10px 0 0; font-size: 19px; font-weight: 800; color: #fff; }
        .tpx-credits { margin-top: 6px; color: #b8c3d9; font-size: 14px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .tpx-credits b { font-family: var(--font-unbounded), sans-serif; font-size: 24px; color: #fff; }
        .tpx-credits small { color: var(--t1); font-size: 12px; font-weight: 600; }
        .tpx-price { margin-top: 14px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .tpx-price s { color: #7d89a3; font-size: 14px; }
        .tpx-price b { font-family: var(--font-unbounded), sans-serif; font-size: 28px; color: #fff; line-height: 1.15; }
        .tpx-save { margin-top: 4px; padding: 3px 10px; border-radius: 999px; background: rgba(251, 146, 60, 0.14); color: #fdba74; font-size: 12px; font-weight: 700; }
        .tpx-amount { margin-top: 14px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 12px; border-radius: 14px; background: rgba(34, 211, 238, 0.07); border: 1px solid rgba(34, 211, 238, 0.2); color: #d7f6fb; font-size: 14px; font-weight: 700; }
        .tpx-amount img { display: block; }
        .tpx-bal { margin: 8px 0 0; font-size: 12.5px; font-weight: 600; }
        .tpx-bal.ok { color: #6ee7b7; }
        .tpx-bal.low { color: #fdba74; }
        .tpx-card > .tpx-btn { margin-top: 16px; width: 100%; }
        .tpx-empty { margin-top: 24px; color: var(--mute); }

        /* The wallet is a bar over the cards: who you are on the left, what to do on the right */
        .tpx-wallet { margin-top: 22px; display: flex; flex-wrap: wrap; align-items: center; gap: 14px 28px; padding: 18px 22px; border-radius: 22px; background: linear-gradient(180deg, rgba(18, 24, 42, 0.95), rgba(10, 14, 26, 0.95)) padding-box, linear-gradient(150deg, rgba(34, 211, 238, 0.4), rgba(168, 85, 247, 0.3), rgba(251, 146, 60, 0.35)) border-box; border: 1px solid transparent; }
        .tpx-wallet-head { display: flex; align-items: center; gap: 12px; }
        .tpx-wallet-head img { display: block; }
        .tpx-wallet-head b { display: block; color: #fff; font-size: 16px; }
        .tpx-wallet-head span { display: block; color: var(--mute); font-size: 12.5px; }
        .tpx-wallet-body { flex: 1 1 460px; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px 14px; }
        .tpx-wallet-body p { flex: 1 1 300px; margin: 0; color: #b8c3d9; font-size: 13.5px; line-height: 1.65; }
        .tpx-wallet-body > small { flex: 1 1 100%; text-align: right; color: var(--mute); font-size: 12px; line-height: 1.6; }
        .tpx-wallet-body .tpx-row { margin-top: 0; }
        .tpx-wallet-line { display: flex; align-items: center; gap: 8px; }
        .tpx-addr { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; color: #fff; padding: 6px 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.06); }
        .tpx-net { padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
        .tpx-net.ok { background: rgba(16, 185, 129, 0.14); color: #6ee7b7; }
        .tpx-net.bad { background: rgba(251, 146, 60, 0.15); color: #fdba74; }
        .tpx-balance { padding: 8px 16px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
        .tpx-balance span { color: var(--mute); font-size: 12.5px; }
        .tpx-balance b { font-family: var(--font-unbounded), sans-serif; font-size: 24px; color: #fff; }
        .tpx-balance em { font-style: normal; font-size: 14px; color: var(--t1); }
        .tpx-balance small { color: var(--mute); font-size: 12.5px; }
        .tpx-note-err { flex: 1 1 100%; margin: 0; color: #fca5a5; font-size: 13px; line-height: 1.6; }

        .tpx-section { margin-top: 72px; }
        .tpx-steps { list-style: none; margin: 24px 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; counter-reset: s; }
        .tpx-steps li { padding: 22px 18px; border-radius: 20px; background: rgba(255, 255, 255, 0.035); border: 1px solid var(--line); }
        .tpx-step-n { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: var(--tg); color: #fff; font-family: var(--font-unbounded), sans-serif; font-weight: 800; }
        .tpx-steps b { display: block; margin-top: 14px; color: #fff; font-size: 16px; }
        .tpx-steps p { margin: 6px 0 0; color: #aab5ca; font-size: 13.5px; line-height: 1.65; }

        .tpx-about { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; align-items: center; padding: 34px; border-radius: 28px; background: radial-gradient(120% 140% at 0% 0%, rgba(34, 211, 238, 0.12), transparent 50%), radial-gradient(120% 140% at 100% 100%, rgba(251, 146, 60, 0.1), transparent 50%), rgba(255, 255, 255, 0.03); border: 1px solid var(--line); }
        .tpx-about .tpx-eyebrow { margin-top: 0; }
        .tpx-about-copy p { color: #c0cadc; font-size: 15px; line-height: 1.8; }
        .tpx-about-copy .tpx-h2 { margin-top: 6px; }
        .tpx-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .tpx-fact { padding: 18px; border-radius: 18px; background: rgba(6, 10, 22, 0.6); border: 1px solid var(--line); }
        .tpx-fact span { color: var(--mute); font-size: 12.5px; }
        .tpx-fact b { display: block; margin-top: 4px; font-family: var(--font-unbounded), sans-serif; font-size: 20px; background: var(--tg); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .tpx-fact p { margin: 6px 0 0; color: #a7b2c7; font-size: 13px; line-height: 1.6; }

        .tpx-where { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 24px; }
        .tpx-where-card { display: flex; flex-direction: column; gap: 8px; padding: 22px; border-radius: 20px; background: rgba(255, 255, 255, 0.035); border: 1px solid var(--line); color: inherit; text-decoration: none; transition: transform 0.2s ease, border-color 0.2s ease; }
        a.tpx-where-card:hover { transform: translateY(-3px); border-color: rgba(168, 85, 247, 0.45); }
        .tpx-where-card b { color: #fff; font-size: 18px; }
        .tpx-where-card p { margin: 0; color: #aab5ca; font-size: 13.5px; line-height: 1.65; flex: 1; }
        .tpx-chip { align-self: flex-start; padding: 3px 10px; border-radius: 999px; background: rgba(34, 211, 238, 0.12); color: #a5f3fc; font-size: 11.5px; font-weight: 700; }
        .tpx-go { color: #c4b5fd; font-weight: 700; font-size: 14px; }
        .tpx-where-add .tpx-btn { align-self: flex-start; }

        .tpx-faq { margin-top: 22px; display: grid; gap: 12px; max-width: 900px; }
        .tpx-faq details { border-radius: 16px; background: rgba(255, 255, 255, 0.035); border: 1px solid var(--line); }
        .tpx-faq summary { cursor: pointer; padding: 16px 18px; color: #fff; font-weight: 700; font-size: 15px; list-style: none; }
        .tpx-faq summary::-webkit-details-marker { display: none; }
        .tpx-faq summary::after { content: "+"; float: right; color: var(--t1); font-weight: 800; }
        .tpx-faq details[open] summary::after { content: "−"; }
        .tpx-faq p { margin: 0; padding: 0 18px 16px; color: #b5c0d4; font-size: 14px; line-height: 1.75; }

        .tpx-final { margin-top: 80px; padding: 44px 24px; border-radius: 28px; text-align: center; background: radial-gradient(60% 120% at 50% 0%, rgba(168, 85, 247, 0.22), transparent 70%), rgba(255, 255, 255, 0.03); border: 1px solid var(--line); }
        .tpx-final img { display: block; margin: 0 auto; }
        .tpx-final h2 { margin: 16px 0 0; font-size: clamp(24px, 3.2vw, 36px); color: #fff; font-weight: 800; }
        .tpx-final p { margin: 10px auto 0; max-width: 600px; color: #b5c0d4; font-size: 15px; line-height: 1.7; }
        .tpx-final .tpx-fine { margin-top: 22px; font-size: 12.5px; color: #8391a7; }
        .tpx-fine a { color: #b9c7ff; }

        .tpx-modal { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 16px; background: rgba(3, 6, 14, 0.72); backdrop-filter: blur(8px); }
        .tpx-sheet { position: relative; width: min(460px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; padding: 24px; border-radius: 24px; background: linear-gradient(180deg, #121a30, #0a0f1f) padding-box, var(--tg) border-box; border: 1px solid transparent; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); }
        .tpx-x { position: absolute; top: 12px; right: 14px; width: 34px; height: 34px; border-radius: 10px; border: 0; background: rgba(255, 255, 255, 0.06); color: #cbd5e1; font-size: 20px; cursor: pointer; }
        .tpx-sheet-head { display: flex; align-items: center; gap: 12px; padding-right: 36px; }
        .tpx-sheet-head img { display: block; }
        .tpx-sheet-head h3 { margin: 0; color: #fff; font-size: 18px; }
        .tpx-sheet-head span { color: var(--mute); font-size: 13px; }
        .tpx-wait { display: flex; align-items: center; gap: 12px; margin: 28px 0 10px; color: #cbd5e1; }
        .tpx-spin { width: 22px; height: 22px; border-radius: 50%; border: 3px solid rgba(255, 255, 255, 0.15); border-top-color: var(--t1); animation: tpx-rot 0.9s linear infinite; flex: none; }
        @keyframes tpx-rot { to { transform: rotate(360deg); } }
        .tpx-sum { margin: 20px 0 0; display: grid; gap: 8px; }
        .tpx-sum div { display: flex; justify-content: space-between; color: #b8c3d9; font-size: 14px; }
        .tpx-sum dt, .tpx-sum dd { margin: 0; }
        .tpx-sum dd { color: #fff; font-weight: 700; }
        .tpx-sum-off dd { color: #fdba74 !important; }
        .tpx-due { margin-top: 16px; padding: 16px; border-radius: 18px; text-align: center; background: rgba(34, 211, 238, 0.07); border: 1px solid rgba(34, 211, 238, 0.25); }
        .tpx-due span { display: block; color: #a5f3fc; font-size: 12.5px; font-weight: 600; }
        .tpx-due b { display: block; margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 24px; color: #fff; word-break: break-all; }
        .tpx-due em { font-style: normal; font-size: 15px; color: var(--t1); }
        .tpx-due button, .tpx-copyline button { margin-top: 10px; padding: 7px 14px; border-radius: 10px; border: 0; background: rgba(255, 255, 255, 0.08); color: #e2e8f0; font-size: 13px; font-weight: 700; cursor: pointer; }
        .tpx-timer { margin: 12px 0; text-align: center; color: #b8c3d9; font-size: 13.5px; }
        .tpx-timer b { color: #fff; font-family: var(--font-unbounded), sans-serif; }
        .tpx-timer.low b { color: #fdba74; }
        .tpx-timer.out { color: #fca5a5; }
        .tpx-warn { margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; background: rgba(251, 146, 60, 0.1); color: #fed7aa; font-size: 12.5px; line-height: 1.6; }
        .tpx-link { display: inline-block; margin-top: 12px; padding: 0; border: 0; background: none; color: #b9c7ff; font-size: 13.5px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
        .tpx-manual { margin-top: 10px; display: grid; gap: 8px; }
        .tpx-manual label { color: var(--mute); font-size: 12.5px; }
        .tpx-manual p { margin: 0; color: #aab5ca; font-size: 12.5px; line-height: 1.6; }
        .tpx-copyline { display: flex; align-items: center; gap: 8px; }
        .tpx-copyline code { flex: 1; min-width: 0; padding: 9px 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); color: #fff; font-size: 12px; word-break: break-all; }
        .tpx-copyline input { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.04); color: #fff; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .tpx-copyline button { margin-top: 0; flex: none; }
        .tpx-progress, .tpx-done { margin-top: 22px; display: grid; justify-items: center; gap: 10px; text-align: center; }
        .tpx-progress b, .tpx-done b { color: #fff; font-size: 18px; }
        .tpx-progress p, .tpx-done p { margin: 0; color: #b8c3d9; font-size: 14px; line-height: 1.7; }
        .tpx-done a { color: #b9c7ff; }
        .tpx-muted { color: var(--mute) !important; font-size: 12.5px !important; }
        .tpx-check { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg, #10b981, #22d3ee); color: #fff; font-size: 32px; font-weight: 800; box-shadow: 0 12px 30px rgba(16, 185, 129, 0.4); }

        @media (max-width: 1100px) {
          .tpx-grid:not([data-n="3"]) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .tpx-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .tpx-about { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 980px) {
          /* Narrow: the art on top, still flush right as on desktop (a centred ring left a hard edge
             and an empty strip on the right), the words below it */
          .tpx-hero { --ah: clamp(300px, 64vw, 520px); min-height: 0; display: block; padding: calc(56px + var(--ah)) 0 40px; }
          .tpx-art { top: 64px; right: 0; height: var(--ah); transform: none; }
          .tpx-art::after { background: linear-gradient(90deg, #03050f 0%, rgba(3, 5, 15, 0) 16%), linear-gradient(180deg, rgba(3, 5, 15, 0) 62%, #03050f 100%); }
          .tpx-hero-shade { background: linear-gradient(180deg, rgba(3, 5, 15, 0) calc(64px + var(--ah) * 0.8), #03050f calc(64px + var(--ah)), #070b16 100%); }
          .tpx-hero-copy { max-width: 680px; }
        }
        @media (max-width: 760px) {
          .tpx-hero-inner { padding: 0 16px; }
          .tpx-sub { font-size: 15px; }
          .tpx-wrap { padding: 0 16px 32px; }
          .tpx-where { grid-template-columns: minmax(0, 1fr); }
          .tpx-about { padding: 22px 18px; }
          .tpx-section { margin-top: 56px; }
          .tpx-grid, .tpx-grid[data-n] { grid-template-columns: minmax(0, 1fr); max-width: none; }
          .tpx-wallet { padding: 18px; }
          .tpx-wallet-body { justify-content: flex-start; }
          .tpx-wallet-body > small { text-align: left; }
          .tpx-wallet-line { flex: 1 1 100%; justify-content: space-between; }
          .tpx-wallet-body > .tpx-btn, .tpx-balance { flex: 1 1 100%; }
          .tpx-row .tpx-btn-lg { flex: 1 1 auto; }
        }
        @media (max-width: 480px) {
          .tpx-steps, .tpx-facts { grid-template-columns: minmax(0, 1fr); }
          .tpx-due b { font-size: 20px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tpx-coin, .tpx-coin-glow, .tpx-skel, .tpx-spin { animation: none; }
          .tpx-btn, .tpx-card, .tpx-where-card { transition: none; }
        }
      `}</style>
    </div>
  );
}
