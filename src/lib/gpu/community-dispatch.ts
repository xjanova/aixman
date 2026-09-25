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

import { isCommunitySafe, type ContentTier } from '@/lib/safety/content-tier';

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
  disabled: 'relay ปิดการรับงานของเครื่องนี้ชั่วคราว (ผู้ดูแลระงับไว้)',
  'relay-busy': 'relay ไม่ว่างชั่วคราว — คำขอยังไม่ถึงเครื่อง',
};

/**
 * The relay's reversible "no" (contract C4 disable/enable): 403
 * `{error:'worker-disabled'}`. It knows the token and is holding the node
 * back until it is switched on again — unlike 401, which is a dead token.
 */
export const RELAY_DISABLED_ERROR = 'worker-disabled';

/** The stage a relay-disabled node is read as, for refusals and probes alike. */
export const DISABLED_STAGE = 'disabled';

/**
 * The relay pushing back for itself (contract C4): 503 `{error:'relay-busy'}`
 * when the buffers it holds request bodies in are full (Retry-After 5), and
 * 429 `{error:'rate-limited'}` when this worker's tunnel allowance is spent.
 * Neither carries a stage, because neither says anything about the node: the
 * relay turns the request away before the node sees it. Read as this stage,
 * so the job goes back to the queue without spending an attempt and the
 * machine stays in rotation — not parked in `warming`, not on the job's
 * avoid list.
 */
export const RELAY_BUSY_ERROR = 'relay-busy';

/** The stage relay pushback (503 relay-busy, 429) is read as. */
export const RELAY_BUSY_STAGE = 'relay-busy';

/**
 * Relay pushback on one machine this many times in a row, with no submit
 * getting through in between, parks it like any other "not now". Once is the
 * relay under load. Again and again is more likely that node's own share of
 * the relay (its agent stopped reading, so the relay's buffer for it stays
 * full) — or a modified node answering in the relay's words to stay in
 * rotation while refusing every job. Parked, it is asked /aixman/ready next
 * tick like any warming row, and comes back on a 200.
 */
export const RELAY_PUSHBACK_PARK_AFTER = 3;

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
 * node or the relay, 409 `{stage:'busy'}` for a second prompt, or the relay's
 * 403 `{error:'worker-disabled'}` for a node an admin has switched off for
 * now. The relay's own pushback — 503 `{error:'relay-busy'}`, and any 429 —
 * is read as stage `relay-busy`. Anything else without a stage is an ordinary
 * failure, not a refusal.
 */
