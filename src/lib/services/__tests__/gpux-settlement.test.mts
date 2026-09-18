/**
 * The money rules, asserted.
 *
 * Run: node --test src/lib/services/__tests__/gpux-settlement.test.mts
 *
 * These are the numbers a node owner will one day dispute. Every case here is
 * one someone can point at and say "that is what I was told would happen".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  settleJob,
  cooperationScore,
  proBonusCeiling,
  dispatchPriority,
  shouldFreeShare,
  isLotterySlot,
  PLATFORM_FEE_FREE,
  PLATFORM_FEE_PRO,
  REFERRAL_RATE,
  COOP_WEIGHT_PRO,
  FIT_FLOOR,
  LOTTERY_SHARE,
} from '@/lib/services/gpux-settlement';

/** A credit is worth ฿0.50 in these tests; the real figure comes from pricingBasis(). */
const THB_PER_CREDIT = 0.5;

const baseJob = {
  creditsPerUnit: 12,          // one MiniMax H3 clip
  thbPerCredit: THB_PER_CREDIT,
  freeShare: false,
  pro: false,
};

test('a paid job splits into platform fee and node payout, to the satang', () => {
  const s = settleJob(baseJob);

  // 12 credits x ฿0.50 = ฿6.00 = 600 satang
  assert.equal(s.revenueSatang, 600);
  assert.equal(s.platformFeeSatang, 120);              // 20%
  assert.equal(s.nodePayoutSatang, 480);
  assert.equal(s.referralSatang, 0);
  assert.equal(s.donatedValueSatang, 0);

  // Nothing may be created or destroyed in the split.
  assert.equal(s.platformFeeSatang + s.nodePayoutSatang + s.referralSatang, s.revenueSatang);
});

test('Pro Miner lowers the platform fee and the node keeps the difference', () => {
  const free = settleJob(baseJob);
  const pro = settleJob({ ...baseJob, pro: true });

  assert.equal(pro.platformFeeRate, PLATFORM_FEE_PRO);
  assert.equal(free.platformFeeRate, PLATFORM_FEE_FREE);
  assert.ok(pro.nodePayoutSatang > free.nodePayoutSatang);
  assert.equal(pro.nodePayoutSatang - free.nodePayoutSatang, 48);   // 8% of 600
});

test('a free-shared job pays the node nothing and records what it was worth', () => {
  const s = settleJob({ ...baseJob, freeShare: true });

  assert.equal(s.nodePayoutSatang, 0);
  assert.equal(s.referralSatang, 0);
  // The whole pool becomes donated value — the platform does not quietly
  // pocket the fee on work somebody gave away.
  assert.equal(s.donatedValueSatang, 480);
});

test('referral comes out of the node share, never added on top', () => {
  const joinedAt = new Date('2026-06-01');
  const s = settleJob({
    ...baseJob,
    referrer: { userId: 42, joinedAt },
    now: new Date('2026-09-18'),
  });

  assert.equal(s.referralSatang, Math.round(480 * REFERRAL_RATE));   // 24
  assert.equal(s.referralUserId, 42);
  assert.equal(s.nodePayoutSatang, 480 - 24);
  // Still adds up: the platform pays no more for a referred node.
  assert.equal(s.platformFeeSatang + s.nodePayoutSatang + s.referralSatang, s.revenueSatang);
});

test('referral stops after twelve months', () => {
  const joinedAt = new Date('2025-09-01');
  const s = settleJob({
    ...baseJob,
    referrer: { userId: 42, joinedAt },
    now: new Date('2026-09-18'),          // 12.5 months later
  });

  assert.equal(s.referralSatang, 0);
  assert.equal(s.referralUserId, null);
  assert.equal(s.nodePayoutSatang, 480);
});

test('a free-shared job pays the upline nothing either', () => {
  const s = settleJob({
    ...baseJob,
    freeShare: true,
    referrer: { userId: 42, joinedAt: new Date('2026-06-01') },
    now: new Date('2026-09-18'),
  });

  // The node earned nothing, so there is nothing for the upline to take a
  // share of. This is the line that has to be in the terms, or someone will
  // expect commission on work that was given away.
  assert.equal(s.referralSatang, 0);
  assert.equal(s.nodePayoutSatang, 0);
});

test('a longer clip is settled on the same curve the customer was charged on', () => {
  const short = settleJob({
    ...baseJob,
    durationCurve: { unitSeconds: 5, exponent: 1.5 },
    outputSeconds: 5,
  });
  const long = settleJob({
    ...baseJob,
    durationCurve: { unitSeconds: 5, exponent: 1.5 },
    outputSeconds: 10,
  });

  // 2x the length at exponent 1.5 is 2^1.5 ~= 2.83x the credits.
  assert.equal(short.revenueSatang, 600);
  assert.equal(long.revenueSatang, 1700);      // ceil(12 * 2.828) = 34 credits
  assert.ok(long.nodePayoutSatang > short.nodePayoutSatang * 2);
});

