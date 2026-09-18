import { create } from 'zustand';
import type { DurationCurve } from '@/lib/pricing';

interface AIModel {
  id: number;
  modelId: string;
  name: string;
  category: string;
  subcategory: string | null;
  creditsPerUnit: number;
  maxWidth: number | null;
  maxHeight: number | null;
  maxDuration: number | null;
  isFeatured: boolean;
  provider: { name: string; slug: string; logo: string | null };
  /**
   * False while a self-hosted model is still being proven out on this
   * deployment. It stays listed so customers can see it is coming, but ordering
   * is blocked so nobody spends credits on a render it cannot deliver.
   */
  canOrder?: boolean;
  tuningMessage?: string | null;
  readiness?: string;
  /** 'unavailable': provider not connected, keys failing, or switched off. */
  status?: 'ready' | 'tuning' | 'unavailable';
  /** Customer-safe reason when `canOrder` is false. */
  unavailableReason?: string | null;
  /** Set when one order yields at most this many outputs (rented-GPU models: 1). */
  maxOutputs?: number | null;
  /** Set when the price grows with clip length; see lib/pricing.ts. */
  durationCurve?: DurationCurve | null;
  /**
   * Optional video controls (rented-GPU models): a first frame, a last frame,
   * and resolution presets per aspect ratio. From the GPU catalogue entry.
   */
  video?: {
    firstFrame?: boolean;
    lastFrame?: boolean;
    resolutions?: { id: string; label: string; aspects: string[]; isDefault?: boolean }[];
  } | null;
  /**
   * Music controls (rented-GPU audio models): whether it sings the customer's
   * lyrics, and whether it needs a song uploaded to cover. Null for everything
   * else, so the studio draws the plain style-only music panel.
   */
  music?: {
    lyrics: boolean;
    sourceSong: boolean;
    maxDuration: number | null;
  } | null;
}

interface AIStyle {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  promptSuffix: string | null;
}

interface AITemplate {
  id: number;
  name: string;
  description: string | null;
  category: string;
  prompt: string;
  negativePrompt: string | null;
  thumbnail: string | null;
  isFeatured: boolean;
}

interface AppState {
  // Generation state
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  // Credits
  creditBalance: number;
  setCreditBalance: (v: number) => void;
  fetchCredits: () => Promise<void>;

  // Models
  models: AIModel[];
  modelsLoaded: boolean;
  fetchModels: () => Promise<void>;

  // Styles
  styles: AIStyle[];
  stylesLoaded: boolean;
  fetchStyles: () => Promise<void>;

  // Templates (prompt presets)
  templates: AITemplate[];
  templatesLoaded: boolean;
  fetchTemplates: () => Promise<void>;

  // Selected model
  selectedModelId: number | null;
  setSelectedModelId: (v: number | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  isGenerating: false,
  setIsGenerating: (v) => set({ isGenerating: v }),

  creditBalance: 0,
  setCreditBalance: (v) => set({ creditBalance: v }),
  fetchCredits: async () => {
    try {
      const res = await fetch('/api/credits');
      if (res.ok) {
        const data = await res.json();
        set({ creditBalance: data.balance ?? 0 });
      }
    } catch {}
  },

  models: [],
  modelsLoaded: false,
  fetchModels: async () => {
    if (get().modelsLoaded) return;
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        set({ models: data.models || [], modelsLoaded: true });
      }
    } catch {}
  },

  styles: [],
  stylesLoaded: false,
  fetchStyles: async () => {
    if (get().stylesLoaded) return;
    try {
      const res = await fetch('/api/styles');
      if (res.ok) {
        const data = await res.json();
        set({ styles: data.styles || [], stylesLoaded: true });
      }
    } catch {}
  },

  templates: [],
  templatesLoaded: false,
  fetchTemplates: async () => {
    if (get().templatesLoaded) return;
    try {
      const res = await fetch('/api/templates');
      if (res.ok) {
        const data = await res.json();
        set({ templates: data.templates || [], templatesLoaded: true });
      }
    } catch {}
  },

  selectedModelId: null,
  setSelectedModelId: (v) => set({ selectedModelId: v }),
}));
