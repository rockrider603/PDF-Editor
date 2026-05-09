// Fixed display width of the canvas in CSS pixels.
// The canvas height is computed from the PDF's aspect ratio.
export const CANVAS_WIDTH = 850;

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
export function toCanvasY(pdfY, elHeight, pageHeight, scale) {
  return (pageHeight - pdfY - elHeight) * scale;
}
