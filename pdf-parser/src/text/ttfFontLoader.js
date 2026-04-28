import opentype from 'opentype.js';

/**
 * Loads a TTF file from an ArrayBuffer using opentype.js
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {opentype.Font}
 */
export function parseTTF(arrayBuffer) {
    return opentype.parse(arrayBuffer);
}

/**
 * Finds characters in the text that are not present in the given encoding map.
 * @param {string} text 
 * @param {Map<string, any>} existingEncodingMap 
 * @returns {string[]} Array of missing characters
 */
export function getMissingCharacters(text, existingEncodingMap) {
    const missing = new Set();
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (!existingEncodingMap.has(char)) {
            missing.add(char);
        }
    }
    return Array.from(missing);
}

/**
 * Generates width data for the specified characters using the TTF font.
 * The widths are scaled to a 1000-unit em square (standard for PDF /Widths).
 * @param {opentype.Font} font 
 * @param {string[]} chars 
 * @returns {Record<string, number>}
 */
export function generateCharacterWidths(font, chars) {
    const widths = {};
    const unitsPerEm = font.unitsPerEm;

    chars.forEach(char => {
        const glyph = font.charToGlyph(char);
        const pdfWidth = (glyph.advanceWidth / unitsPerEm) * 1000;
        widths[char] = Math.round(pdfWidth);
    });

    return widths;
}
