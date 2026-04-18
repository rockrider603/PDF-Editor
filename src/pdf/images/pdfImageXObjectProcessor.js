const { getObject, resolveLength, extractValue, decompressStream } = require('../core/pdfObjectReader');
const { resolveDictOrRef } = require('../core/pdfDictionaryResolver');
const { buildXObjectNameMap, parsePaintOperations } = require('./pdfBackgroundExtractor');
const zlib = require('zlib');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

/**
 * Ensures we don't store the same image twice.
 */
function generateHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Logic to find Resources, checking Parent if not found on the Page.
 */
function getPageResources(buffer, pdfString, pageObjStr) {
    let resEntry = resolveDictOrRef(pageObjStr, '/Resources');

    if (!resEntry) {
        const parentMatch = pageObjStr.match(/\/Parent\s+(\d+\s+\d+\s+R)/);
        if (parentMatch) {
            const parentObj = getObject(buffer, pdfString, parentMatch[1]);
            resEntry = resolveDictOrRef(parentObj, '/Resources');
        }
    }
    return resEntry;
}

/**
 * Find XObject image references on a single page.
 */
function getImageObjectNumbers(buffer, pdfString, pageObjStr) {
    try {
        const resEntry = getPageResources(buffer, pdfString, pageObjStr);
        if (!resEntry) return [];

        const resObj = resEntry.type === 'ref'
            ? getObject(buffer, pdfString, resEntry.value)
            : resEntry.value;

        const xobjectEntry = resolveDictOrRef(resObj, '/XObject');
        if (!xobjectEntry) return [];

        const xobjectDict = xobjectEntry.type === 'ref'
            ? getObject(buffer, pdfString, xobjectEntry.value)
            : xobjectEntry.value;

        const objectNumbers = [];
        const xobjectMatches = xobjectDict.match(/\/([^\s/<>]+)\s*(\d+\s+\d+\s+R)/g) || [];

        for (const match of xobjectMatches) {
            const refMatch = match.match(/(\d+)\s+\d+\s+R/);
            if (refMatch) {
                const objNum = parseInt(refMatch[1]);
                const xobjectContent = getObject(buffer, pdfString, `${objNum} 0 R`);

                if (xobjectContent.includes('/Image')) {
                    objectNumbers.push(objNum);
                }
            }
        }
        return [...new Set(objectNumbers)];
    } catch (err) {
        console.error("Error finding image numbers:", err);
        return [];
    }
}

/**
 * Extract raw bytes and metadata for given object numbers.
 */
function extractAllImageData(buffer, pdfString, objectNumbers, appearancesMap = new Map()) {
    const results = [];
    for (const objNum of objectNumbers) {
        try {
            const ref = `${objNum} 0 R`;
            const objBuffer = getObject(buffer, pdfString, ref, true);
            const objStr = objBuffer.toString('binary');

            const metadata = extractImageMetadata(objStr);

            const streamIdx = objBuffer.indexOf('stream');
            if (streamIdx === -1) continue;

            let start = streamIdx + 6;
            if (objBuffer[start] === 0x0d) start += 2; // \r\n
            else if (objBuffer[start] === 0x0a) start += 1; // \n

            let length;
            try {
                length = resolveLength(buffer, pdfString, objBuffer);
            } catch (err) {
                // fallback to metadata length if resolveLength fails
                length = metadata.length || 0;
            }

            const streamData = objBuffer.slice(start, start + length);
            let finalBytes = streamData;
            let extension = '.jpg';
            let format = 'jpeg';

            if (metadata.filter === 'FlateDecode') {
                finalBytes = zlib.inflateSync(streamData);
                finalBytes = createBMP(finalBytes, metadata.width, metadata.height);
                extension = '.bmp';
                format = 'bmp';
            }

            const appearances = appearancesMap.get(objNum) || [];

            results.push({
                bytes: finalBytes,
                metadata,
                extension,
                format,
                objNum,
                role: 'image',
                appearances
            });
        } catch (err) {
            console.warn(`Failed object ${objNum}:`, err.message);
        }
    }
    return results;
}

/**
 * Scans the entire PDF for all page objects and finds all unique image references.
 */
function scanForImages(buffer, pdfString) {
    const pageMatches = pdfString.matchAll(/(\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Page[\s\S]*?endobj)/g);
    const allObjectIds = new Set();
    const appearancesMap = new Map();

    console.log("--- Starting Full PDF Image Scan ---");

    for (const match of pageMatches) {
        const pageContent = match[0];
        
        // Use the background extractor logic to map image names (e.g. /Im4 -> 4)
        const nameMap = buildXObjectNameMap(buffer, pdfString, pageContent);
        
        for (const objNum of nameMap.values()) {
            allObjectIds.add(objNum);
            if (!appearancesMap.has(objNum)) appearancesMap.set(objNum, []);
        }

        try {
            // Extract the decompressed stream of this specific page to find Do operations
            let contentsRef;
            try {
                contentsRef = extractValue(pageContent, '/Contents');
            } catch {
                continue; // Page has no contents
            }
            
            const contentsObjRaw = getObject(buffer, pdfString, contentsRef, true);
            const streamLength = resolveLength(buffer, pdfString, contentsObjRaw);
            const streamContent = decompressStream(contentsObjRaw, streamLength);
            
            const paintOps = parsePaintOperations(streamContent);
            for (const op of paintOps) {
                const objNum = nameMap.get(op.name);
                if (objNum !== undefined) {
                    appearancesMap.get(objNum).push({
                        x: op.matrix[4],
                        y: op.matrix[5],
                        renderedWidth: Math.abs(op.matrix[0]),
                        renderedHeight: Math.abs(op.matrix[3])
                    });
                }
            }
        } catch (err) {
            console.warn(`[Content Stream Parse Warning] Skipping appearances for a page: ${err.message}`);
        }
    }

    console.log(`Detected ${allObjectIds.size} unique image objects across all pages.`);
    return extractAllImageData(buffer, pdfString, Array.from(allObjectIds), appearancesMap);
}

/**
 * Helper: Metadata Parser
 */
function extractImageMetadata(str) {
    return {
        width: parseInt(str.match(/\/Width\s+(\d+)/)?.[1] || 0),
        height: parseInt(str.match(/\/Height\s+(\d+)/)?.[1] || 0),
        filter: str.match(/\/Filter\s*\/(\w+)/)?.[1] || 'None',
        length: parseInt(str.match(/\/Length\s+(\d+)/)?.[1] || 0)
    };
}

/**
 * Helper: BMP wrapper for raw pixels
 */
function createBMP(pixelData, width, height) {
    const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
    const fileSize = 54 + (rowSize * height);
    const buf = Buffer.alloc(fileSize);
    buf.write('BM', 0);
    buf.writeUInt32LE(fileSize, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(-height, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    // Note: This assumes standard RGB. Real PDF parsing requires 
    // checking ColorSpace for BGR/RGB swapping.
    pixelData.copy(buf, 54);
    return buf;
}

module.exports = {
    getImageObjectNumbers,
    extractAllImageData,
    scanForImages
};