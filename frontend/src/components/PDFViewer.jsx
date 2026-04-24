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

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * PDFViewer renders a pixel-accurate canvas reconstruction of the PDF page.
 *
 * Three stacked layers (all position:absolute inside a position:relative box):
 *   Layer 0 (z=0) — Background image, fills the entire canvas
 *   Layer 1 (z=1) — Page images, placed at their PDF coordinates
 *   Layer 2 (z=2) — Text (headers + paragraphs), placed at their PDF coordinates
 *
 * @param {{ pageWidth, pageHeight, textElements, classification, images, isLoading, selectedTool }} props
 */
const PDFViewer = ({
  pageWidth = 612,
  pageHeight = 792,
  textElements = [],
  classification = null,
  images = { background: null, pageImages: [] },
  isLoading = false,
  selectedTool = null,
}) => {
  const scale = CANVAS_WIDTH / pageWidth;
  const canvasHeight = pageHeight * scale;

  // ── Loading State ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-white rounded-lg border border-gray-200 shadow-inner"
        style={{ width: CANVAS_WIDTH, height: Math.min(canvasHeight, 600) }}
      >
        <Loader2 size={40} className="animate-spin text-primary mb-4" />
        <p className="text-gray-500 text-sm">Parsing PDF…</p>
      </div>
    );
  }

  const hasContent =
    textElements.length > 0 ||
    images.background ||
    (images.pageImages && images.pageImages.length > 0);

  // ── Empty State ────────────────────────────────────────────────────────────
  if (!hasContent) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-white rounded-lg border-2 border-dashed border-gray-300"
        style={{ width: CANVAS_WIDTH, height: Math.max(canvasHeight, 400) }}
      >
        <p className="text-gray-400 text-sm">No content extracted from this PDF</p>
      </div>
    );
  }

  // ── Headers & Paragraphs from classification ──────────────────────────────
  // We use classification just for styling (bold vs normal).
  // The actual coordinates are taken from textElements directly.
  const headerTexts = new Set(classification?.headers ?? []);

  return (
    <div className="overflow-auto rounded-lg shadow-xl border border-gray-200" style={{ maxWidth: '100%' }}>
      {/* Page canvas — white box, exact PDF aspect ratio */}
      <div
        id="pdf-canvas"
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
            alt="PDF background"
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
          const cssX = img.x * scale;
          const cssY = toCanvasY(img.y, img.renderedHeight, pageHeight, scale);
          const cssW = img.renderedWidth  * scale;
          const cssH = img.renderedHeight * scale;

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
          const cssY = toCanvasY(el.y, el.fontSize ?? 12, pageHeight, scale);
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
  );
};

export default PDFViewer;
