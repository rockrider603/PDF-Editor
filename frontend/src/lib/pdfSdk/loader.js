import * as pdfjsLib from 'pdfjs-dist';

// Wire the web worker. Vite resolves `new URL(..., import.meta.url)` at build time.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString();

/**
 * Loads a PDF File object and returns a PDFDocumentProxy.
 *
 * @param {File} file - The raw File object from the browser.
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export async function loadPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  return loadingTask.promise;
}
