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
        const char = decodeUnicodeHex(unicodeHex);
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

function decodeUnicodeHex(unicodeHex) {
    const normalized = (unicodeHex || '').toUpperCase();
    if (!normalized || normalized.length % 4 !== 0) {
        return '';
    }

    let out = '';
    for (let i = 0; i < normalized.length; i += 4) {
        const chunk = normalized.slice(i, i + 4);
        out += String.fromCharCode(parseInt(chunk, 16));
    }
    return out;
}

function extractInlineDictionary(str, startIdx) {
    let depth = 0;
    let i = startIdx;

    while (i < str.length - 1) {
        const two = str.slice(i, i + 2);
        if (two === '<<') {
            depth++;
            i += 2;
            continue;
        }
        if (two === '>>') {
            depth--;
            i += 2;
            if (depth === 0) {
                return str.slice(startIdx, i);
            }
            continue;
        }
        i++;
    }
    throw new Error("Unterminated inline dictionary");
}

function resolveDictOrRef(objStr, key) {
    const keyIdx = objStr.indexOf(key);
    if (keyIdx === -1) return null;

    const afterKey = objStr.slice(keyIdx + key.length).trimStart();
    const refMatch = afterKey.match(/^(\d+\s+\d+\s+R)/);
    if (refMatch) {
        return { type: 'ref', value: refMatch[1] };
    }

    if (afterKey.startsWith('<<')) {
        const dictStart = keyIdx + key.length + (objStr.slice(keyIdx + key.length).length - afterKey.length);
        const dict = extractInlineDictionary(objStr, dictStart);
        return { type: 'dict', value: dict };
    }

    return null;
}

function findFontAndCMap(buffer, pdfString, pageObjStr) {
    const resEntry = resolveDictOrRef(pageObjStr, '/Resources');
    if (!resEntry) throw new Error("No /Resources found in page object");

    const resObj = resEntry.type === 'ref'
        ? getObject(buffer, pdfString, resEntry.value)
        : resEntry.value;

    const fontEntry = resolveDictOrRef(resObj, '/Font');
    if (!fontEntry) throw new Error("No /Font found in resources");

    const fontDictObj = fontEntry.type === 'ref'
        ? getObject(buffer, pdfString, fontEntry.value)
        : fontEntry.value;
    
    const fonts = {};
    const fontNameMatch = fontDictObj.match(/\/(\w+)\s+(\d+\s+\d+\s+R)/g);
    if (fontNameMatch) {
        for (const fm of fontNameMatch) {
            const parts = fm.split(/\s+/);
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
            
            fonts[fontName] = {
                ref: fontRef,
                cmapMap: parseCMap(cmapText),
                charMap: buildCharMap(parseCMap(cmapText))
            };
        }
    }
    return fonts;
}

function decodePdfLiteralString(token) {
    let inner = token;
    if (inner.startsWith('(') && inner.endsWith(')')) {
        inner = inner.slice(1, -1);
    }

    return inner
        .replace(/\\\\/g, '\\')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f');
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
                result += decodeUnicodeHex(cmapMap[code]);
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
    let currentY = null;
    const groupedLines = [];

    function appendTextChunk(text) {
        if (!text) return;

        if (groupedLines.length === 0) {
            groupedLines.push({ y: currentY, text });
            return;
        }

        const last = groupedLines[groupedLines.length - 1];
        if (
            typeof currentY === 'number' &&
            typeof last.y === 'number' &&
            Math.abs(last.y - currentY) <= 0.5
        ) {
            last.text += text;
        } else {
            groupedLines.push({ y: currentY, text });
        }
    }
    
    for (const line of lines) {
        const fontMatch = line.match(/\/F(\d+)\s+(\d+)\s+Tf/);
        if (fontMatch) {
            currentFont = 'F' + fontMatch[1];
        }

        const tmMatch = line.match(/1\s+0\s+0\s+1\s+([\-\d.]+)\s+([\-\d.]+)\s+Tm/);
        if (tmMatch) {
            currentY = parseFloat(tmMatch[2]);
        }
        
        const tjArrayMatch = line.match(/\[(.*?)\]\s*TJ/);
        if (tjArrayMatch && currentFont && fonts[currentFont]) {
            const parts = tjArrayMatch[1].match(/<([0-9A-Fa-f]+)>|\((?:\\.|[^\\)])*\)/g) || [];
            let combined = '';

            for (const part of parts) {
                let translated = '';
                if (part.startsWith('<')) {
                    translated = translateText(fonts[currentFont].cmapMap, part);
                } else {
                    translated = decodePdfLiteralString(part);
                }
                combined += translated;
                console.log(`Font ${currentFont}: ${part} -> "${translated}"`);
            }

            if (combined) {
                appendTextChunk(combined);
            }
            continue;
        }

        const tjSingleMatch = line.match(/(<[0-9A-Fa-f]+>)\s*Tj/);
        if (tjSingleMatch && currentFont && fonts[currentFont]) {
            const hex = tjSingleMatch[1];
            const translated = translateText(fonts[currentFont].cmapMap, hex);
            console.log(`Font ${currentFont}: ${hex} -> "${translated}"`);
            appendTextChunk(translated);
        }
    }

    return groupedLines
        .map(item => item.text)
        .join('\n')
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.length > 0)
        .join('\n');
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