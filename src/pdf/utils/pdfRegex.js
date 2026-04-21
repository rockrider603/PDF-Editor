const PDF_REGEX = {
    common: {
        whitespace: /\s+/,
        lineBreaks: /\r\n|\r|\n/
    },
    core: {
        rootRef: /\/Root\s+(\d+\s+\d+\s+R)/,
        kidsArray: /\/Kids\s*\[\s*([^\]]+)\]/s,
        dictValueByKey: key => new RegExp(`${key}\\s*([\\d\\s+R]+|/[\\w]+|\\d+)`),
        objectHeaderByIdGen: (id, gen) => new RegExp(`(?:^|[\\r\\n\\s])${id}\\s+${gen}\\s+obj`, 'g'),
        indirectLengthObject: /obj\s+(\d+)\s+endobj/s,
        directNumericLine: /^(\d+)$/m,
        leadingIndirectRef: /^(\d+\s+\d+\s+R)/
    },
    images: {
        pageObjectBlock: /(\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Page[\s\S]*?endobj)/g,
        mediaBox: /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/,
        xObjectRefEntries: /\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g,
        cmOperation: /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm\b/,
        doOperation: /\/([^\s/]+)\s+Do\b/,
        decodeParmsBlock: /\/DecodeParms\s*<<([\s\S]*?)>>/,
        colorSpace: /\/ColorSpace\s*\/(\w+)/,
        bitsPerComponent: /\/BitsPerComponent\s+(\d+)/,
        width: /\/Width\s+(\d+)/,
        height: /\/Height\s+(\d+)/,
        filter: /\/Filter\s*\/(\w+)/,
        length: /\/Length\s+(\d+)/,
        predictor: /\/Predictor\s+(\d+)/,
        colors: /\/Colors\s+(\d+)/,
        columns: /\/Columns\s+(\d+)/
    },
    text: {
        fontTf: /\/F(\d+)\s+(\d+)\s+Tf/,
        tmPosition: /1\s+0\s+0\s+1\s+([\-\d.]+)\s+([\-\d.]+)\s+Tm/,
        tjArray: /\[(.*?)\]\s*TJ/,
        tjParts: /<([0-9A-Fa-f]+)>|\((?:\\.|[^\\)])*\)/g,
        tjSingle: /(<[0-9A-Fa-f]+>)\s*Tj/,
        fontNameRefEntries: /\/(\w+)\s+(\d+\s+\d+\s+R)/g,
        bfchar: /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/,
        bfrange: /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/,
        cleanedHexBrackets: /[<>]/g,
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
