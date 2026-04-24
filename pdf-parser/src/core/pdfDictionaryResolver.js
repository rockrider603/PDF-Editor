import { PDF_REGEX } from '../utils/pdfRegex.js';

/**
 * Extracts the inline dictionary starting at `startIdx` from `str`,
 * handling nested `<< ... >>` pairs correctly.
 *
 * @param {string} str
 * @param {number} startIdx - Index of the opening `<<`.
 * @returns {string} The full dictionary string including `<<` and `>>`.
 */
function extractInlineDictionary(str, startIdx) {
    let depth = 0;
    let i = startIdx;

    while (i < str.length - 1) {
        const two = str.slice(i, i + 2);
        if (two === '<<') { depth++; i += 2; continue; }
        if (two === '>>') {
            depth--;
            i += 2;
            if (depth === 0) return str.slice(startIdx, i);
            continue;
        }
        i++;
    }
    throw new Error('Unterminated inline dictionary');
}

/**
 * Resolves the value of a dictionary key in a PDF object string.
 * The value may be an indirect reference ("5 0 R") or an inline dictionary ("<<…>>").
 *
 * @param {string} objStr - String of the containing PDF object.
 * @param {string} key    - Dictionary key to look up, e.g. `'/Resources'`.
 * @returns {{ type: 'ref'|'dict', value: string } | null}
 */
export function resolveDictOrRef(objStr, key) {
    const keyIdx = objStr.indexOf(key);
    if (keyIdx === -1) return null;

    const afterKey = objStr.slice(keyIdx + key.length).trimStart();
    const refMatch = afterKey.match(PDF_REGEX.core.leadingIndirectRef);
    if (refMatch) return { type: 'ref', value: refMatch[1] };

    if (afterKey.startsWith('<<')) {
        const dictStart = keyIdx + key.length +
            (objStr.slice(keyIdx + key.length).length - afterKey.length);
        const dict = extractInlineDictionary(objStr, dictStart);
        return { type: 'dict', value: dict };
    }

    return null;
}

export { extractInlineDictionary };
