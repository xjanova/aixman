import { isHostFault, readBootProgress } from './boot-watch';

/**
 * Each rented machine's own record: what it really did, not what its listing
 * claims. Two RTX PRO 5000s listed alike on 2026-10-27 — one booted LTX in
 * 10 minutes, the other downloaded at a third of the speed. Card-family
 * history (offer-picker.ts) cannot tell them apart; this can.
 *
 * A machine is known by its vendor's physical id where the vendor gives one
 * (Vast `machine_id`), else by the offer id — on SimplePod a listing is one
 * host; on RunPod, Verda and Google Cloud an offer is a pool of identical
 * VMs, so the record describes that pool. Built from `ai_gpu_workers` rows
 * (no table of its own), so it costs no migration and starts with history.
 * Pure: the rows come in, the records go out.
 */

/** The machine an offer rents, comparable across vendors and across rentals. */
export function machineKeyOf(provider: string | undefined, offer: { id: string; machineId?: string }): string {
  return `${provider ?? 'simplepod'}:${offer.machineId ? `m${offer.machineId}` : offer.id}`;
}

/** One past rental, as the record needs it. */
export interface HostRentalRow {
  machineKey: string;
  rentedAt: Date;
  readyAt: Date | null;
  terminatedAt: Date | null;
  lastError: string | null;
  metadata: unknown;
}

export interface HostRecord {
  machineKey: string;
  /** Rentals that reached an outcome: became ready, or failed on the host's account. */
  judged: number;
  failures: number;
  /** Median download rate measured during its boots, Mbit/s; null until one was measured. */
  downloadMbps: number | null;
  /** Why it last failed, for the admin page. */
  lastFailure: string | null;
  lastRentedAt: Date | null;
}

/**
 * Ways a boot ends that are the host's doing. A model's own broken boot
 * ("Worker failed to provision" without a network cause) is the model's;
 * released, idle or drained machines are ours.
 */
const HOST_ENDINGS = /never became healthy|Never reported its HTTPS tunnel|Boot stalled|Download too slow|Provider reported an error|Instance stopped at provider/i;

export function isHostFailure(row: Pick<HostRentalRow, 'readyAt' | 'terminatedAt' | 'lastError'>): boolean {
  if (row.readyAt || !row.terminatedAt) return false;
  return HOST_ENDINGS.test(row.lastError ?? '') || isHostFault(row.lastError);
}

/** A measured boot download in Mbit/s, or null when too little was seen to say. */
export function measuredDownloadMbps(metadata: unknown): number | null {
  const p = readBootProgress(metadata);
  if (!p || p.bytes === undefined || p.firstBytes === undefined || p.firstAt === undefined || p.bytesAt === undefined) return null;
  const bytes = p.bytes - p.firstBytes;
  const seconds = (p.bytesAt - p.firstAt) / 1000;
  if (seconds < 60 || bytes < 1e9) return null;
  return (bytes * 8) / 1e6 / seconds;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeHosts(rows: HostRentalRow[]): Map<string, HostRecord> {
  const groups = new Map<string, HostRentalRow[]>();
  for (const row of rows) {
    const list = groups.get(row.machineKey) ?? [];
    list.push(row);
    groups.set(row.machineKey, list);
  }
  const records = new Map<string, HostRecord>();
  for (const [machineKey, list] of groups) {
    list.sort((a, b) => b.rentedAt.getTime() - a.rentedAt.getTime());
    const failed = list.filter(isHostFailure);
    const rates = list.map((r) => measuredDownloadMbps(r.metadata)).filter((v): v is number => v !== null);
    records.set(machineKey, {
      machineKey,
      judged: list.filter((r) => r.readyAt).length + failed.length,
      failures: failed.length,
      downloadMbps: median(rates),
      lastFailure: failed[0]?.lastError?.slice(0, 200) ?? null,
      lastRentedAt: list[0]?.rentedAt ?? null,
    });
  }
  return records;
}

/**
 * Chance the next boot on this machine fails, with a prior so one boot decides
 * little. Of 79 rentals to 2026-10-27, about one in six never became ready.
 */
export const PRIOR_FAILURE_CHANCE = 0.15;
const PRIOR_WEIGHT = 2;

export function failureChance(record: Pick<HostRecord, 'judged' | 'failures'> | undefined): number {
  const judged = record?.judged ?? 0;
  const failures = record?.failures ?? 0;
  return (failures + PRIOR_FAILURE_CHANCE * PRIOR_WEIGHT) / (judged + PRIOR_WEIGHT);
}

/** The machine a stored rental ran on: its recorded key, else provider + offer id (rows from before). */
export function machineKeyOfRow(providerSlug: string, metadata: unknown): string | null {
  const meta = (metadata ?? {}) as { machineKey?: unknown; offerId?: unknown };
  if (typeof meta.machineKey === 'string' && meta.machineKey) return meta.machineKey;
  return typeof meta.offerId === 'string' && meta.offerId ? `${providerSlug}:${meta.offerId}` : null;
}
