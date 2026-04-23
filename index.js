const { extractAndTranslatePdf } = require('./pdf/extractAndTranslatePdf');
const fs=require('fs');
const path=require('path');

const target = process.argv[2];
console.log("ARGV:", process.argv);
console.log("TARGET:", target);

console.log("Input:", target);
console.log("Resolved:", path.resolve(target));
console.log("Exists:", fs.existsSync(target));


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