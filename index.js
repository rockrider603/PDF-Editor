const { extractAndTranslatePdf } = require('./src/pdf/extractAndTranslatePdf');

const target = process.argv[2];
if (!target) {
    console.log('Usage: node index.js <file.pdf>');
} else {
    extractAndTranslatePdf(target);
}