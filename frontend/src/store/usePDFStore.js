import { create } from "zustand";

const applyGlobalReflow = (pages, startPageIdx, yThreshold, amount, skipFilter = null) => {
  if (amount === 0) return [...pages];

  const pageOffsets = [];
  let currentOffset = 0;
  for (const p of pages) {
    pageOffsets.push(currentOffset);
    currentOffset += (p.dimensions?.height ?? 792);
  }

  let allElements = [];
  pages.forEach((page, pIdx) => {
    const pHeight = page.dimensions?.height ?? 792;
    page.textElements.forEach((el, elIdx) => {
      allElements.push({
        type: 'text',
        originalPage: pIdx,
        originalIdx: elIdx,
        globalY: pageOffsets[pIdx] + (pHeight - el.y),
        data: el
      });
    });
    page.images?.pageImages?.forEach((img, imgIdx) => {
      const ap = img.appearances?.[0];
      if (ap) {
        allElements.push({
          type: 'image',
          originalPage: pIdx,
          originalIdx: imgIdx,
          globalY: pageOffsets[pIdx] + (pHeight - ap.y),
          data: img,
          ap: ap
        });
      }
    });
  });

  const targetPageHeight = pages[startPageIdx].dimensions?.height ?? 792;
  const globalThreshold = pageOffsets[startPageIdx] + (targetPageHeight - yThreshold);

  allElements.forEach(item => {
    if (skipFilter && skipFilter(item)) return;
    if (item.globalY > globalThreshold + 0.1) {
      item.globalY += amount;
    }
    
    let height = 0;
    if (item.type === 'text') {
      height = (item.data.fontSize || 12) * 1.2;
    } else if (item.type === 'image') {
      height = item.ap.renderedHeight || 100;
    }
    item.height = height;
  });

  allElements.sort((a, b) => a.globalY - b.globalY);

  const getPageInfo = (gY) => {
    if (gY < 0) gY = 0;
    let pIdx = 0;
    while (true) {
      if (pageOffsets[pIdx + 1] === undefined) {
        const lastPageHeight = pages[pages.length - 1].dimensions?.height ?? 792;
        pageOffsets.push(pageOffsets[pIdx] + lastPageHeight);
      }
      if (gY >= pageOffsets[pIdx] && gY < pageOffsets[pIdx + 1]) {
        return { pageIdx: pIdx, pOffset: pageOffsets[pIdx], nextOffset: pageOffsets[pIdx + 1] };
      }
      pIdx++;
    }
  };

  let cumulativeShift = 0;
  const MARGIN = 48;

  for (const item of allElements) {
    item.globalY += cumulativeShift;

    let { pageIdx, pOffset, nextOffset } = getPageInfo(item.globalY);
    let pHeight = nextOffset - pOffset;
    let localY = pHeight - (item.globalY - pOffset);
    
    const usableHeight = pHeight - 2 * MARGIN;
    const isOversized = item.height > usableHeight;

    // 1. Check if it sticks out the TOP of the usable area (pHeight - MARGIN)
    if (localY + item.height > pHeight - MARGIN) {
      const topGlobalY = pOffset + MARGIN + item.height;
      const shiftNeeded = topGlobalY - item.globalY;
      if (shiftNeeded > 0) {
        item.globalY += shiftNeeded;
        cumulativeShift += shiftNeeded;
        
        // Re-evaluate position
        const info = getPageInfo(item.globalY);
        pageIdx = info.pageIdx; pOffset = info.pOffset; nextOffset = info.nextOffset;
        pHeight = nextOffset - pOffset;
        localY = pHeight - (item.globalY - pOffset);
      }
    }

    // 2. Check if it sticks out the BOTTOM of the usable area
    if (!isOversized && localY < MARGIN) {
      const nextPageTopGlobalY = nextOffset + MARGIN + item.height;
      const shiftNeeded = nextPageTopGlobalY - item.globalY;
      
      if (shiftNeeded > 0) {
        item.globalY += shiftNeeded;
        cumulativeShift += shiftNeeded;
      }
    }
  }

  const newPages = pages.map(p => ({
    ...p,
    textElements: [],
    images: { ...p.images, pageImages: [] }
  }));

  allElements.forEach(item => {
    const { pageIdx, pOffset, nextOffset } = getPageInfo(item.globalY);
    
    while (pageIdx >= newPages.length) {
      const lastPage = newPages[newPages.length - 1];
      newPages.push({
        dimensions: lastPage?.dimensions || { width: 612, height: 792 },
        textElements: [],
        classification: { headers: [], detailed: { paragraphs: new Map() } },
        images: { background: null, pageImages: [] }
      });
    }

    const pHeight = nextOffset - pOffset;
    const localY = pHeight - (item.globalY - pOffset);

    if (item.type === 'text') {
      newPages[pageIdx].textElements.push({ ...item.data, y: localY });
    } else if (item.type === 'image') {
      newPages[pageIdx].images.pageImages.push({
        ...item.data,
        appearances: [{ ...item.ap, y: localY }]
      });
    }
  });

  return newPages;
};

