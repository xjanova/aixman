/**
 * GPUxMINE — the rules for keeping community machines in the pool and handing
 * them work.
 *
 * A rented machine and a community machine look the same to the queue (an
 * endpoint, a token, a model), but they die differently. A rented one is ours
 * to kill: every minute it idles costs money, so it is reaped on a timer. A
 * community one is somebody's PC that costs nothing while idle, goes offline
 * when its owner closes the lid, pauses while they game, and comes back. The
 * rental reaper applied to it threw nodes out of the pool for good after one
 * network blip, ten quiet minutes or an hour of uptime.
 *
 * Everything here is a decision, not an action — no database, no fetch — so
 * the rules can be tested with a plain `node --test`, and GpuWorkerManager /
 * GpuQueue carry them out.
 */

/** Providers whose rows are community machines rather than rentals (exposure `pool-relay`). */
export const COMMUNITY_PROVIDER_SLUGS: readonly string[] = ['gpuxmine'];

export function isCommunitySlug(slug: string | null | undefined): boolean {
  return typeof slug === 'string' && COMMUNITY_PROVIDER_SLUGS.includes(slug);
}

/**
 * A ready row is asked again this often. Its owner can pause it, start a game
 * or queue their own ComfyUI batch at any moment, and the node only says so
 * when asked; a job sent in between is refused and requeued, which costs the
 * customer nothing but a few seconds.
 */
export const READY_REPROBE_MS = 3 * 60_000;

/** At most this many community probes in flight at once, so a large pool cannot hold the tick. */
export const PROBE_CONCURRENCY = 8;

/**
 * Probing stops starting new probes after this long in one tick; the rest wait
 * for the next. The tick's lease is 150 s and renting still has to fit in it.
 */
export const PROBE_BUDGET_MS = 60_000;

/**
 * This many probes in a row failing at the network level, with not one HTTP
 * answer, means the relay itself is down: the rest of the pool is read as
 * unreachable without each costing a full timeout.
 */
export const RELAY_DOWN_AFTER = 2 * PROBE_CONCURRENCY;

/** A job remembers at most this many machines it failed on. */
export const AVOID_LIST_LIMIT = 20;

/**
 * What XMAN Studio wrote into `ai_gpu_workers.metadata` when it last pushed the
 * node across (POST /api/gpux/nodes, contract C1), plus aixman's own markers.
 * Every field is optional: rows written by older builds have fewer of them.
 */
export interface CommunityMeta {
  source?: string;
  ownerUserId?: number | null;
  label?: string | null;
  score?: number;
  tier?: string;
  canRun?: string[];
  /** ต่องาน: "full" = เร็วพอให้คนนั่งรอ · "slow" = ส่งเฉพาะงานที่ไม่มีคนรอ */
  lanes?: Record<string, string>;
  /** The lane of the model this node was matched to — what dispatch ranks on. */
  lane?: string;
  provisional?: boolean;
  eligibility?: string;
  note?: string;
  syncedAt?: string;
  /** 0..100 — the share of this node's work its owner gives away (C1). */
  freeSharePct?: number;
  pro?: boolean;
  /** The node heartbeat's `accepting`; null when XMAN Studio did not know. */
  accepting?: boolean | null;
  busy?: boolean | null;
  referrerUserId?: number | null;
  firstPairedAt?: string | null;
  /** Suspended by an XMAN Studio admin: out of the pool until un-suspended. */
  suspended?: boolean;
  /** Retired by an aixman admin. A push from XMAN Studio never undoes this. */
  adminRetired?: boolean;
  adminRetiredAt?: string;
  /**
   * sha256 of a token the relay refused (401/403). The same token pushed again
   * would be refused again, so it does not bring the row back — a new one does.
   */
  rejectedTokenHash?: string;
}

export function readCommunityMeta(metadata: unknown): CommunityMeta {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as CommunityMeta) : {};
}

// ---------------------------------------------------------------------------
// The node's own "not now" (contract C5)
// ---------------------------------------------------------------------------

/** Thai for the stages a node (or the relay, for `offline`) refuses work with. */
const STAGE_LABEL: Record<string, string> = {
  offline: 'เครื่องไม่ได้เชื่อมต่อ relay',
  paused: 'เจ้าของเครื่องพักการแชร์อยู่',
  unassessed: 'เครื่องยังไม่ผ่านการประเมิน',
  busy: 'เครื่องกำลังทำงานอื่นอยู่',
  draining: 'เครื่องกำลังหยุดรับงาน',
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? `เครื่องยังไม่พร้อม (${stage})`;
}

