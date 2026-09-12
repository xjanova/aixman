import { getGpuProvider } from '@/lib/gpu';

/**
 * How a provider is shown to customers.
 *
 * Models we run ourselves on rented GPUs are presented as our own engine: how
 * and where they run is a trade secret, and "SimplePod (เช่า GPU)" in a
 * dropdown tells a competitor exactly how the service is built. Admin pages
 * keep the real names — they read the provider row directly, not through this.
 */
export const IN_HOUSE_PROVIDER = { name: 'X-DREAMER', slug: 'xdreamer', logo: null } as const;

export function isInHouse(slug: string): boolean {
  return getGpuProvider(slug) !== null;
}

export function publicProvider<T extends { name: string; slug: string; logo?: string | null }>(
  provider: T
): { name: string; slug: string; logo: string | null } {
  if (isInHouse(provider.slug)) return { ...IN_HOUSE_PROVIDER };
  return { name: provider.name, slug: provider.slug, logo: provider.logo ?? null };
}
