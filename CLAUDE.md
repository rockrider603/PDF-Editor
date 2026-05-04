# CLAUDE.md

Project context and architecture guide for this workspace.

---

## What This Project Is

A **fully browser-side PDF editor** — no server, no uploads, no backend. The user opens a PDF in the browser, and everything (parsing, editing, re-export) happens locally in JavaScript.

**Current capabilities:**
- Parse multi-page PDFs directly in the browser using a custom `pdf-parser` ESM SDK
- Extract and reconstruct text elements with their PDF coordinates and font sizes
- Detect and render background images and inline page images
- Live in-browser text editing: type, delete, bold, italic, resize, recolor
- Re-export the edited state to a downloadable PDF via `pdf-lib`
- Paragraph detection from raw `TextElement[]` using geometry-based heuristics (no pilcrow markers — PDFs have no semantic paragraph structure)

---

## Project Structure

```
PDF-Editor/
├── index.js                        # CLI test harness — runs pdf-parser SDK against a local PDF
├── package.json                    # Root CJS package; depends on pdf-parser via "file:./pdf-parser"
│
├── pdf-parser/                     # The standalone ESM SDK (browser-compatible)
│   ├── package.json                # type: "module", pako + opentype.js deps
│   ├── index.js                    # Barrel re-export — all named exports, tree-shakable
│   ├── PdfDocument.js              # Factory class: fromFile(File) → PdfDocument
│   ├── PdfPage.js                  # Adapter class: getText(), classifyText(), getImages(), extract()
│   └── src/
│       ├── core/
│       │   ├── pdfObjectReader.js      # getObject, extractValue, resolveLength, decompressStream
│       │   ├── pdfDictionaryResolver.js# resolveDictOrRef, extractInlineDictionary
│       │   └── pdfPageTreeResolver.js  # findRootRef, extractFirstKid, extractKidN, extractPageCount
│       ├── text/
│       │   ├── pdfCMapParser.js        # parseCMap, translateText, buildCharMap, decodeUnicodeHex, getCMapCodeLengths
│       │   ├── pdfFontCMapResolver.js  # findFontAndCMap — walks /Resources → /Font → /ToUnicode
│       │   ├── pdfContentStreamTextProcessor.js # processContentStream, detectParasAndHeaders, decodePdfLiteralString
│       │   │                                    # ↳ NOW ALSO EXPORTS: groupIntoLines, getDominantLineGap,
│       │   │                                    #   isParaBreak, detectParagraphs, buildParagraph
│       │   ├── fontDictionaryUpdater.js# font dict patching utilities
│       │   ├── ttfFontLoader.js        # TTF font loading (opentype.js)
│       │   └── index.js               # sub-barrel for "pdf-parser/text"
│       ├── images/
│       │   ├── imageDecoder.js         # decodeImageObject, parseImageMetadata — FlateDecode + DCTDecode
│       │   ├── imageScanner.js         # scanPageImages — discovers all /XObject /Image entries
│       │   ├── pageContentParser.js    # buildXObjectNameMap, parsePaintOperations — no I/O
│       │   └── backgroundDetector.js   # extractBackgroundImage, getPageDimensions — CTM coverage scoring
│       └── utils/
│           ├── bytes.js               # uint8ToBinaryString, indexOfSeq, allocBytes, asciiToBytes
│           └── pdfRegex.js            # PDF_REGEX — all regex patterns centralised here
│
└── frontend/                       # React 18 + Vite + Tailwind v4 + DaisyUI v5
    ├── package.json                # depends on pdf-parser via "file:../pdf-parser", pdf-lib, zustand
    ├── vite.config.js
    └── src/
        ├── main.jsx                # React root, BrowserRouter
        ├── App.jsx                 # Routes: / → UploadPage, /edit → EditingPage
        ├── components/
        │   ├── Navbar.jsx          # Top nav with DaisyUI theme switcher
        │   ├── FileUpload.jsx      # Drag-and-drop zone; validates size/type (50MB, PDF only)
        │   ├── EditToolbar.jsx     # Sticky toolbar: Bold, Italic, Highlight, Size, Color, Download
        │   ├── PDFViewer.jsx       # Core canvas: renders all pages, handles keyboard editing
        │   └── Upload.js           # (utility)
        ├── pages/
        │   ├── UploadPage.jsx      # Upload landing; calls setCurrentPDF then navigates to /edit
        │   └── EditingPage.jsx     # Orchestrator: runs sdk pipeline → setPages → renders PDFViewer
        ├── store/
        │   ├── usePDFStore.js      # Zustand store — all PDF state + text mutation actions
        │   └── useThemeStore.js    # Zustand store — DaisyUI theme persistence
        ├── constants/
        │   └── index.js            # THEMES, PDF_UPLOAD_LIMITS, EDITING_TOOLS, NOTIFICATION_MESSAGES
        └── lib/
            └── utils.js            # misc helpers
```

