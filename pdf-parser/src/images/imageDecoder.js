import { inflate } from 'pako';
import { getObject, resolveLength } from '../core/pdfObjectReader.js';
import { PDF_REGEX } from '../utils/pdfRegex.js';
import { uint8ToBinaryString, allocBytes } from '../utils/bytes.js';

// ── Metadata Parsing ──────────────────────────────────────────────────────────

/**
 * Infers the number of colour channels from a PDF colour space name.
 *
 * @param {string} colorSpace
 * @returns {number}
 */
function guessColorsFromColorSpace(colorSpace) {
    if (colorSpace === 'DeviceGray') return 1;
    if (colorSpace === 'DeviceCMYK') return 4;
    return 3; // DeviceRGB / default
}

/**
 * Parses image metadata fields from a PDF object's dictionary string.
 *
 * @param {string} objStr - String representation of the PDF object.
 * @returns {{ width, height, filter, length, colorSpace, bitsPerComponent, predictor, colors, columns }}
 */
export function parseImageMetadata(objStr) {
    const decodeParmsBlock  = objStr.match(PDF_REGEX.images.decodeParmsBlock);
    const decodeParms       = decodeParmsBlock?.[1] || '';
    const colorSpace        = objStr.match(PDF_REGEX.images.colorSpace)?.[1] || 'DeviceRGB';
    const bitsPerComponent  = parseInt(objStr.match(PDF_REGEX.images.bitsPerComponent)?.[1] || 8);

    return {
        width:            parseInt(objStr.match(PDF_REGEX.images.width)?.[1]  || 0),
        height:           parseInt(objStr.match(PDF_REGEX.images.height)?.[1] || 0),
        filter:           objStr.match(PDF_REGEX.images.filter)?.[1]          || 'None',
        length:           parseInt(objStr.match(PDF_REGEX.images.length)?.[1] || 0),
        colorSpace,
        bitsPerComponent,
        predictor: parseInt(decodeParms.match(PDF_REGEX.images.predictor)?.[1] || 1),
        colors:    parseInt(decodeParms.match(PDF_REGEX.images.colors)?.[1]    ||
                            guessColorsFromColorSpace(colorSpace)),
        columns:   parseInt(decodeParms.match(PDF_REGEX.images.columns)?.[1]  || 0)
    };
}

// ── PNG Predictor Decoding ────────────────────────────────────────────────────

/**
 * Paeth predictor helper used by PNG filter type 4.
 *
 * @param {number} left
 * @param {number} up
 * @param {number} upLeft
 * @returns {number}
 */
function paethPredictor(left, up, upLeft) {
    const p  = left + up - upLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - upLeft);
    if (pa <= pb && pa <= pc) return left;
    if (pb <= pc) return up;
    return upLeft;
}

/**
 * Applies PNG predictor decoding (Predictor 10–15) to an inflated stream.
 *
 * Ported from pdf/images/imageDecoder.js — `Buffer.alloc(n)` → `allocBytes(n)`,
 * `inflated.subarray()` works identically on Uint8Array.
 *
 * @param {Uint8Array} inflated
 * @param {number}     columns
 * @param {number}     colors
 * @param {number}     bitsPerComponent
 * @returns {Uint8Array}
 */
