const sharp = require('sharp');
const zlib = require('zlib');
const { getObject, resolveLength } = require('../core/pdfObjectReader');
const { PDF_REGEX } = require('../utils/pdfRegex');

/**
 * Parses the image metadata fields from a PDF object's dictionary string.
 *
 * @param {string} objStr - String representation of the PDF object.
 * @returns {{ width: number, height: number, filter: string, length: number }}
 */



function parseImageMetadata(objStr) {
    const decodeParmsBlock = objStr.match(PDF_REGEX.images.decodeParmsBlock);
    const decodeParms = decodeParmsBlock?.[1] || '';
    const colorSpace = objStr.match(PDF_REGEX.images.colorSpace)?.[1] || 'DeviceRGB';
    const bitsPerComponent = parseInt(objStr.match(PDF_REGEX.images.bitsPerComponent)?.[1] || 8);

    return {
        width:  parseInt(objStr.match(PDF_REGEX.images.width)?.[1]  || 0),
        height: parseInt(objStr.match(PDF_REGEX.images.height)?.[1] || 0),
        filter: objStr.match(PDF_REGEX.images.filter)?.[1]        || 'None',
        length: parseInt(objStr.match(PDF_REGEX.images.length)?.[1] || 0),
        colorSpace,
        bitsPerComponent,
        predictor: parseInt(decodeParms.match(PDF_REGEX.images.predictor)?.[1] || 1),
        colors: parseInt(decodeParms.match(PDF_REGEX.images.colors)?.[1] || guessColorsFromColorSpace(colorSpace)),
        columns: parseInt(decodeParms.match(PDF_REGEX.images.columns)?.[1] || 0)
    };
}

/**
 * Infers channel count from PDF image color space.
 *
 * @param {string} colorSpace
 * @returns {number}
 */
function guessColorsFromColorSpace(colorSpace) {
    if (colorSpace === 'DeviceGray') return 1;
    if (colorSpace === 'DeviceCMYK') return 4;
    return 3;
}

/**
 * Applies PNG predictor decoding (Predictor 10-15) to an inflated stream.
 *
 * @param {Buffer} inflated
 * @param {number} columns
 * @param {number} colors
 * @param {number} bitsPerComponent
 * @returns {Buffer}
 */
function decodePngPredictor(inflated, columns, colors, bitsPerComponent) {
    if (bitsPerComponent !== 8) {
        throw new Error(`Unsupported PNG predictor bits-per-component: ${bitsPerComponent}`);
    }

    const rowLength = columns * colors;
    if (rowLength <= 0) {
        throw new Error('Invalid row length for PNG predictor decoding.');
    }

    const bytesPerPixel = Math.max(1, colors);
    const stride = rowLength + 1;
    if (inflated.length % stride !== 0) {
        throw new Error('Inflated PNG predictor stream has unexpected row stride.');
    }

    const rows = inflated.length / stride;
    const output = Buffer.alloc(rowLength * rows);
    let srcOffset = 0;
    let dstOffset = 0;
    let prevRow = null;

    for (let row = 0; row < rows; row += 1) {
        const filterType = inflated[srcOffset];
        srcOffset += 1;

        const outRow = output.subarray(dstOffset, dstOffset + rowLength);
        const rawRow = inflated.subarray(srcOffset, srcOffset + rowLength);
        srcOffset += rowLength;

        for (let i = 0; i < rowLength; i += 1) {
            const left = i >= bytesPerPixel ? outRow[i - bytesPerPixel] : 0;
            const up = prevRow ? prevRow[i] : 0;
            const upLeft = prevRow && i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;

            switch (filterType) {
                case 0:
                    outRow[i] = rawRow[i];
                    break;
                case 1:
                    outRow[i] = (rawRow[i] + left) & 0xff;
                    break;
                case 2:
                    outRow[i] = (rawRow[i] + up) & 0xff;
                    break;
                case 3:
                    outRow[i] = (rawRow[i] + Math.floor((left + up) / 2)) & 0xff;
                    break;
                case 4:
                    outRow[i] = (rawRow[i] + paethPredictor(left, up, upLeft)) & 0xff;
                    break;
                default:
                    throw new Error(`Unknown PNG predictor filter type: ${filterType}`);
            }
        }

        prevRow = outRow;
        dstOffset += rowLength;
    }

    return output;
}

