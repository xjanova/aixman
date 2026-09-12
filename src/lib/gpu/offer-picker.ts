import type { GpuOffer } from './types';

/**
 * Which marketplace offer to rent: the one whose *work* costs least, not the
 * one with the lowest sticker price.
 *
 * A rental is paid per second from the moment it starts, so what an offer
 * really costs is its hourly price over the time it will be up for this work:
 * booting (dominated by downloading tens of GB of weights at that host's
 * speed) plus the jobs it will take (at that GPU's render speed). Two findings
 * from the first real rentals (2026-09-12) shaped this:
 *
 *   - every rental had landed on the same host (the cheapest listing), and
 *     three renting at once there booted in 183–206 s against 114–156 s alone —
 *     they shared one uplink. Machines of ours still downloading on a listing
 *     divide its bandwidth, so a busy host can lose to a slightly dearer one.
 *   - render speed differs by GPU. History per GPU model is used where it
 *     exists; a GPU with no history is assumed to render like the model's
 *     median, so it competes on price and boot only — never on a guessed
 *     speed-up.
 *
 * Pure: given offers and context, returns them ranked with the estimate that
 * put each where it is.
 */

/** Install, ComfyUI start and first model load — everything but the download. */
export const BASE_BOOT_SECONDS = 70;
/** Assumed when a host does not report its download speed. */
export const UNKNOWN_DOWNLOAD_MBPS = 1000;

export interface OfferContext {
  /** Weights this machine downloads before it can serve. */
  weightsGb: number;
  /** Median render seconds per GPU model name (exact vendor string), from history. */
  renderSecondsByGpu: Map<string, number>;
  /** Render seconds for a GPU with no history — the model's typical figure. */
  defaultRenderSeconds: number;
  /** Jobs this machine is expected to take (at least 1). */
  jobsExpected: number;
  /** Our machines still booting per offer id — they share that host's uplink. */
  bootingOnOffer: Map<string, number>;
}

export interface RankedOffer {
  offer: GpuOffer;
  /** Estimated USD for booting plus the expected jobs. */
  costUsd: number;
  bootSeconds: number;
  renderSeconds: number;
  /** Where the render figure came from. */
  renderBasis: 'history' | 'model median';
}

export function estimateOffer(offer: GpuOffer, ctx: OfferContext): RankedOffer {
  const sharing = 1 + (ctx.bootingOnOffer.get(offer.id) ?? 0);
  const mbps = (offer.downloadMbps && offer.downloadMbps > 0 ? offer.downloadMbps : UNKNOWN_DOWNLOAD_MBPS) / sharing;
  const downloadSeconds = (ctx.weightsGb * 8 * 1000) / Math.max(1, mbps);
  const bootSeconds = BASE_BOOT_SECONDS + downloadSeconds;

  const known = ctx.renderSecondsByGpu.get(offer.gpuModel);
  const renderSeconds = known ?? ctx.defaultRenderSeconds;
  const seconds = bootSeconds + Math.max(1, ctx.jobsExpected) * renderSeconds;
  return {
    offer,
    costUsd: (offer.pricePerHourUsd * offer.gpuCount * seconds) / 3600,
    bootSeconds: Math.round(bootSeconds),
    renderSeconds: Math.round(renderSeconds),
    renderBasis: known !== undefined ? 'history' : 'model median',
  };
}

/**
 * Cheapest estimated work first. Within a cent-hundredth, the more reliable
 * host and then the faster uplink win — a failed boot costs more than the
 * difference.
 */
export function rankOffers(offers: GpuOffer[], ctx: OfferContext): RankedOffer[] {
  return offers
    .map((o) => estimateOffer(o, ctx))
    .sort((a, b) => {
      const diff = a.costUsd - b.costUsd;
      if (Math.abs(diff) > 0.0001) return diff;
      const rel = (b.offer.reliability ?? 0) - (a.offer.reliability ?? 0);
      if (rel !== 0) return rel;
      return (b.offer.downloadMbps ?? 0) - (a.offer.downloadMbps ?? 0);
    });
}