function decodePngPredictor(inflated, columns, colors, bitsPerComponent) {
    if (bitsPerComponent !== 8) {
        throw new Error(`Unsupported PNG predictor bits-per-component: ${bitsPerComponent}`);
    }

    const rowLength = columns * colors;
    if (rowLength <= 0) throw new Error('Invalid row length for PNG predictor decoding.');

    const bytesPerPixel = Math.max(1, colors);
    const stride        = rowLength + 1;
    if (inflated.length % stride !== 0) {
        throw new Error('Inflated PNG predictor stream has unexpected row stride.');
    }

    const rows   = inflated.length / stride;
    const output = allocBytes(rowLength * rows);
    let srcOffset = 0;
    let dstOffset = 0;
    let prevRow   = null;

    for (let row = 0; row < rows; row++) {
        const filterType = inflated[srcOffset];
        srcOffset += 1;

        const outRow = output.subarray(dstOffset, dstOffset + rowLength);
        const rawRow = inflated.subarray(srcOffset, srcOffset + rowLength);
        srcOffset += rowLength;

        for (let i = 0; i < rowLength; i++) {
            const left   = i >= bytesPerPixel ? outRow[i - bytesPerPixel] : 0;
            const up     = prevRow ? prevRow[i] : 0;
            const upLeft = prevRow && i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;

            switch (filterType) {
                case 0: outRow[i] = rawRow[i]; break;
                case 1: outRow[i] = (rawRow[i] + left) & 0xff; break;
                case 2: outRow[i] = (rawRow[i] + up) & 0xff; break;
                case 3: outRow[i] = (rawRow[i] + Math.floor((left + up) / 2)) & 0xff; break;
                case 4: outRow[i] = (rawRow[i] + paethPredictor(left, up, upLeft)) & 0xff; break;
                default: throw new Error(`Unknown PNG predictor filter type: ${filterType}`);
            }
        }

        prevRow    = outRow;
        dstOffset += rowLength;
    }

    return output;
}

// ── Colour Space Conversion ───────────────────────────────────────────────────

/**
 * Converts raw CMYK pixel data to RGB.
 *
 * @param {Uint8Array} cmyk
 * @returns {Uint8Array}
 */
function cmykToRgb(cmyk) {
    const rgb = allocBytes(Math.floor(cmyk.length / 4) * 3);
    for (let i = 0, j = 0; i < cmyk.length; i += 4, j += 3) {
        const c = cmyk[i] / 255, m = cmyk[i + 1] / 255;
        const y = cmyk[i + 2] / 255, k = cmyk[i + 3] / 255;
        rgb[j]     = Math.round(255 * (1 - c) * (1 - k));
        rgb[j + 1] = Math.round(255 * (1 - m) * (1 - k));
        rgb[j + 2] = Math.round(255 * (1 - y) * (1 - k));
    }
    return rgb;
}

// ── Canvas Rendering ──────────────────────────────────────────────────────────

/**
 * Converts a raw RGB/Gray raster to an RGBA Uint8ClampedArray for ImageData.
 *
 * @param {Uint8Array} raster
 * @param {number}     width
 * @param {number}     height
 * @param {number}     channels - 1 (gray) or 3 (RGB).
 * @returns {Uint8ClampedArray}
 */
function rasterToRgba(raster, width, height, channels) {
    const pixelCount = width * height;
    const rgba = new Uint8ClampedArray(pixelCount * 4);

    for (let i = 0; i < pixelCount; i++) {
        if (channels === 1) {
            const v = raster[i];
            rgba[i * 4]     = v;
            rgba[i * 4 + 1] = v;
            rgba[i * 4 + 2] = v;
        } else {
            rgba[i * 4]     = raster[i * 3];
            rgba[i * 4 + 1] = raster[i * 3 + 1];
            rgba[i * 4 + 2] = raster[i * 3 + 2];
        }
        rgba[i * 4 + 3] = 255; // fully opaque
    }
    return rgba;
}

/**
 * Draws raw pixel data to a canvas and exports it as a JPEG data URL.
 *
 * Replaces `sharp(raster, opts).jpeg().toBuffer()` from the Node.js pipeline.
 * Uses OffscreenCanvas when available, falls back to a regular <canvas> element.
 *
 * @param {Uint8Array} raster   - Raw RGB or Grayscale pixel data.
 * @param {number}     width
 * @param {number}     height
 * @param {number}     channels - 1 or 3.
 * @returns {Promise<string>}   JPEG data URL.
 */
async function rasterToDataUrl(raster, width, height, channels) {
    const rgba      = rasterToRgba(raster, width, height, channels);
    const imageData = new ImageData(rgba, width, height);

    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(width, height);
    } else {
        canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
    }

    canvas.getContext('2d').putImageData(imageData, 0, 0);

    if (canvas instanceof OffscreenCanvas) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Regular HTMLCanvasElement fallback
    return canvas.toDataURL('image/jpeg', 0.9);
}

