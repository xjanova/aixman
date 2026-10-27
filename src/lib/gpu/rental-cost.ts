import { readBootProgress } from './boot-watch';

/**
 * What a rental really costs, and how long a booted machine is worth keeping.
 *
 * Uptime × the hourly price was all we counted, but a Vast host also bills
 * every GB downloaded into the machine (`inet_down_cost`) — an LTX boot pulls
 * ~40 GB of weights. On 2026-10-27 one 10-minute film rented 17 LTX machines;
 * the admin page said $2.80, the vendor balance fell about $5. Pure, so the
 * money rules are pinned by tests (rental-cost.test.mts).
 */

/** What a rental's downloads are billed at, stored in `metadata.ingress` when it is rented. */
export interface IngressTerms {
  usdPerGb: number;
  /** Everything a full boot downloads (the catalogue's weights). */
  gb: number;
}

export function ingressTerms(usdPerGb: number | undefined, gb: number): IngressTerms | null {
  if (!usdPerGb || !(usdPerGb > 0) || !(gb > 0)) return null;
  return { usdPerGb, gb };
}

export function readIngress(metadata: unknown): IngressTerms | null {
  const raw = (metadata as { ingress?: unknown } | null)?.ingress as Partial<IngressTerms> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const usdPerGb = Number(raw.usdPerGb);
  const gb = Number(raw.gb);
  return Number.isFinite(usdPerGb) && usdPerGb > 0 && Number.isFinite(gb) && gb > 0 ? { usdPerGb, gb } : null;
}

/**
 * Download fees so far: the whole boot once the machine came up, else what its
 * proxy reported on disk. A floor — pip packages and the image pull are not
 * measured.
 */
export function ingressUsd(worker: { readyAt: Date | null; metadata: unknown }): number {
  const terms = readIngress(worker.metadata);
  if (!terms) return 0;
  const onDisk = (readBootProgress(worker.metadata)?.bytes ?? 0) / 1e9;
  const gb = worker.readyAt ? terms.gb : Math.min(terms.gb, onDisk);
  return gb * terms.usdPerGb;
}

export interface RentalCostRow {
  rentedAt: Date;
  terminatedAt: Date | null;
  readyAt: Date | null;
  pricePerHourUsd: unknown;
  metadata: unknown;
}

/** Uptime at the hourly price, plus download fees, up to `until` or the end of the rental. */
export function rentalCostUsd(worker: RentalCostRow, until: Date = new Date()): number {
  const end = worker.terminatedAt && worker.terminatedAt < until ? worker.terminatedAt : until;
  const ms = Math.max(0, end.getTime() - worker.rentedAt.getTime());
  return (ms / 3_600_000) * Number(worker.pricePerHourUsd) + ingressUsd(worker);
}

/**
 * How long a booted machine may sit idle before closing it costs more than it
 * saves. Closing now and renting again for the next order pays a whole boot
 * (its minutes at the hourly price, plus the downloads); waiting pays the
 * hourly price. Waiting up to that break-even point never costs more than
 * twice the better choice in hindsight (the ski-rental rule), whatever comes
 * next — so a machine that took 10 minutes and 40 GB to boot waits about 10
 * minutes, and a 2-minute boot keeps the plain idle timeout.
 */
export const MAX_KEEP_WARM_MINUTES = 20;

export function keepWarmMinutes(input: {
  idleTimeoutMinutes: number;
  pricePerHourUsd: number;
  /** How long this machine took to boot. */
  bootSeconds: number;
  ingress: IngressTerms | null;
}): number {
  const price = input.pricePerHourUsd;
  if (!(price > 0)) return input.idleTimeoutMinutes;
  const rebootUsd = (price * Math.max(0, input.bootSeconds)) / 3600 + (input.ingress ? input.ingress.gb * input.ingress.usdPerGb : 0);
  const breakEven = (rebootUsd / price) * 60;
  return Math.max(input.idleTimeoutMinutes, Math.min(MAX_KEEP_WARM_MINUTES, breakEven));
}
