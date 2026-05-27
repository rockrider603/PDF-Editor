import { inflate } from 'pako';
import { uint8ToBinaryString } from '../utils/bytes.js';
import { getObject, extractValue } from './pdfObjectReader.js';

// ── XRef Parsing ──────────────────────────────────────────────────────────────

/**
 * Reads a modern Cross-Reference (XRef) Stream.
 */
function parseXrefStream(bytes, pdfString, offset) {
    const xrefMap = new Map();
    
    // Find the object header
    const objHeaderRegex = /^(\d+)\s+(\d+)\s+obj/;
    const headerStr = pdfString.substring(offset, offset + 100);
    const headerMatch = headerStr.match(objHeaderRegex);
    if (!headerMatch) return xrefMap;
    
    // Extract dictionary
    const dictStart = pdfString.indexOf('<<', offset);
    let dictEnd = dictStart;
    let depth = 0;
    for (let i = dictStart; i < pdfString.length - 1; i++) {
        if (pdfString[i] === '<' && pdfString[i+1] === '<') { depth++; i++; }
        else if (pdfString[i] === '>' && pdfString[i+1] === '>') { 
            depth--; i++; 
            if (depth === 0) { dictEnd = i + 1; break; }
        }
    }
    
    const dictStr = pdfString.substring(dictStart, dictEnd);
    
    // Parse /W array
    const wMatch = dictStr.match(/\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    if (!wMatch) return xrefMap;
    const W = [parseInt(wMatch[1]), parseInt(wMatch[2]), parseInt(wMatch[3])];
    const rowLength = W[0] + W[1] + W[2];
    
    // Parse /Size
    const sizeMatch = dictStr.match(/\/Size\s+(\d+)/);
    const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
    
    // Parse /Index (default is [0 Size])
    let indices = [0, size];
    const indexMatch = dictStr.match(/\/Index\s*\[([^\]]+)\]/);
    if (indexMatch) {
        indices = indexMatch[1].trim().split(/\s+/).map(Number);
    }
    
    // Extract stream
    const streamStartKeyword = pdfString.indexOf('stream', dictEnd);
    if (streamStartKeyword === -1) return xrefMap;
    const streamStart = streamStartKeyword + 6 + (bytes[streamStartKeyword + 6] === 0x0d ? 2 : 1);
    const streamEnd = pdfString.indexOf('endstream', streamStart);
    const streamBytes = bytes.subarray(streamStart, streamEnd);
    
    // Decompress
    let decompressed;
    try {
        decompressed = inflate(streamBytes);
    } catch (e) {
        console.warn("XRef Decompression failed:", e);
        return xrefMap;
    }
    
    // Apply PNG UP Predictor (Predictor 12)
    // Note: Predictor values are in /DecodeParms. We assume PNG UP if /Columns is present.
    let isPredictor = dictStr.includes('/Predictor');
    let columns = rowLength;
    const colMatch = dictStr.match(/\/Columns\s+(\d+)/);
    if (colMatch) columns = parseInt(colMatch[1]);
    
    let decodedBytes = decompressed;
    if (isPredictor) {
        const decodedLen = decompressed.length - (decompressed.length / (columns + 1));
        decodedBytes = new Uint8Array(decodedLen);
        let dIdx = 0;
        let prevRow = new Uint8Array(columns);
        
        for (let i = 0; i < decompressed.length; i += (columns + 1)) {
            const filter = decompressed[i];
            const rowData = decompressed.subarray(i + 1, i + 1 + columns);
            for (let c = 0; c < columns; c++) {
                let val = rowData[c];
                if (filter === 2) val = (val + prevRow[c]) & 0xFF; // UP
                decodedBytes[dIdx++] = val;
                prevRow[c] = val;
            }
        }
    }
    
    // Parse the bytes into xrefMap
    let byteIdx = 0;
    for (let i = 0; i < indices.length; i += 2) {
        const startObj = indices[i];
        const count = indices[i+1];
        
        for (let objId = startObj; objId < startObj + count; objId++) {
            if (byteIdx >= decodedBytes.length) break;
            
            let type = W[0] === 0 ? 1 : decodedBytes[byteIdx];
            byteIdx += W[0];
            
            let field2 = 0;
            for (let b = 0; b < W[1]; b++) {
                field2 = (field2 << 8) | decodedBytes[byteIdx++];
            }
            
            let field3 = 0;
            for (let b = 0; b < W[2]; b++) {
                field3 = (field3 << 8) | decodedBytes[byteIdx++];
            }
            
            xrefMap.set(objId, { type, field2, field3 });
        }
    }
    
    return xrefMap;
}

