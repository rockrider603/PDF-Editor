# CLAUDE.md

Project context and maintenance guide for this workspace.

---

## Current Goal

A modular PDF analysis and editing tool that:
- Extracts text via ToUnicode CMap fonts (Node.js CLI pipeline)
- Detects and extracts embedded image XObjects with full positional metadata
- Identifies the background image using content stream paint operation analysis
- Stores all assets locally in `uploads/` with companion `.json` metadata
- **Reconstructs the PDF page visually in the browser editor window** using `pdfjs-dist`

---

## Project Structure

```
PDF-Editor/
├── index.js                        # CLI entry — argument parsing + invocation only
├── pdf/                            # Node.js-only extraction pipeline (NOT browser-compatible)
│   ├── extractAndTranslatePdf.js   # Orchestrator — coordinates all pipeline steps
│   ├── core/
│   │   ├── pdfObjectReader.js      # getObject, resolveLength, decompressStream, extractValue
│   │   ├── pdfDictionaryResolver.js# resolveDictOrRef, extractInlineDictionary
│   │   └── pdfPageTreeResolver.js  # findRootRef, extractFirstKid
│   ├── text/
│   │   ├── pdfFontCMapResolver.js  # Resolves /Font and /ToUnicode CMap streams
│   │   ├── pdfCMapParser.js        # parseCMap, translateText, buildCharMap
│   │   └── pdfContentStreamTextProcessor.js  # processContentStream, detectParasAndHeaders
│   ├── images/
│   │   ├── pageContentParser.js    # buildXObjectNameMap, parsePaintOperations (no I/O)
│   │   ├── imageDecoder.js         # decodeImageObject, parseImageMetadata, encodeBmp
│   │   ├── imageScanner.js         # scanPageImages — full-PDF image discovery and decoding
│   │   ├── backgroundDetector.js   # extractBackgroundImage — CTM-based page coverage scoring
│   │   └── imageStorage.js         # storePageImages, storeBackgroundImage
│   ├── storage/
│   │   └── fileStore.js            # hashBytes, writeImageToDisk — all filesystem I/O
│   └── utils/
│       └── pdfRegex.js             # PDF_REGEX — centralised regex collection (CommonJS)
└── frontend/                       # React + Vite + DaisyUI frontend
    └── src/
        ├── lib/
        │   └── pdfSdk/             # Browser-compatible PDF SDK (pdfjs-dist based)
        │       ├── index.js        # Barrel re-export — enables tree-shaking
        │       ├── loader.js       # loadPdf(file) → PDFDocumentProxy
        │       ├── pageInfo.js     # getPageInfo(page) → { width, height }
        │       ├── textExtractor.js# extractText(page) → TextElement[]
        │       ├── classifier.js   # classifyText(elements, pageWidth) → Classification
        │       └── imageExtractor.js # extractImages(page, pageHeight) → ImageEntry[]
        ├── pages/
        │   ├── UploadPage.jsx      # Drag-and-drop PDF upload, validates + stores File object
        │   └── EditingPage.jsx     # Runs pdfSdk pipeline on mount; renders PDFViewer
        ├── components/
        │   ├── PDFViewer.jsx       # 3-layer positioned canvas (bg image / page images / text)
        │   ├── EditToolbar.jsx     # Tool palette (highlight, underline, notes, crop, etc.)
        │   ├── FileUpload.jsx      # Drag-and-drop zone; validates size + type
        │   └── Navbar.jsx          # Top nav with theme switcher
        ├── store/
        │   ├── usePDFStore.js      # Zustand: currentPDF, extractedContent, extractedImages, pageDimensions
        │   └── useThemeStore.js    # Zustand: active DaisyUI theme
        └── constants/
            └── index.js            # THEMES, PDF_UPLOAD_LIMITS, EDITING_TOOLS, NOTIFICATION_MESSAGES
```

---

## Two Separate Pipelines

| Pipeline | Location | Runtime | Entry point |
|---|---|---|---|
| Extraction / analysis | `pdf/` | Node.js only | `node index.js <file.pdf>` |
| Browser editor / canvas | `frontend/src/lib/pdfSdk/` | Browser only | `pdfSdk/index.js` |

**Do not cross the streams.** The Node.js pipeline uses `fs`, `zlib`, `Buffer` — none available in the browser. The browser SDK uses `pdfjs-dist` — not suitable for headless CLI work.

---

## pdfSdk — Browser PDF SDK

Tree-shakable named exports. Import only what you need:

