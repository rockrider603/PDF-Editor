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
 * @returns {object} Structured extraction results
 */
async function extractAndTranslatePdf(filePath) {
    try {
        console.log(`--- Starting Analysis: ${path.basename(filePath)} ---\n`);

        const buffer    = fs.readFileSync(filePath);
        const pdfString = buffer.toString('binary');

        // ── 1. Structure ─────────────────────────────────────────────────────
        const rootRef = findRootRef(pdfString);
        if (!rootRef) throw new Error('[Step 1] findRootRef returned null — trailer /Root not found');
        console.log(`[1] Trailer -> Root: ${rootRef}`);

        const rootObj = getObject(buffer, pdfString, rootRef);
        if (!rootObj) throw new Error(`[Step 1] getObject failed for Root: ${rootRef}`);

        const pagesRef = extractValue(rootObj, '/Pages');
        if (!pagesRef) throw new Error(`[Step 2] extractValue("/Pages") returned empty — rootObj:\n${rootObj}`);
        console.log(`[2] Root -> Pages: ${pagesRef}`);

        const pagesObj = getObject(buffer, pdfString, pagesRef);
        if (!pagesObj) throw new Error(`[Step 2] getObject failed for Pages: ${pagesRef}`);

        const firstPageRef = extractFirstKid(pagesObj, pagesRef);
        if (!firstPageRef) throw new Error(`[Step 3] extractFirstKid returned null — pagesObj:\n${pagesObj}`);
        console.log(`[3] Pages -> First Page: ${firstPageRef}`);

        const pageObj = getObject(buffer, pdfString, firstPageRef);
        if (!pageObj) throw new Error(`[Step 3] getObject failed for first page: ${firstPageRef}`);

        const contentsRef = extractValue(pageObj, '/Contents');
        if (!contentsRef) throw new Error(`[Step 4] extractValue("/Contents") returned empty — pageObj:\n${pageObj}`);
        console.log(`[4] Page -> Contents: ${contentsRef}`);

        const contentsBuffer = getObject(buffer, pdfString, contentsRef, true);
        if (!contentsBuffer || contentsBuffer.length === 0) throw new Error(`[Step 4] getObject returned empty buffer for Contents: "${contentsRef}"`);

        const streamLength = resolveLength(buffer, pdfString, contentsBuffer);
        if (!streamLength || streamLength <= 0) throw new Error(`[Step 5] resolveLength returned invalid value: ${streamLength}`);
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
        const classification = detectParasAndHeaders(textElements);

        // ── 5. Background Image ───────────────────────────────────────────────
        const bgImage = await extractBackgroundImage(buffer, pdfString, pageObj, contentStream);
        storeBackgroundImage(bgImage);

        // ── 6. Page Images ────────────────────────────────────────────────────
        let pageImages = await scanPageImages(buffer, pdfString);
        if (bgImage) {
            pageImages = pageImages.filter(img => img.objNum !== bgImage.objNum);
        }
        storePageImages(pageImages);

        // ── 7. Return Structured Data ─────────────────────────────────────────
        return {
            success: true,
            fileName: path.basename(filePath),
            extractedAt: new Date().toISOString(),
            structure: {
                rootRef,
                pagesRef,
                firstPageRef,
                contentsRef,
                streamLength
            },
            text: {
                rawElements: textElements,
                fullText: textElements.map(el => el.text).join('\n') || '[No translatable text found]',
                classification
            },
            images: {
                background: bgImage,
                pageImages: pageImages,
                totalImages: pageImages.length + (bgImage ? 1 : 0)
            },
            fonts: Object.keys(fonts).map(name => ({
                name,
                cmapEntries: Object.keys(fonts[name].cmapMap).length
            }))
        };

    } catch (err) {
        console.error(`\n[!] ERROR: ${err.message}`);
        return {
            success: false,
            fileName: path.basename(filePath),
            error: err.message,
            extractedAt: new Date().toISOString()
        };
    }
}

module.exports = { extractAndTranslatePdf };