/**
 * Paeth predictor helper used by PNG filter type 4.
 *
 * @param {number} left
 * @param {number} up
 * @param {number} upLeft
 * @returns {number}
 */
function paethPredictor(left, up, upLeft) {
    const p = left + up - upLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - upLeft);

    if (pa <= pb && pa <= pc) return left;
    if (pb <= pc) return up;
    return upLeft;
}

/**
 * Converts raw CMYK samples to raw RGB for Sharp.
 *
 * @param {Buffer} cmyk
 * @returns {Buffer}
 */
function cmykToRgb(cmyk) {
    const rgb = Buffer.alloc(Math.floor(cmyk.length / 4) * 3);
    for (let i = 0, j = 0; i < cmyk.length; i += 4, j += 3) {
        const c = cmyk[i] / 255;
        const m = cmyk[i + 1] / 255;
        const y = cmyk[i + 2] / 255;
        const k = cmyk[i + 3] / 255;

        rgb[j] = Math.round(255 * (1 - c) * (1 - k));
        rgb[j + 1] = Math.round(255 * (1 - m) * (1 - k));
        rgb[j + 2] = Math.round(255 * (1 - y) * (1 - k));
    }
    return rgb;
}

/**
 * Converts a FlateDecode PDF image stream to JPEG bytes.
 *
 * @param {Buffer} rawStream
 * @param {object} metadata
 * @returns {Promise<Buffer>}
 */
async function convertFlateToJpeg(rawStream, metadata) {
    let inflated;
    try {
        inflated = zlib.inflateSync(rawStream);
    } catch (err) {
        throw new Error(`Flate stream inflate failed: ${err.message}`);
    }

    const columns = metadata.columns || metadata.width;
    let raster = inflated;
    if (metadata.predictor >= 10) {
        raster = decodePngPredictor(inflated, columns, metadata.colors, metadata.bitsPerComponent);
    }

    let channels = metadata.colors || guessColorsFromColorSpace(metadata.colorSpace);
    if (channels === 4 || metadata.colorSpace === 'DeviceCMYK') {
        raster = cmykToRgb(raster);
        channels = 3;
    }

    if (channels < 1 || channels > 4) {
        throw new Error(`Unsupported channel count for Sharp raw input: ${channels}`);
    }

    return sharp(raster, {
        raw: {
            width: metadata.width,
            height: metadata.height,
            channels
        }
    })
        .removeAlpha()
        .jpeg({ quality: 90 })
        .toBuffer();
}

/**
 * Extracts and decodes the raw image stream from a PDF object buffer.
 * Handles FlateDecode (→ JPEG via Sharp) and DCTDecode (→ JPEG passthrough).
 *
 * @param {Buffer} buffer     - Full PDF file buffer (needed for indirect length resolution).
 * @param {string} pdfString  - Full PDF as binary string.
 * @param {number} objNum     - PDF object number to decode.
 * @returns {Promise<{ bytes: Buffer, format: string, extension: string, metadata: object } | null>}
 */
async function decodeImageObject(buffer, pdfString, objNum) {
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
        const jpegBytes = await convertFlateToJpeg(rawStream, metadata);
        return {
            bytes: jpegBytes,
            format: 'jpeg',
            extension: '.jpg',
            metadata
        };
    }

    if (metadata.filter === 'DCTDecode') {
        return {
            bytes: rawStream,
            format: 'jpeg',
            extension: '.jpg',
            metadata
        };
    }

    return null;
}

module.exports = {
    parseImageMetadata,
    decodeImageObject
};
