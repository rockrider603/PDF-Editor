const { extractAndTranslatePdf } = require('./backend/pdf/extractAndTranslatePdf');

const target = process.argv[2];
if (!target) {
    console.log('Usage: node index.js <file.pdf>');
} else {
    extractAndTranslatePdf(target)
        .then(() => {
            console.log("\nProcessing complete.");
        })
        .catch(err => {
            console.error("Critical Failure:", err);
            process.exit(1);
        });
}