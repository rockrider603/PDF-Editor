import { getObject, extractValue, resolveLength, decompressStream } from '../core/pdfObjectReader.js';
import { buildXObjectNameMap, parsePaintOperations } from './pageContentParser.js';
import { decodeImageObject } from './imageDecoder.js';
import { PDF_REGEX } from '../utils/pdfRegex.js';
import { uint8ToBinaryString } from '../utils/bytes.js';

// ── Per-Page Appearance Building ──────────────────────────────────────────────

/**
 * Builds the list of all XObject paint appearances (position + size) for
 * every image on a given page by parsing its content stream.
 *
 * @param {Uint8Array}       bytes
 * @param {string}           pdfString
 * @param {string}           pageObjStr
 * @param {Map<string, number>} nameMap  - Local XObject name → object number.
 * @returns {Map<number, object[]>}       Object number → array of appearance objects.
 */
function buildAppearancesForPage(bytes, pdfString, pageObjStr, nameMap) {
    const appearancesMap = new Map();
    for (const objNum of nameMap.values()) appearancesMap.set(objNum, []);

    let contentsRef;
    try {
        contentsRef = extractValue(pageObjStr, '/Contents');
    } catch {
        return appearancesMap;
    }

    try {
        const contentsObjBytes = getObject(bytes, pdfString, contentsRef, true);
        const streamLength     = resolveLength(bytes, pdfString, contentsObjBytes);
        const streamText       = decompressStream(contentsObjBytes, streamLength);

        for (const op of parsePaintOperations(streamText)) {
            const objNum = nameMap.get(op.name);
            if (objNum !== undefined) {
                const d = op.matrix[3];
                const f = op.matrix[5];
                const pdfBottomY = d < 0 ? f + d : f;

                appearancesMap.get(objNum).push({
                    x:              op.matrix[4],
                    y:              pdfBottomY,
                    renderedWidth:  Math.abs(op.matrix[0]),
                    renderedHeight: Math.abs(d)
                });
            }
        }
    } catch (err) {
        console.warn(`[Scanner] Could not parse appearances for a page: ${err.message}`);
    }

    return appearancesMap;
}

// ── Full-PDF Image Scan ───────────────────────────────────────────────────────

/**
 * Scans every page in the PDF for image XObjects, collects their decoded data,
 * metadata, format, and all on-page paint appearances.
 *
 * Returns one entry per unique image object. Background image filtering is
 * handled by the caller (e.g. `PdfPage.getImages()`) after background detection.
 *
 * Each entry's `dataUrl` is a base64 JPEG ready for `<img src="…">`.
 *
 * @param {Uint8Array} bytes
 * @param {string}     pdfString
 * @returns {Promise<Array<{
 *   dataUrl: string,
 *   metadata: object,
 *   format: string,
 *   extension: string,
 *   objNum: number,
 *   role: string,
 *   appearances: object[]
 * }>>}
 */
export async function scanPageImages(bytes, pdfString) {
    const allObjectIds     = new Set();
    const globalAppearances = new Map();

    for (const match of pdfString.matchAll(PDF_REGEX.images.pageObjectBlock)) {
        const pageObjStr = match[0];
        const nameMap    = buildXObjectNameMap(bytes, pdfString, pageObjStr);

        for (const objNum of nameMap.values()) {
            allObjectIds.add(objNum);
            if (!globalAppearances.has(objNum)) globalAppearances.set(objNum, []);
        }

        const pageAppearances = buildAppearancesForPage(bytes, pdfString, pageObjStr, nameMap);
        for (const [objNum, list] of pageAppearances) {
            globalAppearances.get(objNum).push(...list);
        }
    }

    const results = [];
    for (const objNum of allObjectIds) {
        try {
            const decoded = await decodeImageObject(bytes, pdfString, objNum);
            if (!decoded) continue;
            results.push({
                ...decoded,
                objNum,
                role:        'image',
                appearances: globalAppearances.get(objNum) || []
            });
        } catch (err) {
            console.warn(`[Scanner] Failed to decode object ${objNum}: ${err.message}`);
        }
    }

    return results;
}
