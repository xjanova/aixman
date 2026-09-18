/**
 * What a community node earns for a job, and who else is paid out of it.
 *
 * This file is the whole of the money decision for GPUxMINE, on purpose: the
 * client is C#, compiled to IL, and anyone running a node can read it in
 * seconds. Nothing here may ever move into the agent. The node reports what it
 * did; the platform decides what that was worth.
 *
 * The shape of the answer, for one completed job:
 *
 *   revenue        what the customer's credits were worth in THB
 *   − platform fee the platform's cut (lower for Pro Miner)
 *   = node pool    what the job has to distribute
 *      ├─ free-shared job → node is paid 0, and the pool becomes
 *      │                    donated value, which buys dispatch priority
 *      └─ paid job       → referral comes out first, node takes the rest
 *
 * Every figure is integer satang. Money never touches a float here: two nodes
 * settling 0.1 + 0.2 in binary floating point disagree by a satang, and a
 * ledger that disagrees with itself is worse than no ledger.
 */
import { creditsForDuration } from '@/lib/pricing';
import type { DurationCurve } from '@/lib/pricing';

/** Platform's share of a job's revenue. Pro Miner buys the lower one. */
export const PLATFORM_FEE_FREE = 0.20;
export const PLATFORM_FEE_PRO = 0.12;

/** Referral: a share of what the node earns, for 12 months after they joined. */
export const REFERRAL_RATE = 0.05;
export const REFERRAL_MONTHS = 12;

export interface SettlementInput {
  /** Base credits the model charges per unit, from the catalogue. */
  creditsPerUnit: number;
  /** How price grows with length, for models billed by duration. */
  durationCurve?: DurationCurve | null;
  /** Output seconds for video/audio; omitted for a single image. */
  outputSeconds?: number | null;
  /** How many units the job produced — a batch of 4 images is 4. */
  units?: number;
  /** Blended THB a credit is worth, from `pricingBasis()`. Never hard-coded here. */
  thbPerCredit: number;

  /** The pool marked this job as the node's free share at dispatch time. */
  freeShare: boolean;
  /** The node held an active Pro Miner licence when it claimed the job. */
  pro: boolean;

  /** Who invited this node's owner, and when they joined — null when nobody did. */
  referrer?: { userId: number; joinedAt: Date } | null;
  /** Settlement time; passed in so the same job always settles the same way in a replay. */
  now?: Date;
}

export interface Settlement {
  /** What the customer's spend on this job was worth, in satang. */
  revenueSatang: number;
  platformFeeSatang: number;
  /** Paid to the node's owner. Zero for a free-shared job. */
  nodePayoutSatang: number;
  /** Paid to the upline, out of the node's share — never added on top. */
  referralSatang: number;
  referralUserId: number | null;
  /**
   * For a free-shared job: what it would have paid. This is the number that
   * drives the cooperation score, and the reason the score cannot be farmed by
   * donating at 4am — an hour with no work donates no value.
   */
  donatedValueSatang: number;
  /** Which fee rate applied, for the receipt the owner sees. */
  platformFeeRate: number;
}

/**
 * Settles one completed job.
 *
 * Deliberately pure: no database, no clock of its own, no rounding surprises.
 * It can be replayed over a month of jobs and produce the same satang every
 * time, which is what makes a payout dispute answerable.
 */
