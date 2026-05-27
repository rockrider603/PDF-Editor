import { PDF_REGEX } from '../utils/pdfRegex.js';

/**
 * Locates the `/Root` indirect reference from the PDF.
 *
 * Uses the trailer dictionary parsed from the XRef table/stream.
 *
 * @param {string}              pdfString - Full PDF file as a binary string.
 * @param {Map<number,object>}  xrefMap   - XRef Map from buildXrefMap().
 * @param {Uint8Array}          bytes     - Full raw PDF bytes.
 * @returns {string} Indirect reference string, e.g. `"1 0 R"`.
 * @throws {Error} If the Root reference cannot be found by any strategy.
 */
export function findRootRef(pdfString, xrefMap, bytes) {
    // ── 1. startxref → XRef stream ──────────────────────────────────────────
    const sxIdx = pdfString.lastIndexOf('startxref');
    if (sxIdx !== -1) {
        const afterSx = pdfString.substring(sxIdx + 9, sxIdx + 30).trim();
        const offsetMatch = afterSx.match(/^(\d+)/);
        if (offsetMatch) {
            const xrefOffset = parseInt(offsetMatch[1], 10);
            const headerChunk = pdfString.substring(xrefOffset, xrefOffset + 1024);
            const rootM = headerChunk.match(/\/Root\s+(\d+\s+\d+\s+R)/);
            if (rootM) return rootM[1];
        }
    }

    // ── 2. Traditional trailer ───────────────────────────────────────────────
    const trailerIdx = pdfString.lastIndexOf('trailer');
    if (trailerIdx !== -1) {
        const chunk = pdfString.substring(trailerIdx, trailerIdx + 512);
        const m = chunk.match(/\/Root\s+(\d+\s+\d+\s+R)/);
        if (m) return m[1];
    }

    // ── 3. Fallback: Search for /Type /Catalog in the xrefMap ────────────────
    if (xrefMap) {
        // As requested: if there's no trailer, start checking objects (like 1 0 obj)
        // for the Catalog.
        for (const [objId, entry] of xrefMap.entries()) {
            if (entry.type === 1) {
                const startIdx = entry.field2;
                const slice = pdfString.substring(startIdx, startIdx + 1024);
                if (slice.includes('/Type') && slice.includes('/Catalog')) {
                    return `${objId} 0 R`;
                }
            }
        }
    }

    throw new Error('Could not locate PDF Root/Catalog.');
}

/**
 * Extracts the first child reference from a PDF Pages node's `/Kids` array.
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
