import { uint8ToBinaryString } from './src/utils/bytes.js';
import { findRootRef, extractFirstKid } from './src/core/pdfPageTreeResolver.js';
import { getObject, extractValue, resolveLength, decompressStream } from './src/core/pdfObjectReader.js';
import { PdfPage } from './PdfPage.js';

/**
 * Factory for loading and navigating a PDF document in the browser.
 *
 * Creates a `PdfDocument` instance from a File object (drag-and-drop upload),
 * then provides `getPage(n)` to obtain a `PdfPage` adapter for each page.
 *
 * @example
 * const doc  = await PdfDocument.fromFile(file);
 * const page = await doc.getPage(1);
 * const result = await page.extract();
 */
export class PdfDocument {
    // ── Private Fields ─────────────────────────────────────────────────────────

    /** @type {Uint8Array} Full PDF file bytes */
    #bytes;
    /** @type {string} Full PDF as a binary string (for regex operations) */
    #pdfString;

    /**
     * @param {Uint8Array} bytes
     */
    constructor(bytes) {
        this.#bytes     = bytes;
        this.#pdfString = uint8ToBinaryString(bytes);
    }

    // ── Factory Methods ────────────────────────────────────────────────────────

    /**
     * Loads a PDF from a browser `File` object (e.g. from drag-and-drop or
     * `<input type="file">`). Reads the file as an ArrayBuffer and wraps it.
     *
     * @param {File} file - The raw File object from the browser.
     * @returns {Promise<PdfDocument>}
     */
    static async fromFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        return new PdfDocument(new Uint8Array(arrayBuffer));
    }

    // ── Page Navigation ────────────────────────────────────────────────────────

    /**
     * Returns a `PdfPage` adapter for the given 1-indexed page number.
     *
     * Resolves the PDF structure (trailer → root → pages → page node) and
     * decompresses the page's content stream so the adapter is ready to use.
     *
     * Currently supports single-page or first-kid resolution. Multi-page
     * support (walking the full Kids array) can be added here.
     *
     * @param {number} [n=1] - 1-indexed page number.
     * @returns {Promise<PdfPage>}
     * @throws {Error} If any step of the page tree walk fails.
     */
    async getPage(n = 1) {
        const { pageObj, contentStream } = this.#resolvePageN(n);
        return new PdfPage(this.#bytes, this.#pdfString, pageObj, contentStream);
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    /**
     * Walks the PDF page tree from the trailer down to page `n` and
     * decompresses the page's content stream.
     *
     * @param {number} n - 1-indexed page number.
     * @returns {{ pageObj: string, contentStream: string }}
     */
    #resolvePageN(n) {
        // ── 1. Trailer → Root ───────────────────────────────────────────────
        const rootRef = findRootRef(this.#pdfString);
        const rootObj = getObject(this.#bytes, this.#pdfString, rootRef);

        // ── 2. Root → Pages ─────────────────────────────────────────────────
        const pagesRef = extractValue(rootObj, '/Pages');
        const pagesObj = getObject(this.#bytes, this.#pdfString, pagesRef);

        // ── 3. Pages → Page node ─────────────────────────────────────────────
        // extractFirstKid currently returns the first kid regardless of n.
        // TODO: walk Kids[n-1] for multi-page support.
        const pageRef = extractFirstKid(pagesObj, pagesRef);
        const pageObj = getObject(this.#bytes, this.#pdfString, pageRef);

        // ── 4. Page → Content Stream ─────────────────────────────────────────
        const contentsRef    = extractValue(pageObj, '/Contents');
        const contentsBytes  = getObject(this.#bytes, this.#pdfString, contentsRef, true);
        const streamLength   = resolveLength(this.#bytes, this.#pdfString, contentsBytes);
        const contentStream  = decompressStream(contentsBytes, streamLength);

        return { pageObj, contentStream };
    }
}
