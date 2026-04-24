import { getObject, extractValue, resolveLength, decompressStream } from '../core/pdfObjectReader.js';
import { resolveDictOrRef } from '../core/pdfDictionaryResolver.js';
import { parseCMap, buildCharMap } from './pdfCMapParser.js';
import { PDF_REGEX } from '../utils/pdfRegex.js';

/**
 * Resolves all /Font entries on a page and extracts their ToUnicode CMap data.
 *
 * Walks the page's /Resources → /Font dictionary, resolves each font object,
 * decompresses its /ToUnicode CMap stream, and builds both the raw glyph map
 * and the decoded character map.
 *
 * @param {Uint8Array} bytes      - Full PDF file bytes.
 * @param {string}     pdfString  - Full PDF as a binary string.
 * @param {string}     pageObjStr - String of the Page object dictionary.
 * @returns {Record<string, { ref: string, cmapMap: Record<string, string>, charMap: Record<string, string> }>}
 *   Map of font name (e.g. `"F1"`) to its resolved CMap data.
 */
export function findFontAndCMap(bytes, pdfString, pageObjStr) {
    const resEntry = resolveDictOrRef(pageObjStr, '/Resources');
    if (!resEntry) throw new Error('No /Resources found in page object');

    const resObj = resEntry.type === 'ref'
        ? getObject(bytes, pdfString, resEntry.value)
        : resEntry.value;

    const fontEntry = resolveDictOrRef(resObj, '/Font');
    if (!fontEntry) throw new Error('No /Font found in resources');

    const fontDictObj = fontEntry.type === 'ref'
        ? getObject(bytes, pdfString, fontEntry.value)
        : fontEntry.value;

    const fonts = {};
    const fontNameMatches = fontDictObj.match(PDF_REGEX.text.fontNameRefEntries);
    if (!fontNameMatches) return fonts;

    for (const fm of fontNameMatches) {
        const parts    = fm.split(PDF_REGEX.common.whitespace);
        const fontName = parts[0].replace('/', '');
        const fontRef  = parts.slice(1).join(' ');
        const fontObj  = getObject(bytes, pdfString, fontRef);

        let toUnicodeRef;
        try {
            toUnicodeRef = extractValue(fontObj, '/ToUnicode');
        } catch {
            continue; // font has no ToUnicode CMap — skip
        }

        const cmapObjBytes = getObject(bytes, pdfString, toUnicodeRef, true);
        const cmapLen      = resolveLength(bytes, pdfString, cmapObjBytes);
        const cmapText     = decompressStream(cmapObjBytes, cmapLen);
        const parsedCMap   = parseCMap(cmapText);

        fonts[fontName] = {
            ref:     fontRef,
            cmapMap: parsedCMap,
            charMap: buildCharMap(parsedCMap)
        };
    }

    return fonts;
}
