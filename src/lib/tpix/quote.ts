/**
 * The quote and status xmanstudio returns, narrowed to what the /tpix page
 * may see and checked before the browser is allowed to pay it.
 *
 * The page sends coins to `receiveAddress` for exactly `amountWei`, so a quote
 * is refused (null) unless the address is an address, the chain is TPIX Chain,
 * and `amountTpix` is the same number as `amountWei` — a page must never be
 * handed something to pay that does not add up.
 */
import { TPIX_CHAIN, isAddress, isQuoteReference, isTxHash, tpixToWei } from './chain';

export interface TpixQuote {
  reference: string;
  orderNumber: string;
  package: { slug: string; name: string; credits: number; bonusCredits: number };
  priceThb: string;
  discountThb: string;
  totalThb: string;
  discountPercent: number;
  amountTpix: string;
  amountWei: string;
  receiveAddress: string;
  rateThb: string;
  expiresAt: string;
  secondsLeft: number;
  /** EIP-681 link for wallets that scan a QR. */
  paymentUri: string;
}

export interface TpixPaymentStatus {
  reference: string;
  status: string;
  label: string;
  settled: boolean;
  payable: boolean;
  confirmations: number;
  requiredConfirmations: number;
  txHash: string | null;
  explorerUrl: string | null;
  secondsLeft: number;
  orderNumber: string | null;
  creditsDelivered: boolean;
}

const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const n = (v: unknown) => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
};
const money = (v: unknown) => (/^\d+(\.\d+)?$/.test(s(v)) ? s(v) : null);

export function pickQuote(d: Record<string, unknown>): TpixQuote | null {
  const reference = s(d.reference);
  const receiveAddress = s(d.receive_address);
  const amountWei = s(d.amount_wei);
  const amountTpix = s(d.amount_tpix);
  const priceThb = money(d.price_thb);
  const discountThb = money(d.discount_thb);
  const totalThb = money(d.total_thb);

  if (!isQuoteReference(reference) || !isAddress(receiveAddress)) return null;
  if (n(d.chain_id) !== TPIX_CHAIN.id) return null;
  if (!/^[1-9]\d*$/.test(amountWei) || priceThb === null || discountThb === null || totalThb === null) return null;
  try {
    if (tpixToWei(amountTpix) !== BigInt(amountWei)) return null;
  } catch {
    return null;
  }

  const pkg = (d.package && typeof d.package === "object" ? d.package : {}) as Record<string, unknown>;
  const paymentUri = s(d.payment_uri);

  return {
    reference,
    orderNumber: s(d.order_number),
    package: {
      slug: s(pkg.slug),
      name: s(pkg.name),
      credits: Math.max(0, Math.trunc(n(pkg.credits))),
      bonusCredits: Math.max(0, Math.trunc(n(pkg.bonus_credits))),
    },
    priceThb,
    discountThb,
    totalThb,
    discountPercent: Math.max(0, Math.trunc(n(d.discount_percent))),
    amountTpix,
    amountWei,
    receiveAddress,
    rateThb: s(d.rate_thb),
    expiresAt: s(d.expires_at),
    secondsLeft: Math.max(0, Math.trunc(n(d.seconds_left))),
    // Only an EIP-681 link to this very address on this chain is passed on
    paymentUri: paymentUri.toLowerCase().startsWith(`ethereum:${receiveAddress.toLowerCase()}@${TPIX_CHAIN.id}`) ? paymentUri : "",
  };
}

export function pickStatus(d: Record<string, unknown>): TpixPaymentStatus {
  const txHash = s(d.tx_hash);
  const explorerUrl = s(d.explorer_url);
  return {
    reference: s(d.reference),
    status: s(d.status) || "unknown",
    label: s(d.label),
    settled: d.settled === true,
    payable: d.payable === true,
    confirmations: Math.max(0, Math.trunc(n(d.confirmations))),
    requiredConfirmations: Math.max(1, Math.trunc(n(d.required_confirmations)) || 1),
    txHash: isTxHash(txHash) ? txHash : null,
    // A link out only to the chain's own explorer
    explorerUrl: explorerUrl.startsWith(`${TPIX_CHAIN.explorer}/`) ? explorerUrl : null,
    secondsLeft: Math.max(0, Math.trunc(n(d.seconds_left))),
    orderNumber: s(d.order_number) || null,
    creditsDelivered: d.credits_delivered === true,
  };
}
