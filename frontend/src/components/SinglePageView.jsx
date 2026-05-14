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
import { layoutObjects } from "../lib/layoutObjects";

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

const SinglePageView = ({
  pages = [],
  objects: incomingObjects = [],
  isLoading = false,
}) => {
  // ── Layer 1: model ────────────────────────────────────────────────────────
  const [objects, setObjects] = useState(incomingObjects);
  useEffect(() => {
    setObjects(incomingObjects);
  }, [incomingObjects]);

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
  const resizeObserverRef = useRef(null);
  // 2-press-to-merge: armed when a Backspace at offset 0 has been seen and
  // no other input has happened since. Disarmed by any other key, click, or
  // a Backspace fired at offset > 0.
  const mergeArmedRef = useRef(false);

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
      for (const entry of entries) {
        const id = entry.target.dataset.id;
        if (!id) continue;
        // contentRect.height excludes borders/padding; matches how the
        // layout cursor treats heights.
        const h = entry.contentRect.height;
        const prev = measuredHeightsRef.current.get(id);
        if (prev === undefined || Math.abs(prev - h) > 0.5) {
          measuredHeightsRef.current.set(id, h);
          changed = true;
        }
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
  const pageWidthsByIdx = useMemo(
    () => pages.map((p) => p?.dimensions?.width ?? DEFAULT_PAGE_WIDTH_PT),
    [pages]
  );

  const scale = useMemo(() => {
    const maxW = pageWidthsByIdx.reduce(
      (m, w) => Math.max(m, w),
      DEFAULT_PAGE_WIDTH_PT
    );
    return CANVAS_WIDTH / maxW;
  }, [pageWidthsByIdx]);

  const { layout, separators, totalHeight } = useMemo(
    () =>
      layoutObjects({
        objects,
        scale,
        pageWidthsByIdx,
        measureCtx: measureCtxRef.current,
        measureCache: measureCacheRef.current,
        measuredHeights: measuredHeightsRef.current,
      }),
    // heightTick is the dep that fires when ResizeObserver wrote to
    // measuredHeightsRef. We can't depend on the Map itself (identity is
    // stable) so the tick is the trigger.
    [objects, scale, pageWidthsByIdx, heightTick]
  );

  // ── Caret helpers ─────────────────────────────────────────────────────────
  const placeCaret = (el, pos) => {
    if (!el) return;
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
    setObjects((prev) => {
      let changed = false;
      const next = prev.map((b) => {
        if (snapshot.has(b.id) && snapshot.get(b.id) !== b.text) {
          changed = true;
          return { ...b, text: snapshot.get(b.id) };
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

    const curEl = blockRefs.current.get(cur.id);
    const prevEl = blockRefs.current.get(prev.id);
    const curText = curEl ? curEl.textContent : cur.text;
    const prevText = prevEl ? prevEl.textContent : prev.text;
    const gap = prevText.length > 0 && curText.length > 0 ? " " : "";
    const merged = prevText + gap + curText;
    const seamOffset = prevText.length + gap.length;

    pendingTextRef.current.delete(cur.id);
    pendingTextRef.current.delete(prev.id);

    setObjects((arr) => {
      const next = arr.slice();
      next[prevIdx] = { ...next[prevIdx], text: merged };
      next.splice(curIdx, 1);
      return next;
    });

    caretIntentRef.current = { id: prev.id, offset: seamOffset };
    mergeArmedRef.current = false;
  };

  const handleEnterSplit = (curIdx, el) => {
    const cur = objects[curIdx];
    if (!TEXT_TYPES.has(cur.type)) return;

    const offset = getCaretCharOffset(el);
    const text = el.textContent;
    const before = text.slice(0, offset);
    const after = text.slice(offset).replace(/^\s+/, "");

    const newId = `n${idCounter.current++}`;
    pendingTextRef.current.delete(cur.id);

    setObjects((arr) => {
      const next = arr.slice();
      next[curIdx] = { ...next[curIdx], text: before };
      next.splice(curIdx + 1, 0, {
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
      });
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
      if (idx >= 0) handleBackspaceAtStart(idx);
      return;
    }

    // Any other key disarms merge.
    if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") {
      mergeArmedRef.current = false;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      flushPending();
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
              left: 0,
              right: 0,
              top: sep.top,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              background:
                "repeating-linear-gradient(90deg, #d1d5db 0 6px, transparent 6px 12px)",
              backgroundSize: "12px 1px",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
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
              Page {sep.fromPage + 1} / {sep.toPage + 1}
            </div>
          </div>
        ))}

        {objects.map((block) => {
          const rect = layout.get(block.id);
          if (!rect) return null;

          if (block.type === "image") {
            const isBg = block.role === "background";
            return (
              <img
                key={`img-${block.id}`}
                src={block.dataUrl}
                alt={isBg ? "PDF background" : "PDF image"}
                style={{
                  position: "absolute",
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  zIndex: isBg ? 0 : 1,
                  objectFit: isBg ? "fill" : "contain",
                  pointerEvents: isBg ? "none" : "auto",
                  userSelect: "none",
                }}
                draggable={false}
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

  return (
    <div
      ref={handleRef}
      data-id={block.id}
      data-type={block.type}
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => onInput(e, block.id)}
      onKeyDown={(e) => onKeyDown(e, block.id)}
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
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
