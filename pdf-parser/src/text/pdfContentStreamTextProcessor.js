import { translateText } from './pdfCMapParser.js';
import { PDF_REGEX } from '../utils/pdfRegex.js';

// ── Literal String Decoding ───────────────────────────────────────────────────

/**
 * Decodes PDF literal string escape sequences into their real characters.
 * Strips the surrounding `(` `)` delimiters if present.
 *
 * @param {string} token - Raw PDF literal string token, e.g. `(Hello\nWorld)`.
 * @returns {string}
 */
function decodePdfLiteralString(token) {
    let inner = token;
    if (inner.startsWith('(') && inner.endsWith(')')) {
        inner = inner.slice(1, -1);
    }
    return inner
        .replace(PDF_REGEX.text.escapedBackslash,      '\\')
        .replace(PDF_REGEX.text.escapedOpenParen,      '(')
        .replace(PDF_REGEX.text.escapedCloseParen,     ')')
        .replace(PDF_REGEX.text.escapedNewline,        '\n')
        .replace(PDF_REGEX.text.escapedCarriageReturn, '\r')
        .replace(PDF_REGEX.text.escapedTab,            '\t')
        .replace(PDF_REGEX.text.escapedBackspace,      '\b')
        .replace(PDF_REGEX.text.escapedFormFeed,       '\f');
}

// ── Content Stream Processing ─────────────────────────────────────────────────

/**
 * Walks a decompressed PDF content stream and extracts all text elements
 * with their (x, y) positions from `Tm` / `Td` operators.
 *
 * Text chunks sharing the same Y coordinate (within 0.5pt) are merged
 * into a single element to reconstruct logical text runs.
 *
 * @param {string} decompressed - Decompressed content stream text.
 * @param {Record<string, { cmapMap: Record<string, string> }>} fonts
 *   Map of font names (e.g. `"F1"`) to their parsed CMap data.
 * @returns {{ text: string, x: number, y: number, width: number }[]}
 */
export function processContentStream(decompressed, fonts) {
    const lines = decompressed.split('\n');
    let currentFont     = null;
    let currentFontSize = null;
    let currentY        = null;
    let currentX        = null;
    const groupedLines = [];

    function appendTextChunk(text) {
        if (!text) return;

        if (groupedLines.length === 0) {
            groupedLines.push({ y: currentY, x: currentX, fontSize: currentFontSize, text });
            return;
        }

        const last = groupedLines[groupedLines.length - 1];
        if (
            typeof currentY === 'number' &&
            typeof last.y  === 'number' &&
            Math.abs(last.y - currentY) <= 0.5
        ) {
            last.text += text;
        } else {
            groupedLines.push({ y: currentY, x: currentX, fontSize: currentFontSize, text });
        }
    }

    for (const line of lines) {
        const fontMatch = line.match(PDF_REGEX.text.fontTf);
        if (fontMatch) {
            currentFont     = 'F' + fontMatch[1];
            currentFontSize = parseFloat(fontMatch[2]);
        }

        const tmMatch = line.match(PDF_REGEX.text.tmPosition);
        if (tmMatch) {
            currentX = parseFloat(tmMatch[1]);
            currentY = parseFloat(tmMatch[2]);
        }

        const tjArrayMatch = line.match(PDF_REGEX.text.tjArray);
        if (tjArrayMatch && currentFont && fonts[currentFont]) {
            const parts = tjArrayMatch[1].match(PDF_REGEX.text.tjParts) || [];
            let combined = '';
            for (const part of parts) {
                if (part.startsWith('<')) {
                    combined += translateText(fonts[currentFont].cmapMap, part);
                } else if (part.startsWith('(')) {
                    combined += decodePdfLiteralString(part);
                } else {
                    // It's a kerning number.
                    // Negative numbers shift text to the right (adding space).
                    // A large negative value is commonly used to simulate a space character.
                    const kern = parseFloat(part);
                    if (kern < -150) {
                        combined += ' ';
                    }
                }
            }
            if (combined) appendTextChunk(combined);
            continue;
        }

        const tjSingleMatch = line.match(PDF_REGEX.text.tjSingle);
        if (tjSingleMatch && currentFont && fonts[currentFont]) {
            appendTextChunk(translateText(fonts[currentFont].cmapMap, tjSingleMatch[1]));
        }
    }

    return groupedLines
        .map(item => ({
            text:     item.text.trim(),
            x:        item.x,
            y:        item.y,
            fontSize: item.fontSize,
            width:    item.text.length * 5.5
        }))
        .filter(item => item.text.length > 0);
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Groups body-text lines into logical paragraphs using the line-fill heuristic.
 *
 * A paragraph boundary is detected when the previous line's width is less than
 * SHORT_LINE_RATIO of the block's maximum observed line width — indicating the
 * previous line was the last (short) line of a paragraph.
 *
 * A large Y gap between consecutive lines also triggers a paragraph break.
 *
 * @param {Array<{ text: string, x: number, y: number, width: number, fontSize: number }>} bodyLines 
 *   - Body-text lines sorted by y DESC (reading order).
 * @returns {Map<number, { id: number, lines: Array<any>, x: number, y: number, width: number, fontSize: number }>}  
 *   1-indexed paragraph map.
 */
export function groupIntoParagraphs(bodyLines) {
    const paragraphs = new Map();
    if (bodyLines.length === 0) return paragraphs;

    const SHORT_LINE_RATIO    = 0.85;   // line is "short" if width < maxBlockWidth * this
    const Y_GAP_MULTIPLIER    = 2.5;    // y gap > avgLineHeight * this → paragraph break
    const DEFAULT_LINE_HEIGHT = 14;     // fallback pts when fontSize is unavailable

    // Sort descending by y (highest y = topmost line in PDF space = first to read)
    const sorted = [...bodyLines].sort((a, b) => b.y - a.y);

    // Estimate average line height from font sizes
    const avgFontSize = sorted.reduce((s, l) => s + (l.fontSize || DEFAULT_LINE_HEIGHT), 0) / sorted.length;
    const avgLineHeight = avgFontSize * 1.2;

    let paraId        = 1;
    let currentLines  = [sorted[0]];
    let maxWidth      = sorted[0].width || 0;

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        const yGap           = prev.y - curr.y;                         // should be positive
        const prevLineShort  = (prev.width || 0) < maxWidth * SHORT_LINE_RATIO;
        const largeYGap      = yGap > avgLineHeight * Y_GAP_MULTIPLIER;

        if (prevLineShort || largeYGap) {
            // Finalize current paragraph
            paragraphs.set(paraId, {
                id:       paraId,
                lines:    currentLines,
                x:        currentLines[0].x,
                y:        currentLines[0].y,
                width:    maxWidth,
                fontSize: currentLines[0].fontSize ?? DEFAULT_LINE_HEIGHT
            });
            paraId++;
            currentLines = [curr];
            maxWidth     = curr.width || 0;
        } else {
            currentLines.push(curr);
            maxWidth = Math.max(maxWidth, curr.width || 0);
        }
    }

    // Finalize last paragraph
    paragraphs.set(paraId, {
        id:       paraId,
        lines:    currentLines,
        x:        currentLines[0].x,
        y:        currentLines[0].y,
        width:    maxWidth,
        fontSize: currentLines[0].fontSize ?? DEFAULT_LINE_HEIGHT
    });

    return paragraphs;
}

