// Flattens parsed pages[] into a unified objects[] stream — the document
// model consumed by SinglePageView.
//
// IMPORTANT: this output is the *model*, not a layout. Positions in CSS pixels
// are computed downstream by layoutObjects() (frontend/src/lib/layoutObjects.js).
// Blocks carry only their identity, content, and original PDF coordinates;
// they carry no canvas-space y, height, or wrap geometry.
//
// Block shapes:
//   paragraph:
//     { id: number, type:'paragraph', pageIdx, text, x, fontSize, lines[],
//       isBold, isItalic, color }
//
//   header / line (orphan body line outside any detected paragraph):
//     { id: string, type:'header'|'line', pageIdx, text, x, fontSize,
//       isBold, isItalic, color }
//
//   image:
//     { id: string, type:'image', pageIdx, dataUrl, role:'background'|'image',
//       x, y, renderedWidth, renderedHeight, pageHeight }
//     x/y/renderedWidth/renderedHeight are PDF user-space points (bottom-left
//     origin). pageHeight is needed for the page-relative anchor formula in
//     the layout pass.
//
// Paragraph ids are globally incrementing numbers starting at 0, in document
// reading order, so the console log keeps the {id:0, id:1, …} shape that
// was originally specified. Header/line/image ids are strings so they cannot
// collide with paragraph numerics.

const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;

