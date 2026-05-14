// Flattens parsed pages[] into a unified objects[] stream for the
// single-page-view rendering pipeline.
//
// Object shapes:
//   { type: 'image',     pageIdx, dataUrl, x, y, renderedWidth, renderedHeight, role, globalTopY }
//   { type: 'paragraph', id, pageIdx, text, x, y, width, fontSize, lines[], globalTopY }
//   { type: 'header',    pageIdx, text, x, y, fontSize, globalTopY }
//   { type: 'line',      pageIdx, text, x, y, fontSize, globalTopY }   // orphan body lines
//
// Paragraph ids are assigned globally, starting at 0 in reading order
// (top of page 0 first), incrementing across pages.
//
// `globalTopY` is the CSS-space TOP coordinate (in PDF points, not scaled)
// measured from the top of the *concatenated* document. It does NOT include
// inter-page separator padding — the view layer adds that.

const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;

export function buildObjects(pages = []) {
  const objects = [];
  let paragraphId = 0;

  // Pre-compute global y offsets (top of each page in pure PDF points,
  // stacking pages without any separator gap).
  const pageOffsets = [];
  let cumulative = 0;
  for (const p of pages) {
    pageOffsets.push(cumulative);
    cumulative += p?.dimensions?.height ?? DEFAULT_PAGE_HEIGHT;
  }

  pages.forEach((page, pageIdx) => {
    const pageHeight = page?.dimensions?.height ?? DEFAULT_PAGE_HEIGHT;
    const pageWidth = page?.dimensions?.width ?? DEFAULT_PAGE_WIDTH;
    const pageOffset = pageOffsets[pageIdx];

    const pageObjects = [];

    // ── Images ────────────────────────────────────────────────────────
    const bg = page?.images?.background;
    if (bg?.dataUrl) {
      pageObjects.push({
        type: 'image',
        pageIdx,
        dataUrl: bg.dataUrl,
        role: 'background',
        x: 0,
        y: 0,                                  // PDF coords, bottom-left
        renderedWidth: pageWidth,
        renderedHeight: pageHeight,
        // bottom-left → CSS top in global space
        globalTopY: pageOffset + 0,
      });
    }

    for (const img of page?.images?.pageImages ?? []) {
      const ap = img.appearances?.[0];
      if (!ap) continue;
      const topYInPage = pageHeight - ap.y - ap.renderedHeight;
      pageObjects.push({
        type: 'image',
        pageIdx,
        dataUrl: img.dataUrl,
        role: img.role ?? 'image',
        x: ap.x,
        y: ap.y,
        renderedWidth: ap.renderedWidth,
        renderedHeight: ap.renderedHeight,
        globalTopY: pageOffset + topYInPage,
      });
    }

    // ── Text: paragraphs + headers + orphan lines ─────────────────────
    const textElements = page?.textElements ?? [];
    const classification = page?.classification ?? null;
    const paragraphsMap = classification?.detailed?.paragraphs ?? null;
    const headerTexts = new Set(classification?.headers ?? []);

    // Build lookup: textElement index → paragraph block (from this page).
    const elIdxToParaBlock = new Map();
    if (paragraphsMap) {
      paragraphsMap.forEach((para) => {
        for (const line of para.lines) {
          const idx = textElements.findIndex(
            (el) =>
              el.x === line.x && el.y === line.y && el.text === line.text
          );
          if (idx !== -1) elIdxToParaBlock.set(idx, para);
        }
      });
    }

    // Emit each paragraph at most once, when we first encounter one of
    // its lines (preserves document reading order across header / para /
    // orphan-line interleaving).
    const emittedParaBlockIds = new Set();

    textElements.forEach((el, idx) => {
      const paraBlock = elIdxToParaBlock.get(idx);
      if (paraBlock) {
        if (emittedParaBlockIds.has(paraBlock.id)) return;
        emittedParaBlockIds.add(paraBlock.id);

        const topYInPage =
          pageHeight - paraBlock.y - (paraBlock.fontSize ?? 12) * 0.8;
        pageObjects.push({
          type: 'paragraph',
          id: paragraphId++,
          pageIdx,
          text: paraBlock.text,
          x: paraBlock.x,
          y: paraBlock.y,
          width: paraBlock.width,
          fontSize: paraBlock.fontSize ?? 12,
          lines: paraBlock.lines.map((l) => ({
            text: l.text,
            x: l.x,
            y: l.y,
            fontSize: l.fontSize ?? 12,
            isBold: !!l.isBold,
            isItalic: !!l.isItalic,
            color: l.color ?? null,
          })),
          globalTopY: pageOffset + topYInPage,
        });
        return;
      }

      // Not part of any paragraph → header or orphan line.
      const isHeader = el.isHeader || headerTexts.has(el.text);
      const ascent = (el.fontSize ?? 12) * 0.8;
      const topYInPage = pageHeight - el.y - ascent;
      pageObjects.push({
        type: isHeader ? 'header' : 'line',
        pageIdx,
        text: el.text,
        x: el.x,
        y: el.y,
        fontSize: el.fontSize ?? 12,
        isBold: !!el.isBold,
        isItalic: !!el.isItalic,
        color: el.color ?? null,
        globalTopY: pageOffset + topYInPage,
      });
    });

    // Sort objects on this page by their top y (smallest first = top-down).
    pageObjects.sort((a, b) => a.globalTopY - b.globalTopY);
    objects.push(...pageObjects);
  });

  return objects;
}

// Pretty-print the unified objects stream in the format requested by the
// product spec:
//
//   Objects:
//   {type:image,...}
//   {type:paragraph, id:0,...}
//   ...
//
export function logObjects(objects) {
  console.log('Objects:');
  for (const obj of objects) {
    if (obj.type === 'image' && typeof obj.dataUrl === 'string') {
      // Truncate base64 so the console stays scannable.
      const { dataUrl, ...rest } = obj;
      const preview =
        dataUrl.length > 64 ? dataUrl.slice(0, 48) + '…[truncated]' : dataUrl;
      console.log({ ...rest, dataUrl: preview });
    } else {
      console.log(obj);
    }
  }
}
