import { findFontAndCMap } from './src/text/pdfFontCMapResolver.js';
import { processContentStream, detectParasAndHeaders } from './src/text/pdfContentStreamTextProcessor.js';
import { extractBackgroundImage } from './src/images/backgroundDetector.js';
import { scanPageImages } from './src/images/imageScanner.js';
import { buildXObjectNameMap } from './src/images/pageContentParser.js';
import { getPageDimensions } from './src/images/backgroundDetector.js';

/**
 * Adapter for a single PDF page.
 *
 * Created by `PdfDocument.getPage(n)` — not intended to be instantiated directly.
 * Wraps the raw (bytes, pdfString, pageObj, contentStream) tuple and exposes a
 * clean, method-based API for text and image extraction.
 *
 * @example
 * const doc  = await PdfDocument.fromFile(file);
 * const page = await doc.getPage(1);
 *
 * const textElements   = await page.getText();
 * const classification = page.classifyText(textElements);
 * const images         = await page.getImages();
 *
 * // Or all at once:
 * const result = await page.extract();
 */
export class PdfPage {
    // ── Private Fields ─────────────────────────────────────────────────────────

    /** @type {Uint8Array} */
    #bytes;
    /** @type {string} */
    #pdfString;
    /** @type {string} */
    #pageObj;
    /** @type {string} */
    #contentStream;

    /**
     * @param {Uint8Array} bytes
     * @param {string}     pdfString
     * @param {string}     pageObj        - String of the Page object dictionary.
     * @param {string}     contentStream  - Decompressed content stream text.
     */
    constructor(bytes, pdfString, pageObj, contentStream) {
        this.#bytes         = bytes;
        this.#pdfString     = pdfString;
        this.#pageObj       = pageObj;
        this.#contentStream = contentStream;
    }

    // ── Page Info ──────────────────────────────────────────────────────────────

    /**
     * Page dimensions in PDF points (e.g. `{ width: 612, height: 792 }`).
     * Derived from the page's /MediaBox entry.
     *
     * @returns {{ width: number, height: number }}
     */
    get dimensions() {
        return getPageDimensions(this.#pageObj);
    }

    // ── Text Extraction ────────────────────────────────────────────────────────

    /**
     * Extracts all positioned text elements from this page.
     *
     * Resolves fonts via ToUnicode CMaps, then walks the content stream to
     * produce one element per logical text run, with x/y coordinates in
     * PDF user-space (bottom-left origin).
     *
     * @returns {Promise<Array<{ text: string, x: number, y: number, width: number }>>}
     */
    async getText() {
        const fonts = findFontAndCMap(this.#bytes, this.#pdfString, this.#pageObj);
        return processContentStream(this.#contentStream, fonts);
    }

    /**
     * Classifies an array of text elements into headers and paragraphs.
     *
     * Uses dynamic thresholds based on the page's actual width — no hardcoded
     * 612pt assumption.
     *
     * @param {Array<{ text: string, x: number, y: number, width: number }>} textElements
     * @returns {{
     *   headers:        string[],
     *   paragraphs:     string[],
     *   headerCount:    number,
     *   paragraphCount: number,
     *   detailed: {
     *     headers:    Array<{ text, xPosition, elementCenter, alignment }>,
     *     paragraphs: Array<{ text, xPosition, elementCenter, alignment }>
     *   }
     * }}
     */
    classifyText(textElements) {
        const { width } = this.dimensions;
        return detectParasAndHeaders(textElements, width);
    }

    // ── Image Extraction ───────────────────────────────────────────────────────

    /**
     * Extracts all images from this page as decoded entries with data URLs.
     *
     * Automatically separates the background image (≥80% page coverage) from
     * regular page images. Each entry is ready for `<img src="…">` rendering.
     *
     * @returns {Promise<{
     *   background: { dataUrl: string, metadata: object, role: 'background', appearances: object[] } | null,
     *   pageImages: Array<{ dataUrl: string, metadata: object, role: 'image', appearances: object[] }>
     * }>}
     */
    async getImages() {
        const bg = await extractBackgroundImage(
            this.#bytes, this.#pdfString, this.#pageObj, this.#contentStream
        );

        // Build XObject name map for this specific page to determine which
        // image objects belong to it — avoids cross-page contamination
        // without relying on fragile string comparisons.
        const nameMap     = buildXObjectNameMap(this.#bytes, this.#pdfString, this.#pageObj);
        const pageObjNums = new Set(nameMap.values());

        // Scan all images in the PDF but keep only those on this page
        let pageImgs = await scanPageImages(this.#bytes, this.#pdfString);
        pageImgs = pageImgs.filter(img => pageObjNums.has(img.objNum));

        if (bg) {
            pageImgs = pageImgs.filter(img => img.objNum !== bg.objNum);
        }

        return { background: bg, pageImages: pageImgs };
    }

    // ── Combined Extraction ────────────────────────────────────────────────────

    /**
     * Runs the full extraction pipeline in a single call.
     *
     * Equivalent to calling `getText()`, `classifyText()`, and `getImages()` in
     * sequence, but more convenient when all three results are needed at once.
     *
     * @returns {Promise<{
     *   dimensions:     { width: number, height: number },
     *   textElements:   Array<{ text, x, y, width }>,
     *   classification: object,
     *   images:         { background: object|null, pageImages: object[] }
     * }>}
     */
    async extract() {
        const dimensions    = this.dimensions;
        const textElements  = await this.getText();
        const classification = this.classifyText(textElements);
        const images        = await this.getImages();

        return { dimensions, textElements, classification, images };
    }
}
