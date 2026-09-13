/**
 * GPU Rental Provider Registry
 *
 * Every vendor implements `GpuRentalProvider` and is registered here. The
 * worker manager asks all of them for offers at once and rents the best value
 * anywhere; nothing else needs to know which vendors exist.
 */
import type { GpuProviderSlug, GpuRentalProvider } from './types';
import { SimplePodProvider } from './simplepod';
import { RunPodProvider } from './runpod';
import { VastProvider } from './vast';
import { VerdaProvider } from './verda';

const rentalProviders: Record<GpuProviderSlug, GpuRentalProvider> = {
  simplepod: new SimplePodProvider(),
  runpod: new RunPodProvider(),
  vast: new VastProvider(),
  verda: new VerdaProvider(),
};

export function getGpuProvider(slug: GpuProviderSlug | string): GpuRentalProvider | null {
  return (rentalProviders as Record<string, GpuRentalProvider>)[slug] || null;
}

export function getGpuProviderSlugs(): GpuProviderSlug[] {
  return Object.keys(rentalProviders) as GpuProviderSlug[];
}

export { SimplePodProvider, RunPodProvider, VastProvider, VerdaProvider };
export * from './types';
