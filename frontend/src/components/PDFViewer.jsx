import React, { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { usePDFStore } from "../store/usePDFStore";

// Fixed display width of the canvas in CSS pixels.
// The canvas height is computed from the PDF's aspect ratio.
const CANVAS_WIDTH = 850;

/**
 * Flips a PDF Y coordinate (bottom-left origin) to a CSS Y coordinate
 * (top-left origin) and applies the scale factor.
 *
 * @param {number} pdfY       - Element's Y position in PDF user-space points
 * @param {number} elHeight   - Element's height in PDF user-space points
 * @param {number} pageHeight - Full page height in PDF user-space points
 * @param {number} scale      - Points-to-pixels scale factor
 * @returns {number} CSS top value in pixels
 */
function toCanvasY(pdfY, elHeight, pageHeight, scale) {
  return (pageHeight - pdfY - elHeight) * scale;
}

// ─── PageCanvas Sub-Component ────────────────────────────────────────────────

const PageCanvas = ({ page, pageNumber, selectedTool, activeCursor, setActiveCursor }) => {
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

            return (
              <img
                key={`img-${idx}`}
                src={img.dataUrl}
                alt={`PDF image ${idx + 1}`}
                style={{
                  position: 'absolute',
                  left: cssX,
                  top: cssY,
                  width: cssW,
                  height: cssH,
                  zIndex: 1,
                  pointerEvents: 'none',
                }}
              />
            );
          })}

          {/* ── Layer 2: Text ────────────────────────────────────────────────── */}
          {textElements.map((el, idx) => {
            const cssX = el.x * scale;
            const ascent = (el.fontSize ?? 12) * 0.8;
            const cssY = toCanvasY(el.y, ascent, pageHeight, scale);
            const isHeader = headerTexts.has(el.text);
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

// ─── Main Component ───────────────────────────────────────────────────────────

const PDFViewer = ({
  pages = [],
  isLoading = false,
  selectedTool = null,
}) => {
  const activeCursor = usePDFStore((state) => state.activeCursor);
  const setActiveCursor = usePDFStore((state) => state.setActiveCursor);

  const updateTextElement = usePDFStore((state) => state.updateTextElement);
  const insertTextElement = usePDFStore((state) => state.insertTextElement);
  const removeTextElement = usePDFStore((state) => state.removeTextElement);
  const shiftElementsBelow = usePDFStore((state) => state.shiftElementsBelow);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (activeCursor.pageIdx === null || activeCursor.elIdx === null) return;

      const page = pages[activeCursor.pageIdx];
      if (!page) return;

      const el = page.textElements[activeCursor.elIdx];
      if (!el) return;

      let newText = el.text;
      let newOffset = activeCursor.charOffset;
      let prevent = false;
      let handledBySpecial = false;

      const scale = CANVAS_WIDTH / (page.dimensions?.width ?? 612);
      const maxWidthInPoints = (CANVAS_WIDTH - 40) / scale - el.x;
      const isHeader = page.classification?.headers?.includes(el.text);
      
      const measureTextWidthPoints = (txt, targetEl = el) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const fontStyle = targetEl.isItalic ? 'italic ' : '';
        const isTargetHeader = page.classification?.headers?.includes(targetEl.text);
        const fontWeight = targetEl.isBold ? 'bold ' : (isTargetHeader ? 'bold ' : 'normal ');
        const fontSize = targetEl.fontSize || 12;
        context.font = `${fontStyle}${fontWeight}${fontSize}px serif`;
        return context.measureText(txt).width;
      };

      if (e.key === 'Backspace') {
        if (newOffset > 0) {
          newText = newText.slice(0, newOffset - 1) + newText.slice(newOffset);
          newOffset -= 1;
          prevent = true;
        } else if (activeCursor.elIdx > 0) {
          const prevEl = page.textElements[activeCursor.elIdx - 1];
          const lineHeight = (el.fontSize || 12) * 1.2;
          
          if (prevEl.y > el.y) {
             const mergedText = prevEl.text + el.text;
             updateTextElement(activeCursor.pageIdx, activeCursor.elIdx - 1, {
                 text: mergedText,
                 width: measureTextWidthPoints(mergedText, prevEl)
             });
             removeTextElement(activeCursor.pageIdx, activeCursor.elIdx);
             shiftElementsBelow(activeCursor.pageIdx, el.y - 1, -lineHeight);
             
             setActiveCursor(prev => ({
                 ...prev,
                 elIdx: prev.elIdx - 1,
                 charOffset: prevEl.text.length,
             }));
             prevent = true;
             handledBySpecial = true;
          }
        }
      } else if (e.key === 'ArrowLeft') {
        if (newOffset > 0) {
          newOffset -= 1;
          prevent = true;
        } else if (activeCursor.elIdx > 0) {
          const prevEl = page.textElements[activeCursor.elIdx - 1];
          setActiveCursor(prev => ({
             ...prev,
             elIdx: prev.elIdx - 1,
             charOffset: prevEl.text.length
          }));
          prevent = true;
          handledBySpecial = true;
        }
      } else if (e.key === 'ArrowRight') {
        if (newOffset < newText.length) {
          newOffset += 1;
          prevent = true;
        } else if (activeCursor.elIdx < page.textElements.length - 1) {
          setActiveCursor(prev => ({
             ...prev,
             elIdx: prev.elIdx + 1,
             charOffset: 0
          }));
          prevent = true;
          handledBySpecial = true;
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        newText = newText.slice(0, newOffset) + e.key + newText.slice(newOffset);
        newOffset += 1;
        prevent = true;
        
        if (measureTextWidthPoints(newText) > maxWidthInPoints) {
           const lastSpace = newText.lastIndexOf(' ');
           if (lastSpace !== -1) {
              const firstLine = newText.substring(0, lastSpace);
              const secondLine = newText.substring(lastSpace + 1);
              
              updateTextElement(activeCursor.pageIdx, activeCursor.elIdx, {
                 text: firstLine,
                 width: measureTextWidthPoints(firstLine)
              });
              const lineHeight = (el.fontSize || 12) * 1.2;
              
              const newElement = {
                ...el,
                text: secondLine,
                y: el.y - lineHeight,
                width: measureTextWidthPoints(secondLine),
              };
              
              shiftElementsBelow(activeCursor.pageIdx, el.y - 1, lineHeight);
              insertTextElement(activeCursor.pageIdx, activeCursor.elIdx, newElement);
              
              setActiveCursor(prev => ({
                 ...prev,
                 elIdx: prev.elIdx + 1,
                 charOffset: newOffset > lastSpace ? newOffset - lastSpace - 1 : newOffset,
                 caretX: 0
              }));
              prevent = true;
              handledBySpecial = true;
           }
        }
      }

      if (prevent) {
        e.preventDefault();
        if (!handledBySpecial) {
           updateTextElement(activeCursor.pageIdx, activeCursor.elIdx, {
              text: newText,
              width: measureTextWidthPoints(newText)
           });
           setActiveCursor(prev => ({ ...prev, charOffset: newOffset }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCursor, pages, updateTextElement]);

  // ── Loading State ──────────────────────────────────────────────────────────
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

  // ── Empty State ────────────────────────────────────────────────────────────
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
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 180px)',
        background: '#e5e7eb',    // grey inter-page area
        padding: '24px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      {pages.map((page, pageIdx) => (
        <PageCanvas
          key={pageIdx}
          page={page}
          pageNumber={pageIdx + 1}
          selectedTool={selectedTool}
          activeCursor={activeCursor}
          setActiveCursor={setActiveCursor}
        />
      ))}
    </div>
  );
};

export default PDFViewer;
