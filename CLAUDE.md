# CLAUDE.md

Project context and architecture guide for this workspace.

---

## What This Project Is

A **fully browser-side PDF editor** — no server, no uploads, no backend. The user opens a PDF in the browser, and everything (parsing, editing, re-export) happens locally in JavaScript.

**Current capabilities:**
- Parse multi-page PDFs directly in the browser using a custom `pdf-parser` ESM SDK
- Extract and reconstruct text elements with their PDF coordinates and font sizes
- Detect and render background images and inline page images
- **Single-page continuous editing view** — all pages flow into one tall canvas with soft page-separator markers; no per-page canvas switching
- Live in-browser text editing via per-block `contentEditable`; typing, Backspace, Enter all produce immediate visual reflow
- **DOM-driven reflow** — a shared `ResizeObserver` on every editable block measures actual browser-rendered heights; layout positions downstream blocks accordingly without any debounce delay
- **Three-layer editor architecture** — model (objects[]) → layout (layoutObjects pure fn) → render (absolute positioning from layout map)
- Paragraph detection from raw `TextElement[]` using **spacing-only heuristics** (gap > 1.6 × fontSize = new paragraph) — no short-line / indent rules that fragment ragged-right body text
- Header detection: SDK centre-tolerance check gated by ≤ 60 chars AND ≤ 8 words so long body lines are never misclassified as headings
- Re-export the edited state to a downloadable PDF via `pdf-lib` (uses live edited objects, wraps text per-page)

---

## Project Structure

```
PDF-Editor/
├── index.js                        # CLI test harness — runs pdf-parser SDK against a local PDF
├── package.json                    # Root CJS package (test harness); depends on pdf-parser via "file:./pdf-parser"
├── pnpm-workspace.yaml             # pnpm workspace: packages = [frontend, pdf-parser]
├── pnpm-lock.yaml                  # pnpm lockfile (root)
├── debug/                          # Ad-hoc debug scripts (debug_pdf.js etc.)
├── uploads/                        # Cached `.json` image metadata sidecars (legacy)
├── Text fonts/                     # Bundled TTF fallbacks (used by ttfFontLoader)
├── TEST.pdf / TEST2.pdf            # Sample inputs for the CLI harness
├── Color bg.pdf / Hello World (1).pdf
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
│       │   ├── pdfCMapParser.js              # parseCMap, translateText, buildCharMap, decodeUnicodeHex, getCMapCodeLengths
│       │   ├── pdfFontCMapResolver.js        # findFontAndCMap — walks /Resources → /Font → /ToUnicode
│       │   ├── pdfContentStreamTextProcessor.js
│       │   │       # processContentStream, decodePdfLiteralString,
│       │   │       # groupIntoParagraphs, detectParasAndHeaders
│       │   ├── fontDictionaryUpdater.js      # font dict patching utilities (stub)
│       │   ├── ttfFontLoader.js              # TTF font loading via opentype.js
│       │   └── index.js                      # sub-barrel for "pdf-parser/text"
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
        ├── App.jsx                 # Routes: / and /upload → UploadPage, /edit → EditingPage
        ├── components/
        │   ├── Navbar.jsx          # Top nav with theme toggle
        │   ├── FileUpload.jsx      # Drag-and-drop zone; validates size/type (50MB, PDF only)
        │   ├── EditToolbar.jsx     # Sticky toolbar: Bold, Italic, Highlight, Size, Color, Reset, Save, Download, Share, Delete
        │   ├── PDFViewer.jsx       # Global keyboard handler + scroller; renders one PageCanvas per page
        │   ├── PageCanvas.jsx      # Per-page canvas: bg / images / text layers, click-to-position cursor
        │   ├── ResizeOverlay.jsx   # 8-handle interactive image resize with Apply/Cancel
        │   ├── pdfConstants.js     # CANVAS_WIDTH (850) + toCanvasY() helper
        │   └── Upload.js           # (utility)
        ├── pages/
        │   ├── UploadPage.jsx      # Upload landing; calls setCurrentPDF then navigates to /edit
        │   └── EditingPage.jsx     # Orchestrator: runs sdk pipeline → setPages → renders PDFViewer; owns handleDownload
        ├── store/
        │   ├── usePDFStore.js      # Zustand store + applyGlobalReflow engine (text + image flow with page margins)
        │   └── useThemeStore.js    # Zustand store — DaisyUI theme persistence (localStorage key "chat-theme")
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

The repo is set up as a pnpm workspace (`pnpm-workspace.yaml`). Install from the root with `pnpm install` and it links `pdf-parser` into `frontend` automatically.

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
     └─ groupIntoParagraphs(bodyLines)             → Map<paraId, ParagraphBlock>

PdfPage.getImages()
  └─ extractBackgroundImage(...)   → bg entry (coverage ≥ 80%)
  └─ buildXObjectNameMap(...)      → this page's XObject objNums
  └─ scanPageImages(...)           → all images, filtered to this page
```

