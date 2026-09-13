import type { GpuOffer } from './types';
import { cardFamily, priorSpeed } from './gpu-specs';

/**
 * Which marketplace offer to rent: the one whose *work* costs least, not the
 * one with the lowest sticker price.
 *
 * A rental is paid per second from the moment it starts, so what an offer
 * really costs is its hourly price over the time it will be up for this work:
 * booting (dominated by downloading tens of GB of weights at that host's
 * speed), the jobs it will take (at that GPU's render speed), and the idle
 * tail every machine sits through after its last job before it is released.
 * Findings from the first real rentals (2026-09-12) shaped this:
 *
 *   - every rental had landed on the same host (the cheapest listing), and
 *     three renting at once there booted in 183–206 s against 114–156 s alone —
 *     they shared one uplink. Machines of ours still downloading on a listing
 *     divide its bandwidth, so a busy host can lose to a slightly dearer one.
 *   - render speed differs by GPU, and idle time — not boot — became the
 *     largest overhead once boots fell to ~2 minutes. The idle tail costs the
 *     hourly price whatever the card's speed, so it is priced in.
 *
 * Render speed per card, in order of trust: this deployment's own history on
 * that card; failing that, the model's measured speed scaled by the card's
 * paper speed (gpu-specs.ts) — believing all of a slower card's handicap but
 * only half of a faster card's promise, so an untried card has to be cheap
 * enough to win on the cautious figure. A card with less VRAM than the
 * model's weights is slowed further, since ComfyUI swaps what does not fit.
 * A few samples blend with that prior rather than replacing it outright; one
 * lucky render should not decide.
 *
 * Rental cost alone would always pick the cheapest card that can run the
 * model: the boot and idle tail dominate, so a 24 GB card at $0.20 "beats" an
 * A100 at $0.50 while the customer waits three times as long. Each second a
 * customer waits is therefore priced too (`waitValueUsdPerHour`, an admin
 * setting) — ranking is by rental plus waiting; the budget sees rental only.
 *
 * Pure: given offers and context, returns them ranked with the estimate that
 * put each where it is.
 */

/**
 * An offer's identity across vendors: ids are only unique within one. Rows
 * and penalties from before there were several vendors are SimplePod's.
 */
export const offerKey = (provider: string | undefined, offerId: string) => `${provider ?? 'simplepod'}:${offerId}`;

/**
 * Credit a vendor account must hold, as a multiple of the work planned for the
 * machine: a machine whose account runs dry mid-render dies with the job.
 */
export const FUNDING_MARGIN = 1.5;

/**
 * The ranked machines whose own vendor account can pay for the work planned
 * on them. Machines are ranked first and funded second — the question is
 * never "which vendor" but "which machine, that is free and paid for". A
 * vendor whose balance cannot be read (Infinity) is left to refuse an unfunded
 * order itself, which the renter treats as a refusal.
 */
export function fundedOffers(ranked: RankedOffer[], balances: Map<string, number>): RankedOffer[] {
  return ranked.filter((r) => (balances.get(r.offer.provider ?? 'simplepod') ?? 0) >= r.costUsd * FUNDING_MARGIN);
}

/** Install, ComfyUI start and first model load — everything but the download. */
export const BASE_BOOT_SECONDS = 70;
/** Assumed when a host does not report its download speed. */
export const UNKNOWN_DOWNLOAD_MBPS = 1000;
/** SimplePod lists disk per GB per month. */
const HOURS_PER_MONTH = 730;
/** How much a card's paper speed-up is believed before it has rendered here. */
const PRIOR_TRUST = 0.5;
/** The prior counts as this many samples when blended with real ones. */
const PRIOR_WEIGHT = 2;
/** Samples from which a card's own history is reported as such. */
const HISTORY_SAMPLES = 3;

export interface RenderStats {
  /** Median render seconds at the model's unit length on this card. */
  median: number;
  n: number;
}

export type RenderBasis = 'history' | 'blended' | 'prior';

export interface OfferContext {
  /** Weights this machine downloads before it can serve. */
  weightsGb: number;
  /** Disk the machine is rented with, billed for its whole uptime. */
  diskGb: number;
  /** Measured render stats per card family (gpu-specs.ts cardFamily), at the waiting jobs' length. */
  renderStatsByGpu: Map<string, RenderStats>;
  /** The model's render seconds on an A100-class card (speed 1), at the waiting jobs' length. */
  referenceRenderSeconds: number;
  /** Jobs this machine is expected to take (at least 1). */
  jobsExpected: number;
  /** Our machines still booting per offer (keyed by `offerKey`) — they share that host's uplink. */
  bootingOnOffer: Map<string, number>;
  /** Seconds a machine sits idle after its last job before it is released. */
  idleTailSeconds: number;
  /** What an hour of customers waiting is worth, to weigh cheap-but-slow against dear-but-fast. */
  waitValueUsdPerHour: number;
}

