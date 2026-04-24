import { getObject } from '../core/pdfObjectReader.js';
import { resolveDictOrRef } from '../core/pdfDictionaryResolver.js';
import { PDF_REGEX } from '../utils/pdfRegex.js';

/**
 * Parses a decompressed PDF content stream and returns every XObject paint
 * ("Do") operation with the transformation matrix ("cm") active at the time.
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
export function parsePaintOperations(contentStream) {
    const operations = [];
    const lines = contentStream.split(PDF_REGEX.common.lineBreaks);

    let currentMatrix = [1, 0, 0, 1, 0, 0];
    let pendingMatrix = null;
    const stateStack  = [];

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

        const cmMatch = trimmed.match(PDF_REGEX.images.cmOperation);
        if (cmMatch) {
            pendingMatrix = cmMatch.slice(1).map(Number);
        }

        const doMatch = trimmed.match(PDF_REGEX.images.doOperation);
        if (doMatch) {
            operations.push({
                name:   doMatch[1],
                matrix: pendingMatrix ? [...pendingMatrix] : [...currentMatrix]
            });
            pendingMatrix = null;
        }
    }

    return operations;
}

/**
 * Builds a map of { xObjectLocalName → pdfObjectNumber } for every image
 * XObject declared in a page's /Resources dictionary.
 *
 * Resolves indirect references for both /Resources and /XObject entries.
 *
 * @param {Uint8Array} bytes      - Full PDF file bytes.
 * @param {string}     pdfString  - Full PDF as a binary string.
 * @param {string}     pageObjStr - String of the Page object dictionary.
 * @returns {Map<string, number>}
 */
export function buildXObjectNameMap(bytes, pdfString, pageObjStr) {
    const nameToObjNum = new Map();

    const resourcesEntry = resolveDictOrRef(pageObjStr, '/Resources');
    if (!resourcesEntry) return nameToObjNum;

    const resourcesStr = resourcesEntry.type === 'ref'
        ? getObject(bytes, pdfString, resourcesEntry.value)
        : resourcesEntry.value;

    const xObjectEntry = resolveDictOrRef(resourcesStr, '/XObject');
    if (!xObjectEntry) return nameToObjNum;

    const xObjectDict = xObjectEntry.type === 'ref'
        ? getObject(bytes, pdfString, xObjectEntry.value)
        : xObjectEntry.value;

    for (const [, name, objNum] of xObjectDict.matchAll(PDF_REGEX.images.xObjectRefEntries)) {
        const objContent = getObject(bytes, pdfString, `${objNum} 0 R`);
        if (objContent.includes('/Image')) {
            nameToObjNum.set(name, parseInt(objNum, 10));
        }
    }

    return nameToObjNum;
}
