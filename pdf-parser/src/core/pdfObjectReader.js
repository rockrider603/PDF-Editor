import { inflate } from 'pako';
import { PDF_REGEX } from '../utils/pdfRegex.js';
import { indexOfSeq, uint8ToBinaryString, asciiToBytes } from '../utils/bytes.js';
import { parseObjectStream } from './pdfXrefParser.js';

// ── Object Lookup ─────────────────────────────────────────────────────────────

/**
 * Cache for Object Streams to avoid decompressing the same ObjStm multiple times.
 * Key: objStmId (number), Value: Map<objId, string>
 */
const objStmCache = new Map();

/**
 * Locates and returns a PDF indirect object by its reference string.
 *
 * Uses the pre-built Cross-Reference (XRef) Map, which correctly handles
 * uncompressed (Type 1) and compressed (Type 2) objects.
 *
 * @param {Uint8Array}          bytes        - Full PDF file bytes.
 * @param {string}              pdfString    - Full PDF as a binary string (for regex).
 * @param {string}              ref          - Indirect reference, e.g. `"5 0 R"`.
 * @param {boolean}             [returnBytes=false] - If true, return a Uint8Array slice.
 * @param {Map<number, object>} [xrefMap]    - Optional XRef Map from buildXrefMap().
 * @returns {string | Uint8Array}
 */
export function getObject(bytes, pdfString, ref, returnBytes = false, xrefMap = null) {
    const parts = ref.trim().split(PDF_REGEX.common.whitespace);
    const id  = parseInt(parts[0], 10);
    const gen = parts[1]; // generation is usually 0

    let startIdx = -1;

    // ── Fast/Correct path: use the parsed XRef Map ──────────────────────────
    if (xrefMap && xrefMap.has(id)) {
        const entry = xrefMap.get(id);
        
        if (entry.type === 1) {
            // Type 1: Uncompressed object. field2 is the exact byte offset.
            startIdx = entry.field2;
        } else if (entry.type === 2) {
            // Type 2: Compressed object inside an Object Stream.
            const objStmId = entry.field2;
            
            // Fetch and decompress the Object Stream if not already cached
            if (!objStmCache.has(objStmId)) {
                // To get the ObjStm, we recursively call getObject for it.
                // ObjStms themselves are always Type 1 (uncompressed wrapper, compressed stream).
                if (!xrefMap.has(objStmId)) throw new Error(`ObjStm ${objStmId} not found in XRef`);
                const stmOffset = xrefMap.get(objStmId).field2;
                const parsedStm = parseObjectStream(bytes, pdfString, stmOffset);
                objStmCache.set(objStmId, parsedStm);
            }
            
            const stmMap = objStmCache.get(objStmId);
            if (!stmMap.has(id)) throw new Error(`Object ${id} not found in ObjStm ${objStmId}`);
            
            const objContent = stmMap.get(id);
            // Since it's from an ObjStm, it doesn't have "id gen obj ... endobj" wrappers.
            // We just return the content directly. returnBytes isn't supported for ObjStm content
            // because it's already decoded as a string (usually just dicts/arrays, not streams).
            return objContent;
        }
    } 
    
    // ── Fallback path ───────────────────────────────────────────────────────
    if (startIdx === -1) {
        const objHeaderRegex = PDF_REGEX.core.objectHeaderByIdGen(id, gen);
        const match = objHeaderRegex.exec(pdfString);
        if (!match) throw new Error(`Could not find object: ${ref}`);

        const matchedText = match[0];
        const trimmedOffset = matchedText.length - matchedText.trimStart().length;
        startIdx = match.index + trimmedOffset;
    }

    // From startIdx, find where this object ends
    const endIdx = pdfString.indexOf('endobj', startIdx) + 6;

    if (returnBytes) return bytes.subarray(startIdx, endIdx);
    return pdfString.substring(startIdx, endIdx);
}

// ── Dictionary Value Extraction ───────────────────────────────────────────────

export function extractValue(objStr, key) {
    const regex = PDF_REGEX.core.dictValueByKey(key);
    const match = objStr.match(regex);
    if (!match) throw new Error(`Key ${key} not found in dictionary`);
    return match[1].trim();
}

// ── Stream Length Resolution ──────────────────────────────────────────────────

export function resolveLength(bytes, pdfString, objBytes, xrefMap = null) {
    const objStr    = uint8ToBinaryString(objBytes);
    const lengthVal = extractValue(objStr, '/Length');

    if (lengthVal.includes('R')) {
        const lengthObj = getObject(bytes, pdfString, lengthVal, false, xrefMap);
        // lengthObj from an ObjStm will just be a number string like "45", not "3 0 obj 45 endobj"
        if (/^\d+$/.test(lengthObj.trim())) {
            return parseInt(lengthObj.trim());
        }
        
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

export function decompressStream(objBytes, length) {
    const streamKeyword = asciiToBytes('stream');
    const kwIdx         = indexOfSeq(objBytes, streamKeyword);
    const startIdx      = kwIdx + streamKeyword.length;
    const offset        = objBytes[startIdx] === 0x0d ? 2 : 1; // \r\n or \n
    const streamData    = objBytes.subarray(startIdx + offset, startIdx + offset + length);

    const objStr = uint8ToBinaryString(objBytes);
    if (objStr.includes('/FlateDecode')) {
        try {
            const decompressed = inflate(streamData);
            return new TextDecoder('utf-8').decode(decompressed);
        } catch (e) {
            return `[Decompression Failed: ${e.message}]`;
        }
    }
    return new TextDecoder('utf-8').decode(streamData);
}
