import { NextResponse } from 'next/server';
import { getTpixMarket } from '@/lib/tpix/xman-api';

/**
 * GET /api/tpix/info — public. What the /tpix campaign page needs from
 * xmanstudio's TPIX Pay: whether TPIX is taken now, the AI-credit discount it
 * applies, and the rate a quote would use (for "about N TPIX" estimates; the
 * exact amount only ever comes from a quote).
 *
 * `canBuy` needs both: payments switched on at xmanstudio, and an xmanstudio
 * new enough to apply the campaign discount (it sends the percent). Until then
 * the page shows the campaign with buying closed, never an undiscounted sale.
 */
export async function GET() {
  const market = await getTpixMarket();
  const canBuy = market.paymentsEnabled && market.discountPercent !== null && market.rateThb !== null;

  return NextResponse.json(
    {
      canBuy,
      paymentsEnabled: market.paymentsEnabled,
      discountPercent: market.discountPercent,
      rateThb: market.rateThb,
      priceUsd: market.priceUsd,
      maxQuoteThb: market.maxQuoteThb,
      updatedAt: market.updatedAt,
    },
    { headers: { 'Cache-Control': 'public, max-age=30' } },
  );
}
