import { create } from "zustand";

export const usePDFStore = create((set) => ({
  currentPDF: null,
  extractedContent: null,   // { rawElements: TextElement[], classification: Classification }
  extractedImages: null,    // { background: ImageEntry|null, pageImages: ImageEntry[] }
  pageDimensions: { width: 612, height: 792 }, // PDF points — default US Letter
  isLoading: false,
  error: null,

  setCurrentPDF: (file) => set({ currentPDF: file }),

  setExtractedData: (content, images) =>
    set({ extractedContent: content, extractedImages: images }),

  setPageDimensions: (dims) => set({ pageDimensions: dims }),

  setIsLoading: (val) => set({ isLoading: val }),

  clearError: () => set({ error: null }),
}));