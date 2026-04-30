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

- **Printable char**: insert at `charOffset`, word-wrap if line overflows → `insertTextElement + shiftElementsBelow`
- **Backspace at offset > 0**: delete char before cursor
- **Backspace at offset 0**: merge with previous element, remove current, shift elements up
- **ArrowLeft / ArrowRight**: move `charOffset` within element or jump to adjacent element
- Text width is measured with an off-screen `<canvas>` and `CanvasRenderingContext2D.measureText()`

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

---

## Maintenance Checklist

### Before committing `pdf-parser` changes:

1. Run `node index.js TEST.pdf` — confirm dimensions, text runs, and classification print without error.
2. Run with `"Color bg.pdf"` — confirm background image is detected and page images are listed.
3. Confirm image extraction falls back gracefully in Node (expected: `ReferenceError` on canvas ops, not a crash).

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
- **Multi-line text flow**: word-wrap on typing uses canvas measurement but only wraps at spaces; mid-word overflow is not handled.
- **Page tree**: `extractKidN` assumes a flat `/Kids` array (one level). Nested intermediate page nodes (uncommon) will fail.
- **Font rendering**: all text is displayed in `serif` (browser) and re-exported in `Helvetica` (pdf-lib). Original font faces are not preserved.
- **Highlight tool**: UI exists but no highlight rendering is implemented yet.
- **Save button**: shows a toast but does not persist state between sessions.
- **Only FlateDecode + DCTDecode** image filters are supported. JBIG2, JPX, CCITTFax will return `null`.