/**
 * Parses traditional cross-reference tables.
 */
function parseTraditionalXref(pdfString, offset) {
    const xrefMap = new Map();
    const endIdx = pdfString.indexOf('trailer', offset);
    if (endIdx === -1) return xrefMap;
    
    const lines = pdfString.substring(offset, endIdx).split(/\r?\n/);
    let currentObj = 0;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'xref') continue;
        
        const sectionMatch = trimmed.match(/^(\d+)\s+(\d+)$/);
        if (sectionMatch) {
            currentObj = parseInt(sectionMatch[1]);
            continue;
        }
        
        const entryMatch = trimmed.match(/^(\d{10})\s+(\d{5})\s+([fn])$/);
        if (entryMatch) {
            const offset = parseInt(entryMatch[1], 10);
            const gen = parseInt(entryMatch[2], 10);
            const isFree = entryMatch[3] === 'f';
            
            if (!isFree) {
                xrefMap.set(currentObj, { type: 1, field2: offset, field3: gen });
            }
            currentObj++;
        }
    }
    return xrefMap;
}

/**
 * Finds the starting offset of the cross-reference table.
 */
function findStartXref(pdfString) {
    const startxrefIdx = pdfString.lastIndexOf('startxref');
    if (startxrefIdx === -1) return -1;
    const match = pdfString.substring(startxrefIdx).match(/startxref\s+(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
}

/**
 * Fallback: Scans the entire file to find byte offsets of all "N G obj" headers.
 * Used when a PDF has no valid trailer or xref table.
 */
function buildOffsetIndexFallback(bytes) {
    const fallbackMap = new Map();
    const len = bytes.length;
    const CR=0x0D, LF=0x0A, SP=0x20, TAB=0x09, O=0x6F, B=0x62, J=0x6A;
    const isDigit = b => b >= 0x30 && b <= 0x39;
    const isWS    = b => b === SP || b === LF || b === CR || b === TAB || b === 0x0C || b === 0x00;

    let i = 0;
    while (i < len) {
        const prevByte = i === 0 ? LF : bytes[i - 1];
        if (prevByte !== LF && prevByte !== CR) { i++; continue; }

        let pos = i;
        while (pos < len && (bytes[pos] === SP || bytes[pos] === TAB)) pos++;

        if (!isDigit(bytes[pos])) { i++; continue; }
        const numStart = pos;
        while (pos < len && isDigit(bytes[pos])) pos++;
        const numStr = String.fromCharCode(...bytes.subarray(numStart, pos));

        if (pos >= len || bytes[pos] !== SP) { i++; continue; }
        pos++;

        if (!isDigit(bytes[pos])) { i++; continue; }
        const genStart = pos;
        while (pos < len && isDigit(bytes[pos])) pos++;
        const genStr = String.fromCharCode(...bytes.subarray(genStart, pos));

        if (pos >= len || bytes[pos] !== SP) { i++; continue; }
        pos++;

        if (pos + 2 >= len || bytes[pos] !== O || bytes[pos+1] !== B || bytes[pos+2] !== J) { i++; continue; }
        pos += 3;

        if (pos < len && !isWS(bytes[pos])) { i++; continue; }

        fallbackMap.set(parseInt(numStr, 10), { type: 1, field2: numStart, field3: parseInt(genStr, 10) });
        i = pos;
    }
    return fallbackMap;
}

/**
 * Builds the complete Cross-Reference Map for a PDF.
 * Returns Map: ObjID -> { type, field2, field3 }
 */
export function buildXrefMap(bytes) {
    const pdfString = uint8ToBinaryString(bytes);
    let offset = findStartXref(pdfString);
    const fullMap = new Map();
    
    // Follow /Prev links up to 10 times to prevent infinite loops
    let attempts = 0;
    while (offset !== -1 && attempts < 10) {
        attempts++;
        const token = pdfString.substring(offset, offset + 20).trim();
        let currentMap;
        let dictStr = "";
        
        if (token.startsWith('xref')) {
            currentMap = parseTraditionalXref(pdfString, offset);
            const trailerIdx = pdfString.indexOf('trailer', offset);
            if (trailerIdx !== -1) {
                const endTrailer = pdfString.indexOf('>>', trailerIdx) + 2;
                dictStr = pdfString.substring(trailerIdx, endTrailer);
            }
        } else {
            currentMap = parseXrefStream(bytes, pdfString, offset);
            // Extract the stream dictionary for /Prev
            const dictStart = pdfString.indexOf('<<', offset);
            if (dictStart !== -1) {
                let depth = 0, dictEnd = dictStart;
                for (let i = dictStart; i < pdfString.length - 1; i++) {
                    if (pdfString[i] === '<' && pdfString[i+1] === '<') { depth++; i++; }
                    else if (pdfString[i] === '>' && pdfString[i+1] === '>') { 
                        depth--; i++; 
                        if (depth === 0) { dictEnd = i + 1; break; }
                    }
                }
                dictStr = pdfString.substring(dictStart, dictEnd);
            }
        }
        
        // Merge without overwriting newer entries
        for (const [key, val] of currentMap) {
            if (!fullMap.has(key)) fullMap.set(key, val);
        }
        
        // Look for previous xref table
        const prevMatch = dictStr.match(/\/Prev\s+(\d+)/);
        offset = prevMatch ? parseInt(prevMatch[1], 10) : -1;
    }
    
    // Fallback: If no xref found, scan the whole file for object headers
    if (fullMap.size === 0) {
        console.warn("[pdfXrefParser] No xref table found. Falling back to full file byte scan.");
        return buildOffsetIndexFallback(bytes);
    }
    
    return fullMap;
}

// ── Object Stream (ObjStm) Parsing ────────────────────────────────────────────

/**
 * Decompresses an Object Stream and builds a map of the objects inside it.
 * @returns {Map<number, string>} Map of objId -> object content string
 */
export function parseObjectStream(bytes, pdfString, objStmOffset) {
    const objMap = new Map();
    
    // Extract stream
    const dictStart = pdfString.indexOf('<<', objStmOffset);
    let depth = 0, dictEnd = dictStart;
    for (let i = dictStart; i < pdfString.length - 1; i++) {
        if (pdfString[i] === '<' && pdfString[i+1] === '<') { depth++; i++; }
        else if (pdfString[i] === '>' && pdfString[i+1] === '>') { 
            depth--; i++; 
            if (depth === 0) { dictEnd = i + 1; break; }
        }
    }
    const dictStr = pdfString.substring(dictStart, dictEnd);
    
    const streamStartKeyword = pdfString.indexOf('stream', dictEnd);
    if (streamStartKeyword === -1) return objMap;
    const streamStart = streamStartKeyword + 6 + (bytes[streamStartKeyword + 6] === 0x0d ? 2 : 1);
    const streamEnd = pdfString.indexOf('endstream', streamStart);
    const streamBytes = bytes.subarray(streamStart, streamEnd);
    
    // Decompress
    let decompressedStr = "";
    if (dictStr.includes('/FlateDecode')) {
        try {
            const decomp = inflate(streamBytes);
            decompressedStr = new TextDecoder('utf-8').decode(decomp);
        } catch (e) {
            console.warn("ObjStm Decompression failed:", e);
            return objMap;
        }
    } else {
        decompressedStr = uint8ToBinaryString(streamBytes);
    }
    
    // Parse /N (number of objects) and /First (byte offset to first object)
    const nMatch = dictStr.match(/\/N\s+(\d+)/);
    const firstMatch = dictStr.match(/\/First\s+(\d+)/);
    if (!nMatch || !firstMatch) return objMap;
    
    const N = parseInt(nMatch[1]);
    const First = parseInt(firstMatch[1]);
    
    // Parse the N pairs of (objNum, offset)
    const headerStr = decompressedStr.substring(0, First);
    const tokens = headerStr.trim().split(/\s+/).map(Number);
    
    for (let i = 0; i < N; i++) {
        const objId = tokens[i * 2];
        const objOffset = tokens[i * 2 + 1] + First;
        
        // Find the end of this object (either the start of the next, or EOF)
        let nextOffset = decompressedStr.length;
        if (i < N - 1) {
            nextOffset = tokens[(i + 1) * 2 + 1] + First;
        }
        
        const objContent = decompressedStr.substring(objOffset, nextOffset).trim();
        objMap.set(objId, objContent);
    }
    
    return objMap;
}
