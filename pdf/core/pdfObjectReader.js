const zlib = require('zlib');
const { PDF_REGEX } = require('../utils/pdfRegex');

function getObject(buffer, pdfString, ref, returnBuffer = false) {
    const [id, gen] = ref.split(PDF_REGEX.common.whitespace);
    const objHeaderRegex = PDF_REGEX.core.objectHeaderByIdGen(id, gen);
    const match = objHeaderRegex.exec(pdfString);
    if (!match) throw new Error(`Could not find object: ${ref}`);
    const startIdx = match.index + (match[0].length - `${id} ${gen} obj`.length);
    const endIdx = pdfString.indexOf('endobj', startIdx) + 6;
    if (returnBuffer) return buffer.slice(startIdx, endIdx);
    return pdfString.substring(startIdx, endIdx);
}

function extractValue(objStr, key) {
    const regex = PDF_REGEX.core.dictValueByKey(key);
    const match = objStr.match(regex);
    if (!match) throw new Error(`Key ${key} not found in dictionary`);
    return match[1].trim();
}

function resolveLength(buffer, pdfString, objBuffer) {
    const objStr = objBuffer.toString('binary');
    const lengthVal = extractValue(objStr, '/Length');

    if (lengthVal.includes('R')) {
        const lengthObj = getObject(buffer, pdfString, lengthVal);
        const numMatch = lengthObj.match(PDF_REGEX.core.indirectLengthObject);
        if (!numMatch) {
            const directNum = lengthObj.match(PDF_REGEX.core.directNumericLine);
            if (directNum) return parseInt(directNum[1]);
            throw new Error('Could not parse indirect length value');
        }
        return parseInt(numMatch[1]);
    }
    return parseInt(lengthVal);
}

function decompressStream(objBuffer, length) {
    const streamKeyword = Buffer.from('stream');
    const startIdx = objBuffer.indexOf(streamKeyword) + streamKeyword.length;
    const offset = objBuffer[startIdx] === 0x0d ? 2 : 1;
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

module.exports = {
    getObject,
    extractValue,
    resolveLength,
    decompressStream
};
