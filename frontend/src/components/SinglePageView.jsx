import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { CANVAS_WIDTH } from "./pdfConstants";

// Visual gap inserted between pages on the tall canvas.
const PAGE_SEPARATOR_PX = 32;

const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;

// Object types that hold editable text (everything but images).
const TEXT_TYPES = new Set(["paragraph", "header", "line"]);

const SinglePageView = ({
  pages = [],
  objects: incomingObjects = [],
  isLoading = false,
}) => {
  const containerRef = useRef(null);

  // Local mirror of the unified object stream. Backspace-merge and onBlur
  // text edits mutate this, the parent's pages[] stays untouched (Phase 1).
  const [objects, setObjects] = useState(incomingObjects);
  useEffect(() => {
    setObjects(incomingObjects);
  }, [incomingObjects]);

  // refs to each rendered editable block, keyed by current array index.
  const blockRefs = useRef([]);
  blockRefs.current = [];
  const registerRef = (i) => (el) => {
    blockRefs.current[i] = el;
  };

  // Place the caret in `el` at character `pos` from the start of its text.
  const placeCaret = (el, pos) => {
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    const node = el.firstChild || el;
    const len = node.nodeType === Node.TEXT_NODE ? node.data.length : 0;
    const offset = Math.max(0, Math.min(pos, len));
    if (node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, offset);
    } else {
      range.setStart(el, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // True if the editing caret is at the very start of `el`'s text.
  // Survives multi-text-node contents by walking up from the caret and
  // checking that nothing precedes it inside the block.
  const caretAtStart = (el) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    if (r.startOffset !== 0) return false;
    let node = r.startContainer;
    while (node && node !== el) {
      if (node.previousSibling) return false;
      node = node.parentNode;
    }
    return !!node;
  };

  // Backspace at offset 0 → merge this block's text into the previous
  // editable block on the same page. Cross-page merges are skipped
  // (matches the original keyboard handler's behaviour).
  const handleKeyDown = (e, idx) => {
    if (e.key !== "Backspace") return;
    const target = e.currentTarget;
    if (!caretAtStart(target)) return;

    // Walk backwards to find the previous text-type block on this page.
    const cur = objects[idx];
    let prevIdx = -1;
    for (let j = idx - 1; j >= 0; j--) {
      const o = objects[j];
      if (!TEXT_TYPES.has(o.type)) continue;
      if (o.pageIdx !== cur.pageIdx) break;
      prevIdx = j;
      break;
    }
    if (prevIdx < 0) return;

    e.preventDefault();

    // Read current live texts in case the user typed without blurring yet.
    const liveCurText = target.textContent;
    const prevEl = blockRefs.current[prevIdx];
    const livePrevText = prevEl ? prevEl.textContent : objects[prevIdx].text;
    const prevLen = livePrevText.length;
    const merged =
      livePrevText.length > 0 && liveCurText.length > 0
        ? livePrevText + " " + liveCurText
        : livePrevText + liveCurText;

    setObjects((arr) => {
      const next = arr.slice();
      next[prevIdx] = { ...next[prevIdx], text: merged };
      next.splice(idx, 1);
      return next;
    });

    // After re-render, drop caret at the seam (end of original prev text).
    requestAnimationFrame(() => {
      placeCaret(
        blockRefs.current[prevIdx],
        livePrevText.length > 0 && liveCurText.length > 0
          ? prevLen + 1
          : prevLen
      );
    });
  };

  // Persist live edits when a block loses focus, so subsequent merges
  // pick up the latest text instead of the stale prop value.
  const handleBlur = (e, idx) => {
    const text = e.currentTarget.textContent;
    setObjects((arr) => {
      if (arr[idx]?.text === text) return arr;
      const next = arr.slice();
      next[idx] = { ...next[idx], text };
      return next;
    });
  };

  // Pick a single scale for the whole document so the canvas has one width.
  // Scale to the widest page; narrower pages just sit centred-by-x in PDF space.
  const maxPageWidth = useMemo(
    () =>
      Math.max(
        DEFAULT_PAGE_WIDTH,
        ...pages.map((p) => p?.dimensions?.width ?? DEFAULT_PAGE_WIDTH)
      ),
    [pages]
  );
  const scale = CANVAS_WIDTH / maxPageWidth;

  // Cumulative CSS top for the top edge of each page (after separators).
  const pageCssTops = useMemo(() => {
    const tops = [];
    let cum = 0;
    pages.forEach((p) => {
      tops.push(cum);
      const pHeight = p?.dimensions?.height ?? DEFAULT_PAGE_HEIGHT;
      cum += pHeight * scale + PAGE_SEPARATOR_PX;
    });
    return tops;
  }, [pages, scale]);

  const totalHeight = useMemo(() => {
    if (pages.length === 0) return 0;
    const lastIdx = pages.length - 1;
    const lastHeight =
      (pages[lastIdx]?.dimensions?.height ?? DEFAULT_PAGE_HEIGHT) * scale;
    return pageCssTops[lastIdx] + lastHeight;
  }, [pages, pageCssTops, scale]);

  // Convert an object's globalTopY (in cumulative PDF points, no separators)
  // into a CSS pixel position on the tall canvas (with separators).
  const toCanvasTop = (obj) => {
    const pageIdx = obj.pageIdx ?? 0;
    const pageTopPdf = pages
      .slice(0, pageIdx)
      .reduce(
        (acc, p) => acc + (p?.dimensions?.height ?? DEFAULT_PAGE_HEIGHT),
        0
      );
    const offsetWithinPagePdf = obj.globalTopY - pageTopPdf;
    return pageCssTops[pageIdx] + offsetWithinPagePdf * scale;
  };

  // ── Loading / empty states ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-white rounded-lg border border-gray-200 shadow-inner"
        style={{ width: CANVAS_WIDTH, height: 600 }}
      >
        <Loader2 size={40} className="animate-spin text-primary mb-4" />
        <p className="text-gray-500 text-sm">Parsing PDF…</p>
      </div>
    );
  }

  if (!pages || pages.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-white rounded-lg border-2 border-dashed border-gray-300"
        style={{ width: CANVAS_WIDTH, height: 400 }}
      >
        <p className="text-gray-400 text-sm">No content extracted from this PDF</p>
      </div>
    );
  }

  return (
    <div
      id="pdf-scroll-container"
      style={{
        background: "#e5e7eb",
        padding: "24px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        ref={containerRef}
        id="pdf-single-canvas"
        style={{
          position: "relative",
          width: CANVAS_WIDTH,
          height: totalHeight,
          backgroundColor: "#ffffff",
          boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {/* ── Page separators (between consecutive pages) ───────────── */}
        {pages.slice(0, -1).map((_, pageIdx) => {
          const sepTop =
            pageCssTops[pageIdx] +
            (pages[pageIdx]?.dimensions?.height ?? DEFAULT_PAGE_HEIGHT) *
              scale;
          return (
            <div
              key={`sep-${pageIdx}`}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: sepTop,
                height: PAGE_SEPARATOR_PX,
                background:
                  "repeating-linear-gradient(90deg, #d1d5db 0 6px, transparent 6px 12px)",
                backgroundSize: "12px 1px",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  background: "#9ca3af",
                  color: "white",
                  fontSize: 11,
                  padding: "2px 10px",
                  borderRadius: 999,
                  letterSpacing: 0.5,
                }}
              >
                Page {pageIdx + 1} / {pageIdx + 2}
              </div>
            </div>
          );
        })}

        {/* ── Objects (z-order: images < text) ──────────────────────── */}
        {objects.map((obj, i) => {
          const cssTop = toCanvasTop(obj);

          if (obj.type === "image") {
            const cssLeft = obj.x * scale;
            const cssW = obj.renderedWidth * scale;
            const cssH = obj.renderedHeight * scale;
            const isBackground = obj.role === "background";
            return (
              <img
                key={`obj-${i}`}
                src={obj.dataUrl}
                alt={isBackground ? "PDF background" : "PDF image"}
                style={{
                  position: "absolute",
                  left: cssLeft,
                  top: cssTop,
                  width: cssW,
                  height: cssH,
                  zIndex: isBackground ? 0 : 1,
                  objectFit: isBackground ? "fill" : "contain",
                  pointerEvents: isBackground ? "none" : "auto",
                  userSelect: "none",
                }}
                draggable={false}
              />
            );
          }

          if (obj.type === "paragraph") {
            const cssLeft = obj.x * scale;
            // Column width = from x to right margin of widest page
            // (paragraph.width is only the longest line, which clips wrap)
            const pageWidth =
              pages[obj.pageIdx]?.dimensions?.width ?? DEFAULT_PAGE_WIDTH;
            const rightMargin = 48; // PDF points
            const colWidthPdf = Math.max(
              obj.width || 0,
              pageWidth - obj.x - rightMargin
            );
            const cssW = colWidthPdf * scale;
            const fontPx = (obj.fontSize ?? 12) * scale;
            const lineCount = obj.lines?.length || 1;
            // Reserve vertical space for the wrapped paragraph so it
            // doesn't overlap whatever object follows it.
            const reservedHeight = fontPx * 1.2 * lineCount;
            return (
              <div
                key={`para-${obj.id}`}
                ref={registerRef(i)}
                data-object-type="paragraph"
                data-paragraph-id={obj.id}
                contentEditable
                suppressContentEditableWarning
                onKeyDown={(e) => handleKeyDown(e, i)}
                onBlur={(e) => handleBlur(e, i)}
                style={{
                  position: "absolute",
                  left: cssLeft,
                  top: cssTop,
                  width: cssW,
                  minHeight: reservedHeight,
                  fontSize: fontPx,
                  fontFamily: "serif",
                  lineHeight: 1.2,
                  color: "#1f2937",
                  background: "#ffffff",
                  outline: "none",
                  whiteSpace: "pre-wrap",
                  wordWrap: "break-word",
                  zIndex: 2,
                }}
              >
                {obj.text}
              </div>
            );
          }

          // header / line
          const cssLeft = obj.x * scale;
          const fontPx = (obj.fontSize ?? 12) * scale;
          const isHeader = obj.type === "header";
          return (
            <div
              key={`txt-${obj.pageIdx}-${obj.x}-${obj.y}`}
              ref={registerRef(i)}
              data-object-type={obj.type}
              contentEditable
              suppressContentEditableWarning
              onKeyDown={(e) => handleKeyDown(e, i)}
              onBlur={(e) => handleBlur(e, i)}
              style={{
                position: "absolute",
                left: cssLeft,
                top: cssTop,
                fontSize: fontPx,
                fontFamily: "serif",
                fontWeight: isHeader || obj.isBold ? "bold" : "normal",
                fontStyle: obj.isItalic ? "italic" : "normal",
                color: obj.color || (isHeader ? "#111827" : "#1f2937"),
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                outline: "none",
                zIndex: 2,
              }}
            >
              {obj.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SinglePageView;
