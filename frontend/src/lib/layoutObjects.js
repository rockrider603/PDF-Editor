// Pure layout pass for the SinglePageView.
//
// Given the document model (objects[] from buildObjects) and a few presentation
// parameters, returns the CSS-space rectangle for every block, the list of
// soft-page-separator markers, and the total canvas height.
//
// No React, no DOM mutation, no side effects on inputs. The measurement cache
// is the only mutable thing — it persists across calls so unchanged blocks
// don't re-measure.
//
// Guarantees (informally proved in the design doc):
//   P1  Determinism — same inputs → same output.
//   P2  Non-overlap — for any two text blocks at indices i < j in objects[],
//                     layout.get(blocks[j].id).top
//                       ≥ layout.get(blocks[i].id).top + height(i) + BLOCK_GAP_PX.
//   P3  Locality    — replacing objects[k] cannot change top(0..k-1).
//
// Soft page boundaries: pages are visual hints. Between blocks whose pageIdx
// differs, we record a separator at the current cursor and advance cursorY
// past it. The whole document is one continuous flow.

const TOP_MARGIN_PX = 48;
const BLOCK_GAP_PX = 0;
const SEPARATOR_HEIGHT_PX = 0;
const LINE_HEIGHT_FACTOR = 1.2;
const RIGHT_MARGIN_PDF_PT = 48;
const MIN_COLUMN_PDF_PT = 60;
const MEASURE_CACHE_CAP = 500;

const DEFAULT_PAGE_WIDTH_PT = 612;

/**
 * Word-wrap a single text block at `columnPx` CSS pixels using the supplied
 * canvas measurement context. Returns total wrapped height in CSS pixels.
 *
 * Uses the same greedy line-break the browser uses for normal text (no
 * hyphenation, no soft-break-inside-word). Matches the contenteditable's
 * visible wrap for typical body text within ±1 line.
 *
 * Result is cached on (fontPx, columnPx, text). When the cache hits its cap
 * we clear and start fresh — simpler than LRU and the trace is bounded.
 *
 * @param {string} text
 * @param {number} fontPx
 * @param {number} columnPx
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<string, number>} cache
 * @returns {number}
 */
