const fs = require('fs');
const path = require('path');

const { scanForImages } = require('./images/pdfImageXObjectProcessor');
const { storeImages, storeBackgroundImage } = require('./images/pdfImageStorage');
const { extractBackgroundImage } = require('./images/pdfBackgroundExtractor');
const { findRootRef, extractFirstKid } = require('./core/pdfPageTreeResolver');
const { getObject, extractValue, resolveLength, decompressStream } = require('./core/pdfObjectReader');
const { findFontAndCMap } = require('./text/pdfFontCMapResolver');
const { processContentStream, detectParasAndHeaders } = require('./text/pdfContentStreamTextProcessor');

/**
 * Main orchestration function for PDF extraction and translation.
 *
 * Pipeline:
 *   1. Parse PDF structure (trailer → root → pages → first page)
 *   2. Decompress and display the raw content stream
 *   3. Extract and translate text via CMap fonts
 *   4. Extract and store all XObject images
 *   5. Identify and store the background image with a "bg_" prefix
 */
async function extractAndTranslatePdf(filePath) {
    try {
        console.log(`--- Starting Analysis: ${path.basename(filePath)} ---\n`);
        const buffer = fs.readFileSync(filePath);
        const pdfString = buffer.toString('binary');

        // 1. PDF Structure Parsing
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

        // 2. Text Extraction
        const decompressed = decompressStream(contentsObjRaw, streamLength);
        console.log('\n--- RAW CONTENT STREAM ---');
        console.log(decompressed);

        const fonts = findFontAndCMap(buffer, pdfString, pageObj);
        console.log('\n--- FONTS & CMAPS ---');
        for (const [name, font] of Object.entries(fonts)) {
            console.log(`\nFont ${name}:`);
            console.log('  CMap entries:', font.cmapMap);
        }

        console.log('\n--- TRANSLATED TEXT ---');
        const textElements = processContentStream(decompressed, fonts);
        textElements.forEach(el => console.log(el.text));

        console.log('\n--- FINAL PDF CONTENT ---');
        const finalText = textElements.map(el => el.text).join('\n');
        console.log(finalText || '[No translatable text found]');

        detectParasAndHeaders(textElements);

        // 3. Image Extraction and Storage
        const imagesData = scanForImages(buffer, pdfString);
        storeImages(imagesData);

        // 4. Background Image Extraction (first page only)
        // We pass `pageObj` and the decompressed content stream so the extractor
        // can cross-reference painted XObjects with page dimensions without
        // re-reading from disk.
        const bgImage = extractBackgroundImage(buffer, pdfString, pageObj, decompressed);
        storeBackgroundImage(bgImage);

    } catch (err) {
        console.error(`\n[!] ERROR: ${err.message}`);
    }
}

module.exports = {
    extractAndTranslatePdf
};