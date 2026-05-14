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
        .replace(PDF_REGEX.text.escapedBackslash, '\\')
        .replace(PDF_REGEX.text.escapedOpenParen, '(')
        .replace(PDF_REGEX.text.escapedCloseParen, ')')
        .replace(PDF_REGEX.text.escapedNewline, '\n')
        .replace(PDF_REGEX.text.escapedCarriageReturn, '\r')
        .replace(PDF_REGEX.text.escapedTab, '\t')
        .replace(PDF_REGEX.text.escapedBackspace, '\b')
        .replace(PDF_REGEX.text.escapedFormFeed, '\f');
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
    let currentFont = null;
    let currentFontSize = null;
    let currentY = null;
    let currentX = null;
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
            typeof last.y === 'number' &&
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
            currentFont = 'F' + fontMatch[1];
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
            text: item.text.trim(),
            x: item.x,
            y: item.y,
            fontSize: item.fontSize,
            width: item.text.length * 5.5
        }))
        .filter(item => item.text.length > 0);
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Groups body-text lines into logical paragraphs using x and y coordinate thresholds.
 *
 * A paragraph boundary is detected when any of the following conditions in the priority queue are met:
 * 1. Spacing After: dely > (FontSize) * Multiplierz + ythreshold
 * 2. Short Line: xend < xmargin - xthreshold
 * 3. Indented Start: xcurr > xnorm + xthreshold
 * 4. Hanging Indent: xcurr < xprev
 *
 * @param {Array<{ text: string, x: number, y: number, width: number, fontSize: number, type: string }>} bodyLines 
 *   - Body-text lines sorted by y DESC (reading order).
 * @returns {Map<number, { id: number, lines: Array<any>, type: string, text: string, x: number, y: number, width: number, fontSize: number }>}  
 *   1-indexed paragraph map.
 */
export function groupIntoParagraphs(bodyLines) {
    const paragraphs = new Map();
    if (bodyLines.length === 0) return paragraphs;

    const xthreshold = 15;
    const ythreshold = 4;
    const Multiplierz = 1.2;
    const DEFAULT_LINE_HEIGHT = 14;

    // Calculate document-wide or block-wide normal x and right margin
    let xnorm = Infinity;
    let xmargin = -Infinity;
    for (const line of bodyLines) {
        if (line.x < xnorm) xnorm = line.x;
        if (line.x + (line.width || 0) > xmargin) xmargin = line.x + (line.width || 0);
    }

    // Sort descending by y (highest y = topmost line in PDF space = first to read)
    const sorted = [...bodyLines].sort((a, b) => b.y - a.y);

    let paraId = 1;
    let currentLines = [sorted[0]];
    let maxWidth = sorted[0].width || 0;

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        const xcurr = curr.x;
        const xprev = prev.x;
        const xend = prev.x + (prev.width || 0);
        const dely = prev.y - curr.y; // Positive since sorted by descending y

        const fontSize = curr.fontSize || DEFAULT_LINE_HEIGHT;

        let isNewParagraph = false;

        // Priority Queue for Paragraph Detection
        if (dely > (fontSize * Multiplierz) + ythreshold) {
            isNewParagraph = true; // 1. Spacing After
        } else if (xend < xmargin - xthreshold) {
            isNewParagraph = true; // 2. Short Line
        } else if (xcurr > xnorm + xthreshold) {
            isNewParagraph = true; // 3. Indented Start
        } else if (xcurr < xprev) {
            isNewParagraph = true; // 4. Hanging Indent
        }

        if (isNewParagraph) {
            // Finalize current paragraph
            paragraphs.set(paraId, {
                id: paraId,
                lines: currentLines,
                type: 'Paragraph',
                text: currentLines.map(l => l.text).join(' '),
                x: currentLines[0].x,
                y: currentLines[0].y,
                width: maxWidth,
                fontSize: currentLines[0].fontSize ?? DEFAULT_LINE_HEIGHT
            });
            paraId++;
            currentLines = [curr];
            maxWidth = curr.width || 0;
        } else {
            currentLines.push(curr);
            maxWidth = Math.max(maxWidth, curr.width || 0);
        }
    }

    // Finalize last paragraph
    paragraphs.set(paraId, {
        id: paraId,
        lines: currentLines,
        type: 'Paragraph',
        text: currentLines.map(l => l.text).join(' '),
        x: currentLines[0].x,
        y: currentLines[0].y,
        width: maxWidth,
        fontSize: currentLines[0].fontSize ?? DEFAULT_LINE_HEIGHT
    });

    return paragraphs;
}

/**
 * Classifies an array of positioned text elements as headers or paragraphs.
 *
 * Classification rules (using standard letter-page defaults):
 *   - HEADER   : element center is within `CENTER_TOLERANCE` pts of the page centre.
 *   - PARAGRAPH: built using the `groupIntoParagraphs` coordinate-based logic.
 *
 * @param {Array<{ text: string, x: number, y: number, width: number, fontSize: number }>} textElements
 * @param {number} [pageWidth=612] - Page width in PDF points (US Letter default).
 * @returns {{
 *   headers:        string[],
 *   headerCount:    number,
 *   text:           string[],
 *   textCount:      number,
 *   paragraphs:     Map<number, { id: number, lines: Array<any>, type: string, text: string, x: number, y: number, width: number, fontSize: number }>,
 *   paragraphCount: number,
 *   textBlocks:     Array<any>,
 *   detailed: {
 *     headers:    Array<{ text, type, xPosition, yPosition, x, y, elementCenter, alignment }>,
 *     text:       Array<{ text, type, x, y, width, fontSize }>,
 *     paragraphs: Map<number, { id, lines, type, text, x, y, width, fontSize }>,
 *     textBlocks: Array<any>
 *   }
 * }}
 */