---

## The Only Two Packages That Matter

| Package | Location | Runtime | Purpose |
|---|---|---|---|
| `pdf-parser` | `pdf-parser/` | Browser (ESM) | Parse PDF bytes → structured data |
| `pdf-editor-frontend` | `frontend/` | Browser (React) | UI, editing canvas, download |

The root `package.json` / `index.js` is **a CLI test harness only** — it runs the SDK against a local `.pdf` file to verify the pipeline without opening a browser.

---

## pdf-parser SDK — Usage

### Factory Pattern (recommended)

```js
import { PdfDocument } from 'pdf-parser';

const doc    = await PdfDocument.fromFile(file); // File from <input> / drag-and-drop
const count  = doc.pageCount;                    // total pages (integer)
const page   = await doc.getPage(1);             // 1-indexed

// Individual steps:
const textElements   = await page.getText();
const classification = page.classifyText(textElements);
const images         = await page.getImages();

// Or everything at once:
const result = await page.extract();
// → { dimensions, textElements, classification, images }

// Paragraph detection (run after getText, before or after classifyText):
import { detectParagraphs } from 'pdf-parser/text';
const paragraphs = detectParagraphs(textElements, result.dimensions.width);
```

### PdfPage internal flow (`getPage` → `extract`)

```
PdfDocument.getPage(n)
  └─ #resolvePageN(n)
       1. trailer → /Root ref
       2. /Root → /Pages ref
       3. /Pages → extractKidN(n-1) → page ref
       4. page → /Contents → decompressStream → contentStream
       └─ new PdfPage(bytes, pdfString, pageObj, contentStream)

PdfPage.getText()
  └─ findFontAndCMap(bytes, pdfString, pageObj)   → fonts map
  └─ processContentStream(contentStream, fonts)    → TextElement[]

PdfPage.classifyText(elements)
  └─ detectParasAndHeaders(elements, pageWidth)    → Classification
     └─ [NEW] detectParagraphs(elements, pageWidth)
          └─ groupIntoLines(elements)              → Line[][]
          └─ getDominantLineGap(lines)             → number
          └─ isParaBreak(prevLine, currLine, dominantGap, pageWidth) → boolean
          └─ buildParagraph(lines)                 → ParagraphResult

PdfPage.getImages()
  └─ extractBackgroundImage(...)   → bg entry (coverage ≥ 80%)
  └─ buildXObjectNameMap(...)      → this page's XObject objNums
  └─ scanPageImages(...)           → all images, filtered to this page
```

---

## Data Shapes

### `TextElement` (output of `page.getText()`)

```js
{
  text:     string,
  x:        number,   // PDF user-space points, bottom-left origin
  y:        number,   // PDF user-space points, bottom-left origin
  width:    number,   // estimated (text.length * 5.5)
  fontSize: number    // in PDF points
}
```

### `Classification` (output of `page.classifyText()`)

```js
{
  headers:        string[],
  paragraphs:     string[],
  headerCount:    number,
  paragraphCount: number,
  detailed: {
    headers:    [{ text, xPosition, yPosition, fontSize, elementCenter, alignment }],
    paragraphs: [{ text, xPosition, yPosition, fontSize, elementCenter, alignment }]
  }
}
```

