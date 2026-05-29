import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import { CANVAS_WIDTH } from "./pdfConstants";
import { layoutObjects, overrideImageSize, updateImageRect } from "../lib/layoutObjects";
import { usePDFStore } from "../store/usePDFStore";

// Three-layer architecture:
//   Layer 1  Document model — `objects[]` (React state, mirrored from props)
//   Layer 2  Layout         — pure function, useMemo'd over the model
//   Layer 3  Render + edits — imperative DOM sync + keyboard handlers
//
// Reflow is derived, not triggered: layout is a useMemo over the model.
//
// Why imperative text sync (instead of `{block.text}` as children):
//   contenteditable lets the browser mutate textContent on every keystroke.
//   If React also writes to that text node on the next re-render, the browser
//   typically resets the caret. We side-step this by rendering an empty
//   contenteditable and writing textContent in a layout effect ONLY when the
//   user isn't currently typing in that block (tracked via pendingText).
//
// Why two-press merge:
//   Backspace at offset 0 immediately merging surprises users who just
//   deleted the first character — caret arrives at 0 by accident and the
//   next press wipes a paragraph. We require two CONSECUTIVE Backspace
//   presses at offset 0 (any other key/click/move disarms) before merging.

const DEFAULT_PAGE_WIDTH_PT = 612;
const TYPING_DEBOUNCE_MS = 150;
const TEXT_TYPES = new Set(["paragraph", "header", "line"]);
const IMAGE_TYPES = new Set(["image"]);
const SHAPE_TYPES = new Set(["shape"]);