`pdf-parser/index.js` exposes these as named exports (no defaults):

- Factory: `PdfDocument`, `PdfPage`
- Utils: `uint8ToBinaryString`, `indexOfSeq`, `allocBytes`, `asciiToBytes`, `PDF_REGEX`
- Core: `getObject`, `extractValue`, `resolveLength`, `decompressStream`, `findRootRef`, `extractFirstKid`, `resolveDictOrRef`, `extractInlineDictionary`
- Text: `parseCMap`, `buildCharMap`, `translateText`, `decodeUnicodeHex`, `getCMapCodeLengths`, `findFontAndCMap`, `processContentStream`, `detectParasAndHeaders`, `groupIntoParagraphs`, `detectParagraphsFromElements`, `decodePdfLiteralString`
- Images: `buildXObjectNameMap`, `parsePaintOperations`, `decodeImageObject`, `parseImageMetadata`, `extractBackgroundImage`, `getPageDimensions`, `scanPageImages`

> Subpath exports: `pdf-parser/core`, `pdf-parser/text`, `pdf-parser/images` are sub-barrels for tree-shaking-friendly imports.

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

After the EditingPage post-processes a parsed page, header elements also get `isBold: true` and `isHeader: true`. The store may further set `isItalic`, `color` (CSS string) as edits happen.

### `Classification` (output of `page.classifyText()` / `detectParasAndHeaders`)

```js
{
  headers:        string[],
  headerCount:    number,
  text:           string[],   // body-line texts
  textCount:      number,
  paragraphs:     Map<number, ParagraphBlock>,
  paragraphCount: number,
  textBlocks:     ParagraphBlock | HeaderEntry,  // headers + paragraphs, sorted by y DESC
  detailed: {
    headers:    HeaderEntry[],
    text:       BodyLine[],
    paragraphs: Map<number, ParagraphBlock>,
    textBlocks: (ParagraphBlock | HeaderEntry)[]
  }
}
```

Where:
- `HeaderEntry = { text, type:'header', xPosition, yPosition, x, y, fontSize, elementCenter, alignment:'center' }`
- `BodyLine`   = `{ ...textElement, type:'line' }`
- `ParagraphBlock = { id, lines: BodyLine[], type:'Paragraph', text, x, y, width, fontSize }`

Classification rules (page-width-relative, no hardcoded 612pt):
- **Header**: `|elementCenter − pageCenter| < pageWidth * 0.065` (~40pt on a 612pt page)
- **Body**: everything else, fed to `groupIntoParagraphs`

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

The current algorithm uses a **priority-queue of four rules** evaluated top-down per pair of consecutive body lines (after sorting body lines by y DESC). It does **not** compute a dominant line gap or use median statistics — thresholds are constants tuned for typical body text:

```js
const xthreshold = 15;     // PDF points: horizontal slack
const ythreshold = 4;      // PDF points: vertical slack on top of (fontSize * Multiplierz)
const Multiplierz = 1.2;   // multiplier on fontSize for "normal" line gap
const DEFAULT_LINE_HEIGHT = 14;
```

### `groupIntoParagraphs(bodyLines)` → `Map<number, ParagraphBlock>`

`bodyLines` is a flat array of body-text elements (NOT pre-grouped into lines). The function:

1. Computes `xnorm` = leftmost x across all body lines, `xmargin` = rightmost edge across all body lines.
2. Sorts a copy by `y` descending (top of page first).
3. Walks pairs `(prev, curr)` and starts a new paragraph if **any** rule fires (first match wins):

