import React from "react";
import { Loader2 } from "lucide-react";

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

const PageCanvas = ({ page, pageNumber, selectedTool }) => {
  const { dimensions, textElements = [], classification = null, images = { background: null, pageImages: [] } } = page;

  const pageWidth = dimensions?.width ?? 612;
  const pageHeight = dimensions?.height ?? 792;

  const scale = CANVAS_WIDTH / pageWidth;
  const canvasHeight = pageHeight * scale;

  const headerTexts = new Set(classification?.headers ?? []);

  return (
    <div className="flex flex-col items-center">
      <div className="mb-2 text-sm text-gray-500 font-medium">Page {pageNumber}</div>
      <div className="overflow-auto rounded-lg shadow-xl border border-gray-200" style={{ maxWidth: '100%' }}>
        <div
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

            return (
              <div
                key={`el-${idx}`}
                style={{
                  position: 'absolute',
                  left: cssX,
                  top: cssY,
                  fontSize: (el.fontSize ?? 12) * scale,
                  fontFamily: 'serif',
                  fontWeight: isHeader ? 'bold' : 'normal',
                  whiteSpace: 'nowrap',
                  color: isHeader ? '#111827' : '#1f2937',
                  zIndex: 2,
                  userSelect: 'none',
                  cursor: selectedTool ? 'pointer' : 'default',
                  lineHeight: 1,
                }}
              >
                {el.text}
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
        />
      ))}
    </div>
  );
};

export default PDFViewer;
