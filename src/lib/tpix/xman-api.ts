/**
 * Server-to-server calls to xmanstudio's TPIX Pay for the /tpix page.
 *
 * xmanstudio owns the money: it quotes the exact TPIX amount, applies the
 * AI-credit TPIX discount, finds and verifies the transfer on TPIX Chain, pays
 * the order and sends the credits back through `/api/webhooks/xman-credit`.
 * This app only signs requests on behalf of the signed-in customer — the
 * customer's id always comes from our session, never from the browser.
 *
 * Signature (contract: side-session note `tpix-campaign-contract.md`):
 *   signingKey = hex(HMAC-SHA256(XMAN_WEBHOOK_SECRET, "aixman-tpix-api-v1"))
 *   signature  = hex(HMAC-SHA256(signingKey, "{ts}\n{METHOD}\n{path}\n{sha256hex(body)}"))
 * sent as `X-Aixman-Timestamp` / `X-Aixman-Signature`. The secret is the one
 * xmanstudio already uses for the credit webhook (its AIXMAN_WEBHOOK_SECRET).
 */
import { createHash, createHmac } from "crypto";
import type { Locale, Msg } from "@/lib/i18n/locale";

const USER_AGENT = "XmanAI-TpixCampaign/1.0 (+https://ai.xman4289.com/tpix)";
const TIMEOUT_MS = 15_000;

export function xmanBaseUrl(): string {
  return (process.env.XMAN_API_URL || process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com").replace(/\/+$/, "");
}

export function signTpixRequest(secret: string, timestamp: number, method: string, path: string, body: string): string {
  const signingKey = createHmac("sha256", secret).update("aixman-tpix-api-v1").digest("hex");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", signingKey)
    .update(`${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`)
    .digest("hex");
}

type XmanAction = "orders" | "payments/status" | "payments/tx";

export type XmanCall =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; message: Msg };

/** What the customer sees when xmanstudio cannot be asked; its own Thai refusals pass through. */
const UNAVAILABLE: Msg = {
  th: "ระบบชำระด้วย TPIX ยังไม่พร้อมในขณะนี้ กรุณาลองใหม่อีกครั้ง",
  en: "TPIX payments aren't available right now. Please try again later.",
};

/** Thai letters (not the baht sign, which English text uses too). */
const THAI_TEXT = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;

/**
 * xmanstudio words its refusals, labels and messages for the customer in Thai
 * only. In English such a text is replaced by `en` — ours, less specific, but
 * readable — or left out when `en` is empty; text that is not Thai is kept.
 */
export function xmanText(text: string, locale: Locale, en = ""): string {
  return locale === "en" && THAI_TEXT.test(text) ? en : text;
}

/** Our English for a refusal xmanstudio worded in Thai. */
function refusalEn(action: XmanAction, status: number): string {
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 404) return action === "orders" ? "This package was not found." : "This payment was not found.";
  if (action === "orders") return "This package can't be paid with TPIX right now. Please try again later.";
  if (action === "payments/tx") return "This transaction couldn't be accepted for this payment. Please check it and try again.";
  return "We couldn't check this payment right now. Please try again.";
}

/**
 * POST to `/api/aixman/tpix/{action}`. A refusal xmanstudio worded for the
 * customer (422, 429) is passed on; anything about our own credentials (401,
 * 503) or the network is not — the customer gets a plain "not available".
 */
export async function callXmanTpix(action: XmanAction, payload: Record<string, unknown>): Promise<XmanCall> {
  const secret = process.env.XMAN_WEBHOOK_SECRET || "";
  if (!secret) return { ok: false, status: 503, message: UNAVAILABLE };

  const path = `/api/aixman/tpix/${action}`;
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);

  let res: Response;
  try {
    res = await fetch(`${xmanBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        "X-Aixman-Timestamp": String(ts),
        "X-Aixman-Signature": signTpixRequest(secret, ts, "POST", path, body),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error("[tpix] xmanstudio unreachable", { action, error: e instanceof Error ? e.message : String(e) });
    return { ok: false, status: 503, message: UNAVAILABLE };
  }

  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }

  if (res.ok && json && json.success === true && json.data && typeof json.data === "object") {
    return { ok: true, data: json.data as Record<string, unknown> };
  }

  const theirs = json && typeof json.message === "string" ? json.message : null;
  if ((res.status === 422 || res.status === 429 || res.status === 404) && theirs) {
    return { ok: false, status: res.status, message: { th: theirs, en: xmanText(theirs, "en", refusalEn(action, res.status)) } };
  }
  console.error("[tpix] xmanstudio refused", { action, status: res.status });
  return { ok: false, status: 503, message: UNAVAILABLE };
}

export interface TpixMarket {
  /** xmanstudio takes TPIX now (switched on, an address, a quotable price). */
  paymentsEnabled: boolean;
  /** The AI-credit TPIX discount xmanstudio applies; null = that xmanstudio predates the campaign API. */
  discountPercent: number | null;
  /** THB per TPIX a quote would use now (lower of live and 30-min average); null until the average exists. */
  rateThb: string | null;
  priceUsd: string | null;
  maxQuoteThb: string | null;
  updatedAt: string | null;
}

let marketCache: { at: number; value: TpixMarket } | null = null;
const MARKET_TTL_MS = 60_000;

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** xmanstudio's public price API, read at most once a minute. Never throws. */
export async function getTpixMarket(): Promise<TpixMarket> {
  if (marketCache && Date.now() - marketCache.at < MARKET_TTL_MS) return marketCache.value;

  let value: TpixMarket = {
    paymentsEnabled: false, discountPercent: null, rateThb: null, priceUsd: null, maxQuoteThb: null, updatedAt: null,
  };
  try {
    const res = await fetch(`${xmanBaseUrl()}/api/v1/tpix/price`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json()) as { data?: Record<string, unknown> };
    const d = json.data ?? {};
    const pct = d.ai_credit_discount_percent;
    value = {
      paymentsEnabled: d.payments_enabled === true,
      discountPercent: typeof pct === "number" && Number.isFinite(pct) ? Math.min(50, Math.max(0, Math.trunc(pct))) : null,
      rateThb: str(d.quote_rate_thb),
      priceUsd: str(d.price_usd),
      maxQuoteThb: str(d.max_quote_thb),
      updatedAt: str(d.updated_at),
    };
  } catch (e) {
    console.error("[tpix] price API unreachable", e instanceof Error ? e.message : String(e));
    // A failed read is cached too, so a dead xmanstudio is not asked on every page view
  }
  marketCache = { at: Date.now(), value };
  return value;
}