// ── FlateDecode Conversion ────────────────────────────────────────────────────

/**
 * Inflates a FlateDecode image stream and converts it to a JPEG data URL.
 *
 * Ported from pdf/images/imageDecoder.js.
 * Node.js change: `zlib.inflateSync` → `pako.inflate` (same input/output shape).
 *
 * @param {Uint8Array} rawStream
 * @param {object}     metadata
 * @returns {Promise<string>} JPEG data URL.
 */
async function convertFlateToDataUrl(rawStream, metadata) {
    let inflated;
    try {
        inflated = inflate(rawStream); // Uint8Array output — equivalent to Node Buffer
    } catch (err) {
        throw new Error(`Flate stream inflate failed: ${err.message}`);
    }

    const columns  = metadata.columns || metadata.width;
    let raster     = inflated;
    if (metadata.predictor >= 10) {
        raster = decodePngPredictor(inflated, columns, metadata.colors, metadata.bitsPerComponent);
    }

    let channels = metadata.colors || guessColorsFromColorSpace(metadata.colorSpace);
    if (channels === 4 || metadata.colorSpace === 'DeviceCMYK') {
        raster   = cmykToRgb(raster);
        channels = 3;
    }

    if (channels < 1 || channels > 3) {
        throw new Error(`Unsupported channel count: ${channels}`);
    }

    return rasterToDataUrl(raster, metadata.width, metadata.height, channels);
}

// ── DCTDecode (JPEG passthrough) ──────────────────────────────────────────────

/**
 * Converts a raw Uint8Array of JPEG bytes to a data URL without re-encoding.
 *
 * @param {Uint8Array} rawStream
 * @returns {string} JPEG data URL.
 */
function dctToDataUrl(rawStream) {
    let binary = '';
    for (let i = 0; i < rawStream.length; i++) {
        binary += String.fromCharCode(rawStream[i]);
    }
    return 'data:image/jpeg;base64,' + btoa(binary);
}

// ── Public Decoder ────────────────────────────────────────────────────────────

/**
 * Extracts and decodes the raw image stream from a PDF object.
 * Handles FlateDecode (→ JPEG data URL via Canvas) and DCTDecode (→ JPEG passthrough).
 *
 * The returned `dataUrl` is ready to be set as `<img src="…">`.
 *
 * @param {Uint8Array} bytes     - Full PDF file bytes.
 * @param {string}     pdfString - Full PDF as a binary string.
 * @param {number}     objNum    - PDF object number to decode.
 * @returns {Promise<{ dataUrl: string, format: string, extension: string, metadata: object } | null>}
 */
export async function decodeImageObject(bytes, pdfString, objNum) {
    const objRef   = `${objNum} 0 R`;
    const objBytes = getObject(bytes, pdfString, objRef, true);
    const objStr   = uint8ToBinaryString(objBytes);
    const metadata = parseImageMetadata(objStr);

    const streamIdx = uint8ToBinaryString(objBytes).indexOf('stream');
    if (streamIdx === -1) return null;

    let dataStart = streamIdx + 6;
    if (objBytes[dataStart] === 0x0d) dataStart += 2;      // \r\n
    else if (objBytes[dataStart] === 0x0a) dataStart += 1; // \n

    let length;
    try {
        length = resolveLength(bytes, pdfString, objBytes);
    } catch {
        length = metadata.length || 0;
    }

    const rawStream = objBytes.subarray(dataStart, dataStart + length);

    if (metadata.filter === 'FlateDecode') {
        const dataUrl = await convertFlateToDataUrl(rawStream, metadata);
        return { dataUrl, format: 'jpeg', extension: '.jpg', metadata };
    }

    if (metadata.filter === 'DCTDecode') {
        const dataUrl = dctToDataUrl(rawStream);
        return { dataUrl, format: 'jpeg', extension: '.jpg', metadata };
    }

    return null;
}
