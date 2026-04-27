import { create } from "zustand";

export const usePDFStore = create((set) => ({
  currentPDF: null,
  pages: [], // Array<{ dimensions, textElements, classification, images }>
  pageCount: 0,
  isLoading: false,
  error: null,

  setCurrentPDF: (file) => set({ currentPDF: file }),

  setPages: (pages) => set({ pages }),
  setPageCount: (count) => set({ pageCount: count }),

  setIsLoading: (val) => set({ isLoading: val }),

  clearError: () => set({ error: null }),
}));