test('a batch pays per unit produced', () => {
  const one = settleJob(baseJob);
  const four = settleJob({ ...baseJob, units: 4 });
  assert.equal(four.revenueSatang, one.revenueSatang * 4);
});

// ---------------------------------------------------------------------------

test('donating at a dead hour earns nothing, because value not time is counted', () => {
  // The node that "shared 100%" all night while no work existed.
  const idleAllNight = cooperationScore({ donatedSatang: 0, earnedSatang: 0 });
  // The node that donated real work.
  const actuallyDonated = cooperationScore({ donatedSatang: 20_000, earnedSatang: 20_000 });

  assert.equal(idleAllNight, 0);
  assert.ok(actuallyDonated > 0.3);
});

test('a small card giving away half scores near a farm giving away a little', () => {
  const smallGenerous = cooperationScore({ donatedSatang: 10_000, earnedSatang: 10_000 });
  const farmStingy = cooperationScore({ donatedSatang: 60_000, earnedSatang: 1_200_000 });

  // The farm donated six times as much in absolute terms, but gave away 5% of
  // itself. The ratio term is what keeps the little card in the race.
  assert.ok(smallGenerous > farmStingy,
    `small generous ${smallGenerous.toFixed(3)} should beat stingy farm ${farmStingy.toFixed(3)}`);
});

test('a whale cannot buy the whole queue with absolute volume', () => {
  const big = cooperationScore({ donatedSatang: 10_000_000, earnedSatang: 0 });
  const huge = cooperationScore({ donatedSatang: 1_000_000_000, earnedSatang: 0 });

  // A hundred times the donation must not be a hundred times the score.
  assert.ok(huge - big < 0.1, `log curve should saturate: ${big.toFixed(3)} -> ${huge.toFixed(3)}`);
  assert.ok(huge <= 1);
});

test('Pro cannot out-score what generosity can reach', () => {
  const ceiling = proBonusCeiling(0.4);

  const proMax = cooperationScore({ donatedSatang: 0, earnedSatang: 100_000, proBonus: ceiling });
  const honestSharer = cooperationScore({ donatedSatang: 40_000, earnedSatang: 60_000 });

  // This is the rule that keeps the free-share tier alive: paying may put you
  // near the front, never ahead of someone who actually donated.
  assert.ok(proMax <= honestSharer + 0.01,
    `pro ${proMax.toFixed(3)} must not exceed honest sharer ${honestSharer.toFixed(3)}`);
});

// ---------------------------------------------------------------------------

test('a node that cannot do the job well is not eligible, however much it donated', () => {
  const generousButUnfit = dispatchPriority({
    cooperation: 1, reliability: 1, fit: FIT_FLOOR - 0.01, latency: 1,
  });
  assert.equal(generousButUnfit, null, 'quality must never be purchasable');

  const modestButFit = dispatchPriority({
    cooperation: 0.1, reliability: 0.9, fit: 0.9, latency: 0.5,
  });
  assert.ok(modestButFit !== null && modestButFit > 0);
});

test('priority is bounded, so no single term can dominate', () => {
  const best = dispatchPriority({ cooperation: 1, reliability: 1, fit: 1, latency: 1 });
  assert.equal(best, 1);
});

test('the lottery keeps a share of slots open to newcomers', () => {
  let lottery = 0;
  for (let i = 0; i < 10_000; i++) if (isLotterySlot(i / 10_000)) lottery++;
  assert.equal(lottery / 10_000, LOTTERY_SHARE);
});

// ---------------------------------------------------------------------------

test('free-share tracks value given away, not jobs counted', () => {
  // Asked for 50%, has donated ฿30 and earned ฿70 — behind target, so the
  // next job is free.
  assert.equal(shouldFreeShare({ targetPercent: 50, donatedSatang: 3000, earnedSatang: 7000 }), true);

  // Already past 50% — next job is paid.
  assert.equal(shouldFreeShare({ targetPercent: 50, donatedSatang: 7000, earnedSatang: 3000 }), false);
});

test('the extremes mean what they say', () => {
  assert.equal(shouldFreeShare({ targetPercent: 0, donatedSatang: 0, earnedSatang: 0 }), false);
  assert.equal(shouldFreeShare({ targetPercent: 100, donatedSatang: 999_999, earnedSatang: 0 }), true);
});

test('ten donated thumbnails are not one donated video', () => {
  // Ten cheap jobs given away, one expensive job kept.
  const cheapGiveaway = { targetPercent: 50, donatedSatang: 10 * 20, earnedSatang: 2000 };
  // Counting jobs would say this node is at 10/11 = 91% generous.
  // Counting value says 200/2200 = 9%, so it still owes the pool.
  assert.equal(shouldFreeShare(cheapGiveaway), true);
});