```js
import { loadPdf, getPageInfo, extractText, classifyText, extractImages }
  from '../lib/pdfSdk';
```

### Data Shapes

**TextElement** (output of `extractText`):
```js
{ text: string, x: number, y: number, width: number, height: number, fontSize: number }
```

**Classification** (output of `classifyText`):
```js
{
  detailed: {
    headers:    [{ text, xPosition, elementCenter, yPosition, fontSize }],
    paragraphs: [{ text, xPosition, elementCenter, yPosition, fontSize }]
  }
}
```

**ImageEntry** (output of `extractImages`):
```js
{ dataUrl: string, x: number, y: number, renderedWidth: number, renderedHeight: number, role: 'background'|'image' }
```

### Coordinate System (critical)

PDF origin = bottom-left. CSS origin = top-left. Always flip Y before placing elements:
```js
const scale     = CANVAS_WIDTH_PX / pageWidth;
const canvasY   = (pageHeight - element.y - element.height) * scale;
const canvasX   = element.x * scale;
```

---

## Node.js Pipeline — Key Data Shapes

Each stored image entry (`uploads/*.json`):
```json
{
  "hash": "<sha256>",
  "file_name": "<sha256>.jpg",
  "original_object": 9,
  "width": 1000, "height": 1000,
  "filter_type": "DCTDecode",
  "extracted_at": "...",
  "role": "image",
  "format": "jpeg",
  "appearances": [
    { "x": 120.8, "y": 350.0, "renderedWidth": 367.8, "renderedHeight": 367.8 }
  ]
}
```

Background images use `"role": "background"` and are prefixed with `bg_`.

---

## Zustand Store Shape (`usePDFStore`)

```js
{
  currentPDF:      File | null,
  extractedContent: { rawElements: TextElement[], classification: Classification } | null,
  extractedImages:  { background: ImageEntry|null, pageImages: ImageEntry[] } | null,
  pageDimensions:  { width: number, height: number },   // PDF points, e.g. 612×792
  isLoading:       boolean,
  error:           string | null,

  setCurrentPDF(file),
  setExtractedData(content, images),
  setPageDimensions(dims),
  clearError()
}
```

---

## PDFViewer Canvas Architecture

```
<div style={{ position:'relative', width: CANVAS_WIDTH, height: pageHeight*scale }}>

  {/* Layer 0 — Background image */}
  <img style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', zIndex:0 }} />

  {/* Layer 1 — Page images */}
  {images.map(img => (
    <img style={{ position:'absolute', left: img.x*scale, top: toCanvasY(img.y, img.h)*scale,
                  width: img.renderedWidth*scale, height: img.renderedHeight*scale, zIndex:1 }} />
  ))}

  {/* Layer 2 — Text (headers + paragraphs) */}
  {elements.map(el => (
    <div style={{ position:'absolute', left: el.x*scale, top: toCanvasY(el.y, el.height)*scale,
                  fontSize: el.fontSize*scale, zIndex:2 }}>
      {el.text}
    </div>
  ))}

</div>
```

---

## Extension Guidelines

1. New Node.js parsing logic goes in its domain module (`text/`, `images/`, `core/`), not the orchestrator.
2. New browser rendering logic goes in `pdfSdk/` (its own file, exported from `index.js`).
3. Keep `extractAndTranslatePdf.js` as coordinator only — no parsing logic inline.
4. Keep `index.js` minimal — argument parsing and invocation only.
5. All filesystem writes go through `fileStore.js`.
6. Use `try/catch` around recoverable parse operations; emit warnings rather than crashing.
7. pdfSdk exports must be **named exports** (not default) so tree-shaking works correctly.

---

## Quick Run

```bash
# CLI pipeline (Node.js)
node index.js TEST.pdf
node index.js "path/to/file.pdf"

# Frontend dev server
cd frontend && npm run dev
```

---

## Maintenance Checklist

**Before committing parser changes (Node.js pipeline):**
1. Run with `TEST.pdf` and confirm `--- FINAL PDF CONTENT ---` is readable and correct.
2. Confirm image logs appear when `/Subtype/Image` objects are present.
3. Confirm `uploads/` contains the expected `.bmp`/`.jpg` files and their `.json` companions.
4. Confirm `bg_` prefix appears on one file only.

**Before committing frontend changes:**
1. `npm run dev` — upload `TEST.pdf`, confirm canvas renders with correct aspect ratio.
2. Text elements appear at visually correct positions (no Y-axis inversion artifacts).
3. Background image fills the canvas behind text and page images.
4. No console errors from pdfjs worker or missing exports.
