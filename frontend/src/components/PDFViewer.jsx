import React, { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { usePDFStore } from "../store/usePDFStore";
import { applyGlobalReflow } from "../store/usePDFStore";
import PageCanvas from "./PageCanvas";
import { CANVAS_WIDTH } from "./pdfConstants";
import { detectParagraphsFromElements } from "pdf-parser";

// ─── Main Component ───────────────────────────────────────────────────────────

const PDFViewer = ({
  pages = [],
  isLoading = false,
  selectedTool = null,
}) => {
  const activeCursor = usePDFStore((state) => state.activeCursor);
  const setActiveCursor = usePDFStore((state) => state.setActiveCursor);
  const activeImage = usePDFStore((state) => state.activeImage);
  const setActiveImage = usePDFStore((state) => state.setActiveImage);
  const updatePageImage = usePDFStore((state) => state.updatePageImage);
  const resizePageImage = usePDFStore((state) => state.resizePageImage);

  const updateTextElement = usePDFStore((state) => state.updateTextElement);
  const splitTextElement = usePDFStore((state) => state.splitTextElement);
  const wrapTextElement = usePDFStore((state) => state.wrapTextElement);
  const cascadeCompactParagraph = usePDFStore((state) => state.cascadeCompactParagraph);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (activeCursor.pageIdx === null || activeCursor.elIdx === null) return;

      const page = pages[activeCursor.pageIdx];
      if (!page) return;

      const el = page.textElements[activeCursor.elIdx];
      if (!el) return;

      let newText = el.text;
      let newOffset = activeCursor.charOffset;
      let prevent = false;
      let handledBySpecial = false;

      const scale = CANVAS_WIDTH / (page.dimensions?.width ?? 612);
      const maxWidthInPoints = (CANVAS_WIDTH - 40) / scale - el.x;

      // ── Shared utilities ───────────────────────────────────────────────────

      const measureWidth = (txt, targetEl = el) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const style = targetEl.isItalic ? "italic " : "";
        const weight = targetEl.isBold || targetEl.isHeader ? "bold " : "normal ";
        ctx.font = `${style}${weight}${targetEl.fontSize || 12}px serif`;
        return ctx.measureText(txt).width;
      };

      const getMaxWidth = (targetEl) =>
        (CANVAS_WIDTH - 40) / scale - targetEl.x;

      // ── Paragraph detection via pdf-parser ────────────────────────────────
      // Calls detectParagraphsFromElements on the live pages snapshot.
      // Returns: [{ paragraphIdx, lines: [{ pageIdx, elIdx, el }] }]
      const buildParagraphMap = (pgs) => {
        const textElementsPerPage = pgs.map((p) => p.textElements);
        return detectParagraphsFromElements(textElementsPerPage);
      };

      // Find the paragraph that contains (targetPageIdx, targetElIdx).
      // Returns the paragraph descriptor or null.
      const getParagraphFor = (pgs, targetPageIdx, targetElIdx) => {
        const allParas = buildParagraphMap(pgs);
        const para = allParas.find((p) =>
          p.lines.some(
            (l) => l.pageIdx === targetPageIdx && l.elIdx === targetElIdx
          )
        );
        return para ?? null;
      };

      // Greedy paragraph reflow (same-page only).
      // Receives the element array and the paragraph line records filtered to
      // this page, sorted by elIdx.
      // Pulls words from each next line into the previous one; removes empty lines.
      // Returns { elements, linesRemoved, lowestRemovedY }.
      const reflowParagraphLines = (els, paraLineRecordsOnPage) => {
        const idxs = paraLineRecordsOnPage.map((r) => r.elIdx);
        let linesRemoved = 0;
        let lowestRemovedY = null;
        let i = 0;

        while (i < idxs.length - 1) {
          const curEl = els[idxs[i]];
          const nextEl = els[idxs[i + 1]];
          if (!curEl || !nextEl) { i++; continue; }

          const maxW = getMaxWidth(curEl);
          const words = nextEl.text.split(" ").filter(Boolean);
          let merged = curEl.text;
          let moved = 0;

          for (const word of words) {
            const attempt = merged.length > 0 ? merged + " " + word : word;
            if (measureWidth(attempt, curEl) <= maxW) { merged = attempt; moved++; }
            else break;
          }

          if (moved === 0) { i++; continue; }

          const remaining = words.slice(moved).join(" ");
          els[idxs[i]] = { ...curEl, text: merged, width: measureWidth(merged, curEl) };

          if (remaining.length === 0) {
            // Line is empty → remove it
            lowestRemovedY = nextEl.y;
            els.splice(idxs[i + 1], 1);
            linesRemoved++;
            for (let k = i + 1; k < idxs.length; k++) idxs[k]--;
            idxs.splice(i + 1, 1);
            // Retry same i: newly promoted element may also contribute
          } else {
            els[idxs[i + 1]] = { ...nextEl, text: remaining, width: measureWidth(remaining, nextEl) };
            i++;
          }
        }

        return { elements: els, linesRemoved, lowestRemovedY };
      };

      // Cross-page reflow: for every page boundary starting at fromPageIdx,
      // check whether the first element on page+1 fits at the bottom of page.
      // Keep pulling elements up until none fit, then move to the next boundary.
      const crossPageReflow = (pgs, fromPageIdx) => {
        pgs = pgs.map(p => ({ ...p, textElements: [...p.textElements] }));
        const MARGIN = 48;

        for (let pIdx = fromPageIdx; pIdx < pgs.length - 1; pIdx++) {
          let progress = true;
          while (progress) {
            progress = false;
            const cur = pgs[pIdx];
            const next = pgs[pIdx + 1];
            if (!next.textElements.length) break;

            const lastEl = cur.textElements[cur.textElements.length - 1];
            const firstNextEl = next.textElements[0];
            const lh = (firstNextEl.fontSize || 12) * 1.2;
            const pHeight = cur.dimensions?.height ?? 792;
            const candidateY = lastEl ? lastEl.y - lh : pHeight - MARGIN - lh;

            if (candidateY > MARGIN) {
              pgs[pIdx] = { ...cur, textElements: [...cur.textElements, { ...firstNextEl, y: candidateY }] };
              pgs[pIdx + 1] = { ...next, textElements: next.textElements.slice(1) };
              progress = true;
            }
          }
        }
        return pgs;
      };

      // ── Backspace helper: char exists before cursor ────────────────────────
      const handleBackspaceWithChar = () => {
        const { pageIdx, elIdx } = activeCursor;
        const updatedText = newText.slice(0, newOffset - 1) + newText.slice(newOffset);

        // Snapshot of the current page's elements
        const els = page.textElements.map(e => ({ ...e }));
        els[elIdx] = { ...el, text: updatedText, width: measureWidth(updatedText) };

        // Build a fresh pages snapshot with the edited element
        let workingPages = pages.map((p, i) =>
          i !== pageIdx ? p : { ...p, textElements: els }
        );

        // Find the paragraph that contains (pageIdx, elIdx) in the working snapshot
        const para = getParagraphFor(workingPages, pageIdx, elIdx);
        let totalRemoved = 0;
        let shiftY = null;
        let reflowedEls = els;

        if (para) {
          // Only reflow lines on THIS page (cross-page = separate paragraph)
          const pageLines = para.lines
            .filter((l) => l.pageIdx === pageIdx)
            .sort((a, b) => a.elIdx - b.elIdx);

          if (pageLines.length > 1) {
            const { elements, linesRemoved, lowestRemovedY } = reflowParagraphLines(
              [...els],
              pageLines
            );
            reflowedEls = elements;
            totalRemoved += linesRemoved;
            if (lowestRemovedY !== null) shiftY = lowestRemovedY;
          }
        }

        // If the current element is now empty (last char deleted, standalone line
        // with nothing to pull from the next line), remove it so we don't leave
        // an orphan blank element in the layout.
        const lh = (el.fontSize || 12) * 1.2;
        if (reflowedEls[elIdx] && reflowedEls[elIdx].text === "") {
          shiftY = reflowedEls[elIdx].y;
          reflowedEls.splice(elIdx, 1);
          totalRemoved++;
        }

        workingPages = pages.map((p, i) =>
          i !== pageIdx ? p : { ...p, textElements: reflowedEls }
        );

        if (totalRemoved > 0 && shiftY !== null) {
          workingPages = applyGlobalReflow(workingPages, pageIdx, shiftY + 0.1, -(lh * totalRemoved));
        }

        workingPages = crossPageReflow(workingPages, pageIdx);
        // Page-boundary normalisation pass (amount=0): crossPageReflow doesn't
        // re-check the next page's REMAINING content after pulling its first
        // element up, so a page can end up with its top element touching the
        // page edge. This pass re-enforces top/bottom margins everywhere.
        workingPages = applyGlobalReflow(workingPages, pageIdx, -1, 0);

        // If the current element was removed, park cursor at end of previous element.
        if (totalRemoved > 0 && reflowedEls[elIdx] === undefined) {
          const prevIdx = elIdx > 0 ? elIdx - 1 : 0;
          const prevEl = workingPages[pageIdx]?.textElements[prevIdx];
          setActiveCursor(prev => ({ ...prev, elIdx: prevIdx, charOffset: prevEl ? prevEl.text.length : 0 }));
        } else {
          setActiveCursor(prev => ({ ...prev, charOffset: newOffset - 1 }));
        }

        usePDFStore.getState().setPages(workingPages);
      };

      // ── Backspace helper: cursor at line start (merge into previous line) ──
      const handleBackspaceAtLineStart = () => {
        const { pageIdx, elIdx } = activeCursor;

        // ── Special case: cursor at the very first element of a page ──────────
        // Navigate to the last text element of the previous page.
        // The actual backspace will happen on the next keypress.
        if (elIdx === 0) {
          if (pageIdx === 0) return; // nothing before the first page

          const prevPage = pages[pageIdx - 1];
          if (!prevPage) return;

          const prevTextEls = prevPage.textElements;
          if (prevTextEls && prevTextEls.length > 0) {
            const newElIdx = prevTextEls.length - 1;
            const targetEl = prevTextEls[newElIdx];
            setActiveCursor({
              pageIdx: pageIdx - 1,
              elIdx: newElIdx,
              charOffset: targetEl ? targetEl.text.length : 0,
              caretX: 0,
            });
          }
          return;
        }

        const prevElIdx = elIdx - 1;
        const prevEl = page.textElements[prevElIdx];
        if (!prevEl) return;

        // Use detectParagraphsFromElements to decide paragraph membership
        const allParas = buildParagraphMap(pages);
        const curPara = allParas.find(p => p.lines.some(l => l.pageIdx === pageIdx && l.elIdx === elIdx));
        const prevPara = allParas.find(p => p.lines.some(l => l.pageIdx === pageIdx && l.elIdx === prevElIdx));

        const sameParagraph =
          curPara != null &&
          prevPara != null &&
          curPara.paragraphIdx === prevPara.paragraphIdx;

        if (!sameParagraph) {
          // Different paragraph.
          // If the current line is already empty, remove it and shift everything
          // below up so the blank slot doesn't linger in the layout.
          if (el.text === "") {
            const lh = (el.fontSize || 12) * 1.2;
            const els = page.textElements.map(e => ({ ...e }));
            els.splice(elIdx, 1);

            let newPages = pages.map((p, i) =>
              i !== pageIdx ? p : { ...p, textElements: els }
            );
            newPages = applyGlobalReflow(newPages, pageIdx, el.y + 0.1, -lh);
            newPages = crossPageReflow(newPages, pageIdx);
            // Re-enforce top/bottom margins after crossPageReflow.
            newPages = applyGlobalReflow(newPages, pageIdx, -1, 0);

            setActiveCursor(prev => ({ ...prev, elIdx: prevElIdx, charOffset: prevEl.text.length }));
            usePDFStore.getState().setPages(newPages);
          } else {
            // Line still has content – just jump cursor
            setActiveCursor(prev => ({ ...prev, elIdx: prevElIdx, charOffset: prevEl.text.length }));
          }
          return;
        }

        // Same paragraph: try to merge content of el into prevEl
        const prevMaxW = getMaxWidth(prevEl);
        const words = el.text.split(" ").filter(Boolean);
        let merged = prevEl.text;
        let moved = 0;

        for (const word of words) {
          const attempt = merged.length > 0 ? merged + " " + word : word;
          if (measureWidth(attempt, prevEl) <= prevMaxW) { merged = attempt; moved++; }
          else break;
        }

        if (moved === 0) {
          // Nothing fits – just jump cursor
          setActiveCursor(prev => ({ ...prev, elIdx: prevElIdx, charOffset: prevEl.text.length }));
          return;
        }

        const joinOffset = prevEl.text.length > 0 ? prevEl.text.length + 1 : 0;
        const remaining = words.slice(moved).join(" ");
        const els = page.textElements.map(e => ({ ...e }));
        els[prevElIdx] = { ...prevEl, text: merged, width: measureWidth(merged, prevEl) };

        let extraRemoved = 0;
        const thresholdY = el.y;

        if (remaining.length > 0) {
          els[elIdx] = { ...el, text: remaining, width: measureWidth(remaining, el) };
        } else {
          els.splice(elIdx, 1);
          extraRemoved = 1;
        }

        // Re-detect paragraphs on the updated snapshot and reflow
        let workingPages = pages.map((p, i) =>
          i !== pageIdx ? p : { ...p, textElements: els }
        );

        const updatedPara = getParagraphFor(workingPages, pageIdx, prevElIdx);
        let linesRemoved = 0;
        let lowestRemovedY = null;

        if (updatedPara) {
          const pageLines = updatedPara.lines
            .filter((l) => l.pageIdx === pageIdx)
            .sort((a, b) => a.elIdx - b.elIdx);

          if (pageLines.length > 1) {
            const currentEls = workingPages[pageIdx].textElements.map(e => ({ ...e }));
            const result = reflowParagraphLines(currentEls, pageLines);
            linesRemoved = result.linesRemoved;
            lowestRemovedY = result.lowestRemovedY;

            workingPages = workingPages.map((p, i) =>
              i !== pageIdx ? p : { ...p, textElements: result.elements }
            );
          }
        }

        const lh = (el.fontSize || 12) * 1.2;
        const totalRemoved = extraRemoved + linesRemoved;
        const shiftY = lowestRemovedY ?? thresholdY;

        if (totalRemoved > 0) {
          workingPages = applyGlobalReflow(workingPages, pageIdx, shiftY + 0.1, -(lh * totalRemoved));
        }

        workingPages = crossPageReflow(workingPages, pageIdx);
        // Re-enforce top/bottom margins after crossPageReflow.
        workingPages = applyGlobalReflow(workingPages, pageIdx, -1, 0);
        setActiveCursor(prev => ({ ...prev, elIdx: prevElIdx, charOffset: joinOffset }));
        usePDFStore.getState().setPages(workingPages);
      };

      // ── Key dispatch ───────────────────────────────────────────────────────

      if (e.key === "Backspace") {
        //newOffset: index of cursor in that line
        //activeCursor.elIdx: line number of selected line in that page
        if (newOffset > 0) {
          handleBackspaceWithChar();
        } else {
          // Cursor at line start — handles cross-page navigation internally
          handleBackspaceAtLineStart();
        }
        prevent = true;
        handledBySpecial = true;

      } else if (e.key === "Enter") {
        const textBeforeCaret = newText.substring(0, newOffset);
        let textAfterCaret = newText.substring(newOffset);
        if (textAfterCaret.startsWith(" ")) textAfterCaret = textAfterCaret.substring(1);

        const lineHeight = (el.fontSize || 12) * 1.2;

        // Single atomic call: updates current el, inserts new el, reflows
        splitTextElement(
          activeCursor.pageIdx,
          activeCursor.elIdx,
          textBeforeCaret,
          textAfterCaret,
          lineHeight,
          (txt) => measureWidth(txt)
        );

        setActiveCursor(prev => ({ ...prev, elIdx: prev.elIdx + 1, charOffset: 0, caretX: 0 }));
        prevent = true;
        handledBySpecial = true;

      } else if (e.key === 'Delete') {
        // Forward delete. Caret NEVER moves — it stays at newOffset on the
        // current element. Two cases, both delegate the actual reflow to
        // cascadeCompactParagraph, which greedily pulls words from each
        // lower line into the line above, stopping at the first paragraph
        // boundary. Lines emptied by the pull are removed; remaining
        // elements (text + images) below the removed lines on this page
        // lift by lineHeight.
        const maxWidthFn = (curEl) => (CANVAS_WIDTH - 40) / scale - curEl.x;

        if (newOffset < newText.length) {
          // Case A: delete char AT cursor on the current line, then cascade.
          const updatedText = newText.slice(0, newOffset) + newText.slice(newOffset + 1);
          const updateParams = {
            text: updatedText,
            width: measureTextWidthPoints(updatedText),
          };
          if (el.isBold) updateParams.isBold = true;
          if (el.isItalic) updateParams.isItalic = true;
          updateTextElement(activeCursor.pageIdx, activeCursor.elIdx, updateParams);

          cascadeCompactParagraph(
            activeCursor.pageIdx,
            activeCursor.elIdx,
            measureTextWidthPoints,
            maxWidthFn
          );

          prevent = true;
          handledBySpecial = true;
        } else if (activeCursor.elIdx < page.textElements.length - 1) {
          // Case B: at end-of-line — "delete the line break". Same cascade.
          // If lines are in different paragraphs the cascade exits without
          // changes and the caret silently stays put (no jump).
          cascadeCompactParagraph(
            activeCursor.pageIdx,
            activeCursor.elIdx,
            measureTextWidthPoints,
            maxWidthFn
          );

          prevent = true;
          handledBySpecial = true;
        }
      } else if (e.key === "ArrowLeft") {
        if (newOffset > 0) {
          newOffset -= 1;
          prevent = true;
        } else if (activeCursor.elIdx > 0) {
          const prevEl = page.textElements[activeCursor.elIdx - 1];
          setActiveCursor(prev => ({ ...prev, elIdx: prev.elIdx - 1, charOffset: prevEl.text.length }));
          prevent = true;
          handledBySpecial = true;
        }

      } else if (e.key === "ArrowRight") {
        if (newOffset < newText.length) {
          newOffset += 1;
          prevent = true;
        } else if (activeCursor.elIdx < page.textElements.length - 1) {
          setActiveCursor(prev => ({ ...prev, elIdx: prev.elIdx + 1, charOffset: 0 }));
          prevent = true;
          handledBySpecial = true;
        }

      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        newText = newText.slice(0, newOffset) + e.key + newText.slice(newOffset);
        newOffset += 1;
        prevent = true;

        if (measureWidth(newText) > maxWidthInPoints) {
          const lastSpace = newText.lastIndexOf(" ");
          if (lastSpace !== -1) {
            const firstLine = newText.substring(0, lastSpace);
            const secondLine = newText.substring(lastSpace + 1);
            const lineHeight = (el.fontSize || 12) * 1.2;
            const onNewLine = newOffset > lastSpace;
            const cursorOffset = onNewLine ? newOffset - lastSpace - 1 : newOffset;

            // Atomic: update current line + insert overflow line + page-boundary check.
            // wrapTextElement plants a CURSOR_MARKER that survives the reflow (including
            // cross-page moves) and updates activeCursor itself — calling setActiveCursor
            // afterwards would double-jump past the wrap target.
            wrapTextElement(
              activeCursor.pageIdx,
              activeCursor.elIdx,
              firstLine,
              secondLine,
              lineHeight,
              (txt) => measureWidth(txt),
              { onNewLine, charOffset: cursorOffset }
            );

            // The wrap creates a one-word overflow line. Without cascading,
            // every keystroke leaves another orphan line stacked between the
            // user's line and the rest of the paragraph. Cascade from the
            // post-wrap cursor position so the trailing word naturally flows
            // into the next paragraph line (same algorithm Delete uses).
            const post = usePDFStore.getState().activeCursor;
            if (post.pageIdx !== null && post.elIdx !== null) {
              cascadeCompactParagraph(
                post.pageIdx,
                post.elIdx,
                measureWidth,
                getMaxWidth
              );
            }
            prevent = true;
            handledBySpecial = true;
          }
        }
      }

      if (prevent) {
        e.preventDefault();
        if (!handledBySpecial) {
          updateTextElement(activeCursor.pageIdx, activeCursor.elIdx, {
            text: newText,
            width: measureWidth(newText),
          });
          setActiveCursor(prev => ({ ...prev, charOffset: newOffset }));
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeCursor, pages, updateTextElement]);

  // ── Loading State ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-white rounded-lg border border-gray-200 shadow-inner"
        style={{ width: CANVAS_WIDTH, height: 600 }}
      >
        <Loader2 size={40} className="animate-spin text-primary mb-4" />
        <p className="text-gray-500 text-sm">Parsing PDF…</p>
      </div>
    );
  }

  // ── Empty State ────────────────────────────────────────────────────────────
  if (!pages || pages.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-white rounded-lg border-2 border-dashed border-gray-300"
        style={{ width: CANVAS_WIDTH, height: 400 }}
      >
        <p className="text-gray-400 text-sm">No content extracted from this PDF</p>
      </div>
    );
  }

  return (
    <div
      id="pdf-scroll-container"
      style={{
        overflowY: "auto",
        maxHeight: "calc(100vh - 180px)",
        background: "#e5e7eb",
        padding: "24px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
      }}
    >
      {pages.map((page, pageIdx) => (
        <PageCanvas
          key={pageIdx}
          page={page}
          pageNumber={pageIdx + 1}
          selectedTool={selectedTool}
          activeCursor={activeCursor}
          setActiveCursor={setActiveCursor}
          activeImage={activeImage}
          setActiveImage={setActiveImage}
          updatePageImage={updatePageImage}
          resizePageImage={resizePageImage}
        />
      ))}
    </div>
  );
};

export default PDFViewer;