/**
 * Classifies an array of positioned text elements as headers or paragraphs.
 *
 * Classification rules (using standard letter-page defaults):
 *   - HEADER   : element center is within `CENTER_TOLERANCE` pts of the page centre.
 *   - PARAGRAPH: built using the `groupIntoParagraphs` line-fill heuristic.
 *
 * @param {Array<{ text: string, x: number, y: number, width: number, fontSize: number }>} textElements
 * @param {number} [pageWidth=612] - Page width in PDF points (US Letter default).
 * @returns {{
 *   headers:        string[],
 *   headerCount:    number,
 *   text:           string[],
 *   textCount:      number,
 *   paragraphs:     Map<number, { id: number, lines: Array<any>, x: number, y: number, width: number, fontSize: number }>,
 *   paragraphCount: number,
 *   detailed: {
 *     headers:    Array<{ text, xPosition, elementCenter, alignment }>,
 *     text:       Array<{ text, x, y, width, fontSize }>,
 *     paragraphs: Map<number, { id, lines, x, y, width, fontSize }>
 *   }
 * }}
 */
export function detectParasAndHeaders(textElements, pageWidth = 612) {
    if (!Array.isArray(textElements)) {
        return { headers: [], headerCount: 0, text: [], textCount: 0,
                 paragraphs: new Map(), paragraphCount: 0,
                 detailed: { headers: [], text: [], paragraphs: new Map() } };
    }

    const PAGE_CENTER            = pageWidth / 2;
    const CENTER_TOLERANCE       = pageWidth * 0.065;   // ~40pt on 612pt page

    const headers   = [];
    const bodyLines = [];

    for (const element of textElements) {
        if (!element?.text || element.text.trim() === '') continue;

        const text           = element.text.trim();
        const xPosition      = element.x || 0;
        const elementWidth   = element.width || text.length * 5.5;
        const elementCenter  = xPosition + elementWidth / 2;
        const distFromCenter = Math.abs(elementCenter - PAGE_CENTER);

        if (distFromCenter < CENTER_TOLERANCE) {
            headers.push({
                text,
                xPosition:     xPosition,
                yPosition:     element.y,
                fontSize:      element.fontSize,
                elementCenter: elementCenter,
                alignment:     'center'
            });
        } else {
            bodyLines.push(element);
        }
    }

    const paragraphMap = groupIntoParagraphs(bodyLines);

    return {
        headers:        headers.map(h => h.text),
        headerCount:    headers.length,
        text:           bodyLines.map(l => l.text),
        textCount:      bodyLines.length,
        paragraphs:     paragraphMap,
        paragraphCount: paragraphMap.size,
        detailed:       { headers, text: bodyLines, paragraphs: paragraphMap }
    };
}

export { decodePdfLiteralString };
