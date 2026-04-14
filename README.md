# PDF Parser

A modular Node.js PDF parser that extracts:
- Raw content stream
- Font ToUnicode CMaps
- Translated text from TJ/Tj operators
- Image XObjects (`/Type /XObject`, `/Subtype /Image`)

## Project Structure

```text
.
├── index.js
└── src
    └── pdf
        ├── core
        │   ├── pdfDictionaryResolver.js
        │   ├── pdfObjectReader.js
        │   └── pdfPageTreeResolver.js
        ├── images
        │   └── pdfImageXObjectProcessor.js
        ├── text
        │   ├── pdfCMapParser.js
        │   ├── pdfContentStreamTextProcessor.js
        │   └── pdfFontCMapResolver.js
        └── extractAndTranslatePdf.js
```

## Module Responsibilities

### Entry
- `index.js`
  - CLI entrypoint
  - Reads input path from `process.argv[2]`
  - Calls `extractAndTranslatePdf(...)`

### Orchestration
- `src/pdf/extractAndTranslatePdf.js`
  - End-to-end flow for a single PDF:
  - resolve root/pages/page/content stream
  - extract fonts and CMaps
  - detect image XObjects
  - process translated text
  - print debug sections and final content

### Core
- `src/pdf/core/pdfObjectReader.js`
  - `getObject(...)`
  - `extractValue(...)`
  - `resolveLength(...)`
  - `decompressStream(...)`

- `src/pdf/core/pdfDictionaryResolver.js`
  - `extractInlineDictionary(...)`
  - `resolveDictOrRef(...)`
  - Supports both inline dictionaries (`<<...>>`) and indirect refs (`n n R`)

- `src/pdf/core/pdfPageTreeResolver.js`
  - `findRootRef(...)`
  - `extractFirstKid(...)`

### Text
- `src/pdf/text/pdfCMapParser.js`
  - Parses `beginbfchar` and `beginbfrange`
  - Handles variable glyph code widths
  - Handles multi-code-unit Unicode mappings (ex: `00660069`)
  - Translates hex glyph strings to readable text

- `src/pdf/text/pdfFontCMapResolver.js`
  - Resolves `/Resources` and `/Font`
  - Loads `/ToUnicode` maps per font

- `src/pdf/text/pdfContentStreamTextProcessor.js`
  - Processes `TJ` and `Tj`
  - Decodes hex strings and literal strings
  - Merges text chunks by close Y-coordinate for cleaner line reconstruction

### Images
- `src/pdf/images/pdfImageXObjectProcessor.js`
  - Finds `/XObject` entries
  - Filters image objects using `/Subtype/Image` or `/Subtype /Image`
  - Extracts image metadata (width, height, color space, bits per component, filter)

## Usage

```bash
node index.js <file.pdf>
```

Examples:

```bash
node index.js test.pdf
node index.js "Hello World.pdf"
```

## Output Sections

The parser prints sections in this order:
1. Starting analysis and object trace
2. Raw content stream
3. Fonts and CMaps
4. Images found (if any)
5. Translated text (debug)
6. Final PDF content

## Notes

- The current implementation focuses on first-page extraction.
- The parser is intentionally verbose for debugging and validation.
- The architecture is split by domain (`core`, `text`, `images`) to keep code maintainable.