| Rule | Condition | Meaning |
|---|---|---|
| 1. Spacing After  | `(prev.y − curr.y) > prev.fontSize * 1.2 + 4` | Large vertical gap |
| 2. Short Line     | `prev.x + prev.width < xmargin − 15`             | Last line of a paragraph is short |
| 3. Indented Start | `curr.x > xnorm + 15`                            | First-line indent |
| 4. Hanging Indent | `curr.x < prev.x`                                 | Outdent / hanging-indent style |

Each finalised paragraph is stored in a 1-indexed `Map` with this shape:

```js
{
  id:       number,
  lines:    BodyLine[],   // raw body-text elements that compose this paragraph
  type:     'Paragraph',
  text:     string,       // lines.map(l => l.text).join(' ')
  x:        number,       // x of the first line (top-most in reading order)
  y:        number,       // y of the first line
  width:    number,       // max width across all lines
  fontSize: number        // fontSize of the first line (fallback 14)
}
```

### `detectParasAndHeaders(textElements, pageWidth = 612)`

Top-level orchestrator. Splits elements into headers and body lines using the centre-tolerance rule, then runs `groupIntoParagraphs` on the body lines. Returns the `Classification` shape above. `textBlocks` is the union of headers and paragraph blocks sorted by y descending — useful for rendering or downstream processing in reading order.

### `processContentStream(decompressed, fonts)` → `TextElement[]`

Walks the content stream line-by-line, tracking `currentFont` from `/Fn s Tf`, `currentX/currentY` from `Td`/`Tm`, and decoding `TJ` arrays / `Tj` singles via the per-font ToUnicode CMap.

Merging rule: consecutive chunks whose `y` differs by `≤ 0.5pt` are concatenated into the same element (reconstructs a logical text run from a `[<a>kern<b>]TJ` operator). A `TJ` kern number more negative than `−150` is rendered as a literal space.

Each output element gets an estimated `width = text.length * 5.5` (cheap pixel-free approximation).

### `decodePdfLiteralString(token)` → `string`

Strips `(...)` delimiters and expands escape sequences (`\\`, `\(`, `\)`, `\n`, `\r`, `\t`, `\b`, `\f`).

---

## Coordinate System (Critical)

PDF coordinate origin = **bottom-left**. CSS origin = **top-left**. Always convert before placing elements.

`frontend/src/components/pdfConstants.js` exports the two coordinate constants/helpers everyone uses:

```js
export const CANVAS_WIDTH = 850; // fixed display width in CSS px

export function toCanvasY(pdfY, elHeight, pageHeight, scale) {
  return (pageHeight - pdfY - elHeight) * scale;
}
```

For text elements, `elHeight` is estimated as `fontSize * 0.8` (ascent only, no descender).

Inside `usePDFStore.applyGlobalReflow`, the engine works in a **global Y space** running downward from the top of page 0:

```js
const pageOffsets[i] = sum of all earlier page heights
const globalY = pageOffsets[pageIdx] + (pageHeight - el.y)   // BOTTOM of element
```

Elements are then sorted by `globalY` ascending and replayed onto pages while honouring a top/bottom margin of `48pt`.

---

## Zustand Store Shape (`usePDFStore`)

```js
{
  // State
  currentPDF:   File | null,
  pages:        PageResult[],       // Array<{ dimensions, textElements, classification, images }>
  pageCount:    number,
  activeCursor: { pageIdx: number|null, elIdx: number|null, charOffset: number|null, caretX: number },
  activeImage:  null | { pageIdx: number, imgIdx: number, side: 'left'|'right'|'selected' },
  isLoading:    boolean,
  error:        string | null,

  // Setters
  setCurrentPDF(file),
  setPages(pages),
  setPageCount(count),
  setActiveCursor(cursorOrUpdater),   // accepts value or (prev) => next updater
  setActiveImage(imageOrUpdater),
  setIsLoading(bool),
  clearError(),

  // Text mutation (all immutable — return new pages array)
  updateTextElement(pageIdx, elIdx, updatesOrString),
  updateTextFontSize(pageIdx, elIdx, newSize),
  updateTextColor(pageIdx, elIdx, newColor),
  updateTextFormat(pageIdx, elIdx, { isBold?, isItalic? }),

  insertTextElement(pageIdx, elIdxToInsertAfter, newElement),
  removeTextElement(pageIdx, elIdx),

  // Flow control (delegate to applyGlobalReflow internally)
  shiftElementsBelow(pageIdx, yThreshold, amount),
  shiftElementsAbove(pageIdx, yThreshold, amount),

  // Atomic structural edits
  splitTextElement(pageIdx, elIdx, textBefore, textAfter, lineHeight, measureFn),
  wrapTextElement(pageIdx, elIdx, firstLineText, secondLineText, lineHeight, measureFn, cursorTarget?),
  cascadeCompactParagraph(pageIdx, startIdx, measureFn, maxWidthFn),

  // Image mutation
  updatePageImage(pageIdx, imgIdx, newDataUrl, newAppearance),
  resizePageImage(pageIdx, imgIdx, newRenderedWidth, newRenderedHeight),
}
```

