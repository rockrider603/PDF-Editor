/**
 * Uint8Array utility helpers — browser equivalents for Node.js Buffer methods.
 *
 * All functions in this module operate on plain Uint8Arrays so they work
 * identically in browsers and Web Workers without any polyfill.
 */

// ── String Conversion ─────────────────────────────────────────────────────────

/**
 * Converts a Uint8Array to a binary string (one char per byte, char code = byte value).
 * This is the browser equivalent of `buffer.toString('binary')`.
 *
 * Uses TextDecoder with 'windows-1252' (latin-1) for performance on large files.
 * Falls back to a manual loop if TextDecoder is unavailable.
 *
 * @param {Uint8Array} u8
 * @returns {string}
 */
export function uint8ToBinaryString(u8) {
    try {
        return new TextDecoder('windows-1252').decode(u8);
    } catch {
        let s = '';
        for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
        return s;
    }
}

// ── Byte Search ───────────────────────────────────────────────────────────────

/**
 * Returns the index of the first occurrence of `needle` inside `haystack`,
 * starting at `fromIndex`. Returns -1 if not found.
 *
 * Browser equivalent of `Buffer.prototype.indexOf` for byte sequences.
 *
 * @param {Uint8Array} haystack
 * @param {Uint8Array} needle
 * @param {number}     [fromIndex=0]
 * @returns {number}
 */
export function indexOfSeq(haystack, needle, fromIndex = 0) {
    const hLen = haystack.length;
    const nLen = needle.length;
    if (nLen === 0) return fromIndex;
    outer: for (let i = fromIndex; i <= hLen - nLen; i++) {
        for (let j = 0; j < nLen; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

// ── Allocation ────────────────────────────────────────────────────────────────

/**
 * Allocates a zeroed Uint8Array of `n` bytes.
 * Browser equivalent of `Buffer.alloc(n)`.
 *
 * @param {number} n
 * @returns {Uint8Array}
 */
export function allocBytes(n) {
    return new Uint8Array(n);
}

// ── Encoding ──────────────────────────────────────────────────────────────────

/**
 * Encodes a plain ASCII string to a Uint8Array.
 * Browser equivalent of `Buffer.from(str)` for ASCII/latin-1 strings.
 *
 * @param {string} str
 * @returns {Uint8Array}
 */
export function asciiToBytes(str) {
    return new TextEncoder().encode(str);
}
