import { PDF_REGEX } from '../utils/pdfRegex.js';

// ── CMap Parsing ──────────────────────────────────────────────────────────────

/**
 * Parses a ToUnicode CMap stream and returns a map of glyph code → Unicode hex.
 *
 * Handles both `beginbfchar` / `endbfchar` (single char mappings) and
 * `beginbfrange` / `endbfrange` (range mappings).
 *
 * @param {string} cmapText - Decompressed CMap stream content.
 * @returns {Record<string, string>} Map of glyph hex code → Unicode hex string.
 */
export function parseCMap(cmapText) {
    const map = {};
    const lines = cmapText.split('\n');
    let inSection = null;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === 'beginbfchar' || trimmed.endsWith('beginbfchar')) {
            inSection = 'bfchar'; continue;
        } else if (trimmed === 'endbfchar' || trimmed.endsWith('endbfchar')) {
            inSection = null; continue;
        } else if (trimmed === 'beginbfrange' || trimmed.endsWith('beginbfrange')) {
            inSection = 'bfrange'; continue;
        } else if (trimmed === 'endbfrange' || trimmed.endsWith('endbfrange')) {
            inSection = null; continue;
        }

        if (inSection === 'bfchar') {
            const charMatch = trimmed.match(PDF_REGEX.text.bfchar);
            if (charMatch) {
                map[charMatch[1].toUpperCase()] = charMatch[2];
            }
        } else if (inSection === 'bfrange') {
            const rangeMatch = trimmed.match(PDF_REGEX.text.bfrange);
            if (rangeMatch) {
                const srcWidth = rangeMatch[1].length;
                let startSrc = parseInt(rangeMatch[1], 16);
                const endSrc = parseInt(rangeMatch[2], 16);
                let startUni = parseInt(rangeMatch[3], 16);

                while (startSrc <= endSrc) {
                    const srcHex = startSrc.toString(16).toUpperCase().padStart(srcWidth, '0');
                    const uniHex = startUni.toString(16).toUpperCase().padStart(4, '0');
                    map[srcHex] = uniHex;
                    startSrc++;
                    startUni++;
                }
            } else {
                // Handle range mapped to array: <srcCode1> <srcCode2> [ <dstString1> <dstString2> ... ]
                // e.g. <123E> <123F> [ <005B> <005D> ]
                const arrayRangeMatch = trimmed.match(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+\[\s*([^\]]+)\s*\]/);
                if (arrayRangeMatch) {
                    const srcWidth = arrayRangeMatch[1].length;
                    const startSrc = parseInt(arrayRangeMatch[1], 16);
                    const endSrc = parseInt(arrayRangeMatch[2], 16);
                    
                    const destHexes = [];
                    const hexRegex = /<([0-9A-Fa-f]+)>/g;
                    let match;
                    while ((match = hexRegex.exec(arrayRangeMatch[3])) !== null) {
                        destHexes.push(match[1]);
                    }
                    
                    for (let i = 0; startSrc + i <= endSrc && i < destHexes.length; i++) {
                        const curSrc = startSrc + i;
                        const srcHex = curSrc.toString(16).toUpperCase().padStart(srcWidth, '0');
                        const uniHex = destHexes[i].toUpperCase();
                        map[srcHex] = uniHex;
                    }
                }
            }
        }
    }
    return map;
}

// ── Unicode Decoding ──────────────────────────────────────────────────────────

/**
 * Converts a Unicode hex string (e.g. `"0041"`) to its character(s).
 *
 * @param {string} unicodeHex
 * @returns {string}
 */
export function decodeUnicodeHex(unicodeHex) {
    const normalized = (unicodeHex || '').toUpperCase();
    if (!normalized || normalized.length % 4 !== 0) return '';

    let out = '';
    for (let i = 0; i < normalized.length; i += 4) {
        out += String.fromCharCode(parseInt(normalized.slice(i, i + 4), 16));
    }
    return out;
}

/**
 * Builds a pre-decoded character map from a raw CMap map.
 * Values are ready-to-use Unicode characters rather than hex strings.
 *
 * @param {Record<string, string>} cmapMap
 * @returns {Record<string, string>}
 */
export function buildCharMap(cmapMap) {
    const charMap = {};
    for (const [glyphId, unicodeHex] of Object.entries(cmapMap)) {
        charMap[glyphId.toUpperCase()] = decodeUnicodeHex(unicodeHex);
    }
    return charMap;
}

// ── Text Translation ──────────────────────────────────────────────────────────

/**
 * Returns all unique code lengths present in a CMap map, sorted descending.
 * Used to determine the correct glyph code width during translation.
 *
 * @param {Record<string, string>} cmapMap
 * @returns {number[]}
 */
export function getCMapCodeLengths(cmapMap) {
    const lengths = new Set(Object.keys(cmapMap).map(k => k.length));
    return Array.from(lengths).sort((a, b) => b - a);
}

/**
 * Translates a hex-encoded glyph string to Unicode text using the provided CMap.
 *
 * Tries all known code lengths in descending order for each position in the
 * hex string, falling back to `[?XX]` when no mapping is found.
 *
 * @param {Record<string, string>} cmapMap - Raw CMap from `parseCMap`.
 * @param {string} hexString              - Hex string like `<004100420043>`.
 * @returns {string}
 */
export function translateText(cmapMap, hexString) {
    let result = '';
    const cleaned = hexString.replace(PDF_REGEX.text.cleanedHexBrackets, '').toUpperCase();
    
    // Fallback if no CMap is defined: decode hex pairs directly as ASCII/Latin-1
    if (!cmapMap || Object.keys(cmapMap).length === 0) {
        let idx = 0;
        while (idx < cleaned.length) {
            const code = cleaned.slice(idx, idx + 2);
            if (code.length === 2) {
                result += String.fromCharCode(parseInt(code, 16));
            }
            idx += 2;
        }
        return result;
    }

    const codeLengths  = getCMapCodeLengths(cmapMap);
    const fallbackLength = codeLengths.length ? codeLengths[codeLengths.length - 1] : 2;

    let idx = 0;
    while (idx < cleaned.length) {
        let matched = false;

        for (const len of codeLengths) {
            if (idx + len > cleaned.length) continue;
            const code = cleaned.slice(idx, idx + len);
            if (cmapMap[code]) {
                result += decodeUnicodeHex(cmapMap[code]);
                idx += len;
                matched = true;
                break;
            }
        }

        if (!matched) {
            result += `[?${cleaned.slice(idx, idx + fallbackLength)}]`;
            idx += fallbackLength;
        }
    }
    return result;
}