export function buildObjects(pages = []) {
  const objects = [];
  let paragraphId = 0;

  pages.forEach((page, pageIdx) => {
    const pageHeight = page?.dimensions?.height ?? DEFAULT_PAGE_HEIGHT;
    const pageWidth = page?.dimensions?.width ?? DEFAULT_PAGE_WIDTH;

    const pageObjects = [];

    // ── Images ────────────────────────────────────────────────────────
    const bg = page?.images?.background;
    if (bg?.dataUrl) {
      pageObjects.push({
        id: `img-${pageIdx}-bg`,
        type: 'image',
        pageIdx,
        dataUrl: bg.dataUrl,
        role: 'background',
        x: 0,
        y: 0,
        renderedWidth: pageWidth,
        renderedHeight: pageHeight,
        pageHeight,
        // synthetic globalTopY used only for the document-order sort below;
        // never reaches the rendered output.
        _sortY: 0,
      });
    }

    (page?.images?.pageImages ?? []).forEach((img, imgIdx) => {
      const ap = img.appearances?.[0];
      if (!ap) return;
      const topYInPage = pageHeight - ap.y - ap.renderedHeight;
      pageObjects.push({
        id: `img-${pageIdx}-${img.objNum ?? imgIdx}`,
        type: 'image',
        pageIdx,
        dataUrl: img.dataUrl,
        role: img.role ?? 'image',
        x: ap.x,
        y: ap.y,
        renderedWidth: ap.renderedWidth,
        renderedHeight: ap.renderedHeight,
        pageHeight,
        _sortY: topYInPage,
      });
    });

    // ── Text: paragraphs (spacing-grouped) + headers ──────────────────
    //
    // We intentionally IGNORE the SDK's paragraph classification because
    // its short-line / indented-start / hanging-indent rules fire wildly
    // on non-justified text, fragmenting one visual paragraph into many
    // single-line blocks. We re-group from scratch using the only rule
    // that's actually reliable: vertical spacing between lines.
    //
    // Rule (spacing-only): the gap between consecutive lines is the
    // distance from the top of one line to the top of the next, measured
    // along PDF y. While that gap is small (~one line-height), the lines
    // belong to the same paragraph. When it exceeds the threshold
    // PARA_BREAK_FACTOR × fontSize, a new paragraph starts. We also
    // break on a meaningful font-size change so headings or footnotes
    // don't get glued to body text.
    const textElements = page?.textElements ?? [];
    const classification = page?.classification ?? null;
    const headerTexts = new Set(classification?.headers ?? []);

    const PARA_BREAK_FACTOR = 1.6; // gap > 1.6 × fontSize ⇒ new paragraph
    const FONT_SIZE_TOLERANCE = 1.5; // pt

    // Partition body vs header up front (headers are emitted as their own
    // blocks regardless of spacing).
    const headers = [];
    const bodyLines = [];
    textElements.forEach((el, elIdx) => {
      const isHeader = el.isHeader || headerTexts.has(el.text);
      if (isHeader) headers.push({ el, elIdx });
      else bodyLines.push({ el, elIdx });
    });

    // Emit headers.
    for (const { el, elIdx } of headers) {
      const ascent = (el.fontSize ?? 12) * 0.8;
      const topYInPage = pageHeight - el.y - ascent;
      pageObjects.push({
        id: `t-${pageIdx}-${elIdx}`,
        type: 'header',
        pageIdx,
        text: el.text,
        x: el.x,
        fontSize: el.fontSize ?? 12,
        isBold: !!el.isBold,
        isItalic: !!el.isItalic,
        color: el.color ?? null,
        _sortY: topYInPage,
      });
    }

    // Group body lines into paragraphs using only vertical spacing.
    // Iteration order: top-to-bottom (PDF y descending).
    const sortedBody = [...bodyLines].sort((a, b) => b.el.y - a.el.y);
    let currentGroup = [];

    const finalizeGroup = (group) => {
      if (group.length === 0) return;
      const first = group[0].el;
      const text = group.map(({ el }) => el.text).join(' ');
      const ascent = (first.fontSize ?? 12) * 0.8;
      const topYInPage = pageHeight - first.y - ascent;
      pageObjects.push({
        id: `p${paragraphId++}`,
        type: 'paragraph',
        pageIdx,
        text,
        x: Math.min(...group.map(({ el }) => el.x)),
        fontSize: first.fontSize ?? 12,
        lines: group.map(({ el }) => ({
          text: el.text,
          x: el.x,
          y: el.y,
          fontSize: el.fontSize ?? 12,
          isBold: !!el.isBold,
          isItalic: !!el.isItalic,
          color: el.color ?? null,
        })),
        isBold: !!first.isBold,
        isItalic: !!first.isItalic,
        color: first.color ?? null,
        _sortY: topYInPage,
      });
    };

    for (const cur of sortedBody) {
      if (currentGroup.length === 0) {
        currentGroup.push(cur);
        continue;
      }
      const prev = currentGroup[currentGroup.length - 1].el;
      const gap = prev.y - cur.el.y; // > 0 since sorted descending
      const prevFs = prev.fontSize ?? 12;
      const curFs = cur.el.fontSize ?? 12;
      const breaksOnSpacing = gap > curFs * PARA_BREAK_FACTOR;
      const breaksOnFontJump =
        Math.abs(prevFs - curFs) > FONT_SIZE_TOLERANCE;
      if (breaksOnSpacing || breaksOnFontJump) {
        finalizeGroup(currentGroup);
        currentGroup = [cur];
      } else {
        currentGroup.push(cur);
      }
    }
    finalizeGroup(currentGroup);

    // Sort within this page by top-y (smallest first = top-down reading order),
    // then strip the helper.
    pageObjects.sort((a, b) => a._sortY - b._sortY);
    for (const obj of pageObjects) delete obj._sortY;
    objects.push(...pageObjects);
  });

  return objects;
}

// Pretty-print the unified objects stream. Image dataUrl is truncated so the
// console stays scannable even on PDFs with many embedded images.
export function logObjects(objects) {
  console.log('Objects:');
  for (const obj of objects) {
    if (obj.type === 'image' && typeof obj.dataUrl === 'string') {
      const { dataUrl, ...rest } = obj;
      const preview =
        dataUrl.length > 64 ? dataUrl.slice(0, 48) + '…[truncated]' : dataUrl;
      console.log({ ...rest, dataUrl: preview });
    } else {
      console.log(obj);
    }
  }
}
