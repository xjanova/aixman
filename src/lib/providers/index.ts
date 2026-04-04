/**
 * Provider Registry
 * Central registry for all AI provider adapters
 */
import type { AIProviderAdapter, ProviderSlug } from '@/types';
import { BytePlusProvider } from './byteplus';
import { OpenAIProvider } from './openai';
import { ReplicateProvider } from './replicate';
import { FalProvider } from './fal';
import { StabilityProvider } from './stability';
import { RunwayProvider } from './runway';
import { KlingProvider } from './kling';
import { LumaProvider } from './luma';
import { LeonardoProvider } from './leonardo';

const providers: Record<string, AIProviderAdapter> = {
  byteplus: new BytePlusProvider(),
  openai: new OpenAIProvider(),
  replicate: new ReplicateProvider(),
  fal: new FalProvider(),
  stability: new StabilityProvider(),
  runway: new RunwayProvider(),
  kling: new KlingProvider(),
  luma: new LumaProvider(),
  leonardo: new LeonardoProvider(),
};

export function getProvider(slug: ProviderSlug): AIProviderAdapter | null {
  return providers[slug] || null;
}

export function getAllProviders(): AIProviderAdapter[] {
  return Object.values(providers);
}

export function getProviderSlugs(): ProviderSlug[] {
  return Object.keys(providers) as ProviderSlug[];
}

export { BytePlusProvider, OpenAIProvider, ReplicateProvider, FalProvider, StabilityProvider, RunwayProvider, KlingProvider, LumaProvider, LeonardoProvider };
