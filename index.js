const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function getObject(buffer, pdfString, ref, returnBuffer = false) {
    const [id, gen] = ref.split(/\s+/);
    const objHeaderRegex = new RegExp(`(?:^|[\\r\\n\\s])${id}\\s+${gen}\\s+obj`, 'g');
    const match = objHeaderRegex.exec(pdfString);
    if (!match) throw new Error(`Could not find object: ${ref}`);
    const startIdx = match.index + (match[0].length - `${id} ${gen} obj`.length);
    const endIdx = pdfString.indexOf('endobj', startIdx) + 6;
    if (returnBuffer) return buffer.slice(startIdx, endIdx);
    return pdfString.substring(startIdx, endIdx);
}

function findRootRef(data) {
    const trailerIdx = data.lastIndexOf('trailer');
    if (trailerIdx === -1) throw new Error("Trailer section not found");
    const trailerChunk = data.substring(trailerIdx, data.indexOf('>>', trailerIdx) + 2);
    const match = trailerChunk.match(/\/Root\s+(\d+\s+\d+\s+R)/);
    if (!match) throw new Error("Root reference not found in trailer");
    return match[1];
}

function extractFirstKid(pagesObjStr, refId) {
    const kidsMatch = pagesObjStr.match(/\/Kids\s*\[\s*([^\]]+)\]/s);
    if (!kidsMatch) throw new Error(`Failed to find /Kids array in Pages object ${refId}`);
    const refs = kidsMatch[1].trim().split(/\s+/);
    return `${refs[0]} ${refs[1]} ${refs[2]}`;
}

function extractValue(objStr, key) {
    const regex = new RegExp(`${key}\\s*([\\d\\s+R]+|/[\\w]+|\\d+)`);
    const match = objStr.match(regex);
    if (!match) throw new Error(`Key ${key} not found in dictionary`);
    return match[1].trim();
}

function resolveLength(buffer, pdfString, objBuffer) {
    const objStr = objBuffer.toString('binary');
    const lengthVal = extractValue(objStr, '/Length');
    
    if (lengthVal.includes('R')) {
        const lengthObj = getObject(buffer, pdfString, lengthVal);
        const numMatch = lengthObj.match(/obj\s+(\d+)\s+endobj/s);
        if (!numMatch) {
            const directNum = lengthObj.match(/^(\d+)$/m);
            if (directNum) return parseInt(directNum[1]);
            throw new Error("Could not parse indirect length value");
        }
        return parseInt(numMatch[1]);
    }
    return parseInt(lengthVal);
}

function decompressStream(objBuffer, length) {
    const streamKeyword = Buffer.from('stream');
    const startIdx = objBuffer.indexOf(streamKeyword) + streamKeyword.length;
    const offset = (objBuffer[startIdx] === 0x0D) ? 2 : 1;
    const streamData = objBuffer.slice(startIdx + offset, startIdx + offset + length);
    if (objBuffer.toString().includes('/FlateDecode')) {
        try {
            return zlib.inflateSync(streamData).toString('utf-8');
        } catch (e) {
            return `[Decompression Failed: ${e.message}]`;
        }
    }
    return streamData.toString('utf-8');
}

function parseCMap(cmapText) {
    const map = {};
    const lines = cmapText.split('\n');
    let inSection = null;
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed === 'beginbfchar' || trimmed.endsWith('beginbfchar')) {
            inSection = 'bfchar';
            continue;
        } else if (trimmed === 'endbfchar' || trimmed.endsWith('endbfchar')) {
            inSection = null;
            continue;
        } else if (trimmed === 'beginbfrange' || trimmed.endsWith('beginbfrange')) {
            inSection = 'bfrange';
            continue;
        } else if (trimmed === 'endbfrange' || trimmed.endsWith('endbfrange')) {
            inSection = null;
            continue;
        }
        
        if (inSection === 'bfchar') {
            const charMatch = trimmed.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
            if (charMatch) {
                const srcCode = charMatch[1].toUpperCase();
                const unicodeHex = charMatch[2];
                map[srcCode] = unicodeHex;
            }
        } else if (inSection === 'bfrange') {
            const rangeMatch = trimmed.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
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
            }
        }
    }
    return map;
}

function buildCharMap(cmapMap) {
    const charMap = {};
    for (const [glyphId, unicodeHex] of Object.entries(cmapMap)) {
        const padded = glyphId.toUpperCase();
        const char = String.fromCharCode(parseInt(unicodeHex, 16));
        charMap[padded] = char;
    }
    return charMap;
}

function getCMapCodeLengths(cmapMap) {
    const lengths = new Set();
    for (const key of Object.keys(cmapMap)) {
        lengths.add(key.length);
    }
    return Array.from(lengths).sort((a, b) => b - a);
}

