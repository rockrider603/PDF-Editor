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
        
        /** Matches object headers like "1 0 obj" — uses lookbehind/ahead to avoid partial matches (e.g. "12 0 obj" matching id=2) */
        objectHeaderByIdGen: (id, gen) => new RegExp(`(?<!\\d)${id}(?!\\d)\\s+${gen}(?!\\d)\\s+obj`),
        
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

        // Font Dictionary — matches entries like "/F1 3 0 R" inside a font dict
        fontNameRefEntries: /\/[A-Za-z0-9]+\s+\d+\s+\d+\s+R/g,

        // Content Stream — font selection: "/F1 12 Tf" → captures the digit(s) after /F
        fontTf: /\/F(\d+)\s+[\d.]+\s+Tf/,

        // Content Stream — text position: "x y Td" or "a b c d x y Tm" → captures x, y
        tmPosition: /(-?[\d.]+)\s+(-?[\d.]+)\s+(?:Td|Tm)/,

        // Content Stream — TJ array: "[<hex>18<hex>]TJ" → captures inner content
        tjArray: /\[([^\]]+)\]TJ/,

        // Content Stream — individual parts inside a TJ array (hex strings or kern numbers)
        tjParts: /<[^>]+>|-?\d+/g,

        // Content Stream — single hex Tj: "<0A0B> Tj" → captures hex string
        tjSingle: /<([^>]+)>\s*Tj/,

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