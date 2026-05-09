import React, { useEffect, useRef } from "react";
import ResizeOverlay from "./ResizeOverlay";
import { CANVAS_WIDTH, toCanvasY } from "./pdfConstants";

const PageCanvas = ({ page, pageNumber, selectedTool, activeCursor, setActiveCursor, activeImage, setActiveImage, updatePageImage, resizePageImage }) => {
  const containerRef = useRef(null);
  const { dimensions, textElements = [], classification = null, images = { background: null, pageImages: [] } } = page;

  const pageWidth = dimensions?.width ?? 612;
  const pageHeight = dimensions?.height ?? 792;

  const scale = CANVAS_WIDTH / pageWidth;
  const canvasHeight = pageHeight * scale;

  const headerTexts = new Set(classification?.headers ?? []);

  // Build a lookup: for each textElement index, which paraId does it belong to?
  const elementToParaId = new Map();
  if (classification?.detailed?.paragraphs) {
    classification.detailed.paragraphs.forEach((para, paraId) => {
      para.lines.forEach(line => {
        const idx = textElements.findIndex(
          el => el.x === line.x && el.y === line.y && el.text === line.text
        );
        if (idx !== -1) elementToParaId.set(idx, paraId);
      });
    });
  }

  const handleTextClick = (e, pageIdx, elIdx) => {
    e.stopPropagation();

    let offset = 0;
    let textNode = null;

    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
        offset = range.startOffset;
        textNode = range.startContainer;
      }
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos && pos.offsetNode.nodeType === Node.TEXT_NODE) {
        offset = pos.offset;
        textNode = pos.offsetNode;
      }
    }

    let caretX = 0;
    if (textNode && offset > 0) {
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, offset);
      caretX = range.getBoundingClientRect().width;
    }

    setActiveCursor({
      pageIdx,
      elIdx,
      charOffset: offset,
      caretX,
    });
  };

  useEffect(() => {
    if (activeCursor?.pageIdx === (pageNumber - 1) && activeCursor?.elIdx !== null) {
      const activeDiv = containerRef.current?.querySelector(`#text-el-${pageNumber - 1}-${activeCursor.elIdx}`);
      if (activeDiv && activeDiv.firstChild?.nodeType === Node.TEXT_NODE) {
        const textNode = activeDiv.firstChild;
        const offset = Math.min(activeCursor.charOffset, textNode.length);
        if (offset > 0) {
          const range = document.createRange();
          try {
            range.setStart(textNode, 0);
            range.setEnd(textNode, offset);
            const newCaretX = range.getBoundingClientRect().width;
            if (Math.abs(newCaretX - activeCursor.caretX) > 0.5) {
              setActiveCursor(prev => ({ ...prev, caretX: newCaretX }));
            }
          } catch (e) {
            console.warn("Failed to measure caret:", e);
          }
        } else {
          if (activeCursor.caretX !== 0) {
            setActiveCursor(prev => ({ ...prev, caretX: 0 }));
          }
        }
      }
    }
  }, [textElements, activeCursor?.charOffset, activeCursor?.pageIdx, activeCursor?.elIdx, pageNumber, setActiveCursor]);

  return (
    <div className="flex flex-col items-center">
      <div className="mb-2 text-sm text-gray-500 font-medium">Page {pageNumber}</div>
      <div className="overflow-auto rounded-lg shadow-xl border border-gray-200" style={{ maxWidth: '100%' }}>
        <div
          ref={containerRef}
          id={`pdf-canvas-page-${pageNumber}`}
          onClick={() => setActiveImage(null)}
          style={{
            position: 'relative',
            width: CANVAS_WIDTH,
            height: canvasHeight,
            backgroundColor: '#ffffff',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {/* ── Layer 0: Background Image ────────────────────────────────────── */}
          {images.background?.dataUrl && (
            <img
              src={images.background.dataUrl}
              alt={`PDF background page ${pageNumber}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                zIndex: 0,
                pointerEvents: 'none',
              }}
            />
          )}

          {/* ── Layer 1: Page Images ─────────────────────────────────────────── */}
          {(images.pageImages ?? []).map((img, idx) => {
            const ap = img.appearances?.[0];
            if (!ap) return null;

            const cssX = ap.x * scale;
            const cssY = toCanvasY(ap.y, ap.renderedHeight, pageHeight, scale);
            const cssW = ap.renderedWidth * scale;
            const cssH = ap.renderedHeight * scale;

            const thisPageIdx = pageNumber - 1;
            const isImgActive = activeImage?.pageIdx === thisPageIdx && activeImage?.imgIdx === idx;
            const imgSide = isImgActive ? activeImage.side : null;
            // Match text cursor size: default 12pt * scale * 1.2 line-height
            const CURSOR_HEIGHT = (12 * scale * 1.2);
            // Bottom-aligned: sit at the bottom edge of the image
            const CURSOR_TOP = cssY + cssH - CURSOR_HEIGHT;

            const handleImageClick = (e) => {
              e.stopPropagation();
              // Deselect text cursor
              setActiveCursor({ pageIdx: null, elIdx: null, charOffset: null, caretX: 0 });
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = e.clientX - rect.left;
              const leftThird = rect.width * 0.3;
              const rightThird = rect.width * 0.7;
              let side;
              if (relX < leftThird) side = 'left';
              else if (relX > rightThird) side = 'right';
              else side = 'selected';
              setActiveImage({ pageIdx: thisPageIdx, imgIdx: idx, side });
            };

            return (
              <React.Fragment key={`img-${idx}`}>
                {/* Left cursor */}
                {isImgActive && imgSide === 'left' && (
                  <div style={{
                    position: 'absolute', left: cssX - 3, top: CURSOR_TOP,
                    width: 2, height: CURSOR_HEIGHT, background: '#2563eb',
                    zIndex: 5, animation: 'blink 1s step-end infinite', pointerEvents: 'none'
                  }} />
                )}

                {/* Image wrapper */}
                <div
                  style={{
                    position: 'absolute', left: cssX, top: cssY,
                    width: cssW, height: cssH,
                    zIndex: isImgActive ? 4 : 1,
                    cursor: 'pointer',
                    outline: isImgActive && imgSide === 'selected' ? '2px solid #3b82f6' : 'none',
                    boxSizing: 'border-box',
                  }}
                  onClick={handleImageClick}
                >
                  <img
                    src={img.dataUrl}
                    alt={`PDF image ${idx + 1}`}
                    style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
                    draggable={false}
                  />

                  {/* Resize overlay when selected */}
                  {isImgActive && imgSide === 'selected' && (
                    <ResizeOverlay
                      cssW={cssW}
                      cssH={cssH}
                      ap={ap}
                      onResize={(newW, newH) => resizePageImage(thisPageIdx, idx, newW, newH)}
                      onCancel={() => setActiveImage(null)}
                    />
                  )}

                  {/* Hint label when selected */}
                  {isImgActive && imgSide === 'selected' && (
                    <div style={{
                      position: 'absolute', top: -24, left: 0,
                      background: '#1d4ed8', color: 'white', borderRadius: 4,
                      padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                      pointerEvents: 'none', whiteSpace: 'nowrap',
                    }}>
                      Drag handles to resize
                    </div>
                  )}
                </div>

                {/* Right cursor */}
                {isImgActive && imgSide === 'right' && (
                  <div style={{
                    position: 'absolute', left: cssX + cssW + 1, top: CURSOR_TOP,
                    width: 2, height: CURSOR_HEIGHT, background: '#2563eb',
                    zIndex: 5, animation: 'blink 1s step-end infinite', pointerEvents: 'none'
                  }} />
                )}
              </React.Fragment>
            );
          })}

          {/* ── Layer 2: Text ────────────────────────────────────────────────── */}
          {textElements.map((el, idx) => {
            const cssX = el.x * scale;
            const ascent = (el.fontSize ?? 12) * 0.8;
            const cssY = toCanvasY(el.y, ascent, pageHeight, scale);
            const isHeader = el.isHeader;
            const isActive = activeCursor?.pageIdx === (pageNumber - 1) && activeCursor?.elIdx === idx;

            return (
              <div
                id={`text-el-${pageNumber - 1}-${idx}`}
                key={`el-${idx}`}
                data-para-id={elementToParaId.get(idx) ?? 'header'}
                onClick={(e) => handleTextClick(e, pageNumber - 1, idx)}
                style={{
                  position: 'absolute',
                  left: cssX,
                  top: cssY,
                  fontSize: (el.fontSize ?? 12) * scale,
                  fontFamily: 'serif',
                  fontWeight: el.isBold ? 'bold' : (isHeader ? 'bold' : 'normal'),
                  fontStyle: el.isItalic ? 'italic' : 'normal',
                  whiteSpace: 'nowrap',
                  color: el.color || (isHeader ? '#111827' : '#1f2937'),
                  zIndex: 2,
                  userSelect: 'none',
                  cursor: 'text',
                  lineHeight: 1,
                }}
              >
                {el.text}

                {/* Render Cursor */}
                {isActive && (
                  <div
                    className="bg-blue-600"
                    style={{
                      position: 'absolute',
                      left: activeCursor.caretX,
                      top: '-10%',
                      width: '2px',
                      height: '120%',
                      pointerEvents: 'none',
                      animation: 'blink 1s step-end infinite'
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PageCanvas;
