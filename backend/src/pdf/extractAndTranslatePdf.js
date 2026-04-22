const fs   = require('fs');
const path = require('path');

const { findRootRef, extractFirstKid }        = require('./core/pdfPageTreeResolver');
const { getObject, extractValue, resolveLength, decompressStream } = require('./core/pdfObjectReader');
const { findFontAndCMap }                      = require('./text/pdfFontCMapResolver');
const { processContentStream, detectParasAndHeaders } = require('./text/pdfContentStreamTextProcessor');
const { extractBackgroundImage }               = require('./images/backgroundDetector');
const { scanPageImages }                       = require('./images/imageScanner');
const { storePageImages, storeBackgroundImage } = require('./images/imageStorage');

/**
 * Full PDF extraction pipeline.
 *
 * Steps:
 *   1. Resolve PDF structure (trailer → root → pages → first page)
 *   2. Decompress the first page's content stream
 *   3. Extract and translate text via ToUnicode CMaps
 *   4. Classify text elements as headers or paragraphs
 *   5. Detect and store the background image
 *   6. Scan and store all remaining page images
 *
 * @param {string} filePath - Absolute or relative path to the input PDF.
 */
async function extractAndTranslatePdf(filePath) {
    try {
        console.log(`--- Starting Analysis: ${path.basename(filePath)} ---\n`);

        const buffer    = fs.readFileSync(filePath);
        const pdfString = buffer.toString('binary');

        // ── 1. Structure ─────────────────────────────────────────────────────
        const rootRef     = findRootRef(pdfString);
        console.log(`[1] Trailer -> Root: ${rootRef}`);

        const rootObj     = getObject(buffer, pdfString, rootRef);
        const pagesRef    = extractValue(rootObj, '/Pages');
        console.log(`[2] Root -> Pages: ${pagesRef}`);

        const pagesObj    = getObject(buffer, pdfString, pagesRef);
        const firstPageRef = extractFirstKid(pagesObj, pagesRef);
        console.log(`[3] Pages -> First Page: ${firstPageRef}`);

        const pageObj     = getObject(buffer, pdfString, firstPageRef);
        const contentsRef = extractValue(pageObj, '/Contents');
        console.log(`[4] Page -> Contents: ${contentsRef}`);

        const contentsBuffer = getObject(buffer, pdfString, contentsRef, true);
        const streamLength   = resolveLength(buffer, pdfString, contentsBuffer);
        console.log(`[5] Content Stream Length: ${streamLength} bytes`);

        // ── 2. Content Stream ─────────────────────────────────────────────────
        const contentStream = decompressStream(contentsBuffer, streamLength);
        console.log('\n--- RAW CONTENT STREAM ---');
        console.log(contentStream);

        // ── 3. Text Extraction ────────────────────────────────────────────────
        const fonts = findFontAndCMap(buffer, pdfString, pageObj);
        console.log('\n--- FONTS & CMAPS ---');
        for (const [name, font] of Object.entries(fonts)) {
            console.log(`\nFont ${name}:`);
            console.log('  CMap entries:', font.cmapMap);
        }

        console.log('\n--- TRANSLATED TEXT ---');
        const textElements = processContentStream(contentStream, fonts);
        textElements.forEach(el => console.log(el.text));

        console.log('\n--- FINAL PDF CONTENT ---');
        console.log(textElements.map(el => el.text).join('\n') || '[No translatable text found]');

        // ── 4. Classification ─────────────────────────────────────────────────
        detectParasAndHeaders(textElements);

        // ── 5. Background Image ───────────────────────────────────────────────
        const bgImage = extractBackgroundImage(buffer, pdfString, pageObj, contentStream);
        storeBackgroundImage(bgImage);

        // ── 6. Page Images ────────────────────────────────────────────────────
        let pageImages = scanPageImages(buffer, pdfString);
        if (bgImage) {
            pageImages = pageImages.filter(img => img.objNum !== bgImage.objNum);
        }
        storePageImages(pageImages);

    } catch (err) {
        console.error(`\n[!] ERROR: ${err.message}`);
    }
}

module.exports = { extractAndTranslatePdf };