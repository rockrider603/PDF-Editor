import { inflate } from 'pako';
import { PDF_REGEX } from '../utils/pdfRegex.js';
import { indexOfSeq, uint8ToBinaryString, asciiToBytes } from '../utils/bytes.js';

// ── Object Lookup ─────────────────────────────────────────────────────────────

/**
 * Locates and returns a PDF indirect object by its reference string.
 *
 * Ported from pdf/core/pdfObjectReader.js.
 * Node.js API changes:
 *   - `buffer: Buffer`  → `bytes: Uint8Array`
 *   - `buffer.slice()`  → `bytes.subarray()`
 *
 * @param {Uint8Array} bytes        - Full PDF file bytes.
 * @param {string}     pdfString    - Full PDF as a binary string (for regex).
 * @param {string}     ref          - Indirect reference, e.g. `"5 0 R"`.
 * @param {boolean}    [returnBytes=false] - If true, return a Uint8Array slice
 *   instead of a decoded string. Use this when the object contains a stream.
 * @returns {string | Uint8Array}
 */
export function getObject(bytes, pdfString, ref, returnBytes = false) {
    const [id, gen] = ref.split(PDF_REGEX.common.whitespace);
    const objHeaderRegex = PDF_REGEX.core.objectHeaderByIdGen(id, gen);
    const match = objHeaderRegex.exec(pdfString);
    if (!match) throw new Error(`Could not find object: ${ref}`);

    const startIdx = match.index + (match[0].length - `${id} ${gen} obj`.length);
    const endIdx   = pdfString.indexOf('endobj', startIdx) + 6;

    if (returnBytes) return bytes.subarray(startIdx, endIdx);
    return pdfString.substring(startIdx, endIdx);
}

// ── Dictionary Value Extraction ───────────────────────────────────────────────

/**
 * Extracts the raw string value of a dictionary key from a PDF object string.
 *
 * @param {string} objStr - String of the PDF object.
 * @param {string} key    - Dictionary key, e.g. `'/Length'`.
 * @returns {string} Trimmed value string.
 * @throws {Error} If the key is not found.
 */
export function extractValue(objStr, key) {
    const regex = PDF_REGEX.core.dictValueByKey(key);
    const match = objStr.match(regex);
    if (!match) throw new Error(`Key ${key} not found in dictionary`);
    return match[1].trim();
}

// ── Stream Length Resolution ──────────────────────────────────────────────────

/**
 * Resolves the `/Length` of a stream object, following indirect references
 * when necessary.
 *
 * @param {Uint8Array} bytes     - Full PDF file bytes.
 * @param {string}     pdfString - Full PDF as a binary string.
 * @param {Uint8Array} objBytes  - Bytes of the object containing the stream.
 * @returns {number}
 */
export function resolveLength(bytes, pdfString, objBytes) {
    const objStr   = uint8ToBinaryString(objBytes);
    const lengthVal = extractValue(objStr, '/Length');

    if (lengthVal.includes('R')) {
        const lengthObj = getObject(bytes, pdfString, lengthVal);
        const numMatch  = lengthObj.match(PDF_REGEX.core.indirectLengthObject);
        if (!numMatch) {
            const directNum = lengthObj.match(PDF_REGEX.core.directNumericLine);
            if (directNum) return parseInt(directNum[1]);
            throw new Error('Could not parse indirect length value');
        }
        return parseInt(numMatch[1]);
    }
    return parseInt(lengthVal);
}

// ── Stream Decompression ──────────────────────────────────────────────────────

/**
 * Extracts and decompresses the stream data from a PDF object's byte slice.
 *
 * Ported from pdf/core/pdfObjectReader.js.
 * Node.js API changes:
 *   - `Buffer.from('stream')` → `asciiToBytes('stream')`
 *   - `objBuffer.indexOf(keyword)` → `indexOfSeq(objBytes, keyword)`
 *   - `zlib.inflateSync(data)` → `pako.inflate(data)` (same signature)
 *   - Returns `string` (UTF-8 decoded) in both code paths.
 *
 * @param {Uint8Array} objBytes - Byte slice of the full PDF object (incl. `obj…endobj`).
 * @param {number}     length   - Byte length of the compressed stream data.
 * @returns {string}  Decompressed content as a UTF-8 string.
 */
export function decompressStream(objBytes, length) {
    const streamKeyword = asciiToBytes('stream');
    const kwIdx         = indexOfSeq(objBytes, streamKeyword);
    const startIdx      = kwIdx + streamKeyword.length;
    const offset        = objBytes[startIdx] === 0x0d ? 2 : 1; // \r\n or \n
    const streamData    = objBytes.subarray(startIdx + offset, startIdx + offset + length);

    const objStr = uint8ToBinaryString(objBytes);
    if (objStr.includes('/FlateDecode')) {
        try {
            // pako.inflate returns Uint8Array — decode as UTF-8
            const decompressed = inflate(streamData);
            return new TextDecoder('utf-8').decode(decompressed);
        } catch (e) {
            return `[Decompression Failed: ${e.message}]`;
        }
    }
    return new TextDecoder('utf-8').decode(streamData);
}
