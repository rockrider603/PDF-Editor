const { getObject } = require('../core/pdfObjectReader');
const { resolveDictOrRef } = require('../core/pdfDictionaryResolver');
const { extractAllImageData } = require('./pdfImageXObjectProcessor');
const zlib = require('zlib');

// ─────────────────────────────────────────────────────────────────────────────
// PDF Background Image Extractor
//
// The PDF content stream is a sequence of graphics operators.  When a raster
// image (XObject of /Subtype /Image) is painted, the typical instruction
// sequence is:
//
//   q                         ← push graphics state
//   w 0 0 h tx ty cm          ← set the current transformation matrix (CTM)
//   /XObjName Do              ← paint the named XObject
//   Q                         ← pop graphics state
//
// The "cm" operand encodes a 6-element affine matrix [a b c d e f] where
//   a = x-scale (rendered width in points)
//   d = y-scale (rendered height in points)
//   e = x-translation
//   f = y-translation
//
// The page's /MediaBox gives its bounding box: [x0 y0 width height].
//
// A background image is one whose rendered area (|a| × |d|) covers ≥ 80 % of
// the page area AND whose translation places its origin near the page origin.
// If no image clears that threshold the largest rendered image is returned as
// the best candidate.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses the page /MediaBox and returns { width, height } in points.
 *
 * @param {string} pageObjStr - Raw string of the page PDF object.
 * @returns {{ width: number, height: number }}
 */
function getPageDimensions(pageObjStr) {
    const match = pageObjStr.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    if (!match) {
        // Fall back to US Letter (612 × 792 pt) when MediaBox is absent.
        console.warn('[BgExtractor] /MediaBox not found; assuming Letter size (612 × 792 pt).');
        return { width: 612, height: 792 };
    }
    return {
        width: parseFloat(match[3]) - parseFloat(match[1]),
        height: parseFloat(match[4]) - parseFloat(match[2])
    };
}

/**
 * Resolves the /XObject resource dictionary and builds a map of
 * { localName → objectNumber } for every image XObject on the page.
 *
 * @param {Buffer}  buffer     - Raw PDF file buffer.
 * @param {string}  pdfString  - Binary string of the full PDF.
 * @param {string}  pageObjStr - Raw string of the page PDF object.
 * @returns {Map<string, number>} localName → object number
 */
function buildXObjectNameMap(buffer, pdfString, pageObjStr) {
    const nameToObjNum = new Map();

    const resEntry = resolveDictOrRef(pageObjStr, '/Resources');
    if (!resEntry) return nameToObjNum;

    const resObj = resEntry.type === 'ref'
        ? getObject(buffer, pdfString, resEntry.value)
        : resEntry.value;

    const xobjectEntry = resolveDictOrRef(resObj, '/XObject');
    if (!xobjectEntry) return nameToObjNum;

    const xobjectDict = xobjectEntry.type === 'ref'
        ? getObject(buffer, pdfString, xobjectEntry.value)
        : xobjectEntry.value;

    // Match entries like:  /Im0 5 0 R  or  /Bg 12 0 R
    const entries = xobjectDict.matchAll(/\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g);
    for (const [, name, objNum] of entries) {
        const objContent = getObject(buffer, pdfString, `${objNum} 0 R`);
        // Keep only image XObjects; skip Form XObjects, etc.
        if (objContent.includes('/Image')) {
            nameToObjNum.set(name, parseInt(objNum, 10));
        }
    }

    return nameToObjNum;
}

/**
 * Parses the decompressed content stream and extracts every "Do" paint
 * operation together with the most recent "cm" transformation matrix that was
 * set inside the same graphics-state save/restore block.
 *
 * @param {string} contentStream - Decompressed PDF content stream text.
 * @returns {{ name: string, matrix: number[] }[]} List of paint operations.
 */
function parsePaintOperations(contentStream) {
    const operations = [];

    // Regex that captures the full "cm" operand (a b c d e f cm)
    // followed eventually by a "/Name Do" inside the same q…Q block.
    //
    // Strategy: walk token-by-token through the stream.  Track whether we are
    // inside a graphics-state block (q … Q) and capture the CTM whenever we
    // see "cm", then record it when we later see "Do".
    const lines = contentStream.split(/\r\n|\r|\n/);

    let currentMatrix = [1, 0, 0, 1, 0, 0]; // identity
    let pendingMatrix = null;                 // matrix seen since last "cm"
    const stateStack = [];                   // stack for q/Q pairs

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('%')) continue; // skip comments

        // Push/pop graphics state — preserve the matrix across nesting.
        if (trimmed === 'q') {
            stateStack.push([...currentMatrix]);
            continue;
        }
        if (trimmed === 'Q') {
            if (stateStack.length > 0) {
                currentMatrix = stateStack.pop();
            }
            pendingMatrix = null;
            continue;
        }

        // Capture transformation matrix:  a b c d e f cm
        const cmMatch = trimmed.match(
            /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm\b/
        );
        if (cmMatch) {
            pendingMatrix = cmMatch.slice(1).map(Number);
        }

        // Paint operation:  /XObjName Do
        const doMatch = trimmed.match(/\/([^\s/]+)\s+Do\b/);
        if (doMatch) {
            operations.push({
                name: doMatch[1],
                matrix: pendingMatrix ? [...pendingMatrix] : [...currentMatrix]
            });
            pendingMatrix = null;
        }
    }

    return operations;
}