// ── CSS colour helper ─────────────────────────────────────────────────────────
// Converts { r, g, b } (0-1 range) to a CSS `rgb(...)` string.
const toCssColor = (c, fallback = 'transparent') => {
  if (!c) return fallback;
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgb(${r},${g},${b})`;
};

const convertToSinglePage = (objs, pages) => {
  if (!pages || pages.length === 0) return objs;
  const pageHeights = pages.map(p => p?.dimensions?.height ?? 792);
  const numPages = pages.length;

  // 1. Calculate minTopDown and maxTopDown for each page based on content boundary
  const minTopDown = [];
  const maxTopDown = [];
  for (let p = 0; p < numPages; p++) {
    const pHeight = pageHeights[p];
    const objsOnPage = objs.filter(o => o.pageIdx === p && (o.type === 'paragraph' || o.type === 'header' || o.type === 'line' || (o.type === 'image' && o.role !== 'background')));
    if (objsOnPage.length === 0) {
      minTopDown.push(0);
      maxTopDown.push(pHeight);
    } else {
      let maxY = -Infinity; // highest point (largest Y)
      let minY = Infinity;  // lowest point (smallest Y)
      for (const o of objsOnPage) {
        if (o.y !== undefined) {
          const h = (o.type === 'image') ? (o.renderedHeight ?? 0) : 0;
          if (o.y + h > maxY) maxY = o.y + h;
          if (o.y < minY) minY = o.y;
        }
      }
      if (maxY === -Infinity) maxY = pHeight;
      if (minY === Infinity) minY = 0;

      minTopDown.push(Math.max(0, pHeight - maxY));
      maxTopDown.push(Math.min(pHeight, pHeight - minY));
    }
  }

  // 2. Calculate cumulativeShift to collapse margin gaps down to standardGap (20pt)
  const standardGap = 20;
  const cumulativeShift = [0];
  let currentShift = 0;
  for (let p = 1; p < numPages; p++) {
    const gap = (pageHeights[p - 1] - maxTopDown[p - 1]) + minTopDown[p];
    const shift = Math.max(0, gap - standardGap);
    currentShift += shift;
    cumulativeShift.push(currentShift);
  }

  // 3. Calculate pageOffsets and total collapsed height
  const pageOffsets = [];
  let currentOffset = 0;
  for (const h of pageHeights) {
    pageOffsets.push(currentOffset);
    currentOffset += h;
  }
  const totalH = currentOffset;
  const totalH_collapsed = totalH - cumulativeShift[numPages - 1];

  // 4. Map objects to global coordinates using cumulative shifts
  return objs.map(obj => {
    if (obj.pageIdx === undefined) return obj;
    const pIdx = obj.pageIdx;
    const pHeight = pageHeights[pIdx] ?? 792;
    const offset = pageOffsets[pIdx] ?? 0;
    const shift = cumulativeShift[pIdx] ?? 0;

    const toGlobalY = (localY) => {
      const topDown = offset - shift + (pHeight - localY);
      return totalH_collapsed - topDown;
    };

    const updated = {
      ...obj,
      pageIdx: 0,
      originalPageIdx: pIdx,
      pageHeight: totalH_collapsed,
      _cumulativeShift: cumulativeShift,
      _pageOffsets: pageOffsets,
      _pageHeights: pageHeights,
      _totalH_collapsed: totalH_collapsed,
    };

    if (obj.y !== undefined) updated.y = toGlobalY(obj.y);
    if (obj.y1 !== undefined) updated.y1 = toGlobalY(obj.y1);
    if (obj.y2 !== undefined) updated.y2 = toGlobalY(obj.y2);
    if (obj.tableBounds) {
      updated.tableBounds = {
        ...obj.tableBounds,
        y1: toGlobalY(obj.tableBounds.y1),
        y2: toGlobalY(obj.tableBounds.y2),
      };
    }
    if (obj.points) {
      updated.points = obj.points.map(p => ({ ...p, y: toGlobalY(p.y) }));
    }
    if (obj.lines) {
      updated.lines = obj.lines.map(l => ({ ...l, y: toGlobalY(l.y) }));
    }

    return updated;
  });
};

const convertToMultiPage = (objs, pages) => {
  if (!pages || pages.length === 0) return objs;

  const sample = objs.find(o => o._cumulativeShift !== undefined);
  let cumulativeShift, pageOffsets, pageHeights, totalH_collapsed;

  if (sample) {
    cumulativeShift = sample._cumulativeShift;
    pageOffsets = sample._pageOffsets;
    pageHeights = sample._pageHeights;
    totalH_collapsed = sample._totalH_collapsed;
  } else {
    pageHeights = pages.map(p => p?.dimensions?.height ?? 792);
    pageOffsets = [];
    let currentOffset = 0;
    for (const h of pageHeights) {
      pageOffsets.push(currentOffset);
      currentOffset += h;
    }
    const totalH = currentOffset;
    cumulativeShift = pages.map(() => 0);
    totalH_collapsed = totalH;
  }

  return objs.map(obj => {
    const pIdx = obj.originalPageIdx !== undefined ? obj.originalPageIdx : 0;
    const pHeight = pageHeights[pIdx] ?? 792;
    const offset = pageOffsets[pIdx] ?? 0;
    const shift = cumulativeShift[pIdx] ?? 0;

    const toLocalY = (globalY) => {
      const topDown = totalH_collapsed - globalY;
      const localTopDown = topDown - offset + shift;
      return pHeight - localTopDown;
    };

    const updated = { ...obj, pageIdx: pIdx, pageHeight: pHeight };

    delete updated.originalPageIdx;
    delete updated._cumulativeShift;
    delete updated._pageOffsets;
    delete updated._pageHeights;
    delete updated._totalH_collapsed;

    if (obj.y !== undefined) updated.y = toLocalY(obj.y);
    if (obj.y1 !== undefined) updated.y1 = toLocalY(obj.y1);
    if (obj.y2 !== undefined) updated.y2 = toLocalY(obj.y2);
    if (obj.tableBounds) {
      updated.tableBounds = {
        ...obj.tableBounds,
        y1: toLocalY(obj.tableBounds.y1),
        y2: toLocalY(obj.tableBounds.y2),
      };
    }
    if (obj.points) {
      updated.points = obj.points.map(p => ({ ...p, y: toLocalY(p.y) }));
    }
    if (obj.lines) {
      updated.lines = obj.lines.map(l => ({ ...l, y: toLocalY(l.y) }));
    }

    return updated;
  });
};

const shiftObjDown = (obj, amount) => {
  let updatedObj = { ...obj };
  let shifted = false;
  console.log("This is the updated Obj: ", updatedObj);
  if (updatedObj.y !== undefined) {
    updatedObj.y -= amount;
    shifted = true;
  }
  if (updatedObj.y1 !== undefined) {
    updatedObj.y1 -= amount;
    shifted = true;
  }
  if (updatedObj.y2 !== undefined) {
    updatedObj.y2 -= amount;
    shifted = true;
  }
  if (updatedObj.tableBounds) {
    updatedObj.tableBounds = {
      ...updatedObj.tableBounds,
      y1: updatedObj.tableBounds.y1 - amount,
      y2: updatedObj.tableBounds.y2 - amount,
    };
    shifted = true;
  }
  if (updatedObj.points) {
    updatedObj.points = updatedObj.points.map(p => ({ ...p, y: p.y - amount }));
    shifted = true;
  }

  return updatedObj;
};


const SinglePageView = ({
  pages = [],
  objects: incomingObjects = [],
  isLoading = false,
  onObjectsChange = null,
}) => {
  // ── Layer 1: model ────────────────────────────────────────────────────────
  const [objects, setObjects] = useState(() => convertToSinglePage(incomingObjects, pages));
  useEffect(() => {
    setObjects(convertToSinglePage(incomingObjects, pages));
  }, [incomingObjects, pages]);
  // Notify parent whenever the model changes so the download always has
  // the latest edited text.
  useEffect(() => {
    if (onObjectsChange) onObjectsChange(convertToMultiPage(objects, pages));
  }, [objects, onObjectsChange, pages]);

  // ── Refs (non-render state) ───────────────────────────────────────────────
  const idCounter = useRef(0);
  const measureCanvasRef = useRef(null);
  const measureCtxRef = useRef(null);
  const measureCacheRef = useRef(new Map());
  const pendingTextRef = useRef(new Map());
  const pendingTimerRef = useRef(null);
  const blockRefs = useRef(new Map());
  const caretIntentRef = useRef(null);
  // DOM-truth heights, written by ResizeObserver, read by layoutObjects.
  // We hold it in a ref + force a render via `heightTick` so we never have
  // to allocate a new Map on every observer fire.
  const measuredHeightsRef = useRef(new Map());
  const [heightTick, bumpHeightTick] = useReducer((n) => n + 1, 0);
  const [layoutTick, bumpLayoutTick] = useReducer((n) => n + 1, 0);
  const resizeObserverRef = useRef(null);
  // 2-press-to-merge: armed when a Backspace at offset 0 has been seen and
  // no other input has happened since. Disarmed by any other key, click, or
  // a Backspace fired at offset > 0.
  const mergeArmedRef = useRef(false);
  const scaleRef = useRef(1);

  // Init the off-screen 2D context once.
  useEffect(() => {
    if (measureCtxRef.current) return;
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas");
    measureCanvasRef.current = canvas;
    measureCtxRef.current = canvas.getContext("2d");
  }, []);

  // Clear measurement cache when the document changes.
  useEffect(() => {
    measureCacheRef.current.clear();
  }, [incomingObjects]);

  // Cleanup debounce on unmount.
  useEffect(
    () => () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    },
    []
  );

  // Disarm merge on any mousedown anywhere — the caret may have just moved.
  useEffect(() => {
    const onDown = () => {
      mergeArmedRef.current = false;
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // One shared ResizeObserver for every editable block. Fires whenever the
  // browser's actual rendered height of a block changes — i.e. on every
  // wrap-point shift while typing, on Backspace deletions, on column-width
  // changes. We compare against the previous reported height and only force
  // a re-render when at least one block actually changed size.
  if (!resizeObserverRef.current && typeof ResizeObserver !== "undefined") {
    resizeObserverRef.current = new ResizeObserver((entries) => {
      let changed = false;
      let heightDiffs = new Map();

      for (const entry of entries) {
        const id = entry.target.dataset.id;
        if (!id) continue;
        // contentRect.height excludes borders/padding; matches how the
        // layout cursor treats heights.
        const h = entry.contentRect.height;
        const prev = measuredHeightsRef.current.get(id);
        if (prev !== undefined && Math.abs(prev - h) > 0.5) {
          heightDiffs.set(id, h - prev);
          measuredHeightsRef.current.set(id, h);
          changed = true;
        } else if (prev === undefined) {
          measuredHeightsRef.current.set(id, h);
          changed = true;
        }
      }

      if (heightDiffs.size > 0) {
        setObjects((prevObjs) => {
          let newObjs = [...prevObjs];
          let updated = false;

          for (const [id, diffPx] of heightDiffs) {
            const idx = newObjs.findIndex((o) => o.id === id);
            if (idx >= 0) {
              const diffPt = diffPx / scaleRef.current;
              // Shift all objects below it
              for (let i = idx + 1; i < newObjs.length; i++) {
                const obj = newObjs[i];
                let updatedObj = { ...obj };
                let shifted = false;

                // Shift standard Y coordinate (paragraphs, images, rects)
                if (updatedObj.y !== undefined) {
                  updatedObj.y -= diffPt;
                  shifted = true;
                }
                // Shift line coordinates
                if (updatedObj.y1 !== undefined) {
                  updatedObj.y1 -= diffPt;
                  shifted = true;
                }
                if (updatedObj.y2 !== undefined) {
                  updatedObj.y2 -= diffPt;
                  shifted = true;
                }
                // Shift table cell bounds if it belongs to a table
                if (updatedObj.tableBounds) {
                  updatedObj.tableBounds = {
                    ...updatedObj.tableBounds,
                    y1: updatedObj.tableBounds.y1 - diffPt,
                    y2: updatedObj.tableBounds.y2 - diffPt,
                  };
                  shifted = true;
                }
                // Shift custom polygon/path points
                if (updatedObj.points) {
                  updatedObj.points = updatedObj.points.map(p => ({ ...p, y: p.y - diffPt }));
                  shifted = true;
                }

                if (shifted) {
                  newObjs[i] = updatedObj;
                  updated = true;
                }
              }
            }
          }
          // Page-boundary normalization removed since the whole document is treated as one single page.

          return updated ? newObjs : prevObjs;
        });
      }

      if (changed) bumpHeightTick();
    });
  }

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
    },
    []
  );

  // ── Layer 2: scale + layout (memoized) ────────────────────────────────────
  const totalDocHeight = useMemo(() => {
    return pages.reduce((sum, p) => sum + (p?.dimensions?.height ?? 792), 0);
  }, [pages]);

  const maxDocWidth = useMemo(() => {
    return pages.reduce((max, p) => Math.max(max, p?.dimensions?.width ?? 612), 0);
  }, [pages]);

  const pageWidthsByIdx = useMemo(
    () => [maxDocWidth],
    [maxDocWidth]
  );

  const pageHeightsByIdx = useMemo(
    () => [totalDocHeight],
    [totalDocHeight]
  );

  const scale = useMemo(() => {
    const maxW = pageWidthsByIdx.reduce(
      (m, w) => Math.max(m, w),
      DEFAULT_PAGE_WIDTH_PT
    );
    const s = CANVAS_WIDTH / maxW;
    scaleRef.current = s;
    return s;
  }, [pageWidthsByIdx]);

  const { layout, separators, gapMarkers, totalHeight } = useMemo(
    () =>
      layoutObjects({
        objects,
        scale,
        pageWidthsByIdx,
        pageHeightsByIdx,
        measureCtx: measureCtxRef.current,
        measureCache: measureCacheRef.current,
        measuredHeights: measuredHeightsRef.current,
      }),
    // heightTick is the dep that fires when ResizeObserver wrote to
    // measuredHeightsRef. We can't depend on the Map itself (identity is
    // stable) so the tick is the trigger.
    [objects, scale, pageWidthsByIdx, pageHeightsByIdx, heightTick, layoutTick]
  );

  // ── Caret helpers ─────────────────────────────────────────────────────────
  const placeCaret = (el, pos) => {
    if (!el) return;
    console.log(el);
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    const node = el.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE) {
      const offset = Math.max(0, Math.min(pos, node.data.length));
      range.setStart(node, offset);
    } else {
      range.setStart(el, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

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

  const getCaretCharOffset = (el) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const live = sel.getRangeAt(0);
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(live.startContainer, live.startOffset);
    return r.toString().length;
  };

  // Apply caret placement after commit (layout effect = before paint).
  useLayoutEffect(() => {
    const intent = caretIntentRef.current;
    if (!intent) return;
    const el = blockRefs.current.get(intent.id);
    if (el) placeCaret(el, intent.offset);
    caretIntentRef.current = null;
  });

  // ── Debug helpers ─────────────────────────────────────────────────────────
  const dbgBlock = (label, block) => {
    if (!block) return;
    const preview = (block.text ?? '').slice(0, 60).replace(/\n/g, '↵');
    console.group(`[PDF-Editor] ${label}  id=${block.id}  type=${block.type}`);
    console.log('text (model)  :', `"${preview}${block.text?.length > 60 ? '…' : ''}"`);
    console.log('textLength    :', block.text?.length ?? 0);
    console.log('lineCount     :', block.lines?.length ?? '(runtime block)');
    console.log('fontSize      :', block.fontSize);
    console.log('x             :', block.x);
    console.log('pageIdx       :', block.pageIdx);
    const rect = layout.get(block.id);
    if (rect) {
      console.log('layout rect   :', `top=${rect.top.toFixed(1)}  h=${rect.height.toFixed(1)}`);
    }
    const domH = measuredHeightsRef.current.get(block.id);
    if (domH !== undefined) {
      console.log('DOM height    :', domH.toFixed(1));
    } else {
      console.warn('DOM height    : NOT MEASURED YET (id type mismatch?)');
    }
    console.groupEnd();
  };

  // ── Typing debounce ───────────────────────────────────────────────────────
  const flushPending = () => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    const pending = pendingTextRef.current;
    if (pending.size === 0) return;
    const snapshot = new Map(pending);
    pending.clear();
    //prev is previous state of objects 
    setObjects((prev) => {
      let changed = false;
      const next = prev.map((b) => {
        if (snapshot.has(b.id) && snapshot.get(b.id) !== b.text) {
          changed = true;
          const liveText = snapshot.get(b.id);
          // Show a slice around the first diff so insertions in the middle are visible.
          const oldT = b.text ?? '';
          const newT = liveText ?? '';
          let diffAt = 0;
          while (diffAt < oldT.length && diffAt < newT.length && oldT[diffAt] === newT[diffAt]) diffAt++;
          const ctx = 15;
          const oldSnip = oldT.slice(Math.max(0, diffAt - ctx), diffAt + ctx);
          const newSnip = newT.slice(Math.max(0, diffAt - ctx), diffAt + ctx);

          return { ...b, text: liveText };
        }

        return b;
      });
      return changed ? next : prev;
    });
  };

  const handleInput = (e, id) => {
    const text = e.currentTarget.textContent;
    pendingTextRef.current.set(id, text);
    // Any input disarms the 2-press merge.
    mergeArmedRef.current = false;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(flushPending, TYPING_DEBOUNCE_MS);
  };

  // ── Structural edits ──────────────────────────────────────────────────────
  const walkBackForTextBlock = (fromIdx) => {
    for (let i = fromIdx - 1; i >= 0; i--) {
      if (TEXT_TYPES.has(objects[i].type)) return i;
    }
    return -1;
  };

  const handleBackspaceAtStart = (curIdx) => {
    const prevIdx = walkBackForTextBlock(curIdx);
    if (prevIdx < 0) return;

    const cur = objects[curIdx];
    const prev = objects[prevIdx];

    // Prevent cross-cell merges: if either is in a table, they must share the exact same cell bounds
    if (cur.inTable || prev.inTable) {
      if (
        !cur.inTable ||
        !prev.inTable ||
        cur.tableBounds?.x1 !== prev.tableBounds?.x1 ||
        cur.tableBounds?.y1 !== prev.tableBounds?.y1 ||
        cur.tableBounds?.x2 !== prev.tableBounds?.x2 ||
        cur.tableBounds?.y2 !== prev.tableBounds?.y2
      ) {
        return; // Reject merging across different cells or table/non-table boundaries
      }
    }

    const curEl = blockRefs.current.get(cur.id);
    const prevEl = blockRefs.current.get(prev.id);
    const curText = curEl ? curEl.textContent : cur.text;
    const prevText = prevEl ? prevEl.textContent : prev.text;
    const gap = prevText.length > 0 && curText.length > 0 ? " " : "";
    const merged = prevText + gap + curText;
    const seamOffset = prevText.length + gap.length;

    // Calculate height of the block being removed to shift elements up
    let curDomHeight = measuredHeightsRef.current.get(cur.id);
    if (!curDomHeight) {
      curDomHeight = (cur.fontSize || 12) * scaleRef.current * 1.2;
    }
    const diffPt = curDomHeight / scaleRef.current;

    console.group('[PDF-Editor] BACKSPACE-MERGE');
    console.log('removed  :', `id=${cur.id}  "${curText.slice(0, 40)}"`);
    console.log('merged → :', `id=${prev.id}  "${merged.slice(0, 60)}"`);
    dbgBlock('prev BEFORE merge', prev);
    console.groupEnd();

    pendingTextRef.current.delete(cur.id);
    pendingTextRef.current.delete(prev.id);

    setObjects((arr) => {
      const next = arr.slice();
      next[prevIdx] = { ...next[prevIdx], text: merged };
      next.splice(curIdx, 1);

      // Shift all objects below the deleted one UP to fill the gap.
      // In PDF coordinates (bottom-up), moving UP means increasing y.
      for (let i = curIdx; i < next.length; i++) {
        const obj = next[i];
        let updatedObj = { ...obj };
        let shifted = false;

        if (updatedObj.y !== undefined) {
          updatedObj.y += diffPt;
          shifted = true;
        }
        if (updatedObj.y1 !== undefined) {
          updatedObj.y1 += diffPt;
          shifted = true;
        }
        if (updatedObj.y2 !== undefined) {
          updatedObj.y2 += diffPt;
          shifted = true;
        }
        if (updatedObj.tableBounds) {
          updatedObj.tableBounds = {
            ...updatedObj.tableBounds,
            y1: updatedObj.tableBounds.y1 + diffPt,
            y2: updatedObj.tableBounds.y2 + diffPt,
          };
          shifted = true;
        }
        if (updatedObj.points) {
          updatedObj.points = updatedObj.points.map(p => ({ ...p, y: p.y + diffPt }));
          shifted = true;
        }

        if (shifted) {
          next[i] = updatedObj;
        }
      }

      return next;
    });

    caretIntentRef.current = { id: prev.id, offset: seamOffset };
    mergeArmedRef.current = false;
  };

  const handleEnterSplit = (curIdx, el) => {
    const cur = objects[curIdx];
    const fontSize = cur.fontSize || 12;
    const lineHeight = fontSize * 1.2;

    if (!TEXT_TYPES.has(cur.type)) {
      setObjects((arr) => {
        const next = arr.slice();
        // Move the object itself and all objects under it down by 1 line height
        for (let i = curIdx; i < next.length; i++) {
          next[i] = shiftObjDown(next[i], lineHeight);
        }
        return next;
      });
      return;
    }

    const offset = getCaretCharOffset(el);
    const text = el.textContent;
    const before = text.slice(0, offset);
    const after = text.slice(offset).replace(/^\s+/, "");

    const newId = `n${idCounter.current++}`;

    console.group(`[PDF-Editor] ENTER-SPLIT  id=${cur.id}  at offset=${offset}`);
    console.log('original text :', `"${text.slice(0, 60)}"`);
    console.log('before (A)    :', `"${before.slice(0, 40)}"`);
    console.log('after  (B)    :', `"${after.slice(0, 40)}"`);
    console.log('new block id  :', newId);
    dbgBlock('paragraph BEFORE split', cur);
    console.groupEnd();

    // Prevent the ResizeObserver from seeing the paragraph shrink and pulling things back up
    if (measuredHeightsRef && measuredHeightsRef.current) {
      measuredHeightsRef.current.delete(cur.id);
    }
    pendingTextRef.current.delete(cur.id);

    setObjects((arr) => {
      const next = arr.slice();

      // Shift all objects below the current index down by 1 line height
      for (let i = curIdx + 1; i < next.length; i++) {
        next[i] = shiftObjDown(next[i], lineHeight);
      }

      next[curIdx] = { ...next[curIdx], text: before };

      const newBlock = {
        id: newId,
        type: "paragraph",
        pageIdx: cur.pageIdx,
        text: after,
        x: cur.x,
        fontSize: cur.fontSize,
        lines: [],
        isBold: !!cur.isBold,
        isItalic: !!cur.isItalic,
        color: cur.color ?? null,
        inTable: cur.inTable ?? false,
        tableBounds: cur.tableBounds ?? null,
      };

      if (cur.y !== undefined) {
        newBlock.y = cur.y - lineHeight;
      }
      if (cur.y1 !== undefined) {
        newBlock.y1 = cur.y1 - lineHeight;
      }
      if (cur.y2 !== undefined) {
        newBlock.y2 = cur.y2 - lineHeight;
      }

      next.splice(curIdx + 1, 0, newBlock);
      return next;
    });

    caretIntentRef.current = { id: newId, offset: 0 };
    mergeArmedRef.current = false;
  };

  const handleKeyDown = (e, id) => {
    if (e.key === "Backspace") {
      const el = e.currentTarget;
      if (!caretAtStart(el)) {
        // In-paragraph backspace: let the browser delete a char.
        // Disarm merge so a subsequent "fresh-at-zero" press doesn't merge.
        mergeArmedRef.current = false;
        return;
      }

      e.preventDefault();
      if (!mergeArmedRef.current) {
        // First Backspace at offset 0 in this idle period — arm only, no merge.
        mergeArmedRef.current = true;
        return;
      }

      // Second consecutive Backspace at offset 0 — merge.
      flushPending();
      const idx = objects.findIndex((b) => b.id === id);
      console.log("This is idx: ");
      if (idx >= 0) handleBackspaceAtStart(idx);
      return;
    }

    // Any other key disarms merge.
    if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") {
      mergeArmedRef.current = false;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      // flushPending();
      const idx = objects.findIndex((b) => b.id === id);
      if (idx >= 0) handleEnterSplit(idx, e.currentTarget);
    }
  };

  const setBlockRef = (id) => (el) => {
    if (el) blockRefs.current.set(id, el);
    else blockRefs.current.delete(id);
  };

  // ── Loading / empty states ────────────────────────────────────────────────
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

  const ImageBlock = ({ block, rect, objects, scale, forceLayout }) => {
    const [imageSize, setImageSize] = useState({ width: rect.width, height: rect.height });
    const [isSelected, setIsSelected] = useState(false);

    // Ref keeps the latest size so the mouseup closure is never stale.
    const liveSizeRef = useRef({ width: rect.width, height: rect.height });
    const draggingRef = useRef(false);

    // Sync from layout rect when NOT mid-drag (e.g. after forceLayout settles).
    useEffect(() => {
      if (!draggingRef.current) {
        const s = { width: rect.width, height: rect.height };
        setImageSize(s);
        liveSizeRef.current = s;
      }
    }, [rect.width, rect.height]);

    const containerRef = useRef(null);
    const imgRef = useRef(null);

    // ── Resize handler factory ──────────────────────────────────────────────
    // mode: 'se' = corner (W + H),  'e' = right-middle (W only),  's' = bottom-middle (H only)
    const makeResizeHandler = (mode) => (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = liveSizeRef.current.width;
      const startH = liveSizeRef.current.height;
      draggingRef.current = true;

      const onMove = (mv) => {
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        const newW = mode === 's' ? startW : Math.max(20, startW + dx);
        const newH = mode === 'e' ? startH : Math.max(20, startH + dy);
        const next = { width: newW, height: newH };
        liveSizeRef.current = next;
        setImageSize(next);           // green border follows instantly
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        draggingRef.current = false;

        const { width: finalW, height: finalH } = liveSizeRef.current;
        // Commit in PDF-point space so the layout engine stores the override.
        overrideImageSize(block.id, finalW / scale, finalH / scale);
        // Re-run layout — cursorY shifts push / pull every block below.
        forceLayout();
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    // ── Click zones (left 30% / right 30% → caret, middle 40% → select) ───
    const handleContainerClick = (e) => {
      const canvasRect = e.currentTarget.closest("#pdf-single-canvas").getBoundingClientRect();
      const clickX = e.clientX - canvasRect.left;
      const leftside = rect.left + 0.3 * rect.width;
      const rightside = rect.left + 0.7 * rect.width;

      if (clickX < leftside) {
        setIsSelected(false);
        if (containerRef.current && imgRef.current) {
          containerRef.current.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.setStartBefore(imgRef.current);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } else if (clickX >= rightside) {
        setIsSelected(false);
        if (containerRef.current && imgRef.current) {
          containerRef.current.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.setStartAfter(imgRef.current);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } else {
        setIsSelected(true);
      }
    };

    const isBg = block.role === "background";

    // Shared style for the 8×8 green squares.
    const handleStyle = {
      position: "absolute",
      width: "8px",
      height: "8px",
      background: "green",
      borderRadius: "1px",
    };

    return (
      <div
        ref={containerRef}
        contentEditable
        suppressContentEditableWarning
        onClick={handleContainerClick}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              const isLeft =
                (range.startContainer === containerRef.current && range.startOffset === 0) ||
                (range.startContainer.childNodes[range.startOffset] === imgRef.current);

              if (isLeft) {
                const imgIdx = objects.findIndex((o) => o.id === block.id);
                if (imgIdx >= 0) {
                  const defaultLineHeight = 14; // PDF points
                  const newId = `n${idCounter.current++}`;

                  setObjects((prev) => {
                    const next = prev.slice();

                    // Shift the image and all objects below it down by 1 line height
                    for (let i = imgIdx; i < next.length; i++) {
                      next[i] = shiftObjDown(next[i], defaultLineHeight);
                    }

                    // Create a new empty paragraph block at the original position of the image
                    const newBlock = {
                      id: newId,
                      type: "paragraph",
                      pageIdx: block.pageIdx,
                      text: "",
                      x: block.x,
                      fontSize: 12,
                      lines: [],
                    };

                    if (block.y !== undefined) {
                      newBlock.y = block.y;
                    }

                    // Insert the new paragraph block BEFORE the image in the objects array
                    next.splice(imgIdx, 0, newBlock);
                    return next;
                  });

                  // Focus the newly created paragraph
                  caretIntentRef.current = { id: newId, offset: 0 };
                }
              }
            }
          }
        }}
        style={{
          position: "absolute",
          left: rect.left,
          top: rect.top,
          width: imageSize.width,
          height: imageSize.height,
          zIndex: isBg ? 0 : 1,
          outline: "none",
          whiteSpace: "nowrap",
          cursor: "text",
          boxSizing: "border-box",
          border: isSelected ? "2px solid green" : "none",
        }}
      >
        <img
          ref={imgRef}
          src={block.dataUrl}
          alt={isBg ? "PDF background" : "PDF image"}
          style={{
            width: "100%",
            height: "100%",
            objectFit: isBg ? "fill" : "contain",
            pointerEvents: isBg ? "none" : "auto",
            userSelect: "none",
            display: "block",
          }}
          draggable={false}
        />
        {isSelected && (
          <>
            {/* BOTTOM-RIGHT corner → width + height */}
            <div
              onMouseDown={makeResizeHandler('se')}
              style={{ ...handleStyle, right: "-4px", bottom: "-4px", cursor: "nwse-resize" }}
            />
            {/* RIGHT-MIDDLE → width only */}
            <div
              onMouseDown={makeResizeHandler('e')}
              style={{ ...handleStyle, right: "-4px", top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" }}
            />
            {/* BOTTOM-MIDDLE → height only */}
            <div
              onMouseDown={makeResizeHandler('s')}
              style={{ ...handleStyle, bottom: "-4px", left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" }}
            />
          </>
        )}
      </div>
    );
  };
  // ── Shape blocks ──────────────────────────────────────────────────────
  const ShapeBlock = ({ block, rect, scale }) => {
    const stroke = toCssColor(block.strokeColor, 'none');
    const fill = toCssColor(block.fillColor, 'none');
    const lw = Math.max(0.5, (block.lineWidth ?? 1) * scale);

    if (block.shapeKind === 'line') {
      // rect carries the bounding box; recompute SVG-space endpoints from
      // the raw PDF coords stored in the layout entry.
      const pH = rect._pageHeight ?? (block.pageHeight ?? 792);
      const ps = rect._pageStart ?? 0;
      const sc = rect._scale ?? scale;
      const svgX1 = (block.x1) * sc - rect.left;
      const svgY1 = ps + (pH - block.y1) * sc - rect.top;
      const svgX2 = (block.x2) * sc - rect.left;
      const svgY2 = ps + (pH - block.y2) * sc - rect.top;
      const w = Math.max(rect.width + lw * 2, 4);
      const h = Math.max(rect.height + lw * 2, 4);
      const offX = lw;
      const offY = lw;
      return (
        <svg
          style={{
            position: 'absolute',
            top: rect.top - offY,
            left: rect.left - offX,
            width: w,
            height: h,
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <line
            x1={svgX1 + offX}
            y1={svgY1 + offY}
            x2={svgX2 + offX}
            y2={svgY2 + offY}
            stroke={stroke}
            strokeWidth={lw}
            strokeLinecap="round"
          />
        </svg>
      );
    }

    if (block.shapeKind === 'rect') {
      const hasStroke = block.strokeColor !== null;
      const offset = hasStroke ? lw / 2 : 0;

      return (
        <svg
          style={{
            position: 'absolute',
            top: rect.top - offset,
            left: rect.left - offset,
            width: rect.width + (hasStroke ? lw : 0),
            height: rect.height + (hasStroke ? lw : 0),
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <rect
            x={offset}
            y={offset}
            width={Math.max(0, rect.width)}
            height={Math.max(0, rect.height)}
            stroke={stroke}
            strokeWidth={hasStroke ? lw : 0}
            fill={fill}
          />
        </svg>
      );
    }

    if (block.shapeKind === 'path' && block.points?.length) {
      const pH = rect._pageHeight ?? (block.pageHeight ?? 792);
      const ps = rect._pageStart ?? 0;
      const sc = rect._scale ?? scale;
      const mX = rect._minX ?? 0;
      const svgPts = block.points.map(p => [
        (p.x - mX) * sc,
        ps + (pH - p.y) * sc - rect.top,
      ]);
      const d = svgPts
        .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ');
      return (
        <svg
          style={{
            position: 'absolute',
            top: rect.top,
            left: rect.left,
            width: rect.width + lw * 2,
            height: rect.height + lw * 2,
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <path d={d} stroke={stroke} strokeWidth={lw} fill={fill} />
        </svg>
      );
    }

    return null;
  };

  // ── Render ────────────────────────────────────────────────────────────────
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
        id="pdf-single-canvas"
        style={{
          position: "relative",
          width: CANVAS_WIDTH,
          height: totalHeight,
          backgroundColor: "#ffffff",
          boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
        }}
      >
        {separators.map((sep, i) => (
          <div
            key={`sep-${i}`}
            style={{
              position: "absolute",
              top: sep.top - 10,
              left: 0,
              right: 0,
              borderTop: "1px dashed #e5e7eb",
              display: "flex",
              justifyContent: "flex-end", // put it on the right side
              pointerEvents: "none",
              userSelect: "none",
              zIndex: 0,
            }}
          >
            <span style={{
              background: "#ffffff",
              padding: "2px 8px",
              color: "#9ca3af",
              fontSize: "10px",
              transform: "translateY(-50%)",
              marginRight: "24px",
              borderRadius: "9999px",
              border: "1px solid #e5e7eb",
              fontWeight: "600",
            }}>
              Page {sep.toPage + 1}
            </span>
          </div>
        ))}
        {objects.map((block) => {
          const rect = layout.get(block.id);
          if (!rect) return null;

          if (block.type === "image") {
            return (
              <ImageBlock
                key={`img-${block.id}`}
                block={block}
                rect={rect}
                objects={objects}
                scale={scale}
                forceLayout={bumpLayoutTick}
              />
            );
          }

          if (block.type === "shape") {
            return (
              <ShapeBlock
                key={`shp-${block.id}`}
                block={block}
                rect={rect}
                scale={scale}
              />
            );
          }

          return (
            <EditableBlock
              key={`blk-${block.id}`}
              block={block}
              rect={rect}
              scale={scale}
              pendingTextRef={pendingTextRef}
              registerRef={setBlockRef(block.id)}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              resizeObserver={resizeObserverRef.current}
              measuredHeightsRef={measuredHeightsRef}
            />
          );
        })}
      </div>
    </div>
  );
};

// One editable text block. The contenteditable's textContent is owned
// imperatively: React does NOT pass `{block.text}` as children, otherwise
// every model update would clobber the live DOM and reset the caret.
//
// Sync rules (in `useLayoutEffect`):
//   1. While user is typing in this block (pendingTextRef has this id),
//      do nothing. The browser owns textContent.
//   2. Otherwise, if DOM textContent differs from model text, write the
//      model text. This fires after merge / split / external updates.
const EditableBlock = ({
  block,
  rect,
  scale,
  pendingTextRef,
  registerRef,
  onInput,
  onKeyDown,
  resizeObserver,
  measuredHeightsRef,
}) => {
  const divRef = useRef(null);

  // Imperative text sync. Skipped while the user is mid-type in this block;
  // otherwise writes the model text into the DOM when it differs.
  useLayoutEffect(() => {
    const el = divRef.current;
    if (!el) return;
    if (pendingTextRef.current.has(block.id)) return;
    if (el.textContent !== (block.text ?? "")) {
      el.textContent = block.text ?? "";
    }
  }, [block.text, block.id, pendingTextRef]);

  // Observe this block's rendered height. The shared observer in
  // SinglePageView reads data-id off the element and updates the
  // measuredHeights map. On unmount, drop the entry so a future block
  // reusing the id doesn't read stale height.
  useEffect(() => {
    const el = divRef.current;
    if (!el || !resizeObserver) return;
    resizeObserver.observe(el);
    return () => {
      resizeObserver.unobserve(el);
      measuredHeightsRef?.current?.delete(block.id);
    };
  }, [resizeObserver, measuredHeightsRef, block.id]);

  const handleRef = (el) => {
    divRef.current = el;
    registerRef(el);
  };

  const isHeader = block.type === "header";
  const fontPx = (block.fontSize ?? 12) * scale;

  const handleFocus = () => {
    // Log the paragraph state the moment the user clicks into it.
    const el = divRef.current;
    const domText = el?.textContent ?? '';
    const modelText = block.text ?? '';
    const domH = measuredHeightsRef?.current?.get(block.id);
  };

  return (
    <div
      ref={handleRef}
      data-id={block.id}
      data-type={block.type}
      contentEditable
      suppressContentEditableWarning
      onFocus={handleFocus}
      onInput={(e) => onInput(e, block.id)}
      onKeyDown={(e) => onKeyDown(e, block.id)}
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        maxHeight: block.inTable && block.tableBounds ? (block.tableBounds.y2 - block.tableBounds.y1) * scale : undefined,
        overflow: block.inTable ? "hidden" : "visible",
        boxSizing: "border-box",
        // No height/minHeight — let the browser size the box from its
        // wrapped content. ResizeObserver reports the result back into
        // measuredHeights, which the next layout pass consumes.
        fontSize: fontPx,
        fontFamily: "serif",
        lineHeight: 1.2,
        fontWeight: isHeader || block.isBold ? "bold" : "normal",
        fontStyle: block.isItalic ? "italic" : "normal",
        color: block.color || (isHeader ? "#111827" : "#1f2937"),
        background: "transparent",
        outline: "none",
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        zIndex: 2,
      }}
    />
  );
};

export default SinglePageView;
