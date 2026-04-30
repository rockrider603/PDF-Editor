/**
 * pdf-parser — Browser-compatible PDF parsing SDK
 *
 * Ported from the PDF-Editor Node.js pipeline (`pdf/`).
 * All exports are tree-shakable named exports — import only what you need.
 *
 * ── Recommended Usage (Factory Pattern) ──────────────────────────────────────
 *
 * @example
 * import { PdfDocument } from 'pdf-parser';
 *
 * const doc    = await PdfDocument.fromFile(file); // File from <input> or drop
 * const page   = await doc.getPage(1);             // 1-indexed
 * const result = await page.extract();             // full pipeline in one call
 *
 * result.dimensions    // { width, height } in PDF points
 * result.textElements  // [{ text, x, y, width }]
 * result.classification // { detailed: { headers, paragraphs } }
 * result.images        // { background, pageImages }
 *
 * ── Tree-Shakable Low-Level Exports ──────────────────────────────────────────
 *
 * @example
 * import { parseCMap, translateText } from 'pdf-parser';
 * import { detectParasAndHeaders }    from 'pdf-parser';
 */

// ── Factory / Adapter Classes ─────────────────────────────────────────────────
export { PdfDocument } from './PdfDocument.js';
export { PdfPage }     from './PdfPage.js';

// ── Utilities ─────────────────────────────────────────────────────────────────
export { uint8ToBinaryString, indexOfSeq, allocBytes, asciiToBytes } from './src/utils/bytes.js';
export { PDF_REGEX }                                                   from './src/utils/pdfRegex.js';

// ── Core ──────────────────────────────────────────────────────────────────────
export { getObject, extractValue,
         resolveLength, decompressStream }  from './src/core/pdfObjectReader.js';
export { findRootRef, extractFirstKid }    from './src/core/pdfPageTreeResolver.js';
export { resolveDictOrRef,
         extractInlineDictionary }         from './src/core/pdfDictionaryResolver.js';

// ── Text ──────────────────────────────────────────────────────────────────────
export { parseCMap, buildCharMap,
         translateText, decodeUnicodeHex,
         getCMapCodeLengths }              from './src/text/pdfCMapParser.js';
export { findFontAndCMap }                 from './src/text/pdfFontCMapResolver.js';
export { processContentStream,
         detectParasAndHeaders,
         groupIntoParagraphs,
         decodePdfLiteralString }          from './src/text/pdfContentStreamTextProcessor.js';

// ── Images ────────────────────────────────────────────────────────────────────
export { buildXObjectNameMap,
         parsePaintOperations }            from './src/images/pageContentParser.js';
export { decodeImageObject,
         parseImageMetadata }              from './src/images/imageDecoder.js';
export { extractBackgroundImage,
         getPageDimensions }              from './src/images/backgroundDetector.js';
export { scanPageImages }                  from './src/images/imageScanner.js';
