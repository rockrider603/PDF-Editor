const fs = require('fs');
const path = require('path');

const target = process.argv[2] || 'Hello World (1).pdf';
if (!target) {
    console.log('Usage: node index.js <file.pdf>');
    process.exit(1);
}

console.log("Input:", target);
console.log("Resolved:", path.resolve(target));
console.log("Exists:", fs.existsSync(target));

(async () => {
    try {
        // Dynamically import the ESM SDK from the new pdf-parser package
        const { PdfDocument } = await import('pdf-parser');

        console.log("\n--- Testing pdf-parser SDK ---");
        const buffer = fs.readFileSync(target);
        
        // Use the constructor directly since we have a Buffer in Node, not a browser File
        const doc = new PdfDocument(new Uint8Array(buffer));
        console.log("1. Document loaded successfully");

        const page = await doc.getPage(1);
        console.log("2. Page 1 parsed successfully");
        console.log(`   Dimensions: ${page.dimensions.width} x ${page.dimensions.height} pts`);

        const textElements = await page.getText();
        console.log(`3. Text extraction successful: found ${textElements.length} text runs`);

        const classification = page.classifyText(textElements);
        console.log(`4. Classification successful: ${classification.headerCount} headers, ${classification.paragraphCount} paragraphs`);

        console.log("\n--- Sample Content ---");
        if (classification.headers.length > 0) {
            console.log("Headers:");
            classification.headers.slice(0, 3).forEach(h => console.log(`  - ${h}`));
        }
        if (classification.text.length > 0) {
            console.log("Text lines:");
            classification.text.slice(0, 3).forEach(p => console.log(`  - ${p.substring(0, 60)}...`));
        }
        if (classification.paragraphs && classification.paragraphs.size > 0) {
            console.log(`Paragraphs (${classification.paragraphs.size}):`);
            for (const [id, para] of classification.paragraphs.entries()) {
                console.log(`  Para ${id} (${para.lines.length} lines, x=${para.x}, y=${para.y}):`);
                para.lines.slice(0, 2).forEach(l => console.log(`    [${l.y.toFixed(1)}] ${l.text.substring(0, 60)}`));
            }
        }

        console.log("\n--- Image Extraction ---");
        try {
            // This will likely throw ReferenceError in Node because document.createElement('canvas') is not defined
            const images = await page.getImages();
            console.log("Images extracted successfully:");
            console.log(`  Background: ${images.background ? 'Yes' : 'No'}`);
            console.log(`  Page images: ${images.pageImages.length}`);
        } catch (imgErr) {
            console.log("Image extraction skipped (Expected in Node environment without DOM/Canvas API):");
            console.log(`  Reason: ${imgErr.message}`);
        }

        console.log("\nSDK test complete.");
    } catch (err) {
        console.error("\nCritical Failure during SDK test:", err);
        process.exit(1);
    }
})();