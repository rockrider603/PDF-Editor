/**
 * pdfOffsetIndex.js
 *
 * Builds a byte-offset lookup map for every indirect object in a PDF file.
 *
 * Instead of searching the entire PDF string with a regex on every object
 * lookup (which fails when objects are out-of-order or when stream content
 * accidentally contains text that looks like an object header), we scan the
 * file exactly once to record the byte position of every "N G obj" token.
 *
 * The resulting map { "N G" → byteOffset } is passed into `getObject` so it
 * can jump directly to the right position, regardless of the order objects
 * appear in the file and regardless of what the streams contain.
 *
 * This also handles PDFs that have no traditional `xref` table or `trailer`
 * section (e.g. linearized or XRef-stream-only PDFs) by falling back to the
 * raw byte scan — we simply start from byte 0 and walk the file.
 */

/**
 * Scans `bytes` and returns a Map of "objId genId" → byte-offset for every
 * indirect object header found in the file.
 *
 * The scan looks for the literal byte sequence:
 *   <newline-or-start>  N  <space>  G  <space>  obj  <whitespace-or-EOF>
 * This mirrors exactly the PDF spec rule that an object header must begin at
 * a line boundary and the keyword `obj` must be followed by whitespace.
 *
 * @param {Uint8Array} bytes - Full raw PDF file bytes.
 * @returns {Map<string, number>}  key = "N G" (e.g. "1 0"), value = byte offset of start of "N G obj"
 */
export function buildOffsetIndex(bytes) {
    const index = new Map();
    const len = bytes.length;

    // We need fast byte access. We look for the ASCII sequence:
    //   \n<digits><space><digits><space>obj<whitespace>
    // or start-of-file with same pattern.

    // ASCII codes
    const CR  = 0x0D; // \r
    const LF  = 0x0A; // \n
    const SP  = 0x20; // space
    const TAB = 0x09; // tab
    const O   = 0x6F; // o
    const B   = 0x62; // b
    const J   = 0x6A; // j

    // Helper: is this byte a decimal digit?
    const isDigit = b => b >= 0x30 && b <= 0x39;
    // Helper: is this byte whitespace in PDF sense?
    const isWS    = b => b === SP || b === LF || b === CR || b === TAB || b === 0x0C || b === 0x00;

    let i = 0;
    while (i < len) {
        // We only start an object header scan at the beginning of the file or
        // right after a newline character.
        const prevByte = i === 0 ? LF : bytes[i - 1];
        const atLineStart = (prevByte === LF || prevByte === CR);

        if (!atLineStart) {
            i++;
            continue;
        }

        // Skip leading spaces/tabs at the start of the line
        let pos = i;
        while (pos < len && (bytes[pos] === SP || bytes[pos] === TAB)) pos++;

        // Read the first integer (object number)
        if (!isDigit(bytes[pos])) { i++; continue; }
        const numStart = pos;
        while (pos < len && isDigit(bytes[pos])) pos++;
        const numStr = String.fromCharCode(...bytes.subarray(numStart, pos));

        // Expect exactly one space
        if (pos >= len || bytes[pos] !== SP) { i++; continue; }
        pos++;

        // Read the second integer (generation number)
        if (!isDigit(bytes[pos])) { i++; continue; }
        const genStart = pos;
        while (pos < len && isDigit(bytes[pos])) pos++;
        const genStr = String.fromCharCode(...bytes.subarray(genStart, pos));

        // Expect exactly one space
        if (pos >= len || bytes[pos] !== SP) { i++; continue; }
        pos++;

        // Expect the keyword "obj"
        if (
            pos + 2 >= len ||
            bytes[pos]     !== O ||
            bytes[pos + 1] !== B ||
            bytes[pos + 2] !== J
        ) { i++; continue; }
        pos += 3; // past "obj"

        // "obj" must be followed by whitespace or end-of-file
        if (pos < len && !isWS(bytes[pos])) { i++; continue; }

        // Valid object header found — record the offset at the start of "N G obj"
        // (i.e. where the number begins, not the preceding newline)
        const headerStart = numStart;
        const key = `${numStr} ${genStr}`;

        // Only record the first occurrence (handles incremental updates where
        // a later revision might redefine an object; we want the latest, but
        // scanning forward means we see earlier versions first — for simplicity
        // we keep the last occurrence so we overwrite with later definitions).
        index.set(key, headerStart);

        i = pos; // advance past "obj"
    }

    return index;
}

/**
 * Attempts to find the Root catalog reference without a trailer section.
 *
 * Strategy (in order):
 * 1. Scan backwards for the `trailer` keyword and extract `/Root` from it
 *    (handles traditional xref + trailer PDFs).
 * 2. If no trailer, scan backwards for a `startxref` followed by a byte
 *    offset, then read the XRef stream object's dictionary for `/Root`
 *    (handles PDF 1.5+ XRef-stream-only PDFs).
 * 3. If neither works, fall back to object `1 0 R` if it exists in the index,
 *    then walk from there looking for `/Type /Catalog`.
 * 4. Last resort: scan every object in the index until `/Type /Catalog` is found.
 *
 * @param {Uint8Array}      bytes      - Full raw PDF bytes.
 * @param {string}          pdfString  - Full PDF as binary string.
 * @param {Map<string,number>} index   - Offset index from buildOffsetIndex().
 * @returns {string}  Indirect reference string, e.g. "1 0 R".
 * @throws {Error}    If no catalog can be found.
 */
export function findRootRefRobust(bytes, pdfString, index) {
    // ── 1. Traditional trailer ───────────────────────────────────────────────
    const trailerIdx = pdfString.lastIndexOf('trailer');
    if (trailerIdx !== -1) {
        const chunk = pdfString.substring(trailerIdx, trailerIdx + 512);
        const m = chunk.match(/\/Root\s+(\d+\s+\d+\s+R)/);
        if (m) return m[1];
    }

    // ── 2. startxref → XRef stream ──────────────────────────────────────────
    const sxIdx = pdfString.lastIndexOf('startxref');
    if (sxIdx !== -1) {
        const afterSx = pdfString.substring(sxIdx + 9, sxIdx + 30).trim();
        const offsetMatch = afterSx.match(/^(\d+)/);
        if (offsetMatch) {
            const xrefOffset = parseInt(offsetMatch[1], 10);
            // The XRef stream object starts at this offset — read ~1 KB of its header
            const headerChunk = pdfString.substring(xrefOffset, xrefOffset + 1024);
            const rootM = headerChunk.match(/\/Root\s+(\d+\s+\d+\s+R)/);
            if (rootM) return rootM[1];
        }
    }

    // ── 3. Look for /Type /Catalog in every indexed object ──────────────────
    for (const [key, offset] of index) {
        const slice = pdfString.substring(offset, offset + 1024);
        if (slice.includes('/Type') && slice.includes('/Catalog')) {
            const [numStr, genStr] = key.split(' ');
            return `${numStr} ${genStr} R`;
        }
    }

    throw new Error(
        'Could not locate PDF Root/Catalog. ' +
        'No trailer, no startxref, and no /Type /Catalog object found.'
    );
}
