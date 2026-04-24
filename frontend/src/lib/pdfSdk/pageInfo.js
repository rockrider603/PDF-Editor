/**
 * Extracts the page dimensions (in PDF user-space points) from a PDFPageProxy.
 *
 * page.view = [x0, y0, x1, y1] — typically [0, 0, width, height] for standard pages.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @returns {{ width: number, height: number }}
 */
export function getPageInfo(page) {
  const [x0, y0, x1, y1] = page.view;
  return {
    width: x1 - x0,
    height: y1 - y0,
  };
}
