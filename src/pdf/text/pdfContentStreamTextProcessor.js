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
    console.log('\n[processContentStream] Starting to extract text elements with positioning...');
    const lines = decompressed.split('\n');
    let currentFont = null;
    let currentY = null;
    let currentX = null;
    const groupedLines = [];

    function appendTextChunk(text) {
        if (!text) return;

        if (groupedLines.length === 0) {
            groupedLines.push({
                y: currentY,
                x: currentX,
                text
            });
            console.log(`  [+] Element 1: x=${currentX}, y=${currentY}, text="${text.substring(0, 50)}..."`);
            return;
        }

        const last = groupedLines[groupedLines.length - 1];
        if (
            typeof currentY === 'number' &&
            typeof last.y === 'number' &&
            Math.abs(last.y - currentY) <= 0.5
        ) {
            last.text += text;
            console.log(`  [+] Appending to element: "${text.substring(0, 30)}..."`);
        } else {
            groupedLines.push({
                y: currentY,
                x: currentX,
                text
            });
            console.log(`  [+] Element ${groupedLines.length}: x=${currentX}, y=${currentY}, text="${text.substring(0, 50)}..."`);
        }
    }

    for (const line of lines) {
        const fontMatch = line.match(/\/F(\d+)\s+(\d+)\s+Tf/);
        if (fontMatch) {
            currentFont = 'F' + fontMatch[1];
        }

        // Extract both X and Y from Tm command
        const tmMatch = line.match(/1\s+0\s+0\s+1\s+([\-\d.]+)\s+([\-\d.]+)\s+Tm/);
        if (tmMatch) {
            currentX = parseFloat(tmMatch[1]);
            currentY = parseFloat(tmMatch[2]);
            console.log(`  [Tm] Position: x=${currentX}, y=${currentY}`);
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
            appendTextChunk(translated);
        }
    }

    // RETURN THE ARRAY WITH POSITIONING DATA
    const result = groupedLines.map(item => ({
        text: item.text.trim(),
        x: item.x,
        y: item.y,
        width: item.text.length * 5.5
    })).filter(item => item.text.length > 0);

    console.log(`\n[processContentStream] Extracted ${result.length} text elements with positioning data:`);
    result.forEach((el, idx) => {
        console.log(`  [${idx + 1}] x=${el.x}, y=${el.y}, width=${el.width.toFixed(2)}, text="${el.text}"`);
    });

    return result;
}


function detectParasAndHeaders(textElements) {
    console.log('\n[detectParasAndHeaders] Starting detection...');

    // Input validation
    if (!Array.isArray(textElements)) {
        console.log('[!] ERROR: textElements is not an array!');
        console.log(`  Type received: ${typeof textElements}`);
        return { headers: [], paragraphs: [], headerCount: 0, paragraphCount: 0, detailed: { headers: [], paragraphs: [] } };
    }

    console.log(`[detectParasAndHeaders] Received ${textElements.length} text elements to classify`);

    const headers = [];
    const paragraphs = [];

    // Standard PDF page width (letter size)
    const PAGE_WIDTH = 612;
    const PAGE_CENTER = PAGE_WIDTH / 2;
    const CENTER_TOLERANCE = 40;
    const LEFT_MARGIN_THRESHOLD = 100;

    console.log(`[Config] PAGE_WIDTH=${PAGE_WIDTH}, PAGE_CENTER=${PAGE_CENTER}, CENTER_TOLERANCE=${CENTER_TOLERANCE}, LEFT_MARGIN_THRESHOLD=${LEFT_MARGIN_THRESHOLD}`);

    // Process each text element with position data
    for (let idx = 0; idx < textElements.length; idx++) {
        const element = textElements[idx];

        if (!element || !element.text || element.text.trim() === '') {
            console.log(`  [${idx}] SKIPPED: Empty or invalid element`);
            continue;
        }

        const text = element.text.trim();
        const xPosition = element.x || 0;
        const elementWidth = element.width || (text.length * 5.5);
        const elementCenter = xPosition + (elementWidth / 2);
        const distanceFromCenter = Math.abs(elementCenter - PAGE_CENTER);

        console.log(`\n  [${idx}] Text: "${text}"`);
        console.log(`       x=${xPosition}, width=${elementWidth.toFixed(2)}, elementCenter=${elementCenter.toFixed(2)}`);
        console.log(`       distanceFromCenter=${distanceFromCenter.toFixed(2)}, isLeft=${xPosition < LEFT_MARGIN_THRESHOLD}`);

        // Check if element is CENTER-ALIGNED (Header)
        if (distanceFromCenter < CENTER_TOLERANCE) {
            headers.push({
                text: text,
                xPosition: xPosition,
                elementCenter: elementCenter,
                alignment: 'center'
            });
            console.log(`       ✓ CLASSIFIED AS: HEADER (centered)`);
        }
        // Check if element is LEFT-ALIGNED (Paragraph)
        else if (xPosition < LEFT_MARGIN_THRESHOLD) {
            paragraphs.push({
                text: text,
                xPosition: xPosition,
                elementCenter: elementCenter,
                alignment: 'left'
            });
            console.log(`       ✓ CLASSIFIED AS: PARAGRAPH (left-aligned)`);
        }
        else {
            console.log(`       ✗ NOT CLASSIFIED (doesn't meet criteria)`);
        }
    }

    // Display results
    console.log('\n--- PARAGRAPHS & HEADERS SUMMARY ---');
    console.log(`Headers : ${headers.length}`);
    headers.forEach(h => console.log(`(${h.text})`));

    console.log(`\nParagraphs : ${paragraphs.length}`);
    paragraphs.forEach(p => console.log(`(${p.text})`));

    return {
        headers: headers.map(h => h.text),
        paragraphs: paragraphs.map(p => p.text),
        headerCount: headers.length,
        paragraphCount: paragraphs.length,
        detailed: { headers, paragraphs }
    };
}


module.exports = {
    decodePdfLiteralString,
    processContentStream,
    detectParasAndHeaders
};
