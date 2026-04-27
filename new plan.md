# PDF Editor Window: Canvas Reconstruction — Implementation Plan

## Goal

Replace the current list/metadata view in the Editor Window with a **true canvas** that visually reconstructs the PDF page. Text (headers + paragraphs) and images are placed at pixel-accurate PDF coordinates on a white box sized to the real page dimensions.

Both text layers (headers, paragraphs) and image layers (background, page images) are implemented together in this plan.

---

## The Architecture Problem

The Node.js pipeline (`pdf/extractAndTranslatePdf.js`) uses `fs`, `zlib`, and `Buffer` — **none of which exist in the browser**. It cannot be imported into the React frontend.

**Solution:** Build a browser-compatible **PDF SDK** as a new module at `frontend/src/lib/pdfSdk/` using `pdfjs-dist` (already in `frontend/package.json`). This SDK is tree-shakable and exports individual named functions so callers import only what they need.

---

## Coordinate System: PDF → CSS

PDF uses **bottom-left origin**. CSS uses **top-left origin**. Every element must be flipped on the Y axis:

```
scale        = CANVAS_WIDTH_PX / pageWidthPt
canvas_x_px  = element.x * scale
canvas_y_px  = (pageHeight - element.y - element.height) * scale
```

---

## Proposed File Changes

### 1. [NEW] `frontend/src/lib/pdfSdk/` — Browser PDF SDK

A tree-shakable SDK. Each concern is its own named export in its own file. Callers import only what they use.

```
frontend/src/lib/pdfSdk/
├── index.js          ← re-exports everything (barrel, enables tree-shaking)
├── loader.js         ← loadPdf(file: File) → PDFDocumentProxy
├── pageInfo.js       ← getPageInfo(page) → { width, height }
├── textExtractor.js  ← extractText(page) → TextElement[]
├── classifier.js     ← classifyText(elements, pageWidth) → Classification
└── imageExtractor.js ← extractImages(page) → ImageEntry[]
```

**`loader.js`** — configures the pdfjs worker and loads the doc:
```js
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js', import.meta.url
).toString();

export async function loadPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}
```

**`pageInfo.js`** — page dimensions in PDF points:
```js
export function getPageInfo(page) {
  const [, , width, height] = page.view; // [x0, y0, x1, y1]
  return { width, height };
}
```

**`textExtractor.js`** — extracts positioned text items:
```js
// Returns: { text, x, y, width, height, fontSize }[]
export async function extractText(page) { ... }
```

**`classifier.js`** — same logic as Node.js `detectParasAndHeaders`, ported to ESM, dynamic `pageWidth`:
```js
// Returns: { detailed: { headers: [...], paragraphs: [...] } }
export function classifyText(elements, pageWidth) { ... }
```

**`imageExtractor.js`** — extracts images via operator list + `objs`:
```js
// Returns: { dataUrl, x, y, renderedWidth, renderedHeight, role }[]
export async function extractImages(page, pageHeight) { ... }
```

**`index.js`** — barrel re-export (tree-shakable):
```js
export { loadPdf }       from './loader.js';
export { getPageInfo }   from './pageInfo.js';
export { extractText }   from './textExtractor.js';
export { classifyText }  from './classifier.js';
export { extractImages } from './imageExtractor.js';
```

> [!IMPORTANT]
> Using named re-exports (not `export * from`) keeps each function independently tree-shakable. Bundlers like Vite drop anything not imported.

---

### 2. [MODIFY] `frontend/src/store/usePDFStore.js`

Add `pageDimensions` field:
```js
pageDimensions: { width: 612, height: 792 },
setPageDimensions: (dims) => set({ pageDimensions: dims }),
```

---

### 3. [MODIFY] `frontend/src/pages/EditingPage.jsx`

Add a `useEffect` that runs the SDK pipeline on mount:
```js
import { loadPdf, getPageInfo, extractText, classifyText, extractImages }
  from '../lib/pdfSdk';

useEffect(() => {
  if (!currentPDF) return;
  (async () => {
    setIsLoading(true);
    const doc  = await loadPdf(currentPDF);
    const page = await doc.getPage(1);            // Page 1 only for now
    const info = getPageInfo(page);
    const elements = await extractText(page);
    const classification = classifyText(elements, info.width);
    const images = await extractImages(page, info.height);
    setPageDimensions(info);
    setExtractedData({ rawElements: elements, classification }, images);
    setIsLoading(false);
  })();
}, [currentPDF]);
```

