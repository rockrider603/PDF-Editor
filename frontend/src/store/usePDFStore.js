import { create } from "zustand";

// Marker temporarily attached to a text element so the store can locate it
// after applyGlobalReflow rebuilds the pages array (rebuild creates new
// objects, so reference equality wouldn't survive). Always stripped before
// the new state is published.
const CURSOR_MARKER = '__pendingCursor';

const findAndStripCursorMarker = (pages, fallbackCursor) => {
  let newCursor = null;
  let anyChange = false;
  const updatedPages = pages.map((p, pIdx) => {
    let pageChanged = false;
    const newEls = p.textElements.map((el, eIdx) => {
      if (el && el[CURSOR_MARKER]) {
        const marker = el[CURSOR_MARKER];
        const { [CURSOR_MARKER]: _, ...clean } = el;
        pageChanged = true;
        anyChange = true;
        newCursor = {
          pageIdx: pIdx,
          elIdx: eIdx,
          charOffset: typeof marker === 'object' ? (marker.charOffset ?? 0) : 0,
          caretX: 0,
        };
        return clean;
      }
      return el;
    });
    return pageChanged ? { ...p, textElements: newEls } : p;
  });
  return { pages: anyChange ? updatedPages : pages, cursor: newCursor ?? fallbackCursor };
};

