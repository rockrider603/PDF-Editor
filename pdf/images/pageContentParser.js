const { getObject } = require('../core/pdfObjectReader');
const { resolveDictOrRef } = require('../core/pdfDictionaryResolver');

/**
 * Builds a map of { xObjectLocalName → pdfObjectNumber } for every image
 * XObject declared in a page's /Resources dictionary.
 *
 * Resolves indirect references for both /Resources and /XObject entries.
 *
 * @param {Buffer} buffer
 * @param {string} pdfString
 * @param {string} pageObjStr
 * @returns {Map<string, number>}
 */
function buildXObjectNameMap(buffer, pdfString, pageObjStr) {
    const nameToObjNum = new Map();

    const resourcesEntry = resolveDictOrRef(pageObjStr, '/Resources');
    if (!resourcesEntry) return nameToObjNum;

    const resourcesStr = resourcesEntry.type === 'ref'
        ? getObject(buffer, pdfString, resourcesEntry.value)
        : resourcesEntry.value;

    const xObjectEntry = resolveDictOrRef(resourcesStr, '/XObject');
    if (!xObjectEntry) return nameToObjNum;

    const xObjectDict = xObjectEntry.type === 'ref'
        ? getObject(buffer, pdfString, xObjectEntry.value)
        : xObjectEntry.value;

    for (const [, name, objNum] of xObjectDict.matchAll(/\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g)) {
        const objContent = getObject(buffer, pdfString, `${objNum} 0 R`);
        if (objContent.includes('/Image')) {
            nameToObjNum.set(name, parseInt(objNum, 10));
        }
    }

    return nameToObjNum;
}

/**
 * Parses a decompressed PDF content stream and returns every XObject paint
 * ("Do") operation along with the transformation matrix ("cm") active at
 * the time it was invoked.
 *
 * The CTM is a 6-element affine matrix [a b c d e f] where:
 *   a = x-scale (rendered width in points)
 *   d = y-scale (rendered height in points)
 *   e = x-translation
 *   f = y-translation
 *
 * @param {string} contentStream - Decompressed content stream text.
 * @returns {{ name: string, matrix: number[] }[]}
 */
function parsePaintOperations(contentStream) {
    const operations = [];
    const lines = contentStream.split(/\r\n|\r|\n/);

    let currentMatrix = [1, 0, 0, 1, 0, 0];
    let pendingMatrix = null;
    const stateStack = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('%')) continue;

        if (trimmed === 'q') {
            stateStack.push([...currentMatrix]);
            continue;
        }

        if (trimmed === 'Q') {
            if (stateStack.length > 0) currentMatrix = stateStack.pop();
            pendingMatrix = null;
            continue;
        }

        const cmMatch = trimmed.match(
            /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm\b/
        );
        if (cmMatch) {
            pendingMatrix = cmMatch.slice(1).map(Number);
        }

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

module.exports = {
    buildXObjectNameMap,
    parsePaintOperations
};
