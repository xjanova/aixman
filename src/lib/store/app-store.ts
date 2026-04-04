import { create } from 'zustand';

interface AppState {
  // Generation state
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;

  // Credits
  creditBalance: number;
  setCreditBalance: (v: number) => void;

  // Theme
  theme: 'dark' | 'light';
  setTheme: (v: 'dark' | 'light') => void;
  toggleTheme: () => void;

  // Selected model/provider
  selectedModelId: number | null;
  setSelectedModelId: (v: number | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isGenerating: false,
  setIsGenerating: (v) => set({ isGenerating: v }),

  sidebarOpen: true,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  creditBalance: 0,
  setCreditBalance: (v) => set({ creditBalance: v }),

  theme: 'dark',
  setTheme: (v) => set({ theme: v }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

  selectedModelId: null,
  setSelectedModelId: (v) => set({ selectedModelId: v }),
}));