export const usePDFStore = create((set) => ({
  currentPDF: null,
  pages: [],
  pageCount: 0,
  activeCursor: { pageIdx: null, elIdx: null, charOffset: null, caretX: 0 },
  // activeImage: null | { pageIdx, imgIdx, side: 'left'|'right'|'selected' }
  activeImage: null,
  isLoading: false,
  error: null,

  setCurrentPDF: (file) => set({ currentPDF: file }),

  setPages: (pages) => set({ pages }),
  setPageCount: (count) => set({ pageCount: count }),
  setActiveCursor: (cursorOrUpdater) => set((state) => ({
    activeCursor: typeof cursorOrUpdater === 'function' ? cursorOrUpdater(state.activeCursor) : cursorOrUpdater
  })),

  setActiveImage: (imageStateOrUpdater) => set((state) => ({
    activeImage: typeof imageStateOrUpdater === 'function'
      ? imageStateOrUpdater(state.activeImage)
      : imageStateOrUpdater
  })),

  /**
   * Update a page image's dataUrl and appearance (simple replace, no reflow).
   * Used when only dataUrl changes (e.g. future crop feature).
   */
  updatePageImage: (pageIdx, imgIdx, newDataUrl, newAppearance) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const pageImages = [...(page.images?.pageImages ?? [])];
    const img = pageImages[imgIdx];
    if (!img) return {};
    pageImages[imgIdx] = { ...img, dataUrl: newDataUrl, appearances: [newAppearance] };
    page.images = { ...page.images, pageImages };
    newPages[pageIdx] = page;
    return { pages: newPages, activeImage: null };
  }),

  /**
   * Resize a page image and trigger smart reflow.
   * - Keeps the image's CSS top-left position fixed (adjusts PDF y coordinate).
   * - Shifts text elements and other images that sit below the image by the
   *   height delta, so content reflows naturally.
   * newRenderedWidth / newRenderedHeight are in PDF user-space points.
   */
  resizePageImage: (pageIdx, imgIdx, newRenderedWidth, newRenderedHeight) => set((state) => {
    const page = state.pages[pageIdx];
    const pageImages = page.images?.pageImages ?? [];
    const img = pageImages[imgIdx];
    if (!img) return {};

    const ap = img.appearances?.[0];
    if (!ap) return {};

    const deltaH = newRenderedHeight - ap.renderedHeight;
    const yThreshold = ap.y;

    const prePages = [...state.pages];
    const prePage = { ...prePages[pageIdx] };
    const prePageImages = [...(prePage.images?.pageImages ?? [])];

    const newY = ap.y + ap.renderedHeight - newRenderedHeight;
    const newAp = { ...ap, y: newY, renderedWidth: newRenderedWidth, renderedHeight: newRenderedHeight };
    prePageImages[imgIdx] = { ...img, appearances: [newAp] };
    prePage.images = { ...prePage.images, pageImages: prePageImages };
    prePages[pageIdx] = prePage;

    const skipFilter = (item) => item.type === 'image' && item.originalPage === pageIdx && item.originalIdx === imgIdx;

    let finalPages = prePages;
    if (deltaH > 0) {
      finalPages = applyGlobalReflow(prePages, pageIdx, yThreshold, deltaH, skipFilter);
    } else if (deltaH < 0) {
      finalPages = applyGlobalReflow(prePages, pageIdx, yThreshold, deltaH, skipFilter); // amount is negative here! Wait, if amount is negative, it shifts UP!
    }

    return { pages: finalPages, activeImage: null };
  }),

  setIsLoading: (val) => set({ isLoading: val }),

  clearError: () => set({ error: null }),

  updateTextElement: (pageIdx, elIdx, updates) => set((state) => {
    const newPages = [...state.pages];
    const page = { ...newPages[pageIdx] };
    const elements = [...page.textElements];

    const currentEl = elements[elIdx] || {};

    if (typeof updates === 'string') {
      elements[elIdx] = { ...currentEl, text: updates };
    } else {
      elements[elIdx] = { ...currentEl, ...updates };
      if (currentEl.isBold && updates.isBold === undefined) {
        elements[elIdx].isBold = true;
      }
      if (currentEl.isItalic && updates.isItalic === undefined) {
        elements[elIdx].isItalic = true;
      }
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
    return { pages: applyGlobalReflow(state.pages, pageIdx, yThreshold, amount) };
  }),

  shiftElementsAbove: (pageIdx, yThreshold, amount) => set((state) => {
    return { pages: applyGlobalReflow(state.pages, pageIdx, yThreshold, -amount) };
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