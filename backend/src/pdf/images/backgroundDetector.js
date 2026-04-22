const { getObject } = require('../core/pdfObjectReader');
const { resolveDictOrRef } = require('../core/pdfDictionaryResolver');
const { buildXObjectNameMap, parsePaintOperations } = require('./pageContentParser');
const { decodeImageObject } = require('./imageDecoder');

/**
 * Parses the page /MediaBox and returns its width and height in points.
 * Falls back to US Letter (612 × 792 pt) if the entry is absent.
 *
 * @param {string} pageObjStr
 * @returns {{ width: number, height: number }}
 */
function getPageDimensions(pageObjStr) {
    const match = pageObjStr.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    if (!match) {
        console.warn('[Detector] /MediaBox not found; defaulting to Letter size (612 × 792 pt).');
        return { width: 612, height: 792 };
    }
    return {
        width:  parseFloat(match[3]) - parseFloat(match[1]),
        height: parseFloat(match[4]) - parseFloat(match[2])
    };
}

/**
 * Computes the fraction of the page area that a paint operation covers.
 * Uses the absolute values of the CTM scale components (a, d).
 *
 * @param {number[]} matrix   - 6-element affine matrix [a b c d e f].
 * @param {{ width: number, height: number }} pageDims
 * @returns {number} Coverage fraction, clamped to [0, 1].
 */
function computePageCoverage(matrix, pageDims) {
    const pageArea = pageDims.width * pageDims.height;
    if (pageArea === 0) return 0;
    return Math.min((Math.abs(matrix[0]) * Math.abs(matrix[3])) / pageArea, 1);
}

/**
 * Identifies the PDF object number and paint matrix for the background image
 * on the given page.
 *
 * Selection criteria (in order):
 *   1. First image whose rendered area ≥ 80% of the page area.
 *   2. The image with the largest rendered area (best candidate fallback).
 *
 * @param {Buffer} buffer
 * @param {string} pdfString
 * @param {string} pageObjStr
 * @param {string} contentStream - Already-decompressed content stream text.
 * @returns {{ objNum: number, matrix: number[] } | null}
 */
function detectBackgroundObject(buffer, pdfString, pageObjStr, contentStream) {
    const pageDims = getPageDimensions(pageObjStr);
    const nameMap  = buildXObjectNameMap(buffer, pdfString, pageObjStr);

    if (nameMap.size === 0) {
        console.log('[Detector] No image XObjects found on this page.');
        return null;
    }

    const paintOps = parsePaintOperations(contentStream);
    console.log(`[Detector] Found ${paintOps.length} paint operation(s) in content stream.`);

    let bestObjNum  = null;
    let bestMatrix  = null;
    let bestCoverage = 0;

    for (const op of paintOps) {
        const objNum = nameMap.get(op.name);
        if (objNum === undefined) continue;

        const coverage = computePageCoverage(op.matrix, pageDims);
        console.log(`[Detector]  /${op.name} (obj ${objNum}): coverage=${(coverage * 100).toFixed(1)}%`);

        if (coverage >= 0.8) {
            console.log(`[Detector] Background identified: /${op.name} (obj ${objNum})`);
            return { objNum, matrix: op.matrix };
        }

        if (coverage > bestCoverage) {
            bestCoverage = coverage;
            bestObjNum   = objNum;
            bestMatrix   = op.matrix;
        }
    }

    if (bestObjNum !== null) {
        console.log(
            `[Detector] No image reaches ≥80% coverage. ` +
            `Best candidate: obj ${bestObjNum} at ${(bestCoverage * 100).toFixed(1)}%.`
        );
        return { objNum: bestObjNum, matrix: bestMatrix };
    }

    console.log('[Detector] No painted image XObjects matched the resource dictionary.');
    return null;
}

/**
 * Extracts the background image from the first page of a PDF.
 *
 * @param {Buffer} buffer
 * @param {string} pdfString
 * @param {string} pageObjStr
 * @param {string} contentStream - Already-decompressed first-page content stream.
 * @returns {{ bytes: Buffer, metadata: object, format: string, extension: string, objNum: number, role: string, appearances: object[] } | null}
 */
function extractBackgroundImage(buffer, pdfString, pageObjStr, contentStream) {
    console.log('\n--- Background Image Extraction ---');

    const detected = detectBackgroundObject(buffer, pdfString, pageObjStr, contentStream);
    if (!detected) {
        console.log('[Detector] No background image found.');
        return null;
    }

    const { objNum, matrix } = detected;

    let decoded;
    try {
        decoded = decodeImageObject(buffer, pdfString, objNum);
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

module.exports = { extractBackgroundImage };