export const applyGlobalReflow = (pages, startPageIdx, yThreshold, amount, skipFilter = null) => {
  // NOTE: we intentionally do NOT short-circuit on amount===0.
  // Callers pass amount=0 as a pure page-boundary normalisation pass
  // (no flowY shifts, just checks that elements respect top/bottom margins).

  const pageOffsets = [];
  let currentOffset = 0;
  for (const p of pages) {
    pageOffsets.push(currentOffset);
    currentOffset += (p.dimensions?.height ?? 792);
  }

  // ── Build allElements from pages (text + images) ─────────────────────────
  // Text elements: read directly from pages (which already have the correct
  // updated/inserted text from the caller — no stale rebuild).
  // Images: always built fresh from page.images.
  let allElements = [];
  pages.forEach((page, pIdx) => {
    const pHeight = page.dimensions?.height ?? 792;

    // Text
    page.textElements.forEach((el, elIdx) => {
      const globalY = pageOffsets[pIdx] + (pHeight - el.y);
      allElements.push({
        type: 'text',
        originalPage: pIdx,
        originalIdx: elIdx,
        globalY,
        flowY: globalY, // always fresh — recompute from current y, never accumulate
        data: el,
        height: (el.fontSize || 12) * 1.2
      });
    });

    // Images (built by reflow itself, not the caller)
    page.images?.pageImages?.forEach((img, imgIdx) => {
      const ap = img.appearances?.[0];
      if (ap) {
        const globalY = pageOffsets[pIdx] + (pHeight - ap.y);
        allElements.push({
          type: 'image',
          originalPage: pIdx,
          originalIdx: imgIdx,
          globalY,
          flowY: globalY, // always fresh
          data: img,
          ap,
          height: ap.renderedHeight || 100
        });
      }
    });
  });

  // ── Compute shift threshold ───────────────────────────────────────────────
  const targetPageHeight = pages[startPageIdx].dimensions?.height ?? 792;
  const globalThreshold = pageOffsets[startPageIdx] + (targetPageHeight - yThreshold);

  // Apply the requested shift to every element whose flowY is below the threshold
  allElements.forEach(item => {
    if (!skipFilter || !skipFilter(item)) {
      if (item.flowY > globalThreshold + 0.1) {
        item.flowY += amount;
      }
    }
  });

  allElements.sort((a, b) => a.flowY - b.flowY);

  // ── Page info helper ──────────────────────────────────────────────────────
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

  const MARGIN = 48;

  // ── Per-element page placement ────────────────────────────────────────────
  // Each element starts from its own fresh flowY (= BOTTOM globalY) but is
  // constrained to come AFTER the previous element ends (Word-like flow order).
  //
  // Constraint: current.TOP ≥ prev.BOTTOM
  //   current.TOP = current.flowY − current.height
  //   ⇒ current.flowY ≥ prev.BOTTOM + current.height
  //
  // Earlier this used (prev.flowY + prev.height), which gave the same answer
  // for uniform-height text but over-padded when prev was tall (e.g. an image).
  // That caused upward shifts to leave a phantom gap of (image.height − text.height)
  // below the image — visually the image moved up but the paragraph below it
  // didn't follow.
  let prevBottomGlobalY = 0;

  for (const item of allElements) {
    let intendedGlobalY = Math.max(item.flowY, prevBottomGlobalY + item.height);

    let { pageIdx, pOffset, nextOffset } = getPageInfo(intendedGlobalY);
    let pHeight = nextOffset - pOffset;
    let localY = pHeight - (intendedGlobalY - pOffset);

    const usableHeight = pHeight - 2 * MARGIN;
    const isOversized = item.height > usableHeight;

    // 1. Top margin: element is too close to the top of the page
    if (localY + item.height > pHeight - MARGIN) {
      const topGlobalY = pOffset + MARGIN + item.height;
      const shiftNeeded = topGlobalY - intendedGlobalY;
      if (shiftNeeded > 0) {
        intendedGlobalY = topGlobalY; // nudge only this element
        const info = getPageInfo(intendedGlobalY);
        pageIdx = info.pageIdx; pOffset = info.pOffset; nextOffset = info.nextOffset;
        pHeight = nextOffset - pOffset;
        localY = pHeight - (intendedGlobalY - pOffset);
      }
    }

    // 2. Bottom margin: element fell below the bottom of its page → push to next page top
    if (!isOversized && localY < MARGIN) {
      // Place at the top of the NEXT page (reset to just inside top margin)
      const nextPageTopGlobalY = nextOffset + MARGIN + item.height;
      intendedGlobalY = nextPageTopGlobalY; // nudge only this element, no accumulation
    }

    item.finalGlobalY = intendedGlobalY;
    // Track this element's BOTTOM so the next element's TOP can be ≥ it
    // (next element's height is applied in the max() above, not here).
    prevBottomGlobalY = intendedGlobalY;
  }

  // ── Rebuild pages from final positions ───────────────────────────────────
  const newPages = pages.map(p => ({
    ...p,
    textElements: [],
    images: { ...p.images, pageImages: [] }
  }));

  allElements.forEach(item => {
    const { pageIdx, pOffset, nextOffset } = getPageInfo(item.finalGlobalY);

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
    const localY = pHeight - (item.finalGlobalY - pOffset);

    if (item.type === 'text') {
      // Never persist flowY — recompute fresh on every reflow to avoid drift
      const { flowY: _drop, ...elData } = item.data;
      newPages[pageIdx].textElements.push({ ...elData, y: localY });
    } else if (item.type === 'image') {
      const { flowY: _dropAp, ...apData } = item.ap;
      newPages[pageIdx].images.pageImages.push({
        ...item.data,
        appearances: [{ ...apData, y: localY }]
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
    // 1. Calculate how much the height is changing (deltaH)
    const deltaH = newRenderedHeight - ap.renderedHeight;
    const yThreshold = ap.y;
    const prePages = [...state.pages];
    const prePage = { ...prePages[pageIdx] };
    const prePageImages = [...(prePage.images?.pageImages ?? [])];
    // 2. Set new PDF coordinates (preserving top-left anchor point)
    const newY = ap.y + ap.renderedHeight - newRenderedHeight;
    const newAp = { ...ap, y: newY, renderedWidth: newRenderedWidth, renderedHeight: newRenderedHeight };
    prePageImages[imgIdx] = { ...img, appearances: [newAp] };
    prePage.images = { ...prePage.images, pageImages: prePageImages };
    prePages[pageIdx] = prePage;
    // Filter to avoid shifting the image itself during reflow
    const skipFilter = (item) => item.type === 'image' && item.originalPage === pageIdx && item.originalIdx === imgIdx;
    // 3. Trigger smart global reflow to push/pull content below the image
    let finalPages = prePages;
    finalPages = applyGlobalReflow(prePages, pageIdx, yThreshold, deltaH, skipFilter);
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

  /**
   * Atomically splits a text element at charOffset (Enter key).
   * Updates the current element's text, inserts the new line element,
   * and shifts everything below — all in one state mutation. The new line
   * is tagged with CURSOR_MARKER so we can locate its final (pageIdx, elIdx)
   * after reflow — critical when the new line overflows to the next page.
   */
  splitTextElement: (pageIdx, elIdx, textBefore, textAfter, lineHeight, measureFn) => set((state) => {
    // Step 1: update current element only (new line NOT yet in the array)
    const pages0 = [...state.pages];
    const page0 = { ...pages0[pageIdx] };
    const els0 = [...page0.textElements];
    const currentEl = els0[elIdx];
    if (!currentEl) return {};

    els0[elIdx] = { ...currentEl, text: textBefore, width: measureFn(textBefore) };
    page0.textElements = els0;
    pages0[pageIdx] = page0;

    // Step 2: shift all OLD elements below currentEl down by one lineHeight.
    // The new line is NOT in pages0 yet, so it is NOT caught by this shift.
    const pagesAfterShift = applyGlobalReflow(pages0, pageIdx, currentEl.y - 0.1, lineHeight);

    // Step 3: insert the new line element at exactly currentEl.y - lineHeight.
    // After the shift, currentEl.y is unchanged (it was above the threshold).
    const pagesForInsert = [...pagesAfterShift];
    const pageForInsert = { ...pagesForInsert[pageIdx] };
    const elsForInsert = [...pageForInsert.textElements];
    const elAfterShift = elsForInsert[elIdx];

    const newLineEl = {
      ...currentEl,
      text: textAfter,
      y: (elAfterShift?.y ?? currentEl.y) - lineHeight,
      width: measureFn(textAfter),
      [CURSOR_MARKER]: { charOffset: 0 },
    };
    delete newLineEl.flowY;

    elsForInsert.splice(elIdx + 1, 0, newLineEl);
    pageForInsert.textElements = elsForInsert;
    pagesForInsert[pageIdx] = pageForInsert;

    // Step 4: page-boundary normalisation with amount=0.
    // No flowY shifts happen; only elements below their page margin are moved
    // to the next page (e.g. the new line if it crossed the bottom margin).
    const finalPages = applyGlobalReflow(pagesForInsert, pageIdx, -1, 0);

    // Step 5: locate the marked new line — it may have landed on a freshly
    // created page if the split happened near the page bottom — and hand
    // the cursor over to it.
    const { pages: cleanPages, cursor } = findAndStripCursorMarker(finalPages, state.activeCursor);
    return { pages: cleanPages, activeCursor: cursor };
  }),

  /**
   * Atomically wraps an overflowing line when typing causes width overflow.
   * Same insert-after-shift pattern as splitTextElement.
   *
   * cursorTarget = { onNewLine: boolean, charOffset: number }
   *   onNewLine=true  → cursor goes to the wrapped (second) line
   *   onNewLine=false → cursor stays on the first line at charOffset
   * Either way the marker survives reflow so a page-overflow lands the
   * cursor on the correct (pageIdx, elIdx) — including new pages.
   */
  wrapTextElement: (pageIdx, elIdx, firstLineText, secondLineText, lineHeight, measureFn, cursorTarget) => set((state) => {
    const onNewLine = cursorTarget ? cursorTarget.onNewLine !== false : true;
    const cursorOffset = cursorTarget?.charOffset ?? 0;

    // Step 1: update current element (overflow line NOT yet in array)
    const pages0 = [...state.pages];
    const page0 = { ...pages0[pageIdx] };
    const els0 = [...page0.textElements];
    const currentEl = els0[elIdx];
    if (!currentEl) return {};

    const firstLineUpdate = {
      ...currentEl,
      text: firstLineText,
      width: measureFn(firstLineText),
    };
    if (!onNewLine) firstLineUpdate[CURSOR_MARKER] = { charOffset: cursorOffset };
    els0[elIdx] = firstLineUpdate;
    page0.textElements = els0;
    pages0[pageIdx] = page0;

    // Step 2: shift old elements below (overflow line not present yet)
    const pagesAfterShift = applyGlobalReflow(pages0, pageIdx, currentEl.y - 0.1, lineHeight);

    // Step 3: insert overflow line after the shift
    const pagesForInsert = [...pagesAfterShift];
    const pageForInsert = { ...pagesForInsert[pageIdx] };
    const elsForInsert = [...pageForInsert.textElements];
    const elAfterShift = elsForInsert[elIdx];

    const newLineEl = {
      ...currentEl,
      text: secondLineText,
      y: (elAfterShift?.y ?? currentEl.y) - lineHeight,
      width: measureFn(secondLineText),
    };
    if (onNewLine) newLineEl[CURSOR_MARKER] = { charOffset: cursorOffset };
    delete newLineEl.flowY;

    elsForInsert.splice(elIdx + 1, 0, newLineEl);
    pageForInsert.textElements = elsForInsert;
    pagesForInsert[pageIdx] = pageForInsert;

    // Step 4: page-boundary normalisation only (amount=0)
    const finalPages = applyGlobalReflow(pagesForInsert, pageIdx, -1, 0);
    const { pages: cleanPages, cursor } = findAndStripCursorMarker(finalPages, state.activeCursor);
    return { pages: cleanPages, activeCursor: cursor };
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

  /**
   * Greedy paragraph compaction triggered by forward-delete.
   *
   * Walks downward from `startIdx` on `pageIdx`, pulling words from each
   * line below into the line above, until either:
   *   - the line above is full and the next line can't contribute a fitting
   *     word (we then advance to that next line and keep trying), OR
   *   - the next line is in a different paragraph (gap > 1.5 × fontSize OR
   *     fontSize differs by > 1.5pt) — cascade stops here.
   *
   * Lines fully consumed are removed; remaining text elements + any images
   * BELOW each removed line on the same page have their y bumped up by
   * the removed line's lineHeight so the visual gap closes. A final
   * applyGlobalReflow(amount=0) pass normalises page boundaries (anything
   * that was held below the bottom margin can now lift / etc.).
   *
   * Caller passes `measureFn(text, el)` and `maxWidthFn(el)` so the store
   * stays decoupled from the canvas measurement API.
   */
  cascadeCompactParagraph: (pageIdx, startIdx, measureFn, maxWidthFn) => set((state) => {
    const initialPage = state.pages[pageIdx];
    if (!initialPage) return {};

    let elements = [...initialPage.textElements];
    const removals = []; // { y, lineHeight }

    let idx = startIdx;
    while (idx + 1 < elements.length) {
      const curEl = elements[idx];
      const nextEl = elements[idx + 1];

      const gap = curEl.y - nextEl.y;
      const fontDiff = Math.abs((curEl.fontSize || 12) - (nextEl.fontSize || 12));
      // Same-paragraph: nextEl directly below curEl (positive gap in PDF y),
      // within 1.5 font-heights, similar font size.
      if (!(gap > 0 && gap < (curEl.fontSize || 12) * 1.5 && fontDiff < 1.5)) {
        break;
      }

      const curMaxWidth = maxWidthFn(curEl);
      const nextWords = nextEl.text.split(' ').filter(w => w.length > 0);
      let testText = curEl.text;
      let pullCount = 0;

      for (const word of nextWords) {
        const candidate = testText + (testText.length > 0 ? ' ' : '') + word;
        if (measureFn(candidate, curEl) <= curMaxWidth) {
          testText = candidate;
          pullCount++;
        } else {
          break;
        }
      }

      if (pullCount === 0) {
        // curEl is already at max width — advance to the next line and try
        // pulling from the one after it.
        idx++;
        continue;
      }

      elements[idx] = {
        ...curEl,
        text: testText,
        width: measureFn(testText, curEl),
      };

      const remainingWords = nextWords.slice(pullCount);
      if (remainingWords.length > 0) {
        const remText = remainingWords.join(' ');
        elements[idx + 1] = {
          ...nextEl,
          text: remText,
          width: measureFn(remText, nextEl),
        };
        idx++;
      } else {
        removals.push({ y: nextEl.y, lineHeight: (nextEl.fontSize || 12) * 1.2 });
        elements.splice(idx + 1, 1);
        // do NOT advance idx — the (new) elements[idx + 1] is what used to
        // be two lines below; try pulling from it on the next iteration.
      }
    }

    const newPages = [...state.pages];

    if (removals.length === 0) {
      newPages[pageIdx] = { ...newPages[pageIdx], textElements: elements };
      return { pages: newPages };
    }

    // Shift y of remaining text elements + page images on THIS page that
    // sat below any removed line, by the cumulative lineHeight of removals
    // above them. PDF y is bottom-origin, so "shift up visually" = "increase y".
    const shiftedElements = elements.map(el => {
      let shiftUp = 0;
      for (const r of removals) {
        if (r.y > el.y) shiftUp += r.lineHeight;
      }
      return shiftUp > 0 ? { ...el, y: el.y + shiftUp } : el;
    });

    const updatedImages = (newPages[pageIdx].images?.pageImages ?? []).map(img => {
      const ap = img.appearances?.[0];
      if (!ap) return img;
      let shiftUp = 0;
      for (const r of removals) {
        if (r.y > ap.y) shiftUp += r.lineHeight;
      }
      if (shiftUp === 0) return img;
      return {
        ...img,
        appearances: [{ ...ap, y: ap.y + shiftUp }],
      };
    });

    newPages[pageIdx] = {
      ...newPages[pageIdx],
      textElements: shiftedElements,
      images: { ...newPages[pageIdx].images, pageImages: updatedImages },
    };

    // Page-boundary normalisation only — no flowY shift. Anything that
    // hugged the bottom margin and now has room is lifted; same for
    // anything that was forced to the next page and should come back.
    return { pages: applyGlobalReflow(newPages, pageIdx, -1, 0) };
  }),
}));