Classification rules (page-width-relative, no hardcoded 612pt):
- **Header**: element center within `pageWidth * 6.5%` of page center → `alignment: 'center'`
- **Paragraph**: x < `pageWidth * 16.3%` → left-aligned text

### `ParagraphResult` (output of `detectParagraphs()`)

```js
{
  text:         string,        // full paragraph text; lines joined with '\n', runs joined with ' '
  lines:        TextElement[][], // array of lines; each line is an array of TextElement objects
  x:            number,        // leftmost x of any element in the paragraph (PDF points)
  y:            number,        // y of the first line's first element = top of paragraph (PDF points)
  fontSize:     number,        // fontSize of the first element (representative size)
  elementCount: number         // total TextElement objects consumed by this paragraph
}
```

### `ImageEntry` (element of `page.getImages()`)

```js
{
  dataUrl:   string,            // "data:image/jpeg;base64,..."
  format:    'jpeg',
  extension: '.jpg',
  metadata:  { width, height, filter, colorSpace, ... },
  objNum:    number,            // PDF object number (used for deduplication)
  role:      'background' | 'image',
  appearances: [{
    x:              number,     // PDF user-space x
    y:              number,     // PDF user-space y (bottom-left origin)
    renderedWidth:  number,
    renderedHeight: number
  }]
}
```

`page.getImages()` returns `{ background: ImageEntry|null, pageImages: ImageEntry[] }`.

Background detection: an image is classified as background when its rendered area covers **≥ 80%** of the page area (CTM-based coverage score).

---

## Paragraph Detection — `pdfContentStreamTextProcessor.js`

> **Note:** PDFs have zero semantic paragraph structure. There is no pilcrow (¶) or any paragraph marker in the content stream — only raw glyph-positioning operators (`BT`, `Tm`, `Td`, `Tj`, `TJ`, etc.). All paragraph boundaries must be inferred entirely from geometry.

All five functions below live in `pdfContentStreamTextProcessor.js` and are exported from `pdf-parser/text`.

Run header extraction via `classifyText` first, remove those elements, then run `detectParagraphs` on the remaining body elements. Headers interleaved with body text will corrupt `getDominantLineGap`.

---

### `groupIntoLines(elements, snapTolerance = 2)` → `TextElement[][]`

Buckets a flat sorted `TextElement[]` into lines. Elements whose `y` values differ by ≤ `snapTolerance` PDF points are placed on the same line. Each line array is sorted left-to-right by `x`.

**Call this first, on a pre-sorted array** (sort descending `y`, break ties ascending `x`):

```js
elements.sort((a, b) => {
  const yDiff = b.y - a.y;
  if (Math.abs(yDiff) > 2) return yDiff;
  return a.x - b.x;
});
```

```js
// Signature
function groupIntoLines(elements, snapTolerance = 2)

// Variables
// elements      — TextElement[], sorted top-to-bottom left-to-right
// snapTolerance — max y-difference (PDF points) to still count as same line; default 2
//                 raise to 3-4 if same-visual-line elements are being split
// lineY         — y anchor of the first element that started the current line;
//                 all subsequent elements compared against this, not each other,
//                 to prevent drift across a run of closely-spaced lines
// currentLine   — accumulator for the line being built
// lines         — final result: array of lines (each line = TextElement[])

function groupIntoLines(elements, snapTolerance = 2) {
  const lines = [];
  let currentLine = [];

  for (const el of elements) {
    if (currentLine.length === 0) {
      currentLine.push(el);
    } else {
      const lineY = currentLine[0].y;
      if (Math.abs(el.y - lineY) <= snapTolerance) {
        currentLine.push(el);
      } else {
        lines.push([...currentLine].sort((a, b) => a.x - b.x));
        currentLine = [el];
      }
    }
  }
  if (currentLine.length) lines.push(currentLine);
  return lines;
}
```

---