export function parseNodeRefusal(status: number, body: string): NodeRefusal | null {
  // A rate limit is never the node's verdict on the work (the node client has
  // no 429 of its own), whatever the body says — the relay's, or a proxy's in
  // front of it.
  if (status === 429) return { stage: RELAY_BUSY_STAGE, reason: 'rate-limited', status };
  if (status !== 503 && status !== 409 && status !== 403) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (status === 403) {
    // Only the reversible 403 is a "not now"; path-not-allowed and the rest stay failures.
    return (parsed as { error?: unknown }).error === RELAY_DISABLED_ERROR ? { stage: DISABLED_STAGE, status } : null;
  }
  const { stage, reason, detail, error } = parsed as { stage?: unknown; reason?: unknown; detail?: unknown; error?: unknown };
  if (typeof stage !== 'string' || stage.trim() === '') {
    return status === 503 && error === RELAY_BUSY_ERROR ? { stage: RELAY_BUSY_STAGE, reason: RELAY_BUSY_ERROR, status } : null;
  }
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

/** The relay turned the request away for itself (503 relay-busy, 429) — see RELAY_BUSY_ERROR. */
export function isRelayPushback(error: unknown): error is NodeRefusedError {
  return isNodeRefusal(error) && error.stage === RELAY_BUSY_STAGE;
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

export interface SubmitFailurePlan {
  /** Back to the queue without spending one of the job's attempts. */
  requeueWithoutAttempt: boolean;
  /**
   * What the worker becomes. `warming` = out of rotation until the reconciler
   * hears a 200 from its /aixman/ready again. Null = settleFailure's usual
   * rule — or, with `requeueWithoutAttempt`, straight back to `ready`: the
   * relay pushed back and the node itself was never asked.
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
 * and should not pay an attempt for it. The relay pushing back for itself
 * (relay-busy, rate-limited) owes the job nothing either, and says nothing
 * about the node, which stays in rotation — until it has happened
 * RELAY_PUSHBACK_PARK_AFTER times in a row (`pushbacksInARow` counts the ones
 * before this). Any other failure on a community machine (a checkpoint the
 * owner deleted, a broken ComfyUI) would fail the same way again, so the job
 * moves on to another node and this one is checked before it gets more work.
 */
export function planSubmitFailure(error: unknown, community: boolean, pushbacksInARow: number = 0): SubmitFailurePlan {
  if (!community) return { requeueWithoutAttempt: false, workerStatus: null, avoidWorker: false };
  if (isRelayPushback(error)) {
    const park = pushbacksInARow + 1 >= RELAY_PUSHBACK_PARK_AFTER;
    return { requeueWithoutAttempt: true, workerStatus: park ? 'warming' : null, avoidWorker: false };
  }
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
// Which jobs a community machine may take (owner decision D4)
// ---------------------------------------------------------------------------

/** Payload fields that carry something the customer uploaded (WorkerJobParams + its `extra`). */
const INPUT_MEDIA_FIELDS = ['inputImage', 'inputImageEnd', 'inputAudio', 'inputVideo'] as const;

/**
 * Whether a queued job's payload carries a customer's upload — a first or
 * last frame, a reference song, a clip. Read from the payload itself so a job
 * enqueued without the flag is still caught.
 */
export function payloadHasInputMedia(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  const extra = p.extra && typeof p.extra === 'object' ? (p.extra as Record<string, unknown>) : {};
  return INPUT_MEDIA_FIELDS.some((field) => {
    const value = p[field] ?? extra[field];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/** Job columns the claim decides on. */
export interface ClaimRow {
  id: number;
  avoidWorkerIds: unknown;
  contentTier: string | null;
  hasInputMedia: boolean | null;
}

/** The Prisma filter for jobs a community machine may be handed (mirrors isCommunitySafe). */
export const COMMUNITY_SAFE_JOB: { contentTier: ContentTier; hasInputMedia: boolean } = {
  contentTier: 'general',
  hasInputMedia: false,
};

/**
 * The queued job (already in claim order) this machine should take, or null.
 * Never one that failed on this machine before; and for a community machine,
 * only general content with nothing the customer uploaded. The query already
 * filters on the same columns — this is the rule, and the last word.
 */
export function pickClaimCandidate<T extends ClaimRow>(queued: readonly T[], workerId: number, community: boolean): T | null {
  return (
    queued.find(
      (job) => !readAvoidList(job.avoidWorkerIds).includes(workerId) && (!community || isCommunitySafe(job))
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Reconciling
// ---------------------------------------------------------------------------

export type ProbeResult = { status: number; body: unknown } | { error: string };

export type ProbeVerdict =
  | { next: 'ready'; detail?: string }
  | { next: 'warming'; detail: string; stage?: string }
  /**
   * `rejectToken`: the relay said this token is dead (401). Only then is the
   * token remembered as refused, so pushing it again does not revive the row.
   */
  | { next: 'terminated'; detail: string; rejectToken: boolean };

/**
 * One answer from `{endpoint}/aixman/ready`, read as a decision.
 *
 * Only a relay that refuses the token ends the row: that credential is dead
 * and asking again changes nothing until XMAN Studio pushes a new one. Every
 * other answer — offline, paused, busy, unreachable, an odd status, and a
 * node the relay has disabled for now (403 worker-disabled, which an enable
 * undoes) — leaves the node in the pool, out of rotation, and it is asked
 * again next tick.
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
    return {
      next: 'terminated',
      detail: 'relay ปฏิเสธ token ของเครื่องนี้ (401) — รอ XMAN Studio ส่ง token ใหม่',
      rejectToken: true,
    };
  }
  if (result.status === 403) {
    // Deny-by-default on the tunnel (contract C4) is a configuration problem
    // on our side, not a verdict on the node.
    if (body.error === 'path-not-allowed') {
      return { next: 'warming', detail: 'relay ไม่อนุญาตให้เรียก /aixman/ready (403 path-not-allowed)' };
    }
    // Disabled on the relay (an XMAN Studio suspension, or an operator):
    // reversible, with the same token. Ending the row here would leave it
    // dead after the enable, since nothing would ever bring it back.
    if (body.error === RELAY_DISABLED_ERROR) {
      return {
        next: 'warming',
        stage: DISABLED_STAGE,
        detail: `${stageLabel(DISABLED_STAGE)} (${DISABLED_STAGE}) — 403 ${RELAY_DISABLED_ERROR}`,
      };
    }
    // A 403 this build does not know. Out of the pool, but the token is not
    // written off: the next push with it brings the row back to be asked again.
    return { next: 'terminated', detail: 'relay ปิดกั้นเครื่องนี้ (403)', rejectToken: false };
  }

  if (typeof body.stage === 'string' && body.stage.trim() !== '') {
    const stage = body.stage.trim().slice(0, 40);
    const why = typeof body.reason === 'string' ? body.reason : typeof body.detail === 'string' ? body.detail : '';
    return { next: 'warming', stage, detail: `${stageLabel(stage)} (${stage})${why ? `: ${why}` : ''}`.slice(0, 300) };
  }
  // The relay pushing back for itself never reached the node, so the node is
  // not blamed for it (and its cached schema is kept — transitionAfterProbe).
  // Still out of rotation until the next tick's probe: a probe is one small
  // GET, and a relay that turns even that away would turn the job away too.
  if (result.status === 429 || (result.status === 503 && body.error === RELAY_BUSY_ERROR)) {
    return {
      next: 'warming',
      stage: RELAY_BUSY_STAGE,
      detail: `${stageLabel(RELAY_BUSY_STAGE)} (${RELAY_BUSY_STAGE}) — HTTP ${result.status}`,
    };
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
  // Relay pushback never reached the node: nothing on it can have changed.
  const nodeAnswered = !(verdict.next === 'warming' && verdict.stage === RELAY_BUSY_STAGE);
  return {
    status: verdict.next,
    stampReadyAt: false,
    lastError: verdict.detail,
    forgetSchema: verdict.next === 'terminated' || (nodeAnswered && (prevStatus === 'ready' || prevStatus === 'busy')),
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
   * Higher goes first within a lane: the node's dispatch-priority band from
   * gpux-ledger.ts communityPriority (the owner's cooperation, the node's
   * success rate, its lane). Absent reads as 0.
   */
  priority?: number;
}

export interface RankOptions {
  /**
   * This pass is a lottery slot (gpux-settlement.ts isLotterySlot): order each
   * lane at random, ignoring priority and history, so a node with no record
   * yet still gets picked sometimes and can start building one.
   */
  lottery?: boolean;
  /** 0-1, for the lottery's shuffle; Math.random unless a test pins it. */
  random?: () => number;
}

export function laneOf(candidate: Pick<CommunityCandidate, 'lane'>): 'full' | 'slow' {
  return candidate.lane === 'slow' ? 'slow' : 'full';
}

/**
 * The order idle community machines are offered work in.
 *
 * Full lane before slow: a card that takes four minutes an image should not
 * serve somebody watching a progress bar while a quick one sits idle. Within
 * a lane, a higher priority band first (what the owner has given, how
 * reliably the node delivers), then the machine given work least recently —
 * one that never had a job before all others. The old warmest-first order
 * handed one owner every job and left new nodes earning nothing, which is how
 * a volunteer network loses its volunteers. On a lottery pass each lane is
 * shuffled instead; the lanes themselves never are.
 */
export function rankCommunityCandidates<T extends CommunityCandidate>(rows: readonly T[], options: RankOptions = {}): T[] {
  if (options.lottery) {
    const random = options.random ?? Math.random;
    const shuffle = (list: T[]): T[] => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(random() * (i + 1)));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    };
    const byId = (a: T, b: T) => a.id - b.id;
    return [
      ...shuffle(rows.filter((r) => laneOf(r) === 'full').sort(byId)),
      ...shuffle(rows.filter((r) => laneOf(r) === 'slow').sort(byId)),
    ];
  }
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

// ---------------------------------------------------------------------------
// Orders for a community-only model (owner decision D5)
// ---------------------------------------------------------------------------

/**
 * How long a community-only job may wait with no machine taking work before
 * it is refunded. Nothing is rented for these models, so there is no boot to
 * wait out — only an owner who may come back. GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN,
 * default 5 minutes, 1 to 120.
 */
export function communityQueueGraceMs(env: Record<string, string | undefined> = process.env): number {
  const minutes = Number(env.GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN);
  const bounded = Number.isFinite(minutes) && minutes > 0 ? Math.min(120, Math.max(1, minutes)) : 5;
  return Math.round(bounded * 60_000);
}

/** Statuses of a community row that count as "there is a machine for this order". */
export const COMMUNITY_ORDERABLE_STATUSES: readonly string[] = ['ready', 'busy', 'warming'];

/**
 * Whether a row's last word from the relay was "this node is not connected"
 * (503 stage offline) or "switched off by an admin" (403 worker-disabled) —
 * as reconcileCommunity and requeueRefused write it: `<label> (<stage>)`.
 * Neither is an owner stepping away for a minute.
 */
export function lastErrorSaysAway(lastError: string | null | undefined): boolean {
  return typeof lastError === 'string' && (lastError.includes('(offline)') || lastError.includes(`(${DISABLED_STAGE})`));
}

export interface OrderableRow {
  status: string;
  endpoint: string | null;
  metadata: unknown;
  readyAt?: Date | null;
  lastJobAt?: Date | null;
  lastError?: string | null;
}

/**
 * Whether one community row counts as a machine that may serve a new order:
 * up, busy, or warming, and not held out for a reason of its own (retired,
 * suspended, not eligible, matched to a model it may not run).
 *
 * A warming row counts while its owner may be back in a minute — paused, busy
 * with their own work — or while it was serving moments ago (a blip). A PC
 * that is simply switched off does not: XMAN Studio says it is offline, or
 * the relay did on the last probe (or said an admin disabled it), and it
 * served nothing within `recentMs`. Counting it charged every order placed
 * overnight only to refund it after the grace.
 */
export function communityRowMayServe(
  row: OrderableRow,
  now: number = Date.now(),
  recentMs: number = communityQueueGraceMs()
): boolean {
  if (!COMMUNITY_ORDERABLE_STATUSES.includes(row.status)) return false;
  if (!row.endpoint) return false;
  const meta = readCommunityMeta(row.metadata);
  if (communityHoldReason(meta) !== null) return false;
  if (row.status !== 'warming') return true;
  const servedAt = Math.max(row.readyAt?.getTime() ?? 0, row.lastJobAt?.getTime() ?? 0);
  if (servedAt > 0 && now - servedAt < recentMs) return true;
  return meta.eligibility !== 'offline' && !lastErrorSaysAway(row.lastError);
}

/**
 * When a community job's pool last had a machine for it, as far as anyone
 * can tell — so the grace before a refund (D5) runs from when the pool went
 * dark, not from when the order was placed. A job queued behind a busy node
 * for ten minutes is not ten minutes into its grace the moment that node
 * steps out for one tick.
 *
 * For each row that may take this job (not retired, not on its avoid list):
 * the last time this process saw it ready or busy, its readyAt and lastJobAt
 * — and, for a row this process has never seen serving, when the process
 * started, since it cannot know what happened before. Null when no such row
 * exists at all.
 */
export function communityLastServingAt(
  rows: readonly { id: number; readyAt: Date | null; lastJobAt: Date | null }[],
  seenServingAt: ReadonlyMap<number, number>,
  avoid: readonly number[],
  processStartedAt: number
): number | null {
  let latest: number | null = null;
  for (const row of rows) {
    if (avoid.includes(row.id)) continue;
    const at = Math.max(
      seenServingAt.get(row.id) ?? processStartedAt,
      row.readyAt?.getTime() ?? 0,
      row.lastJobAt?.getTime() ?? 0
    );
    latest = latest === null ? at : Math.max(latest, at);
  }
  return latest;
}

export type CommunityOrderRefusal = 'adult' | 'unreadable' | 'input-media' | 'no-machine';

/**
 * Why an order for a community-only model is refused before any credit
 * moves, or null to take it. Such a model has no other pool: a job no
 * community machine may take would only wait out the grace and be refunded.
 */
export function communityOrderRefusal(order: {
  contentTier: ContentTier;
  hasInputMedia: boolean;
  machineAvailable: boolean;
}): CommunityOrderRefusal | null {
  if (order.hasInputMedia) return 'input-media';
  if (order.contentTier === 'adult' || order.contentTier === 'blocked') return 'adult';
  if (order.contentTier !== 'general') return 'unreadable';
  if (!order.machineAvailable) return 'no-machine';
  return null;
}

const COMMUNITY_REFUSAL_MESSAGE: Record<CommunityOrderRefusal, string> = {
  adult:
    'โมเดลนี้ประมวลผลบนเครื่องของผู้ร่วมแบ่งปัน (GPUxMINE) จึงรับเฉพาะงานเนื้อหาทั่วไป — คำสั่งนี้มีเนื้อหาสำหรับผู้ใหญ่ กรุณาเลือกโมเดลอื่น ระบบไม่ได้หักเครดิต',
  unreadable:
    'โมเดลนี้ประมวลผลบนเครื่องของผู้ร่วมแบ่งปัน (GPUxMINE) จึงรับเฉพาะคำสั่งที่ระบบตรวจได้ว่าเป็นเนื้อหาทั่วไป — กรุณาเขียนคำสั่งเป็นภาษาไทยหรืออังกฤษ หรือเลือกโมเดลอื่น ระบบไม่ได้หักเครดิต',
  'input-media':
    'โมเดลนี้ประมวลผลบนเครื่องของผู้ร่วมแบ่งปัน (GPUxMINE) จึงไม่รับไฟล์ที่อัปโหลด เพื่อไม่ให้ภาพหรือข้อมูลส่วนตัวของคุณออกไปนอกเครื่องที่เราดูแลเอง — กรุณาเอาไฟล์แนบออก หรือเลือกโมเดลอื่น ระบบไม่ได้หักเครดิต',
  'no-machine':
    'ตอนนี้ยังไม่มีเครื่องชุมชนออนไลน์รับงานโมเดลนี้ กรุณาลองใหม่ภายหลัง หรือเลือกโมเดลอื่น ระบบไม่ได้หักเครดิต',
};

/** Thai for the customer whose order for a community-only model was refused. */
export function communityRefusalMessage(refusal: CommunityOrderRefusal): string {
  return COMMUNITY_REFUSAL_MESSAGE[refusal];
}