export interface NodeRefusal {
  stage: string;
  reason?: string;
  status: number;
}

/**
 * A node's refusal to take work: 503 `{ready:false, stage, reason}` from the
 * node or the relay, or 409 `{stage:'busy'}` for a second prompt. Anything
 * without a stage is an ordinary failure, not a refusal.
 */
export function parseNodeRefusal(status: number, body: string): NodeRefusal | null {
  if (status !== 503 && status !== 409) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { stage, reason, detail } = parsed as { stage?: unknown; reason?: unknown; detail?: unknown };
  if (typeof stage !== 'string' || stage.trim() === '') return null;
  const why = typeof reason === 'string' ? reason : typeof detail === 'string' ? detail : undefined;
  return { stage: stage.trim().slice(0, 40), reason: why?.slice(0, 200), status };
}

/**
 * Thrown by WorkerClient when a node says "not now". It is the node keeping
 * its owner's promise (paused, gaming, their own batch running), not a fault:
 * the job goes back to the queue without spending an attempt.
 */
export class NodeRefusedError extends Error {
  readonly stage: string;
  readonly status: number;
  readonly reason?: string;

  constructor(refusal: NodeRefusal, what: string) {
    super(`Node refused ${what}: ${refusal.stage}${refusal.reason ? ` — ${refusal.reason}` : ''} (HTTP ${refusal.status})`);
    this.name = 'NodeRefusedError';
    this.stage = refusal.stage;
    this.status = refusal.status;
    this.reason = refusal.reason;
  }
}

export function isNodeRefusal(error: unknown): error is NodeRefusedError {
  return error instanceof NodeRefusedError || (error as { name?: unknown } | null)?.name === 'NodeRefusedError';
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

export interface SubmitFailurePlan {
  /** Back to the queue without spending one of the job's attempts. */
  requeueWithoutAttempt: boolean;
  /**
   * What the worker becomes. `warming` = out of rotation until the reconciler
   * hears a 200 from its /aixman/ready again. Null = settleFailure's usual rule.
   */
  workerStatus: 'warming' | null;
  /** Never offer this job to this worker again. */
  avoidWorker: boolean;
}

/**
 * What a failed submit means.
 *
 * Rented machines keep the rule they always had. A community machine that
 * refused with a stage is paused, busy or offline — the job owes it nothing
 * and should not pay an attempt for it. Any other failure on a community
 * machine (a checkpoint the owner deleted, a broken ComfyUI) would fail the
 * same way again, so the job moves on to another node and this one is checked
 * before it gets more work.
 */
export function planSubmitFailure(error: unknown, community: boolean): SubmitFailurePlan {
  if (!community) return { requeueWithoutAttempt: false, workerStatus: null, avoidWorker: false };
  if (isNodeRefusal(error)) return { requeueWithoutAttempt: true, workerStatus: 'warming', avoidWorker: false };
  return { requeueWithoutAttempt: false, workerStatus: 'warming', avoidWorker: true };
}

/** A job's stored avoid-list (ai_gpu_jobs.avoid_worker_ids), tolerant of anything malformed. */
export function readAvoidList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0);
}

/** The list with `workerId` added, newest last, bounded. */
export function withAvoided(value: unknown, workerId: number): number[] {
  const list = readAvoidList(value).filter((id) => id !== workerId);
  list.push(workerId);
  return list.slice(-AVOID_LIST_LIMIT);
}

// ---------------------------------------------------------------------------
// Reconciling
// ---------------------------------------------------------------------------

export type ProbeResult = { status: number; body: unknown } | { error: string };

export type ProbeVerdict =
  | { next: 'ready'; detail?: string }
  | { next: 'warming'; detail: string; stage?: string }
  | { next: 'terminated'; detail: string };

/**
 * One answer from `{endpoint}/aixman/ready`, read as a decision.
 *
 * Only a relay that refuses the token ends the row: that credential is dead
 * and asking again changes nothing until XMAN Studio pushes a new one. Every
 * other answer — offline, paused, busy, unreachable, an odd status — leaves
 * the node in the pool, out of rotation, and it is asked again next tick.
 */