### `getDominantLineGap(lines)` → `number`

Returns the **median** vertical distance between consecutive lines. This is the adaptive baseline used by `isParaBreak` — never hardcode a pixel threshold without calling this first.

```js
// Signature
function getDominantLineGap(lines)

// Variables
// lines        — TextElement[][], output of groupIntoLines
// gap          — lines[i-1][0].y - lines[i][0].y  (positive because y descends down page)
//                filtered to (0, 100) to exclude same-line noise and giant structural gaps
// gaps         — array of all measured inter-line distances
// median index — Math.floor(gaps.length / 2) after ascending sort
// fallback 14  — used when gaps is empty (single-line page); ≈ normal spacing for 12pt text

function getDominantLineGap(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1][0].y - lines[i][0].y;
    if (gap > 0 && gap < 100) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 14;
}
```

---

### `isParaBreak(prevLine, currLine, dominantGap, pageWidth)` → `boolean`

Returns `true` if there is a paragraph boundary between `prevLine` and `currLine`. Applies six independent rules in order; the first rule that fires wins.

```js
// Parameters
// prevLine     — TextElement[], the line above (already collected into current paragraph)
// currLine     — TextElement[], the line below (candidate for new paragraph)
// dominantGap  — median line gap from getDominantLineGap; scales all gap-based thresholds
// pageWidth    — PDF page width in points; scales all x-based thresholds (nothing hardcoded)

function isParaBreak(prevLine, currLine, dominantGap, pageWidth) {

  const prevY = prevLine[0].y;
  const currY = currLine[0].y;
  const gap   = prevY - currY;

  // Rule 1 — LARGE VERTICAL GAP
  // gap > 1.8× normal line spacing → explicit paragraph spacing in the PDF
  // Tune: lower to 1.5 to catch more breaks; raise to 2.2 to reduce false positives
  if (gap > dominantGap * 1.8) return true;

  // Rule 2 — SENTENCE-ENDING PUNCTUATION
  // prevText    — all text runs in prevLine joined with ' ' then right-trimmed
  // regex       — [.!?] optionally followed by closing quote/bracket, then end of string
  //               catches: "Hello.", "Really?", "Stop!", `"Indeed."`, "confirmed.]"
  //               does NOT match trailing hyphen (hyphenated line-break is not a sentence end)
  const prevText = prevLine.map(e => e.text).join(' ').trimEnd();
  if (/[.!?]["'»)\]]?\s*$/.test(prevText)) return true;

  // Rule 3 — FIRST-LINE INDENTATION
  // prevStartX / currStartX — leftmost x of any element in each line
  // threshold: 4% of pageWidth (~24pt on 612pt page ≈ one tab stop)
  // avoids triggering on 1-2pt x-jitter present in justified text
  const prevStartX = Math.min(...prevLine.map(e => e.x));
  const currStartX = Math.min(...currLine.map(e => e.x));
  if (currStartX - prevStartX > pageWidth * 0.04) return true;

  // Rule 4 — SHORT LAST LINE
  // prevLineRight      — rightmost edge of prevLine (e.x + e.width for each element)
  // prevLineWidth      — total horizontal span of the line
  // textColumnWidth    — estimated column width; 68% of pageWidth (typical single-column margin)
  //                      replace with max observed line width across the page for more accuracy
  // threshold: line fills < 72% of column → likely a paragraph-ending short line
  // full wrapped lines sit at 95-100%; mid-paragraph lines never fall this short
  const prevLineRight   = Math.max(...prevLine.map(e => e.x + e.width));
  const prevLineLeft    = Math.min(...prevLine.map(e => e.x));
  const prevLineWidth   = prevLineRight - prevLineLeft;
  const textColumnWidth = pageWidth * 0.68;
  if (prevLineWidth < textColumnWidth * 0.72) return true;

  // Rule 5 — FONT SIZE CHANGE
  // tolerance: 1.5pt to absorb encoding noise for visually identical sizes
  // a change larger than 1.5pt (e.g. 12pt body → 18pt heading) = structural boundary
  const prevFontSize = prevLine[0].fontSize;
  const currFontSize = currLine[0].fontSize;
  if (Math.abs(prevFontSize - currFontSize) > 1.5) return true;

  // Rule 6 — X ALIGNMENT SHIFT
  // absolute horizontal shift > 12% of pageWidth (~73pt on 612pt page)
  // distinguishes column jumps / side-notes from normal indentation (≤4%, Rule 3)
  if (Math.abs(currStartX - prevStartX) > pageWidth * 0.12) return true;

  return false;
}
```

