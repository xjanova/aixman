/**
 * TPIX Chain facts and the coin maths the /tpix page needs. Client-safe: no
 * secrets, no server imports.
 *
 * TPIX is the native coin of TPIX Chain (EVM, chain id 4289, 18 decimals, gas
 * price 0). Only that chain is accepted: a transfer on any other network never
 * reaches the shop's address and is lost, so the page re-reads the wallet's
 * chain right before it sends anything.
 *
 * Money is never rounded through a float on its way to the chain: an amount
 * from a quote is a decimal string and becomes wei with BigInt arithmetic.
 */

export const TPIX_CHAIN = {
  id: 4289,
  /** `0x` + 4289 in hex, the form wallets use for chainId. */
  hex: "0x10c1",
  name: "TPIX Chain",
  symbol: "TPIX",
  decimals: 18,
  rpcUrls: ["https://rpc.tpix.online", "https://rpc1.tpix.online"],
  explorer: "https://explorer.tpix.online",
  /** Read by Rabby, OKX, Trust and Coinbase when the network is added (MetaMask ignores it). */
  iconUrl: "https://tpix.online/images/brand/tpix-coin.png",
} as const;

/**
 * The campaign headline while xmanstudio has not said its figure yet (buying is
 * closed then). The discount actually charged is always xmanstudio's.
 */
export const TPIX_CAMPAIGN_DISCOUNT = 20;

export const TPIX_LINKS = {
  site: "https://tpix.online",
  whitepaper: "https://tpix.online/whitepaper",
  /** The official TPIX Public Sale: where to buy the coin. */
  tokenSale: "https://tpix.online/token-sale",
  /** TPIX DEX on the chain itself, for people who already hold USDT there. */
  swap: "https://tpix.online/swap",
} as const;

/** What `wallet_addEthereumChain` needs to add TPIX Chain to a wallet. */
export function addChainParams() {
  return {
    chainId: TPIX_CHAIN.hex,
    chainName: TPIX_CHAIN.name,
    nativeCurrency: { name: "TPIX", symbol: TPIX_CHAIN.symbol, decimals: TPIX_CHAIN.decimals },
    rpcUrls: [...TPIX_CHAIN.rpcUrls],
    blockExplorerUrls: [TPIX_CHAIN.explorer],
    iconUrls: [TPIX_CHAIN.iconUrl],
  };
}

/** Wallets report chainId as hex in any case ("0x10C1"), some older ones as a decimal string. */
export function isTpixChain(chainId: unknown): boolean {
  if (typeof chainId === "number") return chainId === TPIX_CHAIN.id;
  if (typeof chainId !== "string") return false;
  const s = chainId.trim().toLowerCase();
  if (s.startsWith("0x")) return /^0x[0-9a-f]+$/.test(s) && BigInt(s) === BigInt(TPIX_CHAIN.id);
  return /^\d+$/.test(s) && Number(s) === TPIX_CHAIN.id;
}

const WEI_PER_TPIX = BigInt(10) ** BigInt(18);

/**
 * "94.51234567" → wei. Throws on anything that is not a plain non-negative
 * decimal with at most 18 places — a quote that cannot be paid exactly must
 * not be paid approximately.
 */
export function tpixToWei(amount: string): bigint {
  const s = amount.trim();
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(s);
  if (!m) throw new Error(`not a TPIX amount: ${amount}`);
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(18, "0"));
  return whole * WEI_PER_TPIX + frac;
}

/** wei → the hex quantity `eth_sendTransaction` takes. */
export function weiToHex(wei: bigint | string): string {
  const v = typeof wei === "bigint" ? wei : BigInt(wei);
  if (v < BigInt(0)) throw new Error("negative wei");
  return "0x" + v.toString(16);
}

/** wei → a TPIX figure for people, cut (never rounded up) to `places` decimals. */
export function weiToTpix(wei: bigint | string, places = 4): string {
  const v = typeof wei === "bigint" ? wei : BigInt(wei);
  const whole = v / WEI_PER_TPIX;
  const frac = (v % WEI_PER_TPIX).toString().padStart(18, "0").slice(0, places).replace(/0+$/, "");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** A balance as wallets return it from `eth_getBalance` ("0x…" wei). */
export function parseWeiHex(hex: unknown): bigint | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  return BigInt(hex);
}

export const isAddress = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
export const isTxHash = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);
/** xmanstudio quote references: "TPX" + 13 upper-case letters or digits. */
export const isQuoteReference = (s: unknown): s is string => typeof s === "string" && /^TPX[A-Z0-9]{13}$/.test(s);

export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/**
 * The TPIX discount as xmanstudio charges it: price × pct / 100 to the satang,
 * half-up. Display only — the order xmanstudio creates is the real figure.
 */
export function discountedThb(priceThb: number, percent: number): { discount: number; total: number } {
  const price = Math.round(Math.max(0, priceThb) * 100);
  const pct = Math.min(100, Math.max(0, Math.trunc(percent)));
  const discount = Math.floor((price * pct + 50) / 100);
  return { discount: discount / 100, total: (price - discount) / 100 };
}

/**
 * About how many TPIX a THB amount is at `rateThb` (THB per TPIX), rounded up
 * to 2 places so the estimate never undersells what the quote will ask.
 */
export function estimateTpix(totalThb: number, rateThb: number): number | null {
  if (!(rateThb > 0) || !(totalThb > 0)) return null;
  return Math.ceil((totalThb / rateThb) * 100) / 100;
}