export function classifyCommunityProbe(result: ProbeResult): ProbeVerdict {
  if ('error' in result) {
    return { next: 'warming', detail: `ติดต่อเครื่องไม่ได้: ${result.error}`.slice(0, 300) };
  }
  const body = (result.body && typeof result.body === 'object' ? result.body : {}) as {
    stage?: unknown;
    reason?: unknown;
    detail?: unknown;
    error?: unknown;
  };
  if (result.status >= 200 && result.status < 300) return { next: 'ready' };

  if (result.status === 401) {
    return { next: 'terminated', detail: 'relay ปฏิเสธ token ของเครื่องนี้ (401) — รอ XMAN Studio ส่ง token ใหม่' };
  }
  if (result.status === 403) {
    // Deny-by-default on the tunnel (contract C4) is a configuration problem
    // on our side, not a verdict on the node.
    if (body.error === 'path-not-allowed') {
      return { next: 'warming', detail: 'relay ไม่อนุญาตให้เรียก /aixman/ready (403 path-not-allowed)' };
    }
    return { next: 'terminated', detail: 'relay ปิดกั้นเครื่องนี้ (403)' };
  }

  if (typeof body.stage === 'string' && body.stage.trim() !== '') {
    const stage = body.stage.trim().slice(0, 40);
    const why = typeof body.reason === 'string' ? body.reason : typeof body.detail === 'string' ? body.detail : '';
    return { next: 'warming', stage, detail: `${stageLabel(stage)} (${stage})${why ? `: ${why}` : ''}`.slice(0, 300) };
  }
  return { next: 'warming', detail: `เครื่องตอบ HTTP ${result.status}` };
}

/**
 * One tick's probing, bounded. Every probe goes through the same relay, so a
 * relay that is down makes every probe wait its full timeout — a few hundred
 * nodes would hold the tick past its lease. After RELAY_DOWN_AFTER network
 * failures with no answer at all, the rest are read as unreachable (out of
 * rotation, which dispatching to them would have ended in anyway); after
 * PROBE_BUDGET_MS, the rest wait for the next tick.
 */
export class ProbeBudget {
  private readonly startedAt: number;
  private errors = 0;
  private answers = 0;

  constructor(startedAt: number) {
    this.startedAt = startedAt;
  }

  next(now: number): 'probe' | 'skip' | 'unreachable' {
    if (this.answers === 0 && this.errors >= RELAY_DOWN_AFTER) return 'unreachable';
    if (now - this.startedAt > PROBE_BUDGET_MS) return 'skip';
    return 'probe';
  }

  record(result: ProbeResult): void {
    if ('error' in result) this.errors += 1;
    else this.answers += 1;
  }
}

export interface CommunityRowState {
  status: string;
  hasEndpoint: boolean;
  /** Jobs assigned to or running on this row right now. */
  activeJobs: number;
  meta: CommunityMeta;
  /**
   * The row's modelKey is a catalogue entry community machines may run. A row
   * matched before catalogue pools existed can still name a rented model
   * until XMAN Studio's next push re-matches it; the queue already ignores it
   * for that model, and holding it keeps it out of every "serving" count too.
   */
  modelAllowed?: boolean;
  /** When this process last probed the row (ms), or null. */
  lastProbedAt: number | null;
  now: number;
}

export type CommunityStep =
  | { kind: 'leave' }
  /** Out of rotation, and not worth asking: set `warming` with this reason. */
  | { kind: 'hold'; lastError: string }
  | { kind: 'probe' };

/**
 * Why a row may not be given work whatever it answers, or null when it may.
 *
 * `offline` is not in the list: that is XMAN Studio's last sample of relay
 * presence, which can be minutes old. The probe goes through the same relay
 * and is the fresher answer.
 */
export function communityHoldReason(meta: CommunityMeta): string | null {
  if (meta.adminRetired) return 'ผู้ดูแลระบบปลดเครื่องนี้ออกจากระบบแล้ว';
  if (meta.suspended) return 'ถูกระงับโดยผู้ดูแล XMAN Studio';
  const eligibility = meta.eligibility;
  if (eligibility === undefined || eligibility === 'eligible' || eligibility === 'offline') return null;
  return meta.note || `ยังรับงานไม่ได้ (${eligibility})`;
}

/**
 * What the reconciler does with one community row this tick. None of the
 * rental reapers apply — no lifetime, warmup timeout, idle timeout, budget or
 * drain-means-terminate — because none of them saves money on a machine that
 * costs nothing. Only a DELETE from XMAN Studio, an admin, or a relay that
 * refuses the token ends a row.
 */
