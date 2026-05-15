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
const BLOCK_GAP_PX = 8;
const SEPARATOR_HEIGHT_PX = 32;
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
 *   layout: Map<string|number, {top:number, left:number, width:number, height:number}>,
 *   separators: Array<{ afterId: string|number|null, top: number, fromPage: number, toPage: number }>,
 *   totalHeight: number,
 * }}
 */
export function layoutObjects({
  objects,
  scale,
  pageWidthsByIdx,
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

  let cursorY = TOP_MARGIN_PX;
  const pageStartCursorY = new Map();
  let lastPageIdx = null;
  let prevBlockId = null;

  for (const block of objects) {
    // Page transition → emit a soft separator marker, advance cursor past it.
    if (block.pageIdx !== lastPageIdx) {
      if (lastPageIdx !== null) {
        separators.push({
          afterId: prevBlockId,
          top: cursorY,
          fromPage: lastPageIdx,
          toPage: block.pageIdx,
        });
        cursorY += SEPARATOR_HEIGHT_PX;
      }
      pageStartCursorY.set(block.pageIdx, cursorY);
      lastPageIdx = block.pageIdx;
    } else if (!pageStartCursorY.has(block.pageIdx)) {
      // First block of the very first page.
      pageStartCursorY.set(block.pageIdx, cursorY);
    }

    if (block.type === 'image') {
      // Anchored at original page-relative top-left. May leave an empty band
      // above it if preceding text shrank, or push cursorY further down.
      const pageStart = pageStartCursorY.get(block.pageIdx);
      const pageHeight = block.pageHeight ?? 792;
      const originalTopPx =
        (pageHeight - block.y - block.renderedHeight) * scale;
      const anchoredTop = pageStart + originalTopPx;
      const w = block.renderedWidth * scale;
      const h = block.renderedHeight * scale;

      layout.set(block.id, {
        top: anchoredTop,
        left: block.x * scale,
        width: w,
        height: h,
      });

      cursorY = Math.max(cursorY, anchoredTop + h + BLOCK_GAP_PX);
      prevBlockId = block.id;
      continue;
    }

    // Text block (paragraph / header / line).
    const fontPx = (block.fontSize ?? 12) * scale;
    const pageWidthPt =
      pageWidthsByIdx[block.pageIdx] ?? DEFAULT_PAGE_WIDTH_PT;
    const columnPdfPt = Math.max(
      MIN_COLUMN_PDF_PT,
      pageWidthPt - block.x - RIGHT_MARGIN_PDF_PT
    );
    const columnPx = columnPdfPt * scale;

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

    layout.set(block.id, {
      top: cursorY,
      left: block.x * scale,
      width: columnPx,
      height: h,
    });
    cursorY += h + BLOCK_GAP_PX;
    prevBlockId = block.id;
  }

  return {
    layout,
    separators,
    totalHeight: cursorY + TOP_MARGIN_PX,
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
