# CLAUDE.md

Project context and maintenance guide for this workspace.

## Current Goal

Maintain a modular PDF analysis tool that:
- extracts text via ToUnicode CMaps,
- detects embedded image XObjects,
- and keeps detailed debug logs during parsing.

## Architecture Context

The project is organized by responsibility:
- `core`: low-level PDF object/page/dictionary handling
- `core/db.js`: MongoDB connection management
- `text`: CMap parsing and content stream text reconstruction
- `images`: image XObject discovery, background detection, and metadata extraction
- `images/pdfImageStorage.js`: image persistence to file system and MongoDB
- `images/pdfBackgroundExtractor.js`: identifies the background image by analysing content-stream paint operations vs. page dimensions
- `extractAndTranslatePdf.js`: orchestration layer
- `index.js`: CLI entrypoint

## Behavioral Expectations

1. Keep existing debug sections and log order stable.
2. Preserve support for both PDF styles:
   - LibreOffice-generated PDFs
   - Word-generated PDFs
3. Continue handling:
   - inline dictionaries and indirect references
   - variable-width glyph codes in CMaps
   - multi-code-unit Unicode mappings
4. Keep first-page extraction behavior unless explicitly expanded.

## Extension Guidelines

When adding features:
1. Add logic in the correct domain module (`core`, `text`, `images`).
2. Keep `extractAndTranslatePdf.js` as coordinator only.
3. Keep `index.js` minimal (argument parsing and dispatch).
4. Use `try/catch` around recoverable parse logic and emit warnings instead of hard-failing when possible.
5. Avoid changing existing output labels unless required.

## Known Data Paths

- Entry: `index.js`
- Main orchestration: `src/pdf/extractAndTranslatePdf.js`
- Text extraction path:
  - `src/pdf/text/pdfFontCMapResolver.js`
  - `src/pdf/text/pdfCMapParser.js`
  - `src/pdf/text/pdfContentStreamTextProcessor.js`
- Image extraction path:
  - `src/pdf/images/pdfImageXObjectProcessor.js` (XObject discovery & byte extraction)
  - `src/pdf/images/pdfBackgroundExtractor.js` (background detection via CTM analysis)
  - `src/pdf/images/pdfImageStorage.js` (FS + MongoDB persistence)
- Database:
  - `src/pdf/core/db.js`

## Quick Run

```bash
node index.js test.pdf
node index.js "Hello World.pdf"
```

## Maintenance Checklist

Before committing parser changes:
1. Run with at least one LibreOffice PDF and one Word PDF.
2. Confirm `--- FINAL PDF CONTENT ---` remains readable and accurate.
3. Confirm image logs appear when `/Subtype/Image` exists.
4. Confirm no regressions in CMap decoding output.
