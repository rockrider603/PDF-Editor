const zlib = require('zlib');
const { getObject, resolveLength } = require('../core/pdfObjectReader');

/**
 * Parses the image metadata fields from a PDF object's dictionary string.
 *
 * @param {string} objStr - String representation of the PDF object.
 * @returns {{ width: number, height: number, filter: string, length: number }}
 */
function parseImageMetadata(objStr) {
    return {
        width:  parseInt(objStr.match(/\/Width\s+(\d+)/)?.[1]  || 0),
        height: parseInt(objStr.match(/\/Height\s+(\d+)/)?.[1] || 0),
        filter: objStr.match(/\/Filter\s*\/(\w+)/)?.[1]        || 'None',
        length: parseInt(objStr.match(/\/Length\s+(\d+)/)?.[1] || 0)
    };
}

/**
 * Wraps raw RGB pixel data in a Windows BMP file header.
 * Suitable for FlateDecode image streams decoded from DeviceRGB color space.
 *
 * @param {Buffer} pixelData - Raw uncompressed RGB pixel bytes.
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function encodeBmp(pixelData, width, height) {
    const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
    const fileSize = 54 + rowSize * height;
    const buf = Buffer.alloc(fileSize);

    buf.write('BM', 0);
    buf.writeUInt32LE(fileSize,  2);
    buf.writeUInt32LE(54,        10);
    buf.writeUInt32LE(40,        14);
    buf.writeInt32LE(width,      18);
    buf.writeInt32LE(-height,    22); // negative = top-down row order
    buf.writeUInt16LE(1,         26);
    buf.writeUInt16LE(24,        28);
    pixelData.copy(buf, 54);

    return buf;
}

/**
 * Extracts and decodes the raw image stream from a PDF object buffer.
 * Handles FlateDecode (→ BMP) and DCTDecode (→ JPEG) filters.
 *
 * @param {Buffer} buffer     - Full PDF file buffer (needed for indirect length resolution).
 * @param {string} pdfString  - Full PDF as binary string.
 * @param {number} objNum     - PDF object number to decode.
 * @returns {{ bytes: Buffer, format: string, extension: string, metadata: object } | null}
 */
function decodeImageObject(buffer, pdfString, objNum) {
    const objRef = `${objNum} 0 R`;
    const objBuffer = getObject(buffer, pdfString, objRef, true);
    const objStr = objBuffer.toString('binary');
    const metadata = parseImageMetadata(objStr);

    const streamIdx = objBuffer.indexOf('stream');
    if (streamIdx === -1) return null;

    let dataStart = streamIdx + 6;
    if (objBuffer[dataStart] === 0x0d) dataStart += 2;      // \r\n
    else if (objBuffer[dataStart] === 0x0a) dataStart += 1; // \n

    let length;
    try {
        length = resolveLength(buffer, pdfString, objBuffer);
    } catch {
        length = metadata.length || 0;
    }

    const rawStream = objBuffer.slice(dataStart, dataStart + length);

    if (metadata.filter === 'FlateDecode') {
        const pixels = zlib.inflateSync(rawStream);
        return {
            bytes:    encodeBmp(pixels, metadata.width, metadata.height),
            format:   'bmp',
            extension: '.bmp',
            metadata
        };
    }

    return {
        bytes:    rawStream,
        format:   'jpeg',
        extension: '.jpg',
        metadata
    };
}

module.exports = {
    parseImageMetadata,
    decodeImageObject
};
