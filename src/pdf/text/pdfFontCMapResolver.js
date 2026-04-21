const { getObject, extractValue, resolveLength, decompressStream } = require('../core/pdfObjectReader');
const { resolveDictOrRef } = require('../core/pdfDictionaryResolver');
const { parseCMap, buildCharMap } = require('./pdfCMapParser');
const { PDF_REGEX } = require('../utils/pdfRegex');

function findFontAndCMap(buffer, pdfString, pageObjStr) {
    const resEntry = resolveDictOrRef(pageObjStr, '/Resources');
    if (!resEntry) throw new Error('No /Resources found in page object');

    const resObj = resEntry.type === 'ref'
        ? getObject(buffer, pdfString, resEntry.value)
        : resEntry.value;

    const fontEntry = resolveDictOrRef(resObj, '/Font');
    if (!fontEntry) throw new Error('No /Font found in resources');

    const fontDictObj = fontEntry.type === 'ref'
        ? getObject(buffer, pdfString, fontEntry.value)
        : fontEntry.value;

    const fonts = {};
    const fontNameMatch = fontDictObj.match(PDF_REGEX.text.fontNameRefEntries);
    if (fontNameMatch) {
        for (const fm of fontNameMatch) {
            const parts = fm.split(PDF_REGEX.common.whitespace);
            const fontName = parts[0].replace('/', '');
            const fontRef = parts.slice(1).join(' ');
            const fontObj = getObject(buffer, pdfString, fontRef);
            let toUnicodeRef;
            try {
                toUnicodeRef = extractValue(fontObj, '/ToUnicode');
            } catch {
                continue;
            }

            const cmapObj = getObject(buffer, pdfString, toUnicodeRef, true);
            const cmapLen = resolveLength(buffer, pdfString, cmapObj);
            const cmapText = decompressStream(cmapObj, cmapLen);
            const parsedCMap = parseCMap(cmapText);

            fonts[fontName] = {
                ref: fontRef,
                cmapMap: parsedCMap,
                charMap: buildCharMap(parsedCMap)
            };
        }
    }
    return fonts;
}

module.exports = {
    findFontAndCMap
};