**Edge case overrides to add inside `isParaBreak` before returning:**

| Edge Case | Detection | Override |
|---|---|---|
| Bullet / numbered list | prev and curr both start with `•`, `-`, `*`, or `^\d+\.` AND gap is normal | Skip Rule 4 |
| Drop cap | font-size change but element is a single character at line start | Skip Rule 5 |
| Hyphenated line break | `prevText` ends with `-` | Skip Rule 2 |
| RTL text (Arabic/Hebrew) | Unicode range U+0590–U+08FF | Reverse x-sort in `groupIntoLines` |
| Scanned PDF | very low element density across whole page | Set a `scanMode` flag; skip all rules |

---

### `detectParagraphs(elements, pageWidth)` → `ParagraphResult[]`

Top-level orchestrator. Calls the four functions above in sequence and returns the final paragraph array.

```js
// Parameters
// elements  — TextElement[], the full output of page.getText() minus any header elements
//             (strip headers first via classifyText to avoid corrupting getDominantLineGap)
// pageWidth — PDF page width in points (from page.extract() → dimensions.width)

// Internal variables
// lines           — TextElement[][], from groupIntoLines
// dominantGap     — median line gap, from getDominantLineGap
// paragraphs      — final ParagraphResult[] being built
// currentParaLines— TextElement[][], accumulates lines for the paragraph currently being built
//                   reset to [currLine] each time isParaBreak fires
// flush after loop— the last paragraph never triggers isParaBreak (no line comes after it),
//                   so it must be pushed explicitly after the for-loop ends

function detectParagraphs(elements, pageWidth) {
  const lines        = groupIntoLines(elements);
  const dominantGap  = getDominantLineGap(lines);
  const paragraphs   = [];
  let currentParaLines = [];

  for (let i = 0; i < lines.length; i++) {
    if (i === 0) {
      currentParaLines.push(lines[i]);
      continue;
    }
    if (isParaBreak(lines[i - 1], lines[i], dominantGap, pageWidth)) {
      if (currentParaLines.length) {
        paragraphs.push(buildParagraph(currentParaLines));
      }
      currentParaLines = [lines[i]];
    } else {
      currentParaLines.push(lines[i]);
    }
  }
  if (currentParaLines.length) paragraphs.push(buildParagraph(currentParaLines));
  return paragraphs;
}
```

---

### `buildParagraph(lines)` → `ParagraphResult`

Converts an array of lines (each a `TextElement[]`) into a single `ParagraphResult` object.

```js
// Parameter
// lines — TextElement[][], the accumulated lines for one paragraph

// Internal variables
// allElements  — lines.flat(): single flat TextElement[] across all lines in the paragraph
// text         — reconstructed string: lines joined with '\n', each line's runs joined with ' '
// x            — Math.min over all e.x → leftmost edge = paragraph left boundary
// y            — lines[0][0].y → top of paragraph (lines are top-to-bottom after sorting)
// fontSize     — lines[0][0].fontSize → representative size for the paragraph
// elementCount — total TextElement objects consumed (useful for debugging)

function buildParagraph(lines) {
  const allElements = lines.flat();
  const text = lines.map(line =>
    line.map(e => e.text).join(' ')
  ).join('\n');

  return {
    text,
    lines,
    x:            Math.min(...allElements.map(e => e.x)),
    y:            lines[0][0].y,
    fontSize:     lines[0][0].fontSize,
    elementCount: allElements.length
  };
}
```

---

