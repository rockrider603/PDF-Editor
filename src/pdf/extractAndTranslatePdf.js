const fs = require('fs');
const path = require('path');

// New additions for MongoDB connection
const { connectDB, client } = require('../../db'); // [NEW] Import the MongoDB connection helper

// New additions
const { getImageObjectNumbers, extractAllImageData,processEntirePdf, displayImageData, findXObjects, processImages, storeAndDisplayImages } = require('./images/pdfImageXObjectProcessor');

const { findRootRef, extractFirstKid } = require('./core/pdfPageTreeResolver');
const { getObject, extractValue, resolveLength, decompressStream } = require('./core/pdfObjectReader');
const { findFontAndCMap } = require('./text/pdfFontCMapResolver');
const { processContentStream, detectParasAndHeaders } = require('./text/pdfContentStreamTextProcessor');
const { extractAndLogImageData } = require('./images/pdfImageXObjectProcessor');

// [CHANGED] Added 'async' keyword to handle MongoDB database operations
async function extractAndTranslatePdf(filePath) {
    try {
        // [NEW] Initialize MongoDB connection and get the 'pdf_images' collection
        const collection = await connectDB(); 

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
            console.log('  CMap entries:', font.cmapMap);
        }

        // const images = findXObjects(buffer, pdfString, pageObj);
        // processImages(images);

        // const objectNumbers = getImageObjectNumbers(buffer, pdfString, pageObj);
        // const imageDataArray = extractAllImageData(buffer, pdfString, objectNumbers);
        
        // // [CHANGED] Swapped displayImageData for storeAndDisplayImages to support MongoDB persistence
        // // [NEW] Added 'await' and passed the 'collection' variable to the processor
        // await storeAndDisplayImages(imageDataArray, collection);

        await processEntirePdf(buffer, pdfString, collection);

        console.log('\n--- TRANSLATED TEXT ---');
        const textElements = processContentStream(decompressed, fonts);

        textElements.forEach(el => console.log(el.text));

        console.log('\n--- FINAL PDF CONTENT ---');
        const finalText = textElements.map(el => el.text).join('\n');
        console.log(finalText || '[No translatable text found]');

        detectParasAndHeaders(textElements);

    } catch (err) {
        console.error(`\n[!] ERROR: ${err.message}`);
    } finally {
        // [NEW] Ensure the MongoDB connection is closed after processing is complete
        if (client) {
            await client.close();
            console.log("\n[Note] MongoDB connection closed.");
        }
    }
}

module.exports = {
    extractAndTranslatePdf
};