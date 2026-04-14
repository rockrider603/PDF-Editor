const { translateText } = require('./pdfCMapParser');

function decodePdfLiteralString(token) {
    let inner = token;
    if (inner.startsWith('(') && inner.endsWith(')')) {
        inner = inner.slice(1, -1);
    }

    return inner
        .replace(/\\\\/g, '\\')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f');
}

function processContentStream(decompressed, fonts) {
    const lines = decompressed.split('\n');
    let currentFont = null;
    let currentY = null;
    const groupedLines = [];

    function appendTextChunk(text) {
        if (!text) return;

        if (groupedLines.length === 0) {
            groupedLines.push({ y: currentY, text });
            return;
        }

        const last = groupedLines[groupedLines.length - 1];
        if (
            typeof currentY === 'number' &&
            typeof last.y === 'number' &&
            Math.abs(last.y - currentY) <= 0.5
        ) {
            last.text += text;
        } else {
            groupedLines.push({ y: currentY, text });
        }
    }

    for (const line of lines) {
        const fontMatch = line.match(/\/F(\d+)\s+(\d+)\s+Tf/);
        if (fontMatch) {
            currentFont = 'F' + fontMatch[1];
        }

        const tmMatch = line.match(/1\s+0\s+0\s+1\s+([\-\d.]+)\s+([\-\d.]+)\s+Tm/);
        if (tmMatch) {
            currentY = parseFloat(tmMatch[2]);
        }

        const tjArrayMatch = line.match(/\[(.*?)\]\s*TJ/);
        if (tjArrayMatch && currentFont && fonts[currentFont]) {
            const parts = tjArrayMatch[1].match(/<([0-9A-Fa-f]+)>|\((?:\\.|[^\\)])*\)/g) || [];
            let combined = '';

            for (const part of parts) {
                let translated = '';
                if (part.startsWith('<')) {
                    translated = translateText(fonts[currentFont].cmapMap, part);
                } else {
                    translated = decodePdfLiteralString(part);
                }
                combined += translated;
                console.log(`Font ${currentFont}: ${part} -> "${translated}"`);
            }

            if (combined) {
                appendTextChunk(combined);
            }
            continue;
        }

        const tjSingleMatch = line.match(/(<[0-9A-Fa-f]+>)\s*Tj/);
        if (tjSingleMatch && currentFont && fonts[currentFont]) {
            const hex = tjSingleMatch[1];
            const translated = translateText(fonts[currentFont].cmapMap, hex);
            console.log(`Font ${currentFont}: ${hex} -> "${translated}"`);
            appendTextChunk(translated);
        }
    }

    return groupedLines
        .map(item => item.text)
        .join('\n')
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.length > 0)
        .join('\n');
}

module.exports = {
    decodePdfLiteralString,
    processContentStream
};
