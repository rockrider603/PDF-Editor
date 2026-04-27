import { PDF_REGEX } from '../utils/pdfRegex.js';

/**
 * Locates the `/Root` indirect reference from the PDF trailer section.
 *
 * Scans backwards from the end of the file to find the last `trailer`
 * keyword, then extracts the `/Root` entry from its dictionary.
 *
 * @param {string} pdfString - Full PDF file as a binary string.
 * @returns {string} Indirect reference string, e.g. `"1 0 R"`.
 * @throws {Error} If the trailer or Root reference cannot be found.
 */
export function findRootRef(pdfString) {
    const trailerIdx = pdfString.lastIndexOf('trailer');
    if (trailerIdx === -1) throw new Error('Trailer section not found');

    const trailerChunk = pdfString.substring(
        trailerIdx,
        pdfString.indexOf('>>', trailerIdx) + 2
    );
    const match = trailerChunk.match(PDF_REGEX.core.rootRef);
    if (!match) throw new Error('Root reference not found in trailer');
    return match[1];
}

/**
 * Extracts the first child reference from a PDF Pages node's `/Kids` array.
 *
 * @param {string} pagesObjStr - String of the Pages object.
 * @param {string} refId       - Reference ID used in error messages.
 * @returns {string} Indirect reference string of the first kid, e.g. `"3 0 R"`.
 * @throws {Error} If the `/Kids` array cannot be found.
 */
export function extractFirstKid(pagesObjStr, refId) {
    const kidsMatch = pagesObjStr.match(PDF_REGEX.core.kidsArray);
    if (!kidsMatch) {
        throw new Error(`Failed to find /Kids array in Pages object ${refId}`);
    }
    const refs = kidsMatch[1].trim().split(PDF_REGEX.common.whitespace);
    return `${refs[0]} ${refs[1]} ${refs[2]}`;
}

/**
 * Extracts the Nth (0-indexed) child reference from a /Kids array.
 */
export function extractKidN(pagesObjStr, refId, n) {
    const kidsMatch = pagesObjStr.match(PDF_REGEX.core.kidsArray);
    if (!kidsMatch) throw new Error(`/Kids not found in ${refId}`);
    const tokens = kidsMatch[1].trim().split(PDF_REGEX.common.whitespace);
    const base   = n * 3;   // each ref = "ObjNum GenNum R" = 3 tokens
    if (base + 2 >= tokens.length) throw new Error(`Page ${n + 1} out of range`);
    return `${tokens[base]} ${tokens[base + 1]} ${tokens[base + 2]}`;
}

/**
 * Returns the total page count from a /Count entry.
 */
export function extractPageCount(pagesObjStr) {
    const match = pagesObjStr.match(/\/Count\s+(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
}
