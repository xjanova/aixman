/**
 * What a node push from XMAN Studio (POST /api/gpux/nodes, contract C1) does
 * to the node's row — decided here without a database, so the promises the
 * contract makes can be tested:
 *
 *   - a node that is serving (`ready`/`busy`) stays serving while it is still
 *     eligible and online, however often the same state is pushed;
 *   - a busy node's model never changes under its job;
 *   - a retired row comes back with its clock restarted (`rentedAt = now`);
 *   - a row an admin retired here never comes back from a push;
 *   - a suspension takes the node out at once, and lifting it brings it back;
 *   - a token the relay refused does not revive the row — a new one does.
 */
import type { Eligibility } from './community-eligibility';
import { readCommunityMeta, type CommunityMeta } from './community-dispatch';

export interface NodePayload {
  workerId: string;
  endpoint: string;
  /** The credential for `/w/{id}/*`: the relay's tunnel token (C4), or the legacy single token. */
  token: string;
  label?: string;
  online?: boolean;
  assessed?: boolean;
  gpuName?: string | null;
  vramTotalMb?: number;
  score?: number;
  tier?: string;
  canRun?: string[];
  /** Per-kind speed: `full` for work somebody waits on, `slow` for queued work. */
  lanes?: Record<string, string>;
  /** Kinds whose lane is still the node's opening assumption rather than a measured fact. */
  provisional?: string[];
  ownerUserId?: number;
  // --- C1 additions, all optional ---
  freeSharePct?: number;
  pro?: boolean;
  accepting?: boolean | null;
  busy?: boolean | null;
  referrerUserId?: number | null;
  firstPairedAt?: string | null;
  suspended?: boolean;
}

/**
 * A worker's token opens a tunnel to somebody's PC; over plain http it would
 * travel readable. Only https, or http to this machine during development.
 */
export function endpointProblem(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'endpoint is not a valid URL';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return null;
  return 'endpoint must be https:// (plain http is only allowed for localhost during development)';
}

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const positiveInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];

function lanesOf(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .slice(0, 20)
  );
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** What XMAN Studio told us this time, as it is kept on the row. Every new field is optional on read. */
export function metaFromPush(node: NodePayload, verdict: Eligibility, now: Date = new Date()): CommunityMeta {
  const share = typeof node.freeSharePct === 'number' && Number.isFinite(node.freeSharePct) ? node.freeSharePct : 0;
  return {
    source: 'community',
    ownerUserId: positiveInt(node.ownerUserId),
    label: typeof node.label === 'string' ? node.label.slice(0, 120) : null,
    score: typeof node.score === 'number' && Number.isFinite(node.score) ? node.score : 0,
    tier: typeof node.tier === 'string' ? node.tier.slice(0, 40) : 'unrated',
    canRun: strings(node.canRun),
    lanes: lanesOf(node.lanes),
    // The lane of the model this node was matched to — what dispatch ranks
    // on: `slow` is capacity for work nobody is waiting on, and handing it an
    // impatient customer is the one mistake this field exists to prevent.
    lane: verdict.lane,
    provisional: verdict.provisional,
    eligibility: verdict.status,
    note: verdict.note,
    syncedAt: now.toISOString(),
    freeSharePct: Math.min(100, Math.max(0, Math.round(share))),
    pro: node.pro === true,
    accepting: bool(node.accepting),
    busy: bool(node.busy),
    referrerUserId: positiveInt(node.referrerUserId),
    firstPairedAt: isoOrNull(node.firstPairedAt),
    suspended: node.suspended === true,
  };
}

/** Why a row stays out of the pool for a reason of aixman's own — the top-level status XMAN Studio stores. */
export type PushOutcome = 'retired' | 'suspended' | 'rejected' | null;

export const PUSH_OUTCOME_NOTE: Record<Exclude<PushOutcome, null>, string> = {
  retired: 'ผู้ดูแลระบบ AIXMAN ปลดเครื่องนี้ออกจากการรับงานแล้ว — ติดต่อผู้ดูแลระบบ',
  suspended: 'เครื่องนี้ถูกระงับโดยผู้ดูแล XMAN Studio — ยังไม่ได้รับงาน',
  rejected: 'relay ไม่รับ token ของเครื่องนี้แล้ว — จับคู่เครื่องใหม่ในหน้า GPUxMINE',
};

export interface PushRow {
  status: string;
  terminatedAt: Date | null;
  modelKey: string;
  metadata: unknown;
}

/** The row's own fields to write (endpoint, token and GPU are always written by the caller). */
export interface PushChange {
  status?: 'warming' | 'terminated';
  modelKey?: string;
  terminatedAt?: Date | null;
  rentedAt?: Date;
  readyAt?: null;
  lastError?: string | null;
  metadata: CommunityMeta;
}

export function planNodePush(
  row: PushRow,
  node: NodePayload,
  verdict: Eligibility,
  tokenHash: string,
  now: Date
): { change: PushChange; outcome: PushOutcome } {
  const prev = readCommunityMeta(row.metadata);
  const metadata: CommunityMeta = { ...prev, ...metaFromPush(node, verdict, now) };
  // A new token is a new chance; the refusal was of the old one.
  if (prev.rejectedTokenHash && prev.rejectedTokenHash !== tokenHash) delete metadata.rejectedTokenHash;

  const terminated = row.status === 'terminated' || row.terminatedAt !== null;
  const modelKey = verdict.modelKey ?? 'unassigned';

  // An admin here retired it: XMAN Studio's view of the node is recorded, the
  // row stays out. Only the admin page brings it back.
  if (prev.adminRetired) return { change: { metadata }, outcome: 'retired' };

  // Suspended in XMAN Studio: out now, even mid-job (the job is retried
  // elsewhere), and back when a later push says otherwise — never adminRetired.
  if (node.suspended === true) {
    return {
      change: terminated
        ? { metadata }
        : { metadata, status: 'terminated', terminatedAt: now, lastError: 'ถูกระงับโดยผู้ดูแล XMAN Studio' },
      outcome: 'suspended',
    };
  }

  // The relay refused this very token (reconcileCommunity). Reviving the row
  // would only have it refused again next tick.
  if (terminated && prev.rejectedTokenHash === tokenHash) return { change: { metadata }, outcome: 'rejected' };

  if (terminated) {
    // Back in the pool. The clock restarts: rentedAt dated from the first
    // pairing is what used to get every revival killed by the warmup check.
    return {
      change: { metadata, status: 'warming', modelKey, terminatedAt: null, rentedAt: now, readyAt: null, lastError: null },
      outcome: null,
    };
  }

  // Serving a job: the model under it never changes, and neither does its
  // status — the queue releases it when the job settles.
  if (row.status === 'busy') return { change: { metadata }, outcome: null };

  // Eligible, online and on the same model: nothing the queue cares about
  // changed. Anything else takes it out of rotation until the reconciler's
  // next probe (at most a minute) — including `offline`, which may be a stale
  // sample, but then the probe simply puts it back.
  if (row.status === 'ready' && verdict.status === 'eligible' && row.modelKey === modelKey) {
    return { change: { metadata }, outcome: null };
  }

  return { change: { metadata, status: 'warming', modelKey }, outcome: null };
}