Show a centered spinner while `isLoading` is true.

---

### 4. [MODIFY] `frontend/src/components/PDFViewer.jsx`

Replace the entire tab/list UI with a **3-layer positioned canvas**:

```
┌────────────────────────────────────────────────┐  ← white box
│  position: relative                            │    width = CANVAS_WIDTH
│  height   = pageHeight * scale                 │
│                                                │
│  z=0  Background <img>  (position:absolute,    │
│        top:0, left:0, width:100%, height:100%) │
│                                                │
│  z=1  Page image <img>s (position:absolute,    │
│        left: x*scale, top: flipY*scale,        │
│        width: w*scale, height: h*scale)        │
│                                                │
│  z=2  Text <div>s  (position:absolute,         │
│        left: x*scale, top: flipY*scale,        │
│        fontSize: fontSize*scale)               │
└────────────────────────────────────────────────┘
```

Scale constants (defined at top of file):
```js
const CANVAS_WIDTH = 800; // fixed display width in px
```

Scale computed from props:
```js
const scale = CANVAS_WIDTH / pageWidth;
const canvasHeight = pageHeight * scale;
```

Y-flip helper (inline in JSX):
```js
const toCanvasY = (pdfY, elHeight = 0) =>
  (pageHeight - pdfY - elHeight) * scale;
```

**Headers** → rendered as `<div>` with `fontWeight: bold`, larger `fontSize`  
**Paragraphs** → rendered as `<div>` with normal weight  
**Background image** → `<img>` at z=0, full canvas size  
**Page images** → `<img>` at z=1, positioned by `appearances[0]` coords

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/lib/pdfSdk/index.js` | **NEW** | Barrel re-export for tree-shaking |
| `frontend/src/lib/pdfSdk/loader.js` | **NEW** | pdfjs worker config + `loadPdf` |
| `frontend/src/lib/pdfSdk/pageInfo.js` | **NEW** | `getPageInfo` — page dimensions |
| `frontend/src/lib/pdfSdk/textExtractor.js` | **NEW** | `extractText` — positioned text items |
| `frontend/src/lib/pdfSdk/classifier.js` | **NEW** | `classifyText` — headers vs paragraphs |
| `frontend/src/lib/pdfSdk/imageExtractor.js` | **NEW** | `extractImages` — image data URLs + coords |
| `frontend/src/store/usePDFStore.js` | **MODIFY** | Add `pageDimensions` + setter |
| `frontend/src/pages/EditingPage.jsx` | **MODIFY** | Run SDK pipeline on mount |
| `frontend/src/components/PDFViewer.jsx` | **MODIFY** | Replace lists with positioned canvas |

---

## Implementation Order

```
1. pdfSdk/loader.js         (no deps)
2. pdfSdk/pageInfo.js       (no deps)
3. pdfSdk/textExtractor.js  (depends on pdfjs page object)
4. pdfSdk/classifier.js     (pure logic, no deps)
5. pdfSdk/imageExtractor.js (depends on pdfjs page object)
6. pdfSdk/index.js          (barrel, depends on all above)
7. usePDFStore.js            (add pageDimensions)
8. EditingPage.jsx           (wire SDK)
9. PDFViewer.jsx             (canvas rendering)
```

---

## Open Questions

> [!IMPORTANT]
> **Font rendering:** `pdfjs-dist` provides `fontName` per text item but embedded fonts can't be trivially loaded in CSS. Plan: use `fontFamily: 'sans-serif'` + correct `fontSize` for v1. Acceptable?

> [!NOTE]
> **Multi-page:** Scope is Page 1 only, consistent with the existing CLI pipeline. Multi-page can be added later by looping `doc.getPage(n)`.

---

## Verification

1. `node index.js TEST.pdf` — backend pipeline unchanged, no regressions
2. `cd frontend && npm run dev` — upload `TEST.pdf`, editor opens
3. Canvas shows white box with correct letter-page aspect ratio
4. Text appears at correct vertical/horizontal positions
5. Background image fills canvas behind all other layers
6. Page images appear at their PDF coordinates with correct size