### The `applyGlobalReflow` engine

Lives at the top of `usePDFStore.js` as a named export (the store actions call it internally; `PDFViewer.jsx` also imports it directly for its Backspace cross-page reflow helpers). It:

1. Builds a flat list of every text element + every page image, each tagged with its `globalY` (bottom-of-element in document-global PDF points, running downward).
2. Shifts items below `yThreshold` on `startPageIdx` by `amount` (positive = move content down; negative = pull up).
3. Sorts everything by `globalY` ascending and replays them onto pages, enforcing:
   - **Word-like flow constraint**: each element's TOP must come at or after the previous element's BOTTOM (so a tall image doesn't overlap whatever was below it).
   - **Top margin**: items too close to a page's top get nudged down by exactly the deficit.
   - **Bottom margin**: items that fell below a page's bottom are bumped to the top of the NEXT page (creating extra pages on demand).
4. Rebuilds the `pages[]` array with new `textElements` arrays and image appearances.

A `skipFilter` callback can exclude specific items from being shifted (used by `resizePageImage` so the image being resized doesn't move).

`amount === 0` is **not** a short-circuit — callers use it as a pure page-boundary normalisation pass (push things off the bottom margin, etc.).

### CURSOR_MARKER pattern

`splitTextElement` and `wrapTextElement` insert a new element and then call `applyGlobalReflow`, which rebuilds the `pages` array (new object identities, possibly across pages). To track where the cursor should land, the new element is tagged with a sentinel key:

```js
const CURSOR_MARKER = '__pendingCursor';
newLineEl[CURSOR_MARKER] = { charOffset: 0 };
```

After reflow, `findAndStripCursorMarker` walks the rebuilt pages, locates the marker, strips it, and returns `{ pages: cleanPages, cursor: { pageIdx, elIdx, charOffset, caretX: 0 } }` — so the cursor follows the element even if it moved to a brand-new page.

### `cascadeCompactParagraph(pageIdx, startIdx, measureFn, maxWidthFn)`

Greedy compaction triggered by forward-delete. Walks downward from `startIdx`, pulling words from each next line into the current one until either:

- The next line's font size differs by `> 1.5pt`, **or**
- The vertical gap to the next line is `≥ fontSize * 1.5` (treats them as separate paragraphs and stops).

Fully consumed lines are removed; remaining elements + page images on the same page below a removed line are shifted up by the removed line's `lineHeight`. Final pass: `applyGlobalReflow(amount=0)` for page-boundary cleanup.

---

## PDFViewer — Canvas Architecture

`PDFViewer` is now thin: it owns the **global keyboard listener** and renders one `<PageCanvas>` per page. `PageCanvas` owns the per-page DOM (layers, caret, click handling, image selection).

```
<PDFViewer>           ← keyboard handler, scroll container
  <PageCanvas page={p1} />
  <PageCanvas page={p2} />
  ...
```

### Per-page layer stack (`<PageCanvas>`)

Each `PageCanvas` is a `position: relative` div of fixed width `CANVAS_WIDTH` (850px), height = `pageHeight * scale`:

```
Layer 0 — Background  (zIndex 0)    <img>  full-page bg if images.background exists
Layer 1 — Page images (zIndex 1–5)  per image: optional left-side caret, image wrapper, optional right-side caret
                                    selected image gets <ResizeOverlay> + "Drag handles to resize" hint
Layer 2 — Text        (zIndex 2)    one <div> per textElement; click → setActiveCursor;
                                    blinking caret div when isActive
```

Each text element also has `data-para-id={paraId}` (or `'header'`) — derived from `classification.detailed.paragraphs` by matching `(x, y, text)` triples. This is what downstream paragraph-aware reflow logic uses to decide whether two lines belong to the same paragraph.

### Active page auto-scroll

`PageCanvas` calls `containerRef.current.scrollIntoView({ block: 'nearest' })` whenever its page becomes the active one. `'nearest'` is a no-op when already visible, so in-page typing doesn't jolt the viewport — only cross-page moves (Enter overflowing to a new page) trigger a scroll.

### Image selection states

Clicking an image computes the click-X within the image bounding box:

- `relX < 0.3 * width`  → `side: 'left'`   (blue caret to the left)
- `relX > 0.7 * width`  → `side: 'right'`  (blue caret to the right)
- otherwise            → `side: 'selected'` (full `<ResizeOverlay>` with 8 handles)

`ResizeOverlay` lets the user drag any of the 8 handles (n/ne/e/se/s/sw/w/nw) with a 20px minimum. Apply calls `resizePageImage` which:

- Keeps the image's CSS top-left fixed (adjusts the PDF y so the bottom-left stays in the same place visually).
- Calls `applyGlobalReflow` with `deltaH = newH − oldH` and a `skipFilter` that excludes the image being resized.

### Keyboard editing (in PDFViewer global `keydown` listener)

All editing flows live in one big `keydown` effect. Width measurement is done with an off-screen `<canvas>` and `CanvasRenderingContext2D.measureText()` using `serif` at the element's pt-scaled size — see `measureWidth(txt, targetEl)` inside the handler.

- **Printable char**: insert at `charOffset`. If the new text width exceeds the line's column space, `wrapTextElement` splits at the last space, pushes the tail to a new line below, and `applyGlobalReflow` pushes everything below down by one `lineHeight` (creating a new page if needed).
- **Backspace at offset > 0**: delete char before cursor; then try greedy paragraph reflow inside the active paragraph on the same page. If the current element became empty, remove it and globally shift content up by `lineHeight`.
- **Backspace at offset 0**:
  - If at element 0 of a page (and not page 0): jump cursor to the last element of the previous page.
  - Otherwise: detect the previous element's paragraph membership (via local helpers `buildParagraphMap` / `getParagraphFor`); if same paragraph, merge words back into the previous line until it fills, and lift everything below. If different paragraph, only jump the cursor (no merge).
- **Enter**: split current element at cursor; insert new line exactly `lineHeight` below via `splitTextElement`; cursor follows via CURSOR_MARKER.
- **Delete**: never moves the caret. Deletes the char at cursor (or, at end-of-line, attempts a same-paragraph compaction) and runs `cascadeCompactParagraph` to pull subsequent lines up greedily.
- **ArrowLeft / ArrowRight**: move within element or jump to neighbour; respects element boundaries.

> Note: parts of the keyboard handler currently reference `detectParagraphsFromElements` (intended cross-page paragraph builder). The import is commented out, so those code paths run with `detectParagraphsFromElements` undefined — they only fire on Backspace, and the typical Backspace path doesn't reach them. Be aware if you start exercising the cross-page Backspace flow.

---

## EditToolbar

Sticky toolbar at the top of `EditingPage`, reads/writes the active text element via `activeCursor`:

| Control | Action |
|---|---|
| Bold | Toggles `el.isBold` via `updateTextFormat` — button is active when `el.isBold === true` |
| Italic | Toggles `el.isItalic` via `updateTextFormat` — button is active when `el.isItalic === true` |
| Highlight / Underline / Notes | Tool mode only (`onTool(toolId)`); no store mutation yet |
| Color picker | `updateTextColor` on active element; defaults to `#FFFF00` |
| Size input (4–144) | `updateTextFontSize` on active element |
| Reset / Save / Share / Delete | Currently UI-only / wired to callbacks owned by `EditingPage` |
| Download | Triggers `handleDownload` in `EditingPage` |

The Bold/Italic icon buttons are disabled until a text element is selected (`activeCursor.pageIdx !== null`).

---

## PDF Download (`handleDownload` in EditingPage)

Uses `pdf-lib` to reconstruct a PDF from the **live edited objects[]** (not the stale parsed `pages[]`). `SinglePageView` notifies `EditingPage` via `onObjectsChange` callback on every model mutation; `EditingPage` stores the result in `editedObjectsRef`.

```
PDFDocument.create()
  → for each page n in pages:
      pdfPage = pdfDoc.addPage([dimensions.width, dimensions.height])
      draw background image (from editedObjects where type='image' and role='background', pageIdx=n)
      draw inline images (from editedObjects where type='image' and role='image', pageIdx=n)
      for each text block (paragraph/header/line) where pageIdx=n:
          greedy-wrap block.text at colWidth (avgCharWidth = fontSize × 0.55)
          drawText each wrapped line starting at block.y, advancing −lineHeight per line
          clip at bottom margin (48 pt)
  → pdfDoc.save() → Blob → <a>.click()
```

Font: `StandardFonts.Helvetica`. Color: `rgb(0,0,0)`. Page dimensions from original `pages[n].dimensions`.

**Page overflow in export**: if a grown paragraph's wrapped lines go below the page's bottom margin (48 pt) they are clipped. True page-overflow reflow (spilling to the next page) is a future enhancement.

---

## EditingPage — Pipeline

1. On mount with a `currentPDF`, runs `PdfDocument.fromFile(file)` and iterates pages 1..N.
2. For each page: `page.extract()` → `{ dimensions, textElements, classification, images }`.
3. Post-process: every text element whose text appears in `classification.headers` is tagged `isBold: true, isHeader: true`.
4. Push into `setPages([...])`.
5. `buildObjects(pages)` flattens `pages[]` into `objects[]` (one pass, spacing-only paragraph grouping).
6. Renders `<EditToolbar>` + `<SinglePageView pages={pages} objects={objects} onObjectsChange={...} />`.
7. `onObjectsChange` callback keeps `editedObjectsRef` current — used by `handleDownload`.
8. `handleDownload` builds the PDF from `editedObjectsRef.current` (live edited state), not `pages[]` (original parsed state).
9. `handleSave` is currently a toast — no real persistence yet.

---

## SinglePageView — Three-Layer Architecture

```
Layer 1 — Document model (objects[])
  Produced once by buildObjects(pages), then mutated by edit handlers.
  Each block: { id, type, text, x, fontSize, pageIdx, lines[], isBold, isItalic, color }
  Paragraph ids: "p0", "p1", …   Header/line ids: "t-{pageIdx}-{elIdx}"
  Image ids: "img-{pageIdx}-bg" / "img-{pageIdx}-{objNum}"
  Runtime blocks (Enter-split): "n0", "n1", …

Layer 2 — Layout (layoutObjects, frontend/src/lib/layoutObjects.js)
  Pure function → Map<id, {top,left,width,height}>
  Single forward pass; cursorY monotonically increases (P2: non-overlap guaranteed).
  Height resolution per block (priority order):
    1. measuredHeights.get(id)  ← real DOM height from ResizeObserver (string key)
    2. measureWrappedHeight(text, fontPx, colPx, ctx, cache)  ← canvas fallback (first paint)
  Soft page separators emitted at pageIdx transitions; content flows past them.
  Changing objects[k] cannot affect top(0..k-1)  ← P3 locality.

Layer 3 — Render + edits (SinglePageView.jsx)
  Each text block → <EditableBlock> (height:auto, no minHeight; width from layout).
  Shared ResizeObserver fires on every browser-rewrap; writes DOM height to
  measuredHeightsRef with STRING key (block.id). bumpHeightTick() → useMemo
  recomputes layout → blocks below shift in the same frame.
  EditableBlock.useLayoutEffect: writes model text to DOM only when NOT typing
  (pendingText guard) so caret never resets during keystrokes.

Edit handlers:
  onInput  → pendingText.set(id, liveText); debounce 150ms → flushPending → setObjects
  Backspace at offset>0 → browser handles; disarms merge guard
  Backspace at offset 0, 1st press → arm mergeArmedRef (no merge yet)
  Backspace at offset 0, 2nd consecutive press → merge with prev text block; setObjects
  Enter → split at caret; new block inserted; caretIntentRef → useLayoutEffect places caret
  Any other key / mousedown → disarm merge guard
```

## buildObjects — Document Model Builder (`frontend/src/lib/buildObjects.js`)

Converts parsed `pages[]` → flat `Block[]`.

**Paragraph grouping (spacing-only — matches PDFMiner.six default):**
```
gap = prev_baseline_y - curr_baseline_y   (positive because PDF y is top-down)
if gap > PARA_BREAK_FACTOR × fontSize  →  new paragraph   (PARA_BREAK_FACTOR = 1.6)
if |prevFontSize - currFontSize| > 1.5  →  new paragraph
```
The SDK's `groupIntoParagraphs` four-rule algorithm is intentionally NOT used here because rules 2–4 (Short Line, Indent, Hanging) produce one-block-per-line fragments on ragged-right text.

**Header detection:**
```
isHeader = sdkSaysHeader  AND  text.length ≤ 60  AND  wordCount ≤ 8
```
Prevents long body sentences (> 8 words) being misclassified as headings via the SDK's centre-tolerance rule.

**Key invariant:** all `block.id` values are **strings** so `dataset.id` (always a string in HTML) and `Map.get(block.id)` use the same key. Numeric ids caused a silent `measuredHeights` cache miss that broke ResizeObserver reflow.

---

## pdf-parser Internals — Key Modules

### `pdfObjectReader.js`

- `getObject(bytes, pdfString, ref, returnBytes?)` — locates `N G obj … endobj` block by ref string
- `extractValue(objStr, key)` — extracts the value for a dictionary key (handles refs and names)
- `resolveLength(bytes, pdfString, objBytes)` — resolves `/Length` (may be an indirect ref)
- `decompressStream(objBytes, length)` — extracts and inflates (pako) the stream; auto-detects `\r\n` vs `\n` after the `stream` keyword.

### `pdfCMapParser.js`

- `parseCMap(cmapText)` → `{ '<hex>': '<hex>', ... }` raw map from `bf char/range` sections
- `buildCharMap(parsedCMap)` → `{ '<hex>': 'char', ... }` decoded map
- `translateText(cmapMap, hexStr)` → decoded Unicode string
- `getCMapCodeLengths(cmapMap)` → `{ min, max }` code unit size

### `pdfContentStreamTextProcessor.js`

- `processContentStream(decompressed, fonts)` → `TextElement[]`
- `decodePdfLiteralString(token)` → decoded string
- `groupIntoParagraphs(bodyLines)` → `Map<number, ParagraphBlock>`
- `detectParasAndHeaders(textElements, pageWidth)` → `Classification`
- `detectParagraphsFromElements(textElementsPerPage)` → `Array<{ paragraphIdx, lines: [{ pageIdx, elIdx, el }] }>` — cross-page paragraph grouping used by PDFViewer's Backspace handler. Breaks paragraphs when `prev.y − curr.y > prev.fontSize * 1.5`; page boundaries always start a new paragraph.

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
| React | ^18.2 | UI |
| Vite | ^5 | Dev server + bundler |
| Tailwind CSS | ^4 (`@tailwindcss/vite`) | Utility CSS |
| DaisyUI | ^5 | Component themes (30+ themes via `THEMES` constant) |
| Zustand | ^5 | Global state |
| react-router-dom | ^6 | Client-side routing |
| pdf-lib | ^1.17 | PDF re-generation for download |
| lucide-react | ^0.400 | Icons |
| react-hot-toast | ^2.4 | Toast notifications |
| axios | ^1.15 | (present in package.json; no current backend) |

---

## Quick Run

```bash
# CLI SDK test (Node.js — image extraction will warn, not crash)
node index.js TEST.pdf
node index.js "Color bg.pdf"

# Frontend dev server (from repo root with pnpm workspace, or from frontend/)
pnpm --filter pdf-editor-frontend dev
# or
cd frontend && npm run dev
# → http://localhost:5173
```

---

## Extension Guidelines

1. **New parsing logic**: add a new file in the relevant `pdf-parser/src/` domain (`core/`, `text/`, `images/`), export from `pdf-parser/index.js`. Never put parsing logic in `PdfDocument.js` or `PdfPage.js` — those are adapter-only.
2. **New regex**: add to `PDF_REGEX` in `pdfRegex.js`, don't define inline.
3. **New store actions**: add to `usePDFStore.js`. Either return a new `pages` array yourself or delegate flow to `applyGlobalReflow` — never mutate `state.pages` in place.
4. **New toolbar controls**: add tool id to `EDITING_TOOLS` constant, add handling in `EditToolbar.jsx`. If the control mutates a text element, route through a store action so the canvas re-renders automatically.
5. **New image formats**: add a new decode path in `imageDecoder.js` following the FlateDecode/DCTDecode pattern.
6. **`pdfSdk/` is gone**: the old `frontend/src/lib/pdfSdk/` barrel has been fully replaced by the `pdf-parser` workspace package. Do not recreate it.
7. **All exports from `pdf-parser` must be named** (not default) for tree-shaking.
8. **Use `try/catch` around all decompression and decode operations**; emit `console.warn` rather than crashing.
9. **Touching paragraph detection**: thresholds (`xthreshold`, `ythreshold`, `Multiplierz`) live as locals at the top of `groupIntoParagraphs`. Adjust them there — don't recompute from font metrics unless you're replacing the whole rule pipeline.
10. **Touching `applyGlobalReflow`**: read the docstring inside the engine first. The most common foot-gun is treating `flowY` as cumulative across calls — it's always recomputed fresh from `el.y`. Persisted `flowY` keys are deliberately stripped on rebuild.

---

## Maintenance Checklist

### Before committing `pdf-parser` changes:

1. Run `node index.js TEST.pdf` — confirm dimensions, text runs, and classification print without error.
2. Run with `"Color bg.pdf"` — confirm background image is detected and page images are listed.
3. Confirm image extraction falls back gracefully in Node (expected: `ReferenceError` on canvas ops, caught and logged, not a crash).
4. Confirm `classification.paragraphs.size` matches visual paragraph count on a multi-paragraph test PDF.

### Before committing frontend changes:

1. `pnpm --filter pdf-editor-frontend dev` — upload `TEST.pdf`, confirm pages render with correct aspect ratio.
2. Text elements appear at visually correct positions (no Y-axis inversion artifacts).
3. Background image fills the canvas behind text and page images.
4. Click a text element → blue caret appears. Type a character → it is inserted correctly. Type until line overflows → wrap to next line; keep typing until page overflows → new page is created and cursor lands on it.
5. Bold / Italic toggle reflects in the rendered text and in the toolbar button state.
6. Backspace at line start joins lines; Backspace at page top jumps cursor to previous page's last element.
7. Click an image → selection cursor / overlay appears. Drag a handle → on Apply, image resizes and text below reflows up/down accordingly.
8. Download produces a valid PDF (open in a PDF viewer to verify).
9. No console errors on load (check for missing exports, pako decompression failures, or canvas errors).

---

## Known Limitations / Future Work

- **Text width estimation** for canvas-fallback measurement uses `font.length * 0.55 * fontSize`; real Helvetica metrics would be more accurate.
- **Page tree**: `extractKidN` assumes a flat `/Kids` array. Nested intermediate page nodes (uncommon) will fail.
- **Font rendering**: all text is displayed in `serif` (browser) and re-exported in `Helvetica` (pdf-lib). Original font faces are not preserved.
- **Page overflow in export**: if a paragraph grew past the original page bottom, lines are clipped at 48pt margin. True reflowing to the next page in the export is not yet implemented.
- **Soft page boundaries in editor**: page separators are purely visual. Content that overflows a page boundary in the editor simply grows the tall canvas; it doesn't push text to the next logical page.
- **Bold/italic/color from toolbar**: toolbar controls exist but are wired to the old per-element store model, not the new `objects[]` model in SinglePageView.
- **Save button**: shows a toast but does not persist state between sessions.
- **Highlight / Underline / Notes tools**: UI exists but no rendering is implemented.
- **Only FlateDecode + DCTDecode** image filters supported. JBIG2, JPX, CCITTFax return `null`.
- **Multi-column layout**: spacing-only paragraph detection runs on all body lines together — two-column documents produce incorrect groupings.
- **Scanned PDFs**: element density too low for reliable geometry heuristics.
