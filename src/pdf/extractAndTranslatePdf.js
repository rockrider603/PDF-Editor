const fs = require('fs');
const path = require('path');

const { findRootRef, extractFirstKid } = require('./core/pdfPageTreeResolver');
const { getObject, extractValue, resolveLength, decompressStream } = require('./core/pdfObjectReader');
const { findFontAndCMap } = require('./text/pdfFontCMapResolver');
const { processContentStream, detectParasAndHeaders } = require('./text/pdfContentStreamTextProcessor');
const { findXObjects, processImages } = require('./images/pdfImageXObjectProcessor');

function extractAndTranslatePdf(filePath) {
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
            console.log('  CMap entries:', font.cmapMap);
        }

        const images = findXObjects(buffer, pdfString, pageObj);
        processImages(images);

        console.log('\n--- TRANSLATED TEXT ---');
        const textElements = processContentStream(decompressed, fonts);  // Now returns array of objects

        // Display the text
        textElements.forEach(el => console.log(el.text));

        console.log('\n--- FINAL PDF CONTENT ---');
        const finalText = textElements.map(el => el.text).join('\n');
        console.log(finalText || '[No translatable text found]');

        // Now pass the ARRAY of objects, not just text
        detectParasAndHeaders(textElements);
    } catch (err) {
        console.error(`\n[!] ERROR: ${err.message}`);
    }
}

module.exports = {
    extractAndTranslatePdf
};
