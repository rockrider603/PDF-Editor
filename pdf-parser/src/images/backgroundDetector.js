import { getObject } from '../core/pdfObjectReader.js';
import { resolveDictOrRef } from '../core/pdfDictionaryResolver.js';
import { buildXObjectNameMap, parsePaintOperations } from './pageContentParser.js';
import { decodeImageObject } from './imageDecoder.js';
import { PDF_REGEX } from '../utils/pdfRegex.js';

// ── Page Dimensions ───────────────────────────────────────────────────────────

/**
 * Parses the page /MediaBox and returns its width and height in points.
 * Falls back to US Letter (612 × 792 pt) if the entry is absent.
 *
 * @param {string} pageObjStr
 * @returns {{ width: number, height: number }}
 */
export function getPageDimensions(pageObjStr) {
    const match = pageObjStr.match(PDF_REGEX.images.mediaBox);
    if (!match) {
        console.warn('[Detector] /MediaBox not found; defaulting to Letter size (612 × 792 pt).');
        return { width: 612, height: 792 };
    }
    return {
        width:  parseFloat(match[3]) - parseFloat(match[1]),
        height: parseFloat(match[4]) - parseFloat(match[2])
    };
}

// ── Coverage Scoring ──────────────────────────────────────────────────────────

/**
 * Computes the fraction of the page area covered by a paint operation's CTM.
 * Uses the absolute values of the matrix scale components (a, d).
 *
 * @param {number[]} matrix   - 6-element affine matrix [a b c d e f].
 * @param {{ width: number, height: number }} pageDims
 * @returns {number} Coverage fraction clamped to [0, 1].
 */
function computePageCoverage(matrix, pageDims) {
    const pageArea = pageDims.width * pageDims.height;
    if (pageArea === 0) return 0;
    return Math.min((Math.abs(matrix[0]) * Math.abs(matrix[3])) / pageArea, 1);
}

// ── Background Detection ──────────────────────────────────────────────────────

/**
 * Identifies the PDF object number and paint matrix for the background image.
 *
 * Selection criteria (in order):
 *   1. First image whose rendered area ≥ 80% of the page area.
 *   2. The image with the largest rendered area (best-candidate fallback).
 *
 * @param {Uint8Array} bytes
 * @param {string}     pdfString
 * @param {string}     pageObjStr
 * @param {string}     contentStream - Already-decompressed content stream text.
 * @returns {{ objNum: number, matrix: number[] } | null}
 */
function detectBackgroundObject(bytes, pdfString, pageObjStr, contentStream) {
    const pageDims = getPageDimensions(pageObjStr);
    const nameMap  = buildXObjectNameMap(bytes, pdfString, pageObjStr);
    if (nameMap.size === 0) return null;

    const paintOps   = parsePaintOperations(contentStream);
    let bestObjNum   = null;
    let bestMatrix   = null;
    let bestCoverage = 0;

    for (const op of paintOps) {
        const objNum   = nameMap.get(op.name);
        if (objNum === undefined) continue;

        const coverage = computePageCoverage(op.matrix, pageDims);
        if (coverage >= 0.8) return { objNum, matrix: op.matrix };

        if (coverage > bestCoverage) {
            bestCoverage = coverage;
            bestObjNum   = objNum;
            bestMatrix   = op.matrix;
        }
    }

    return bestObjNum !== null ? { objNum: bestObjNum, matrix: bestMatrix } : null;
}

/**
 * Extracts the background image from the first page of a PDF.
 *
 * Returns a decoded image entry with a `dataUrl` and positional `appearances`,
 * or `null` if no background image is found.
 *
 * @param {Uint8Array} bytes
 * @param {string}     pdfString
 * @param {string}     pageObjStr
 * @param {string}     contentStream - Already-decompressed first-page content stream.
 * @returns {Promise<{ dataUrl: string, metadata: object, format: string, objNum: number, role: string, appearances: object[] } | null>}
 */
export async function extractBackgroundImage(bytes, pdfString, pageObjStr, contentStream) {
    const detected = detectBackgroundObject(bytes, pdfString, pageObjStr, contentStream);
    if (!detected) return null;

    const { objNum, matrix } = detected;

    let decoded;
    try {
        decoded = await decodeImageObject(bytes, pdfString, objNum);
    } catch (err) {
        console.warn(`[Detector] Failed to decode background (obj ${objNum}): ${err.message}`);
        return null;
    }

    if (!decoded) return null;

    return {
        ...decoded,
        objNum,
        role: 'background',
        appearances: [{
            x:              matrix[4],
            y:              matrix[5],
            renderedWidth:  Math.abs(matrix[0]),
            renderedHeight: Math.abs(matrix[3])
        }]
    };
}