/**
 * Scores an image paint operation by how much of the page it covers.
 *
 * The cm matrix element [a] encodes the rendered width and [d] the rendered
 * height (in points).  We compare the rendered area to the page area.
 *
 * @param {{ matrix: number[] }} op       - Paint operation with CTM.
 * @param {{ width: number, height: number }} pageDims - Page dimensions.
 * @returns {number} Coverage ratio (0 → 1, clamped).
 */
function computeCoverage(op, pageDims) {
    const [a, , , d] = op.matrix;
    const renderedWidth = Math.abs(a);
    const renderedHeight = Math.abs(d);
    const pageArea = pageDims.width * pageDims.height;
    if (pageArea === 0) return 0;
    const renderedArea = renderedWidth * renderedHeight;
    return Math.min(renderedArea / pageArea, 1);
}

/**
 * Identifies the background image object number for a single page.
 *
 * Detection criteria (in priority order):
 *   1. A single image whose rendered area covers ≥ 80 % of the page.
 *   2. The image with the greatest rendered area (best candidate).
 *
 * Returns null when no image XObjects are found on the page.
 *
 * @param {Buffer}  buffer          - Raw PDF file buffer.
 * @param {string}  pdfString       - Binary string of the full PDF.
 * @param {string}  pageObjStr      - Raw string of the page PDF object.
 * @param {string}  contentStream   - Decompressed content stream for the page.
 * @returns {number|null} Object number of the background image, or null.
 */
function findBackgroundImageObjNum(buffer, pdfString, pageObjStr, contentStream) {
    const pageDims = getPageDimensions(pageObjStr);
    const nameMap = buildXObjectNameMap(buffer, pdfString, pageObjStr);

    if (nameMap.size === 0) {
        console.log('[BgExtractor] No image XObjects found on this page.');
        return null;
    }

    const paintOps = parsePaintOperations(contentStream);
    console.log(`[BgExtractor] Found ${paintOps.length} paint operation(s) in content stream.`);

    let bestCandidate = null;
    let bestCoverage = 0;

    for (const op of paintOps) {
        const objNum = nameMap.get(op.name);
        if (objNum === undefined) continue; // not an image XObject

        const coverage = computeCoverage(op, pageDims);
        console.log(`[BgExtractor]  /${op.name} (obj ${objNum}): coverage=${(coverage * 100).toFixed(1)}%`);

        if (coverage >= 0.8) {
            // Definitive background — stop searching.
            console.log(`[BgExtractor] Background image identified: /${op.name} (obj ${objNum})`);
            return objNum;
        }

        if (coverage > bestCoverage) {
            bestCoverage = coverage;
            bestCandidate = objNum;
        }
    }

    if (bestCandidate !== null) {
        console.log(
            `[BgExtractor] No image covers ≥80% of the page. ` +
            `Best candidate is obj ${bestCandidate} at ${(bestCoverage * 100).toFixed(1)}% coverage.`
        );
    } else {
        console.log('[BgExtractor] No painted image XObjects matched the resource dictionary.');
    }

    return bestCandidate;
}

/**
 * Public API — extracts the background image from the first page of a PDF.
 *
 * Delegates byte extraction to `extractAllImageData` so that filter decoding
 * (FlateDecode → BMP, DCTDecode → JPG, etc.) is handled in one place.
 *
 * @param {Buffer}  buffer        - Raw PDF file buffer.
 * @param {string}  pdfString     - Binary string of the full PDF.
 * @param {string}  pageObjStr    - Raw string of the page PDF object.
 * @param {string}  contentStream - Decompressed content stream for the page.
 * @returns {{ bytes: Buffer, metadata: object, extension: string, objNum: number, role: string } | null}
 */
function extractBackgroundImage(buffer, pdfString, pageObjStr, contentStream) {
    console.log('\n--- Background Image Extraction ---');

    const objNum = findBackgroundImageObjNum(buffer, pdfString, pageObjStr, contentStream);
    if (objNum === null) {
        console.log('[BgExtractor] No background image found.');
        return null;
    }

    const [imageData] = extractAllImageData(buffer, pdfString, [objNum]);
    if (!imageData) {
        console.warn(`[BgExtractor] Failed to extract bytes for obj ${objNum}.`);
        return null;
    }

    return {
        ...imageData,
        role: 'background'
    };
}

module.exports = {
    extractBackgroundImage
};
