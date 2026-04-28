import { create } from "zustand";

export const usePDFStore = create((set) => ({
  currentPDF: null,
  pages: [], // Array<{ dimensions, textElements, classification, images }>
  pageCount: 0,
  activeCursor: { pageIdx: null, elIdx: null, charOffset: null, caretX: 0 },
  isLoading: false,
  error: null,

  setCurrentPDF: (file) => set({ currentPDF: file }),

  setPages: (pages) => set({ pages }),
  setPageCount: (count) => set({ pageCount: count }),
  setActiveCursor: (cursorOrUpdater) => set((state) => ({
    activeCursor: typeof cursorOrUpdater === 'function' ? cursorOrUpdater(state.activeCursor) : cursorOrUpdater
  })),

  setIsLoading: (val) => set({ isLoading: val }),

  clearError: () => set({ error: null }),

  updateTextElement: (pageIdx, elIdx, newText) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];
    elements[elIdx] = { ...elements[elIdx], text: newText };
    page.textElements = elements;
    newPages[pageIdx] = page;
    return { pages: newPages };
  }),

  updateTextFontSize: (pageIdx, elIdx, newSize) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];
    elements[elIdx] = { ...elements[elIdx], fontSize: newSize };
    page.textElements = elements;
    newPages[pageIdx] = page;
    return { pages: newPages };
  }),
}));