## Coordinate System (Critical)

PDF coordinate origin = **bottom-left**. CSS origin = **top-left**. Always convert before placing elements.

```js
const CANVAS_WIDTH = 850; // fixed display width in CSS px
const scale    = CANVAS_WIDTH / pageWidth;
const canvasY  = (pageHeight - pdfY - elementHeight) * scale; // CSS top
const canvasX  = pdfX * scale;                                // CSS left
```

`PDFViewer.jsx` uses a local `toCanvasY(pdfY, elHeight, pageHeight, scale)` function for this.

For text elements, `elHeight` is estimated as `fontSize * 0.8` (ascent only, no descender).

---

## Zustand Store Shape (`usePDFStore`)

```js
{
  // State
  currentPDF:   File | null,
  pages:        PageResult[],       // Array<{ dimensions, textElements, classification, images }>
  pageCount:    number,
  activeCursor: { pageIdx: number|null, elIdx: number|null, charOffset: number, caretX: number },
  isLoading:    boolean,
  error:        string | null,

  // Setters
  setCurrentPDF(file),
  setPages(pages),
  setPageCount(count),
  setActiveCursor(cursorOrUpdater),  // accepts value or (prev) => next updater
  setIsLoading(bool),
  clearError(),

  // Text mutation (all immutable — return new pages array)
  updateTextElement(pageIdx, elIdx, updatesOrString),
  updateTextFontSize(pageIdx, elIdx, newSize),
  updateTextColor(pageIdx, elIdx, newColor),
  updateTextFormat(pageIdx, elIdx, { isBold?, isItalic? }),
  shiftElementsBelow(pageIdx, yThreshold, amount),   // also shifts pageImages
  insertTextElement(pageIdx, elIdxToInsertAfter, newElement),
  removeTextElement(pageIdx, elIdx),
}
```

---

## PDFViewer — Canvas Architecture

`PDFViewer` renders one `<PageCanvas>` per page, stacked vertically with a grey inter-page gap.

Each `<PageCanvas>` is a `position:relative` div of fixed width 850px:

```
<div style={{ position:'relative', width:850, height: pageHeight*scale, background:'#fff' }}>

  {/* Layer 0 — Background (zIndex 0) */}
  <img style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', objectFit:'fill' }} />

  {/* Layer 1 — Page images (zIndex 1) */}
  {images.pageImages.map(img => {
    const ap = img.appearances[0];
    // x, y converted with toCanvasY
    <img style={{ position:'absolute', left:ap.x*scale, top:toCanvasY(...), width:..., height:... }} />
  })}

  {/* Layer 2 — Text elements (zIndex 2) */}
  {textElements.map((el, idx) => (
    <div
      id={`text-el-${pageIdx}-${idx}`}
      onClick={handleTextClick}     // sets activeCursor
      style={{ position:'absolute', left:el.x*scale, top:toCanvasY(...), fontSize:el.fontSize*scale, ... }}
    >
      {el.text}
      {isActive && <div className="bg-blue-600" style={{ blinking caret }} />}
    </div>
  ))}
</div>
```

### Keyboard Editing (in PDFViewer global `keydown` listener)

- **Printable char**: insert at `charOffset`, word-wrap if line overflows. If the new text exceeds the bounding box, it triggers mid-word wrapping, forcing the overflow to a new line and pushing subsequent elements down via `shiftElementsBelow`.
- **Backspace at offset > 0**: delete char before cursor.
- **Backspace at offset 0**: triggers smart backspace wrapping. It measures available space on the previous line and moves only as many words as fit. It pulls up subsequent lines via greedy text reflow (cascading upward text compaction) when space is freed.
- **Enter**: splits the current text element at the cursor, moves the trailing text to a new line exactly one `lineHeight` below, and shifts all elements below down. Triggers cascading word reflow if the new line overflows.
- **ArrowLeft / ArrowRight**: move `charOffset` within element or jump to adjacent element.
- Text width is measured with an off-screen `<canvas>` and `CanvasRenderingContext2D.measureText()`.