export function detectParasAndHeaders(textElements, pageWidth = 612) {
    if (!Array.isArray(textElements)) {
        return {
            headers: [], headerCount: 0, text: [], textCount: 0,
            paragraphs: new Map(), paragraphCount: 0, textBlocks: [],
            detailed: { headers: [], text: [], paragraphs: new Map(), textBlocks: [] }
        };
    }

    const PAGE_CENTER = pageWidth / 2;
    const CENTER_TOLERANCE = pageWidth * 0.065;   // ~40pt on 612pt page

    const headers = [];
    const bodyLines = [];

    for (const element of textElements) {
        if (!element?.text || element.text.trim() === '') continue;

        const text = element.text.trim();
        const xPosition = element.x || 0;
        const elementWidth = element.width || text.length * 5.5;
        const elementCenter = xPosition + elementWidth / 2;
        const distFromCenter = Math.abs(elementCenter - PAGE_CENTER);

        if (distFromCenter < CENTER_TOLERANCE) {
            headers.push({
                text,
                type: 'header',
                xPosition: xPosition,
                yPosition: element.y,
                x: xPosition,
                y: element.y,
                fontSize: element.fontSize,
                elementCenter: elementCenter,
                alignment: 'center'
            });
        } else {
            bodyLines.push({
                ...element,
                type: 'line'
            });
        }
    }

    const paragraphMap = groupIntoParagraphs(bodyLines);

    const paragraphBlocks = Array.from(paragraphMap.values());
    const allBlocks = [...headers, ...paragraphBlocks].sort((a, b) => (b.y || b.yPosition || 0) - (a.y || a.yPosition || 0));

    // console.log("----- Extracted Text Blocks -----");
    // for (const block of allBlocks) {
    //     console.log(`[Type: ${block.type}] ${block.text.substring(0, 100)}`);
    // }
    // console.log("---------------------------------");

    return {
        headers: headers.map(h => h.text),
        headerCount: headers.length,
        text: bodyLines.map(l => l.text),
        textCount: bodyLines.length,
        paragraphs: paragraphMap,
        paragraphCount: paragraphMap.size,
        textBlocks: allBlocks,
        detailed: { headers, text: bodyLines, paragraphs: paragraphMap, textBlocks: allBlocks }
    };
}

export { decodePdfLiteralString };

// ── Cross-Page Paragraph Detection ────────────────────────────────────────────

/**
 * Groups positioned text elements across all pages into paragraphs.
 *
 * Rule: a paragraph breaks between two consecutive lines when their vertical
 * gap exceeds `prev.fontSize * 1.5` (in PDF user-space points). Same-line
 * elements (multiple chunks at the same y) stay in the same paragraph
 * because their gap is ~0.
 *
 * Page boundary: every page starts a new paragraph. A line at the bottom of
 * one page and its visual continuation at the top of the next are reported as
 * two distinct paragraphs by design.
 *
 * Each page's elements are sorted by y DESC (top-of-page first) before pair
 * analysis, so this function is safe to call on a `textElements[]` whose
 * array order has been disturbed by edits (insertTextElement, splitTextElement).
 *
 * @param {Array<Array<{ text: string, x: number, y: number, width: number, fontSize: number }>>} textElementsPerPage
 *   Outer array indexed by pageIdx; inner array is that page's textElements.
 * @returns {Array<{
 *   paragraphIdx: number,
 *   lines: Array<{ pageIdx: number, elIdx: number, el: object }>
 * }>}
 */
export function detectParagraphsFromElements(textElementsPerPage) {
    const result = [];
    if (!Array.isArray(textElementsPerPage)) return result;

    let paragraphIdx = 0;
    let currentLines = [];

    const flushCurrent = () => {
        if (currentLines.length > 0) {
            result.push({ paragraphIdx, lines: currentLines });
            paragraphIdx++;
            currentLines = [];
        }
    };

    for (let pageIdx = 0; pageIdx < textElementsPerPage.length; pageIdx++) {
        const els = textElementsPerPage[pageIdx];
        if (!Array.isArray(els) || els.length === 0) continue;

        // Tag with original elIdx, then sort by y DESC so the walk runs in
        // reading order regardless of how the source array is ordered.
        const tagged = els
            .map((el, elIdx) => ({ el, elIdx }))
            .sort((a, b) => (b.el?.y ?? 0) - (a.el?.y ?? 0));

        // Page boundary always starts a fresh paragraph.
        flushCurrent();
        currentLines.push({ pageIdx, elIdx: tagged[0].elIdx, el: tagged[0].el });

        for (let i = 1; i < tagged.length; i++) {
            const prev = tagged[i - 1].el;
            const curr = tagged[i].el;
            const gap = (prev?.y ?? 0) - (curr?.y ?? 0);
            const lineHeightThreshold = (prev?.fontSize || 12) * 1.5;

            if (gap > lineHeightThreshold) {
                flushCurrent();
            }
            currentLines.push({ pageIdx, elIdx: tagged[i].elIdx, el: curr });
        }
    }

    flushCurrent();
    return result;
}