export function measureWrappedHeight(text, fontPx, columnPx, ctx, cache) {
  const key = `${fontPx}|${columnPx}|${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (cache.size >= MEASURE_CACHE_CAP) cache.clear();

  ctx.font = `${fontPx}px serif`;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    const h = fontPx * LINE_HEIGHT_FACTOR; // empty block reserves one line
    cache.set(key, h);
    return h;
  }

  const spaceW = ctx.measureText(' ').width;
  let lines = 1;
  let lineWidth = 0;

  for (const word of words) {
    const wordW = ctx.measureText(word).width;
    const candidate = lineWidth === 0 ? wordW : lineWidth + spaceW + wordW;
    if (candidate > columnPx && lineWidth > 0) {
      // Word doesn't fit on the current line. Start a new line with the word.
      // Long words exceeding columnPx alone still get one line each (matches
      // CSS overflow-wrap: normal).
      lines += 1;
      lineWidth = wordW;
    } else {
      lineWidth = candidate;
    }
  }

  const h = lines * fontPx * LINE_HEIGHT_FACTOR;
  cache.set(key, h);
  return h;
}

/**
 * Lay out every block in document order.
 *
 * Height resolution per block (in priority order):
 *   1. measuredHeights.get(id) — the live DOM height reported by
 *      ResizeObserver in the view (browser-accurate; the truth).
 *   2. canvas measureText fallback — used until the observer reports
 *      a real value for that block (first paint, brand-new blocks).
 *
 * @param {object} params
 * @param {Array}  params.objects       — Block[] (model from buildObjects)
 * @param {number} params.scale         — CSS pixels per PDF point
 * @param {number[]} params.pageWidthsByIdx — page widths in PDF points
 * @param {CanvasRenderingContext2D} params.measureCtx
 * @param {Map<string, number>} params.measureCache
 * @param {Map<string|number, number>} [params.measuredHeights] — DOM-reported
 *   heights from ResizeObserver. Optional; if missing, canvas estimate used.
 * @returns {{
 *   layout: Map<string|number, {top:number, left:number, width:number, height:number; gapLines?: number; gapPx?: number}>,
 *   separators: Array<{ afterId: string|number|null, top: number, fromPage: number, toPage: number }>,
 *   gapMarkers: Array<{ top:number, width:number, lines:number, px:number, prevId:string|number, nextId:string|number|null }>,
 *   totalHeight: number,
 * }}
 */
export const imageSizeOverrides = new Map();

export function overrideImageSize(id, width, height) {
  imageSizeOverrides.set(id, { width, height });
}

export function updateImageRect(block, scale, layout) {
  if (!imageSizeOverrides.has(block.id)) return;
  const currentRect = layout.get(block.id);
  if (!currentRect) return;

  const override = imageSizeOverrides.get(block.id);
  const newW = override.width * scale;
  const newH = override.height * scale;

  layout.set(block.id, {
    ...currentRect,
    width: newW,
    height: newH
  });
}

export function layoutObjects({
  objects,
  scale,
  pageWidthsByIdx,
  pageHeightsByIdx = [],
  measureCtx,
  measureCache,
  measuredHeights,
}) {
  const layout = new Map();
  const separators = [];

  // Sentinel measure context for SSR / tests where a real canvas isn't around.
  // We never reach this in the browser; the caller initialises a real ctx.
  if (!measureCtx) {
    // Fake context with a deterministic width estimate.
    measureCtx = {
      font: '',
      measureText: (s) => ({ width: s.length * 6 }),
    };
  }
  if (!measureCache) measureCache = new Map();

  // Pre-calculate physical page starts and separators for every page,
  // including empty pages (like page 5). This ensures a "fixed distance"
  // between page markers and shows the whole white page.
  let precalcY = TOP_MARGIN_PX;
  const pageStartCursorY = new Map();
  for (let i = 0; i < pageHeightsByIdx.length; i++) {
    if (i > 0) {
      separators.push({
        afterId: null, // Pre-calculated, no specific block
        top: precalcY,
        fromPage: i - 1,
        toPage: i,
      });
      precalcY += SEPARATOR_HEIGHT_PX;
    }
    pageStartCursorY.set(i, precalcY);
    const h = (pageHeightsByIdx[i] ?? 792) * scale;
    precalcY += h;
  }
  // Store the total physical canvas height
  const physicalTotalHeight = precalcY;

  let cursorY = TOP_MARGIN_PX;
  let lastPageIdx = null;
  let prevBlock = null;
  const gapMarkers = [];

  const estimateLineHeightPx = (block) => {
    const fontSize = block && typeof block.fontSize === 'number' ? block.fontSize : 12;
    return fontSize * LINE_HEIGHT_FACTOR * scale;
  };

  const recordGap = (prev, current, prevBottom, currentTop) => {
    const gapPx = currentTop - prevBottom;
    if (gapPx <= 0) return;

    const currentLineHeight = estimateLineHeightPx(current);
    const prevLineHeight = estimateLineHeightPx(prev);
    const lineHeight = Math.max(currentLineHeight, prevLineHeight, 12 * LINE_HEIGHT_FACTOR * scale);
    const lines = Math.max(1, Math.round(gapPx / lineHeight));

    gapMarkers.push({
      top: prevBottom + gapPx / 2,
      width: Math.max(120, (pageWidthsByIdx[current.pageIdx] ?? DEFAULT_PAGE_WIDTH_PT) * scale * 0.25),
      lines,
      px: gapPx,
      prevId: prev.id,
      nextId: current.id,
    });

    return { gapLines: lines, gapPx };
  };

  for (const block of objects) {
    if (block.pageIdx !== lastPageIdx) {
      // Jump cursor to the actual start of this page, unless the previous page
      // overflowed its physical bounds, in which case we keep going down.
      const pageStart = pageStartCursorY.get(block.pageIdx) ?? TOP_MARGIN_PX;
      cursorY = Math.max(cursorY, pageStart);
      lastPageIdx = block.pageIdx;
    }

    if (block.type === 'image') {
      const pageStart = pageStartCursorY.get(block.pageIdx);
      const pageHeight = block.pageHeight ?? 792;
      const originalTopPx =
        (pageHeight - block.y - block.renderedHeight) * scale;
      const anchoredTop = pageStart + originalTopPx;
      const effectiveTop = Math.max(anchoredTop, cursorY);

      let w = 0, h = 0;

      if (imageSizeOverrides.has(block.id)) {
        const override = imageSizeOverrides.get(block.id);
        w = override.width;
        h = override.height;
      } else {
        w = block.renderedWidth;
        h = block.renderedHeight;
      }

      w = w * scale;
      h = h * scale;

      layout.set(block.id, {
        top: effectiveTop,
        left: block.x * scale,
        width: w,
        height: h,
      });

      if (prevBlock && prevBlock.pageIdx === block.pageIdx) {
        const prevRect = layout.get(prevBlock.id);
        if (prevRect) {
          const gap = recordGap(prevBlock, block, prevRect.top + prevRect.height, effectiveTop);
          if (gap) {
            layout.set(block.id, {
              ...layout.get(block.id),
              ...gap,
            });
          }
        }
      }

      cursorY = effectiveTop + h + BLOCK_GAP_PX;
      prevBlock = block;
      continue;
    }

    // ── Shape block — absolutely anchored, does NOT advance cursorY ────────
    if (block.type === 'shape') {
      const pageStart = pageStartCursorY.get(block.pageIdx);
      const pageHeight = block.pageHeight ?? 792;

      // Each shape type needs slightly different bounding-box logic.
      if (block.shapeKind === 'line') {
        const minX = Math.min(block.x1, block.x2);
        const minY = Math.min(block.y1, block.y2);
        const maxX = Math.max(block.x1, block.x2);
        const maxY = Math.max(block.y1, block.y2);
        const topPx = pageStart + (pageHeight - maxY) * scale;
        layout.set(block.id, {
          top: topPx,
          left: minX * scale,
          // Store raw PDF coords so the renderer can compute exact line endpoints.
          width: (maxX - minX) * scale,
          height: Math.max(2, (maxY - minY) * scale),
          // Carry the original PDF-space endpoints for SVG rendering.
          _x1: block.x1, _y1: block.y1, _x2: block.x2, _y2: block.y2,
          _pageStart: pageStart, _pageHeight: pageHeight, _scale: scale,
        });
      } else if (block.shapeKind === 'rect') {
        const topPx = pageStart + (pageHeight - block.y - block.height) * scale;
        layout.set(block.id, {
          top: topPx,
          left: block.x * scale,
          width: block.width * scale,
          height: block.height * scale,
        });
      } else if (block.shapeKind === 'path' && block.points?.length) {
        const xs = block.points.map(p => p.x);
        const ys = block.points.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const topPx = pageStart + (pageHeight - maxY) * scale;
        layout.set(block.id, {
          top: topPx,
          left: minX * scale,
          width: (maxX - minX) * scale,
          height: (maxY - minY) * scale,
          _minX: minX, _minY: minY, _pageStart: pageStart,
          _pageHeight: pageHeight, _scale: scale,
        });
      }

      // Shapes are absolutely positioned overlays — they don't push text down.
      prevBlock = block;
      continue;
    }

    // Text block (paragraph / header / line).
    const fontPx = (block.fontSize ?? 12) * scale;
    const pageWidthPt =
      pageWidthsByIdx[block.pageIdx] ?? DEFAULT_PAGE_WIDTH_PT;

    let columnPdfPt;
    if (block.inTable && block.tableBounds) {
      columnPdfPt = Math.max(MIN_COLUMN_PDF_PT, block.tableBounds.x2 - block.x);
    } else {
      columnPdfPt = Math.max(
        MIN_COLUMN_PDF_PT,
        pageWidthPt - block.x - RIGHT_MARGIN_PDF_PT
      );
    }
    const columnPx = columnPdfPt * scale;
    
    // Calculate layout top position
    let layoutTop = cursorY;
    if (block.y !== undefined) {
      const pageStart = pageStartCursorY.get(block.pageIdx) ?? TOP_MARGIN_PX;
      const pageHeight = block.pageHeight ?? 792;
      const originalTopPx = (pageHeight - block.y - (block.fontSize ?? 12) * 0.8) * scale;
      const anchoredTop = pageStart + originalTopPx;
      
      layoutTop = Math.max(anchoredTop, cursorY);
    }

    // Prefer the live DOM-reported height if ResizeObserver has measured
    // this block (the truth). Otherwise fall back to a canvas estimate so
    // the first frame still positions blocks approximately. After the
    // first paint, the observer fires and this branch goes away for
    // existing blocks.
    let h = measuredHeights?.get(block.id);
    if (typeof h !== 'number' || h <= 0) {
      h = measureWrappedHeight(
        block.text ?? '',
        fontPx,
        columnPx,
        measureCtx,
        measureCache
      );
    }

    // Calculate original height in pixels based on original lines' Y span
    let originalHeightPt = 0;
    if (block.lines && block.lines.length > 0) {
      const topLineY = block.lines[0].y;
      const bottomLineY = block.lines[block.lines.length - 1].y;
      originalHeightPt = (topLineY - bottomLineY) + (block.fontSize ?? 12) * 1.2;
    } else {
      originalHeightPt = (block.fontSize ?? 12) * 1.2;
    }
    const originalHeightPx = originalHeightPt * scale;

    layout.set(block.id, {
      top: layoutTop,
      left: block.x * scale,
      width: columnPx,
      height: h,
    });

    if (prevBlock && prevBlock.pageIdx === block.pageIdx) {
      const prevRect = layout.get(prevBlock.id);
      if (prevRect) {
        const gap = recordGap(prevBlock, block, prevRect.top + prevRect.height, layoutTop);
        if (gap) {
          layout.set(block.id, {
            ...layout.get(block.id),
            ...gap,
          });
        }
      }
    }

    cursorY = layoutTop + h + BLOCK_GAP_PX;
    prevBlock = block;
  }

  // Set the height of the canvas to match where the last element layout ends, plus bottom margin
  let finalCanvasHeight = cursorY;

  return {
    layout,
    separators,
    gapMarkers,
    totalHeight: finalCanvasHeight + TOP_MARGIN_PX,
  };
}

export const LAYOUT_CONSTANTS = {
  TOP_MARGIN_PX,
  BLOCK_GAP_PX,
  SEPARATOR_HEIGHT_PX,
  LINE_HEIGHT_FACTOR,
  RIGHT_MARGIN_PDF_PT,
  MIN_COLUMN_PDF_PT,
};
