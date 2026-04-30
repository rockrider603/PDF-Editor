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

  updateTextElement: (pageIdx, elIdx, updates) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];
    
    if (typeof updates === 'string') {
        elements[elIdx] = { ...elements[elIdx], text: updates };
    } else {
        elements[elIdx] = { ...elements[elIdx], ...updates };
    }
    
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

  updateTextColor: (pageIdx, elIdx, newColor) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];
    elements[elIdx] = { ...elements[elIdx], color: newColor };
    page.textElements = elements;
    newPages[pageIdx] = page;
    return { pages: newPages };
  }),

  updateTextFormat: (pageIdx, elIdx, formatProps) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];
    elements[elIdx] = { ...elements[elIdx], ...formatProps };
    page.textElements = elements;
    newPages[pageIdx] = page;
    return { pages: newPages };
  }),

  shiftElementsBelow: (pageIdx, yThreshold, amount) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];
    
    for (let i = 0; i < elements.length; i++) {
      if (elements[i].y < yThreshold) {
        elements[i] = { ...elements[i], y: elements[i].y - amount };
      }
    }
    page.textElements = elements;

    if (page.images && page.images.pageImages) {
        const newImages = [...page.images.pageImages];
        let changed = false;
        for (let i = 0; i < newImages.length; i++) {
            const img = newImages[i];
            if (img.appearances && img.appearances.length > 0) {
               const ap = { ...img.appearances[0] };
               if (ap.y < yThreshold) {
                  ap.y = ap.y - amount;
                  newImages[i] = { ...img, appearances: [ap] };
                  changed = true;
               }
            }
        }
        if (changed) page.images = { ...page.images, pageImages: newImages };
    }
    
    newPages[pageIdx] = page;
    return { pages: newPages };
  }),

  insertTextElement: (pageIdx, elIdxToInsertAfter, newElement) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];
    elements.splice(elIdxToInsertAfter + 1, 0, newElement);
    page.textElements = elements;
    newPages[pageIdx] = page;
    return { pages: newPages };
  }),

  removeTextElement: (pageIdx, elIdx) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];
    elements.splice(elIdx, 1);
    page.textElements = elements;
    newPages[pageIdx] = page;
    return { pages: newPages };
  }),
}));