export function settleJob(input: SettlementInput): Settlement {
  const units = Math.max(1, Math.floor(input.units ?? 1));

  // Same curve the customer was charged on. Settling on a different basis than
  // the customer paid would let the two drift apart silently, and the gap
  // would only ever be noticed when it had grown large.
  const creditsPerUnit = creditsForDuration(
    input.creditsPerUnit,
    input.durationCurve,
    input.outputSeconds
  );

  const revenueSatang = Math.round(creditsPerUnit * units * input.thbPerCredit * 100);

  const platformFeeRate = input.pro ? PLATFORM_FEE_PRO : PLATFORM_FEE_FREE;
  const platformFeeSatang = Math.round(revenueSatang * platformFeeRate);
  const poolSatang = revenueSatang - platformFeeSatang;

  if (input.freeShare) {
    // The owner chose to donate this slice of their capacity. They are paid
    // nothing and the platform keeps nothing either: the whole pool is what
    // the donation was worth, which is what the cooperation score counts.
    return {
      revenueSatang,
      platformFeeSatang,
      nodePayoutSatang: 0,
      referralSatang: 0,
      referralUserId: null,
      donatedValueSatang: poolSatang,
      platformFeeRate,
    };
  }

  const referralSatang = referralCut(poolSatang, input.referrer, input.now ?? new Date());

  return {
    revenueSatang,
    platformFeeSatang,
    // Referral comes out of the node's share rather than on top of it. Paying
    // it on top would mean every referred node costs the platform more than an
    // unreferred one, and the incentive to invite would be an incentive to
    // lose money.
    nodePayoutSatang: poolSatang - referralSatang,
    referralSatang,
    referralUserId: referralSatang > 0 ? (input.referrer?.userId ?? null) : null,
    donatedValueSatang: 0,
    platformFeeRate,
  };
}

function referralCut(
  poolSatang: number,
  referrer: SettlementInput['referrer'],
  now: Date
): number {
  if (!referrer) return 0;

  const expiry = new Date(referrer.joinedAt);
  expiry.setMonth(expiry.getMonth() + REFERRAL_MONTHS);
  if (now >= expiry) return 0;

  return Math.round(poolSatang * REFERRAL_RATE);
}

// ---------------------------------------------------------------------------
// Cooperation score
// ---------------------------------------------------------------------------

export interface CooperationInput {
  /** Value of free-shared work over the window, in satang. */
  donatedSatang: number;
  /** Value of paid work over the same window, in satang. */
  earnedSatang: number;
  /** Pro Miner bonus, 0-1, already capped by the caller. */
  proBonus?: number;
}

/**
 * Weights. Generosity outweighs size, deliberately.
 *
 * The first cut had absolute value at 0.50 and ratio at 0.35, and the test
 * "a small card giving away half scores near a farm giving away a little"
 * failed by a thousandth: 0.294 against 0.295. A fifty-card farm donating 5%
 * of itself beat a single card donating half of everything it had. That is the
 * opposite of what this score exists to do, and nobody would have noticed it in
 * production except the owner of the small card, who would simply have stopped
 * sharing.
 */
export const COOP_WEIGHT_ABSOLUTE = 0.35;
export const COOP_WEIGHT_RATIO = 0.50;
export const COOP_WEIGHT_PRO = 0.15;

/**
 * A node's donation reference point: roughly a day of modest sharing. Only sets
 * the shape of the log curve, not anyone's earnings.
 */
export const COOP_UNIT_SATANG = 5_000; // ฿50

/**
 * How much dispatch priority a node has earned by donating.
 *
 * Two terms, because either alone is unfair:
 *  - absolute donated value, through a log so a farm with fifty cards cannot
 *    simply buy the front of every queue;
 *  - the share of its own capacity a node gave away, so a single small card
 *    donating half of everything it does still scores well.
 *
 * <b>The Pro term is capped by the caller</b> at what an honest sharer at about
 * 40% reaches. Letting money buy more priority than generosity can earn is how
 * the free-share tier dies: nobody donates once the queue is for sale.
 */
export function cooperationScore(input: CooperationInput): number {
  const total = input.donatedSatang + input.earnedSatang;
  const ratio = total > 0 ? input.donatedSatang / total : 0;

  const absolute = Math.log1p(Math.max(0, input.donatedSatang) / COOP_UNIT_SATANG);
  // log1p is unbounded; normalised against a generous reference so the term
  // saturates instead of growing forever with a bigger farm.
  const absoluteNormalised = Math.min(1, absolute / Math.log1p(100));

  return (
    COOP_WEIGHT_ABSOLUTE * absoluteNormalised +
    COOP_WEIGHT_RATIO * ratio +
    COOP_WEIGHT_PRO * Math.min(1, Math.max(0, input.proBonus ?? 0))
  );
}

