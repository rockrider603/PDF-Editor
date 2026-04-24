/**
 * Extracts all text items from a PDF page with their positions.
 *
 * pdfjs gives each item a `transform` matrix [a, b, c, d, tx, ty]
 * where tx = x and ty = y in PDF user-space (bottom-left origin).
 * fontSize is approximated from the matrix scale component `a`.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @returns {Promise<Array<{ text: string, x: number, y: number, width: number, height: number, fontSize: number }>>}
 */
export async function extractText(page) {
  const content = await page.getTextContent();

  return content.items
    .filter((item) => item.str && item.str.trim().length > 0)
    .map((item) => {
      const [a, , , d, tx, ty] = item.transform;
      const fontSize = Math.abs(a) || Math.abs(d) || 12;
      return {
        text: item.str,
        x: tx,
        y: ty,
        width: item.width ?? item.str.length * fontSize * 0.55,
        height: item.height ?? fontSize,
        fontSize,
      };
    });
}