export function planCommunityReconcile(s: CommunityRowState): CommunityStep {
  // The queue owns a row with a job on it: pollRunningJobs waits out a node
  // that drops offline mid-render until the job timeout, instead of throwing
  // the render away on the first blip.
  if (s.activeJobs > 0) return { kind: 'leave' };

  const hold = communityHoldReason(s.meta);
  if (hold) return { kind: 'hold', lastError: hold };
  if (s.modelAllowed === false) {
    return { kind: 'hold', lastError: 'โมเดลที่จับคู่ไว้ไม่ได้เปิดให้เครื่องชุมชน — รอ XMAN Studio ส่งข้อมูลเครื่องรอบใหม่' };
  }
  if (!s.hasEndpoint) return { kind: 'hold', lastError: 'ยังไม่มี endpoint ของเครื่องนี้' };

  if (s.status === 'ready') {
    const fresh = s.lastProbedAt !== null && s.now - s.lastProbedAt < READY_REPROBE_MS;
    return fresh ? { kind: 'leave' } : { kind: 'probe' };
  }
  // warming / provisioning: every tick. busy with no job: a reservation that
  // outlived its submit. draining: taken out of rotation after a bad job —
  // for a machine we do not own that means "check it", never "kill it".
  return { kind: 'probe' };
}

export interface CommunityTransition {
  status: 'ready' | 'warming' | 'terminated';
  /** Stamp readyAt: the row is entering rotation rather than staying in it. */
  stampReadyAt: boolean;
  lastError: string | null;
  /** The node's model files may have changed while it was away — drop the cached /object_info. */
  forgetSchema: boolean;
}

export function transitionAfterProbe(prevStatus: string, verdict: ProbeVerdict): CommunityTransition {
  if (verdict.next === 'ready') {
    return { status: 'ready', stampReadyAt: prevStatus !== 'ready', lastError: verdict.detail ?? null, forgetSchema: false };
  }
  return {
    status: verdict.next,
    stampReadyAt: false,
    lastError: verdict.detail,
    forgetSchema: prevStatus === 'ready' || prevStatus === 'busy' || verdict.next === 'terminated',
  };
}

// ---------------------------------------------------------------------------
// Choosing a machine
// ---------------------------------------------------------------------------

export interface CommunityCandidate {
  id: number;
  /** metadata.lane — how fast this node runs the model it was matched to. */
  lane?: string | null;
  lastJobAt: Date | null;
  /**
   * Higher goes first within a lane. 0 for everyone today; the cooperation
   * data (gpux-settlement.ts dispatchPriority) is meant to feed in here.
   */
  priority?: number;
}

export function laneOf(candidate: Pick<CommunityCandidate, 'lane'>): 'full' | 'slow' {
  return candidate.lane === 'slow' ? 'slow' : 'full';
}

/**
 * The order idle community machines are offered work in.
 *
 * Full lane before slow: a card that takes four minutes an image should not
 * serve somebody watching a progress bar while a quick one sits idle. Within
 * a lane, the machine given work least recently goes first — one that never
 * had a job before all others. The old warmest-first order handed one owner
 * every job and left new nodes earning nothing, which is how a volunteer
 * network loses its volunteers.
 */
export function rankCommunityCandidates<T extends CommunityCandidate>(rows: readonly T[]): T[] {
  const fairness = (a: T, b: T): number => {
    const byPriority = (b.priority ?? 0) - (a.priority ?? 0);
    if (byPriority !== 0) return byPriority;
    const at = a.lastJobAt?.getTime();
    const bt = b.lastJobAt?.getTime();
    if (at === undefined && bt !== undefined) return -1;
    if (bt === undefined && at !== undefined) return 1;
    if (at !== undefined && bt !== undefined && at !== bt) return at - bt;
    return a.id - b.id;
  };
  const full = rows.filter((r) => laneOf(r) === 'full').sort(fairness);
  const slow = rows.filter((r) => laneOf(r) === 'slow').sort(fairness);
  return [...full, ...slow];
}

/**
 * Whether slow-lane machines may take work in this pass. Not while a
 * full-lane machine is idle — unless every idle full-lane machine has already
 * been tried and none could take what is left (the jobs it failed before).
 */
export function slowLaneOpen(idleFullRows: number, fullRowsBlocked: boolean): boolean {
  return idleFullRows === 0 || fullRowsBlocked;
}
