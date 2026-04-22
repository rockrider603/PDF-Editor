import { create } from "zustand";

export const usePDFStore = create((set) => ({
  currentPDF: null,
  extractedContent: null,
  extractedImages: null,
  isLoading: false,
  error: null,

  setCurrentPDF: (file) => set({ currentPDF: file }),
  
  clearError: () => set({ error: null }),

  // When you call extractAndTranslatePdf in your EditingPage, 
  // you'll update these values locally:
  setExtractedData: (content, images) => set({ 
    extractedContent: content, 
    extractedImages: images 
  })
}));