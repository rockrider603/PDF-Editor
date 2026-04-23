/**
 * PDF_REGEX provides a centralized collection of Regular Expressions
 * for parsing PDF structure, images, CMap, and text streams.
 */
const PDF_REGEX = {
    common: {
        whitespace: /\s+/,
        numeric: /-?\d+(\.\d+)?/,
        lineBreaks: /\r?\n/
    },

    core: {
        // Structural references
        rootRef: /\/Root\s+(\d+\s+\d+\s+R)/,
        kidsArray: /\/Kids\s*\[([^\]]+)\]/,
        leadingIndirectRef: /^(\d+\s+\d+\s+R)/,
        
        // Object parsing
        indirectLengthObject: /obj\s*(\d+)\s*endobj/,
        directNumericLine: /^\s*(\d+)\s*$/m,
        
        /** Matches object headers like "1 0 obj" */
        objectHeaderByIdGen: (id, gen) => new RegExp(`${id}\\s+${gen}\\s+obj`, 'g'),
        
        /** Extracts values for keys like /Length or /Type */
        dictValueByKey: (key) => {
            const escapedKey = key.replace(/\//g, '\\/');
            return new RegExp(`${escapedKey}\\s+([^\\/\\>\\<]+)`, 'i');
        }
    },

    images: {
        // Page and Resource Blocks
        pageObjectBlock: /\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Page[\s\S]*?endobj/g,
        xObjectRefEntries: /\/([A-Za-z0-9]+)\s+(\d+)\s+\d+\s+R/g,
        
        // Metadata extraction
        width: /\/Width\s+(\d+)/,
        height: /\/Height\s+(\d+)/,
        length: /\/Length\s+(\d+)/,
        filter: /\/Filter\s*\/([A-Za-z0-9]+)/,
        colorSpace: /\/ColorSpace\s*\/([A-Za-z0-9]+)/,
        bitsPerComponent: /\/BitsPerComponent\s+(\d+)/,
        mediaBox: /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/,

        // DecodeParms extraction
        decodeParmsBlock: /\/DecodeParms\s*<<([^>]+)>>/,
        predictor: /\/Predictor\s+(\d+)/,
        colors: /\/Colors\s+(\d+)/,
        columns: /\/Columns\s+(\d+)/,

        // Content Stream Operations
        cmOperation: /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm/,
        doOperation: /\/([A-Za-z0-9]+)\s+Do/
    },

    text: {
        // CMap Parsing
        bfchar: /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/,
        bfrange: /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/,
        cleanedHexBrackets: /[<>]/g,

        // Literal String Escaping
        escapedBackslash: /\\\\/g,
        escapedOpenParen: /\\\(/g,
        escapedCloseParen: /\\\)/g,
        escapedNewline: /\\n/g,
        escapedCarriageReturn: /\\r/g,
        escapedTab: /\\t/g,
        escapedBackspace: /\\b/g,
        escapedFormFeed: /\\f/g
    }
};

module.exports = { PDF_REGEX };