---

## EditToolbar

Sticky toolbar, reads/writes the active text element via `activeCursor`:

| Control | Action |
|---|---|
| Bold | Toggles `el.isBold` via `updateTextFormat` |
| Italic | Toggles `el.isItalic` via `updateTextFormat` |
| Highlight | Sets tool mode (passive, no store mutation yet) |
| Underline / Notes | Tool modes only |
| Color picker | `updateTextColor` on active element |
| Size input | `updateTextFontSize` on active element |
| Save | Toast confirmation (no actual persistence yet) |
| Download | Triggers `handleDownload` in `EditingPage` |

---

## PDF Download (`handleDownload` in EditingPage)

Uses `pdf-lib` to reconstruct a PDF from the current Zustand `pages` state:

```
PDFDocument.create()
  → for each page in pages:
      pdfDoc.addPage([dimensions.width, dimensions.height])
      if background: page.drawImage(embeddedPng/Jpg, full page rect)
      for each pageImage: page.drawImage at appearances[0] coordinates
      for each textElement: page.drawText(el.text, { x, y, size, font, color })
  → pdfDoc.save() → Blob → <a>.click()
```

Font used for all text: `StandardFonts.Helvetica`. Coordinates are used as-is (PDF origin = bottom-left matches `pdf-lib`'s coordinate system).

---

## pdf-parser Internals — Key Modules

### `pdfObjectReader.js`

- `getObject(bytes, pdfString, ref, returnBytes?)` — locates `N G obj … endobj` block by ref string
- `extractValue(objStr, key)` — extracts the value for a dictionary key (handles refs and names)
- `resolveLength(bytes, pdfString, objBytes)` — resolves `/Length` (may be an indirect ref)
- `decompressStream(objBytes, length)` — extracts and inflates (pako) the stream

### `pdfObjectReader` decompression note

Uses `pako.inflate`. The stream start offset is detected by scanning for `\r\n` or `\n` after the `stream` keyword.

### `pdfCMapParser.js`

- `parseCMap(cmapText)` → `{ '<hex>': '<hex>', ... }` raw map from `bf char/range` sections
- `buildCharMap(parsedCMap)` → `{ '<hex>': 'char', ... }` decoded map
- `translateText(cmapMap, hexStr)` → decoded Unicode string
- `getCMapCodeLengths(cmapMap)` → `{ min, max }` code unit size

### `pdfContentStreamTextProcessor.js`

- `processContentStream(contentStream, fonts)` → `TextElement[]`
- `decodePdfLiteralString(str, fontEntry)` → decoded string
- `detectParasAndHeaders(elements, pageWidth)` → `Classification`
- `groupIntoLines(elements, snapTolerance?)` → `TextElement[][]` ← **NEW**
- `getDominantLineGap(lines)` → `number` ← **NEW**
- `isParaBreak(prevLine, currLine, dominantGap, pageWidth)` → `boolean` ← **NEW**
- `detectParagraphs(elements, pageWidth)` → `ParagraphResult[]` ← **NEW**
- `buildParagraph(lines)` → `ParagraphResult` ← **NEW**

### `imageDecoder.js`

Supports two PDF image filters:
- **FlateDecode**: `pako.inflate` → optional PNG predictor → CMYK→RGB if needed → `OffscreenCanvas` / `<canvas>` → JPEG data URL
- **DCTDecode**: raw JPEG bytes → `btoa` → data URL (no re-encoding)

PNG predictor decoding supports filter types 0–4 (None, Sub, Up, Average, Paeth).

### `pdfRegex.js`

Single source of truth for all regex patterns. Always add new patterns here rather than inline. Organised into `common`, `core`, `images`, `text` namespaces.

---

## Frontend Tech Stack

| Library | Version | Purpose |
|---|---|---|
| React | 18 | UI |
| Vite | 5 | Dev server + bundler |
| Tailwind CSS | 4 | Utility CSS |
| DaisyUI | 5 | Component themes (30+ themes via `THEMES` constant) |
| Zustand | 5 | Global state |
| react-router-dom | 6 | Client-side routing |
| pdf-lib | 1.17 | PDF re-generation for download |
| lucide-react | 0.400 | Icons |
| react-hot-toast | 2 | Toast notifications |

---

## Quick Run

```bash
# CLI SDK test (Node.js — image extraction will warn, not crash)
node index.js TEST.pdf
node index.js "Color bg.pdf"

# Frontend dev server
cd frontend && npm run dev
# → http://localhost:5173
```

---

## Extension Guidelines

1. **New parsing logic**: add a new file in the relevant `pdf-parser/src/` domain (`core/`, `text/`, `images/`), export from `pdf-parser/index.js`. Never put parsing logic in `PdfDocument.js` or `PdfPage.js` — those are adapter-only.
2. **New regex**: add to `PDF_REGEX` in `pdfRegex.js`, don't define inline.
3. **New store actions**: add to `usePDFStore.js` — always return a new `pages` array (immutable updates).
4. **New toolbar controls**: add tool id to `EDITING_TOOLS` constant, add handling in `EditToolbar.jsx` + `PDFViewer.jsx`.
5. **New image formats**: add a new decode path in `imageDecoder.js` following the FlateDecode/DCTDecode pattern.
6. **`pdfSdk/` is gone**: the old `frontend/src/lib/pdfSdk/` barrel (`loader.js`, `textExtractor.js`, etc.) has been fully replaced by the `pdf-parser` npm package. Do not recreate it.
7. **All exports from `pdf-parser` must be named** (not default) for tree-shaking.
8. **Use `try/catch` around all decompression and decode operations**; emit `console.warn` rather than crashing.
9. **Paragraph detection order**: always strip header elements (via `classifyText`) before calling `detectParagraphs`. Headers interleaved with body text corrupt `getDominantLineGap`.

---

## Maintenance Checklist

### Before committing `pdf-parser` changes:

1. Run `node index.js TEST.pdf` — confirm dimensions, text runs, and classification print without error.
2. Run with `"Color bg.pdf"` — confirm background image is detected and page images are listed.
3. Confirm image extraction falls back gracefully in Node (expected: `ReferenceError` on canvas ops, not a crash).
4. Run `detectParagraphs` on a multi-paragraph test PDF — confirm `ParagraphResult[]` count matches visual paragraph count and no body lines bleed into adjacent paragraphs.

### Before committing frontend changes:

1. `cd frontend && npm run dev` — upload `TEST.pdf`, confirm pages render with correct aspect ratio.
2. Text elements appear at visually correct positions (no Y-axis inversion artifacts).
3. Background image fills the canvas behind text and page images.
4. Click a text element → blue caret appears. Type a character → it is inserted correctly.
5. Bold / Italic toggle reflects in the rendered text and in the toolbar button state.
6. Download produces a valid PDF (open in a PDF viewer to verify).
7. No console errors on load (check for missing exports, pako decompression failures, or canvas errors).

---

## Known Limitations / Future Work

- **Text width estimation** is approximate (`text.length * 5.5` pts) — real width requires a font metrics lookup.
- **Page tree**: `extractKidN` assumes a flat `/Kids` array (one level). Nested intermediate page nodes (uncommon) will fail.
- **Font rendering**: all text is displayed in `serif` (browser) and re-exported in `Helvetica` (pdf-lib). Original font faces are not preserved.
- **Highlight tool**: UI exists but no highlight rendering is implemented yet.
- **Save button**: shows a toast but does not persist state between sessions.
- **Only FlateDecode + DCTDecode** image filters are supported. JBIG2, JPX, CCITTFax will return `null`.
- **Multi-column layout**: `detectParagraphs` runs on all elements together — two-column documents will produce incorrect paragraph groupings. Fix: cluster elements into x-range columns first, then run detection per column.
- **Paragraph detection on scanned PDFs**: element density is too low for reliable geometry heuristics. Detect scan mode (very few elements per page area) and skip `detectParagraphs` entirely.
