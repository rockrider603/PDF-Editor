import React, { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { usePDFStore } from "../store/usePDFStore";
import PageCanvas from "./PageCanvas";
import { CANVAS_WIDTH } from "./pdfConstants";

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
  const insertTextElement = usePDFStore((state) => state.insertTextElement);
  const removeTextElement = usePDFStore((state) => state.removeTextElement);
  const shiftElementsBelow = usePDFStore((state) => state.shiftElementsBelow);
  const shiftElementsAbove = usePDFStore((state) => state.shiftElementsAbove);

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

      const measureTextWidthPoints = (txt, targetEl = el) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const fontStyle = targetEl.isItalic ? 'italic ' : '';
        const fontWeight = targetEl.isBold || targetEl.isHeader ? 'bold ' : 'normal ';
        const fontSize = targetEl.fontSize || 12;
        context.font = `${fontStyle}${fontWeight}${fontSize}px serif`;
        return context.measureText(txt).width;
      };

      if (e.key === 'Backspace') {
        if (newOffset > 0) {
          let updatedText = newText.slice(0, newOffset - 1) + newText.slice(newOffset);

          let nextElModified = false;
          let nextElRemaining = "";

          if (activeCursor.elIdx < page.textElements.length - 1) {
            const nextEl = page.textElements[activeCursor.elIdx + 1];
            const lineHeight = (el.fontSize || 12) * 1.2;
            const verticalGap = Math.abs(nextEl.y - el.y);
            const threshold = (el.fontSize || 12) * 1.5;

            if (el.y > nextEl.y && verticalGap < threshold) {
              const currMaxWidth = (CANVAS_WIDTH - 40) / scale - el.x;
              let freeSpace = currMaxWidth - measureTextWidthPoints(updatedText);

              if (freeSpace > measureTextWidthPoints(" a")) {
                const nextWords = nextEl.text.split(' ');
                let movedWords = [];
                let remainingWords = [...nextWords];
                let testText = updatedText;

                for (let w = 0; w < nextWords.length; w++) {
                  const testWithWord = testText + (testText.length > 0 ? " " : "") + nextWords[w];
                  if (measureTextWidthPoints(testWithWord) <= currMaxWidth) {
                    movedWords.push(nextWords[w]);
                    remainingWords.shift();
                    testText = testWithWord;
                  } else {
                    break;
                  }
                }

                if (movedWords.length > 0) {
                  updatedText = testText;
                  nextElModified = true;
                  nextElRemaining = remainingWords.join(' ');
                }
              }
            }
          }

          let updateParams1 = {
            text: updatedText,
            width: measureTextWidthPoints(updatedText)
          };
          if (el.isBold) updateParams1.isBold = true;
          if (el.isItalic) updateParams1.isItalic = true;

          updateTextElement(activeCursor.pageIdx, activeCursor.elIdx, updateParams1);

          if (nextElModified) {
            if (nextElRemaining.length > 0) {
              const nextEl = page.textElements[activeCursor.elIdx + 1];
              let updateParams2 = {
                text: nextElRemaining,
                width: measureTextWidthPoints(nextElRemaining, nextEl)
              };
              if (nextEl.isBold) updateParams2.isBold = true;
              if (nextEl.isItalic) updateParams2.isItalic = true;

              updateTextElement(activeCursor.pageIdx, activeCursor.elIdx + 1, updateParams2);
            } else {
              removeTextElement(activeCursor.pageIdx, activeCursor.elIdx + 1);
              shiftElementsAbove(activeCursor.pageIdx, page.textElements[activeCursor.elIdx + 1].y - 1, ((el.fontSize || 12) * 1.2));
            }
          }

          setActiveCursor(prev => ({ ...prev, charOffset: newOffset - 1 }));
          prevent = true;
          handledBySpecial = true;
        } else if (activeCursor.elIdx > 0) {
          const prevElIdx = activeCursor.elIdx - 1;
          const prevEl = page.textElements[prevElIdx];

          const verticalGap = Math.abs(prevEl.y - el.y);
          const threshold = (el.fontSize || 12) * 1.5;

          if (prevEl.y > el.y && verticalGap < threshold) {
            const prevMaxWidth = (CANVAS_WIDTH - 40) / scale - prevEl.x;
            const freeSpace = prevMaxWidth - measureTextWidthPoints(prevEl.text, prevEl);

            const words = el.text.split(' ');
            let movedWords = [];
            let remainingWords = [...words];
            let testText = prevEl.text;

            for (let i = 0; i < words.length; i++) {
              const testWithWord = testText + (testText.length > 0 ? " " : "") + words[i];
              if (measureTextWidthPoints(testWithWord, prevEl) <= prevMaxWidth) {
                movedWords.push(words[i]);
                remainingWords.shift();
                testText = testWithWord;
              } else {
                break;
              }
            }

            if (movedWords.length > 0) {
              const joinOffset = prevEl.text.length + (prevEl.text.length > 0 ? 1 : 0);
              const remainingTextStr = remainingWords.join(' ');

              let prevUpdateParams = {
                text: testText,
                width: measureTextWidthPoints(testText, prevEl)
              };
              if (prevEl.isBold) prevUpdateParams.isBold = true;
              if (prevEl.isItalic) prevUpdateParams.isItalic = true;

              updateTextElement(activeCursor.pageIdx, prevElIdx, prevUpdateParams);

              if (remainingTextStr.length > 0) {
                let currentUpdateParams = {
                  text: remainingTextStr,
                  width: measureTextWidthPoints(remainingTextStr, el)
                };
                if (el.isBold) currentUpdateParams.isBold = true;
                if (el.isItalic) currentUpdateParams.isItalic = true;

                updateTextElement(activeCursor.pageIdx, activeCursor.elIdx, currentUpdateParams);
              } else {
                const lineHeight = (el.fontSize || 12) * 1.2;
                removeTextElement(activeCursor.pageIdx, activeCursor.elIdx);
                shiftElementsAbove(activeCursor.pageIdx, el.y - 1, lineHeight);
              }

              setActiveCursor(prev => ({
                ...prev,
                elIdx: prevElIdx,
                charOffset: joinOffset,
              }));
            } else {
              // CASE B fallback: Just jump up if no words fit
              setActiveCursor(prev => ({
                ...prev,
                elIdx: prevElIdx,
                charOffset: prevEl.text.length,
              }));
            }
          } else {
            // CASE B: Lines are far apart -> JUST JUMP the cursor to the previous line
            setActiveCursor(prev => ({
              ...prev,
              elIdx: prevElIdx,
              charOffset: prevEl.text.length,
            }));
          }

          prevent = true;
          handledBySpecial = true;
        }
      } else if (e.key === 'Enter') {
        const textBeforeCaret = newText.substring(0, newOffset);
        let textAfterCaret = newText.substring(newOffset);

        // Remove leading space from text after caret if present
        if (textAfterCaret.startsWith(' ')) {
          textAfterCaret = textAfterCaret.substring(1);
        }

        const lineHeight = (el.fontSize || 12) * 1.2;

        // Single atomic call: updates current el, inserts new el, reflows
        // across page boundaries, AND moves activeCursor to the new line's
        // final (pageIdx, elIdx) — which may be on a freshly-created page
        // when the split happens at the bottom margin.
        splitTextElement(
          activeCursor.pageIdx,
          activeCursor.elIdx,
          textBeforeCaret,
          textAfterCaret,
          lineHeight,
          (txt) => measureTextWidthPoints(txt)
        );

        prevent = true;
        handledBySpecial = true;
      } else if (e.key === 'ArrowLeft') {
        if (newOffset > 0) {
          newOffset -= 1;
          prevent = true;
        } else if (activeCursor.elIdx > 0) {
          const prevEl = page.textElements[activeCursor.elIdx - 1];
          setActiveCursor(prev => ({
            ...prev,
            elIdx: prev.elIdx - 1,
            charOffset: prevEl.text.length
          }));
          prevent = true;
          handledBySpecial = true;
        }
      } else if (e.key === 'ArrowRight') {
        if (newOffset < newText.length) {
          newOffset += 1;
          prevent = true;
        } else if (activeCursor.elIdx < page.textElements.length - 1) {
          setActiveCursor(prev => ({
            ...prev,
            elIdx: prev.elIdx + 1,
            charOffset: 0
          }));
          prevent = true;
          handledBySpecial = true;
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        newText = newText.slice(0, newOffset) + e.key + newText.slice(newOffset);
        newOffset += 1;
        prevent = true;

        if (measureTextWidthPoints(newText) > maxWidthInPoints) {
          const lastSpace = newText.lastIndexOf(' ');
          if (lastSpace !== -1) {
            const firstLine = newText.substring(0, lastSpace);
            const secondLine = newText.substring(lastSpace + 1);
            const lineHeight = (el.fontSize || 12) * 1.2;

            // Atomic: update current line + insert overflow line + page-boundary
            // check. The cursor target is computed from where the typed char
            // landed relative to the wrap point — store places the cursor on
            // the correct line, on the correct page (even if it overflowed).
            const onNewLine = newOffset > lastSpace;
            const targetCharOffset = onNewLine ? newOffset - lastSpace - 1 : newOffset;
            wrapTextElement(
              activeCursor.pageIdx,
              activeCursor.elIdx,
              firstLine,
              secondLine,
              lineHeight,
              (txt) => measureTextWidthPoints(txt),
              { onNewLine, charOffset: targetCharOffset }
            );
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
            width: measureTextWidthPoints(newText)
          });
          setActiveCursor(prev => ({ ...prev, charOffset: newOffset }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 180px)',
        background: '#e5e7eb',
        padding: '24px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
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
