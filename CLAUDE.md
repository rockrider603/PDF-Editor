# CLAUDE.md

Project context and maintenance guide for this workspace.

## Current Goal

A modular PDF analysis tool that:
- Extracts text via ToUnicode CMap fonts
- Detects and extracts embedded image XObjects with full positional metadata
- Identifies the background image using content stream paint operation analysis
- Stores all assets locally in `uploads/` with companion `.json` metadata

## Architecture

```
src/pdf/
├── extractAndTranslatePdf.js   # Orchestrator — coordinates all pipeline steps
├── core/
│   ├── pdfObjectReader.js      # getObject, resolveLength, decompressStream, extractValue
│   ├── pdfDictionaryResolver.js# resolveDictOrRef, extractInlineDictionary
│   └── pdfPageTreeResolver.js  # findRootRef, extractFirstKid
├── text/
│   ├── pdfFontCMapResolver.js  # Resolves /Font and /ToUnicode CMap streams
│   ├── pdfCMapParser.js        # parseCMap, translateText, buildCharMap
│   └── pdfContentStreamTextProcessor.js  # processContentStream, detectParasAndHeaders
├── images/
│   ├── pageContentParser.js    # buildXObjectNameMap, parsePaintOperations (shared, no I/O)
│   ├── imageDecoder.js         # decodeImageObject, parseImageMetadata, encodeBmp
│   ├── imageScanner.js         # scanPageImages — full-PDF image discovery and decoding
│   ├── backgroundDetector.js   # extractBackgroundImage — CTM-based page coverage scoring
│   └── imageStorage.js         # storePageImages, storeBackgroundImage
└── storage/
    └── fileStore.js            # hashBytes, writeImageToDisk — all filesystem I/O
```

## Module Responsibilities

| Module | Responsibility |
|---|---|
| `pageContentParser.js` | Parse CTM (`cm`) and paint (`Do`) operators from a content stream. Shared by both the scanner and detector. No I/O. |
| `imageDecoder.js` | Decode a single PDF image object. Handles FlateDecode → BMP and DCTDecode → JPEG. No I/O. |
| `imageScanner.js` | Walk every `/Page` in the XRef table, collect XObject references, build the `appearances` map, and decode all images. |
| `backgroundDetector.js` | Score each painted image by page coverage ratio. Returns the best background candidate (≥80% threshold, or largest fallback). |
| `imageStorage.js` | Build the metadata document and delegate writes to `fileStore.js`. No hash or fs logic inline. |
| `fileStore.js` | Only module that touches `fs`. Handles directory creation, file writes, and JSON companion files. |

## Key Data Shapes

Each stored image entry carries:
```json
{
  "hash": "<sha256>",
  "file_name": "<sha256>.jpg",
  "original_object": 9,
  "width": 1000,
  "height": 1000,
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

## Extension Guidelines

1. Add new logic in its domain module, not in the orchestrator.
2. Keep `extractAndTranslatePdf.js` as a coordinator only — no parsing logic.
3. Keep `index.js` minimal: argument parsing and invocation only.
4. All filesystem writes go through `fileStore.js`.
5. Use `try/catch` around recoverable parse operations; emit warnings rather than crashing.

## Quick Run

```bash
node index.js TEST.pdf
node index.js "path/to/file.pdf"
```

## Maintenance Checklist

Before committing parser changes:
1. Run with `TEST.pdf` and confirm `--- FINAL PDF CONTENT ---` is readable and correct.
2. Confirm image logs appear when `/Subtype/Image` objects are present.
3. Confirm `uploads/` contains the expected `.bmp`/`.jpg` files and their `.json` companions.
4. Confirm `bg_` prefix appears on one file only, and that the same object does not appear twice.
