import { uint8ToBinaryString } from './src/utils/bytes.js';
import { buildXrefMap } from './src/core/pdfXrefParser.js';
import { findRootRef, extractFirstKid, extractKidN } from './src/core/pdfPageTreeResolver.js';
import { getObject, extractValue, resolveLength, decompressStream } from './src/core/pdfObjectReader.js';
import { PdfPage } from './PdfPage.js';

/**
 * Factory for loading and navigating a PDF document in the browser.
 *
 * On load, parses the PDF's Cross-Reference (XRef) table/stream.
 * This handles out-of-order objects (via exact offsets) and decodes 
 * compressed objects hidden inside Object Streams (Type 2).
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
     * Cross-Reference Map: Map<objId (number) → { type, field2, field3 }>
     * Built once in the constructor, used for all object lookups.
     * @type {Map<number, object>}
     */
    #xrefMap;

    /**
     * @param {Uint8Array} bytes
     */
    constructor(bytes) {
        this.#bytes     = bytes;
        this.#pdfString = uint8ToBinaryString(bytes);

        // Parse the XRef table/streams
        this.#xrefMap = buildXrefMap(bytes);

        if (this.#xrefMap.size === 0) {
            console.warn(
                '[PdfDocument] XRef Map is empty — the file may not have a standard ' +
                'startxref. Object lookups will fall back to regex scan.'
            );
        }
    }

    // ── Factory Methods ────────────────────────────────────────────────────────

    static async fromFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        return new PdfDocument(new Uint8Array(arrayBuffer));
    }

    // ── Page Navigation ────────────────────────────────────────────────────────

    get pageCount() {
        const rootRef = findRootRef(this.#pdfString, this.#xrefMap, this.#bytes);
        const rootObj = getObject(this.#bytes, this.#pdfString, rootRef, false, this.#xrefMap);
        const pagesRef = extractValue(rootObj, '/Pages');
        const pagesObj = getObject(this.#bytes, this.#pdfString, pagesRef, false, this.#xrefMap);

        const match = pagesObj.match(/\/Count\s+(\d+)/);
        return match ? parseInt(match[1], 10) : 1;
    }

    async getPage(n = 1) {
        const { pageObj, contentStream } = this.#resolvePageN(n);
        return new PdfPage(this.#bytes, this.#pdfString, pageObj, contentStream, this.#xrefMap);
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    #resolvePageN(n) {
        const idx = this.#xrefMap;

        // ── 1. Find Root (Catalog) ───────────────────────────────────────────
        const rootRef = findRootRef(this.#pdfString, idx, this.#bytes);
        const rootObj = getObject(this.#bytes, this.#pdfString, rootRef, false, idx);

        // ── 2. Root → Pages ──────────────────────────────────────────────────
        const pagesRef = extractValue(rootObj, '/Pages');
        const pagesObj = getObject(this.#bytes, this.#pdfString, pagesRef, false, idx);

        // ── 3. Pages → Page node ─────────────────────────────────────────────
        const pageRef = extractKidN(pagesObj, pagesRef, n - 1);  // n is 1-indexed
        const pageObj = getObject(this.#bytes, this.#pdfString, pageRef, false, idx);

        // ── 4. Page → Content Stream ─────────────────────────────────────────
        const contentsRef   = extractValue(pageObj, '/Contents');
        const contentsBytes = getObject(this.#bytes, this.#pdfString, contentsRef, true, idx);
        const streamLength  = resolveLength(this.#bytes, this.#pdfString, contentsBytes, idx);
        const contentStream = decompressStream(contentsBytes, streamLength);

        return { pageObj, contentStream };
    }
}