/**
 * The ceiling Pro Miner may reach, expressed as the score an honest sharer at
 * `ratio` of their capacity would have. Pro buys a place near the front; it
 * cannot buy a place generosity could not also reach.
 */
export function proBonusCeiling(ratio = 0.4): number {
  const honest = cooperationScore({
    donatedSatang: Math.round(COOP_UNIT_SATANG * 20 * ratio),
    earnedSatang: Math.round(COOP_UNIT_SATANG * 20 * (1 - ratio)),
  });
  return Math.min(1, honest / COOP_WEIGHT_PRO);
}

// ---------------------------------------------------------------------------
// Dispatch priority
// ---------------------------------------------------------------------------

export interface PriorityInput {
  cooperation: number;   // 0-1 from cooperationScore
  reliability: number;   // 0-1: success rate x uptime x anti-cheat pass rate
  fit: number;           // 0-1 from the offer picker: VRAM, speed, model cached
  latency: number;       // 0-1, 1 = closest
}

export const PRIORITY_WEIGHT_COOP = 0.30;
export const PRIORITY_WEIGHT_RELIABILITY = 0.30;
export const PRIORITY_WEIGHT_FIT = 0.30;
export const PRIORITY_WEIGHT_LATENCY = 0.10;

/** A node that cannot do the job well is not eligible however much it donated. */
export const FIT_FLOOR = 0.35;

/**
 * Where a node sits in the queue for one job.
 *
 * Returns null when the node is not eligible at all. Fit is a gate, not just a
 * weight: quality is the one thing that must never be purchasable. A node that
 * donated heavily still does not get a job its card renders badly — that is
 * paid for by the customer, who did not agree to it.
 */
export function dispatchPriority(input: PriorityInput): number | null {
  if (input.fit < FIT_FLOOR) return null;

  const raw =
    PRIORITY_WEIGHT_COOP * clamp01(input.cooperation) +
    PRIORITY_WEIGHT_RELIABILITY * clamp01(input.reliability) +
    PRIORITY_WEIGHT_FIT * clamp01(input.fit) +
    PRIORITY_WEIGHT_LATENCY * clamp01(input.latency);

  // Rounded, not just clamped. The weights sum to 1 in decimal and to
  // 0.9999999999999999 in binary, so a perfect node scored 0.99999… — which
  // reads as a bug, and worse, leaves two identical nodes separated by float
  // noise so the queue orders them differently on different runs. Six decimals
  // is far finer than any real difference between nodes.
  return clamp01(Math.round(raw * 1e6) / 1e6);
}

/**
 * Share of dispatch slots handed out ignoring priority entirely.
 *
 * Without it a new node — no history, no donations, no reliability — would
 * never be picked, so it could never build any of the three, and the network
 * would be closed to everyone who was not there on day one.
 */
export const LOTTERY_SHARE = 0.10;

/** True when this dispatch slot is a lottery slot. `roll` is a caller-supplied 0-1. */
export function isLotterySlot(roll: number): boolean {
  return roll < LOTTERY_SHARE;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

// ---------------------------------------------------------------------------
// Free-share selection
// ---------------------------------------------------------------------------

export interface FreeShareInput {
  /** What the owner asked for, 0-100. */
  targetPercent: number;
  /** Value already donated in the window, satang. */
  donatedSatang: number;
  /** Value already paid in the window, satang. */
  earnedSatang: number;
}

/**
 * Whether the next job for this node should be free-shared.
 *
 * <b>Decided here, on the server, never on the node.</b> A node that chose for
 * itself would mark the cheap jobs free and the valuable ones paid, and its
 * donated value — the thing that buys priority — would be worth a fraction of
 * what it claimed.
 *
 * Tracks value, not job count: donating ten thumbnail upscales is not the same
 * contribution as donating one video, and counting jobs would say it was.
 */
export function shouldFreeShare(input: FreeShareInput): boolean {
  const target = Math.min(100, Math.max(0, input.targetPercent)) / 100;
  if (target <= 0) return false;
  if (target >= 1) return true;

  const total = input.donatedSatang + input.earnedSatang;
  if (total <= 0) return target > 0.5;   // nothing to go on yet

  return input.donatedSatang / total < target;
}
