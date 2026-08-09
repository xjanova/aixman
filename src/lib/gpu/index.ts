/**
 * GPU Rental Provider Registry
 *
 * Only SimplePod is wired up today. Additional vendors (RunPod, Vast.ai, …)
 * implement `GpuRentalProvider` and get registered here — nothing else in the
 * worker manager or queue needs to change.
 */
import type { GpuProviderSlug, GpuRentalProvider } from './types';
import { SimplePodProvider } from './simplepod';

const rentalProviders: Record<string, GpuRentalProvider> = {
  simplepod: new SimplePodProvider(),
};

export function getGpuProvider(slug: GpuProviderSlug | string): GpuRentalProvider | null {
  return rentalProviders[slug] || null;
}

export function getGpuProviderSlugs(): GpuProviderSlug[] {
  return Object.keys(rentalProviders) as GpuProviderSlug[];
}

export { SimplePodProvider };
export * from './types';
