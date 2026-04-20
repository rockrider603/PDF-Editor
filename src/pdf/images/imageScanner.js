const { getObject, extractValue, resolveLength, decompressStream } = require('../core/pdfObjectReader');
const { buildXObjectNameMap, parsePaintOperations } = require('./pageContentParser');
const { decodeImageObject } = require('./imageDecoder');

/**
 * Builds the list of all XObject paint appearances (position + size) for
 * every image on a given page by parsing its content stream.
 *
 * @param {Buffer} buffer
 * @param {string} pdfString
 * @param {string} pageObjStr
 * @param {Map<string, number>} nameMap
 * @returns {Map<number, object[]>} objNum → array of appearance objects
 */
function buildAppearancesForPage(buffer, pdfString, pageObjStr, nameMap) {
    const appearancesMap = new Map();
    for (const objNum of nameMap.values()) {
        appearancesMap.set(objNum, []);
    }

    let contentsRef;
    try {
        contentsRef = extractValue(pageObjStr, '/Contents');
    } catch {
        return appearancesMap;
    }

    try {
        const contentsObjBuffer = getObject(buffer, pdfString, contentsRef, true);
        const streamLength = resolveLength(buffer, pdfString, contentsObjBuffer);
        const streamText = decompressStream(contentsObjBuffer, streamLength);

        for (const op of parsePaintOperations(streamText)) {
            const objNum = nameMap.get(op.name);
            if (objNum !== undefined) {
                appearancesMap.get(objNum).push({
                    x:              op.matrix[4],
                    y:              op.matrix[5],
                    renderedWidth:  Math.abs(op.matrix[0]),
                    renderedHeight: Math.abs(op.matrix[3])
                });
            }
        }
    } catch (err) {
        console.warn(`[Scanner] Could not parse appearances for a page: ${err.message}`);
    }

    return appearancesMap;
}

/**
 * Scans every page in the PDF for image XObjects, collects their decoded bytes,
 * metadata, format, and all on-page paint appearances.
 *
 * Returns one entry per unique image object, with the background image excluded
 * (filtering happens in the orchestrator after background detection).
 *
 * @param {Buffer} buffer
 * @param {string} pdfString
 * @returns {Promise<{ bytes: Buffer, metadata: object, format: string, extension: string, objNum: number, role: string, appearances: object[] }[]>}
 */
async function scanPageImages(buffer, pdfString) {
    console.log('--- Starting Full PDF Image Scan ---');

    const allObjectIds = new Set();
    const globalAppearances = new Map();

    for (const match of pdfString.matchAll(/(\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Page[\s\S]*?endobj)/g)) {
        const pageObjStr = match[0];
        const nameMap = buildXObjectNameMap(buffer, pdfString, pageObjStr);

        for (const objNum of nameMap.values()) {
            allObjectIds.add(objNum);
            if (!globalAppearances.has(objNum)) globalAppearances.set(objNum, []);
        }

        const pageAppearances = buildAppearancesForPage(buffer, pdfString, pageObjStr, nameMap);
        for (const [objNum, list] of pageAppearances) {
            globalAppearances.get(objNum).push(...list);
        }
    }

    console.log(`Detected ${allObjectIds.size} unique image objects across all pages.`);

    const results = [];
    for (const objNum of allObjectIds) {
        try {
            const decoded = await decodeImageObject(buffer, pdfString, objNum);
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

module.exports = { scanPageImages };
