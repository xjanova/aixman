import { create } from 'zustand';

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
}

interface AIStyle {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  promptSuffix: string | null;
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

  selectedModelId: null,
  setSelectedModelId: (v) => set({ selectedModelId: v }),
}));