function findFontAndCMap(buffer, pdfString, pageObjStr) {
    const resMatch = pageObjStr.match(/\/Resources\s+(\d+\s+\d+\s+R)/);
    if (!resMatch) throw new Error("No /Resources found in page object");
    
    const resRef = resMatch[1];
    const resObj = getObject(buffer, pdfString, resRef);
    
    const fontMatch = resObj.match(/\/Font\s+(\d+\s+\d+\s+R)/);
    if (!fontMatch) throw new Error("No /Font found in resources");
    
    const fontDictRef = fontMatch[1];
    const fontDictObj = getObject(buffer, pdfString, fontDictRef);
    
    const fonts = {};
    const fontNameMatch = fontDictObj.match(/\/(\w+)\s+(\d+\s+\d+\s+R)/g);
    if (fontNameMatch) {
        for (const fm of fontNameMatch) {
            const parts = fm.split(/\s+/);
            const fontName = parts[0].replace('/', '');
            const fontRef = parts.slice(1).join(' ');
            const fontObj = getObject(buffer, pdfString, fontRef);
            const toUnicodeRef = extractValue(fontObj, '/ToUnicode');
            
            const cmapObj = getObject(buffer, pdfString, toUnicodeRef, true);
            const cmapLen = resolveLength(buffer, pdfString, cmapObj);
            const cmapText = decompressStream(cmapObj, cmapLen);
            
            fonts[fontName] = {
                ref: fontRef,
                cmapMap: parseCMap(cmapText),
                charMap: buildCharMap(parseCMap(cmapText))
            };
        }
    }
    return fonts;
}

function translateText(cmapMap, hexString) {
    let result = '';
    const cleaned = hexString.replace(/[<>]/g, '').toUpperCase();
    const codeLengths = getCMapCodeLengths(cmapMap);
    const fallbackLength = codeLengths.length ? codeLengths[codeLengths.length - 1] : 2;

    let idx = 0;
    while (idx < cleaned.length) {
        let matched = false;

        for (const len of codeLengths) {
            if (idx + len > cleaned.length) continue;
            const code = cleaned.slice(idx, idx + len);
            if (cmapMap[code]) {
                result += String.fromCodePoint(parseInt(cmapMap[code], 16));
                idx += len;
                matched = true;
                break;
            }
        }

        if (!matched) {
            const next = cleaned.slice(idx, idx + fallbackLength);
            result += `[?${next}]`;
            idx += fallbackLength;
        }
    }
    return result;
}

function processContentStream(decompressed, fonts) {
    const lines = decompressed.split('\n');
    let currentFont = null;
    const finalLines = [];
    
    for (const line of lines) {
        const fontMatch = line.match(/\/F(\d+)\s+(\d+)\s+Tf/);
        if (fontMatch) {
            currentFont = 'F' + fontMatch[1];
        }
        
        const tjArrayMatch = line.match(/\[(.*?)\]\s*TJ/);
        if (tjArrayMatch && currentFont && fonts[currentFont]) {
            const hexParts = tjArrayMatch[1].match(/<([0-9A-Fa-f]+)>/g) || [];
            let combined = '';

            for (const hex of hexParts) {
                const translated = translateText(fonts[currentFont].cmapMap, hex);
                combined += translated;
                console.log(`Font ${currentFont}: ${hex} -> "${translated}"`);
            }

            if (combined) {
                finalLines.push(combined);
            }
            continue;
        }

        const tjSingleMatch = line.match(/(<[0-9A-Fa-f]+>)\s*Tj/);
        if (tjSingleMatch && currentFont && fonts[currentFont]) {
            const hex = tjSingleMatch[1];
            const translated = translateText(fonts[currentFont].cmapMap, hex);
            console.log(`Font ${currentFont}: ${hex} -> "${translated}"`);
            finalLines.push(translated);
        }
    }

    return finalLines.join('\n');
}

function extractAndTranslate(filePath) {
    try {
        console.log(`--- Starting Analysis: ${path.basename(filePath)} ---\n`);
        const buffer = fs.readFileSync(filePath);
        const pdfString = buffer.toString('binary');

        const rootRef = findRootRef(pdfString);
        console.log(`[1] Trailer -> Root: ${rootRef}`);

        const rootObj = getObject(buffer, pdfString, rootRef);
        const pagesRef = extractValue(rootObj, '/Pages');
        console.log(`[2] Root -> Pages: ${pagesRef}`);

        const pagesObj = getObject(buffer, pdfString, pagesRef);
        const firstPageRef = extractFirstKid(pagesObj, pagesRef);
        console.log(`[3] Pages -> First Page: ${firstPageRef}`);

        const pageObj = getObject(buffer, pdfString, firstPageRef);
        const contentsRef = extractValue(pageObj, '/Contents');
        console.log(`[4] Page -> Contents: ${contentsRef}`);

        const contentsObjRaw = getObject(buffer, pdfString, contentsRef, true);
        const streamLength = resolveLength(buffer, pdfString, contentsObjRaw);
        console.log(`[5] Content Stream Length: ${streamLength} bytes`);

        const decompressed = decompressStream(contentsObjRaw, streamLength);

        console.log('\n--- RAW CONTENT STREAM ---');
        console.log(decompressed);
        
        const fonts = findFontAndCMap(buffer, pdfString, pageObj);
        
        console.log('\n--- FONTS & CMAPS ---');
        for (const [name, font] of Object.entries(fonts)) {
            console.log(`\nFont ${name}:`);
            console.log(`  CMap entries:`, font.cmapMap);
        }
        
        console.log('\n--- TRANSLATED TEXT ---');
        const finalText = processContentStream(decompressed, fonts);

        console.log('\n--- FINAL PDF CONTENT ---');
        console.log(finalText || '[No translatable text found]');

    } catch (err) {
        console.error(`\n[!] ERROR: ${err.message}`);
    }
}

const target = process.argv[2];
if (!target) {
    console.log("Usage: node index.js <file.pdf>");
} else {
    extractAndTranslate(target);
}