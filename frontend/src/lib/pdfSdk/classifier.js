/**
 * Classifies an array of TextElements into headers and paragraphs.
 *
 * Mirrors the logic in the Node.js `detectParasAndHeaders` function but:
 *  - Uses dynamic thresholds based on actual `pageWidth`
 *  - Operates on ESM-compatible data shapes
 *
 * Classification rules:
 *  - HEADER   : element center is within CENTER_TOLERANCE pts of the page center
 *  - PARAGRAPH: element x < LEFT_MARGIN_THRESHOLD (left-aligned text)
 *
 * @param {Array<{ text: string, x: number, y: number, width: number, height: number, fontSize: number }>} elements
 * @param {number} pageWidth  PDF page width in points
 * @returns {{ detailed: { headers: object[], paragraphs: object[] } }}
 */
export function classifyText(elements, pageWidth) {
  const PAGE_CENTER = pageWidth / 2;
  const CENTER_TOLERANCE = pageWidth * 0.065;      // ~40pt on a 612pt page
  const LEFT_MARGIN_THRESHOLD = pageWidth * 0.163; // ~100pt on a 612pt page

  const headers = [];
  const paragraphs = [];

  for (const el of elements) {
    if (!el.text || el.text.trim() === '') continue;

    const elementCenter = el.x + el.width / 2;
    const distanceFromCenter = Math.abs(elementCenter - PAGE_CENTER);

    if (distanceFromCenter < CENTER_TOLERANCE) {
      headers.push({
        text: el.text,
        xPosition: el.x,
        yPosition: el.y,
        elementCenter,
        fontSize: el.fontSize,
        width: el.width,
        height: el.height,
      });
    } else if (el.x < LEFT_MARGIN_THRESHOLD) {
      paragraphs.push({
        text: el.text,
        xPosition: el.x,
        yPosition: el.y,
        elementCenter,
        fontSize: el.fontSize,
        width: el.width,
        height: el.height,
      });
    }
  }

  return { detailed: { headers, paragraphs } };
}