export interface RankedOffer {
  offer: GpuOffer;
  /** Estimated USD for booting, the expected jobs and the idle tail. */
  costUsd: number;
  /** The same for a single job — the least this rental can cost. */
  firstJobCostUsd: number;
  /** What the ranking sorts on: `costUsd` plus the customers' wait, priced. */
  scoreUsd: number;
  bootSeconds: number;
  renderSeconds: number;
  /** Where the render figure came from. */
  renderBasis: RenderBasis;
}

/**
 * Render seconds expected on a card, and how much of that is measured.
 * `vramMb` is the card's; with less than the model's weights, the prior
 * assumes swapping costs up to the share that does not fit.
 */
export function renderEstimate(
  gpuModel: string,
  vramMb: number,
  ctx: Pick<OfferContext, 'renderStatsByGpu' | 'referenceRenderSeconds' | 'weightsGb'>
): {
  seconds: number;
  basis: RenderBasis;
} {
  const speed = priorSpeed(gpuModel);
  const believed = speed < 1 ? speed : 1 + PRIOR_TRUST * (speed - 1);
  const vramGb = vramMb / 1024;
  const swapping = vramGb > 0 && ctx.weightsGb > vramGb ? 1 + (ctx.weightsGb - vramGb) / ctx.weightsGb : 1;
  const prior = (ctx.referenceRenderSeconds * swapping) / Math.max(0.05, believed);
  const stats = ctx.renderStatsByGpu.get(cardFamily(gpuModel));
  if (!stats || stats.n <= 0) return { seconds: prior, basis: 'prior' };
  return {
    seconds: (stats.n * stats.median + PRIOR_WEIGHT * prior) / (stats.n + PRIOR_WEIGHT),
    basis: stats.n >= HISTORY_SAMPLES ? 'history' : 'blended',
  };
}

export function estimateOffer(offer: GpuOffer, ctx: OfferContext): RankedOffer {
  const sharing = 1 + (ctx.bootingOnOffer.get(offerKey(offer.provider, offer.id)) ?? 0);
  const mbps = (offer.downloadMbps && offer.downloadMbps > 0 ? offer.downloadMbps : UNKNOWN_DOWNLOAD_MBPS) / sharing;
  const downloadSeconds = (ctx.weightsGb * 8 * 1000) / Math.max(1, mbps);
  // A VM that must start, or an image the host must pull, comes first.
  const bootSeconds = BASE_BOOT_SECONDS + Math.max(0, offer.extraBootSeconds ?? 0) + downloadSeconds;

  const render = renderEstimate(offer.gpuModel, offer.gpuMemoryMb, ctx);
  const jobs = Math.max(1, ctx.jobsExpected);
  const overhead = bootSeconds + Math.max(0, ctx.idleTailSeconds);
  const hourly =
    offer.pricePerHourUsd * offer.gpuCount + ((offer.diskPricePerGbMonthUsd ?? 0) * ctx.diskGb) / HOURS_PER_MONTH;
  // Some vendors bill a minimum per rental, and some charge for the weights
  // coming in — both are real money this offer costs and others do not.
  const floor = Math.max(0, offer.minBillingSeconds ?? 0);
  const ingress = Math.max(0, offer.ingressUsdPerGb ?? 0) * ctx.weightsGb;
  const billed = (seconds: number) => (hourly * Math.max(seconds, floor)) / 3600 + ingress;
  const costUsd = billed(overhead + jobs * render.seconds);
  // Until this machine has cleared its share, its customers are waiting: the
  // boot, then each job in turn.
  const waitSeconds = bootSeconds + jobs * render.seconds;
  return {
    offer,
    costUsd,
    firstJobCostUsd: billed(overhead + render.seconds),
    scoreUsd: costUsd + (Math.max(0, ctx.waitValueUsdPerHour) * waitSeconds) / 3600,
    bootSeconds: Math.round(bootSeconds),
    renderSeconds: Math.round(render.seconds),
    renderBasis: render.basis,
  };
}

/**
 * Best value first — rental plus priced waiting. Within a cent-hundredth, the
 * more reliable host and then the faster uplink win — a failed boot costs
 * more than the difference.
 */
export function rankOffers(offers: GpuOffer[], ctx: OfferContext): RankedOffer[] {
  return offers
    .map((o) => estimateOffer(o, ctx))
    .sort((a, b) => {
      const diff = a.scoreUsd - b.scoreUsd;
      if (Math.abs(diff) > 0.0001) return diff;
      const rel = (b.offer.reliability ?? 0) - (a.offer.reliability ?? 0);
      if (rel !== 0) return rel;
      return (b.offer.downloadMbps ?? 0) - (a.offer.downloadMbps ?? 0);
    });
}
