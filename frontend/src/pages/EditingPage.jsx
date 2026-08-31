import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import EditToolbar from "../components/EditToolbar";
import SinglePageView from "../components/SinglePageView";
import { usePDFStore } from "../store/usePDFStore";
import { PdfDocument } from "../../../pdf-parser/PdfDocument";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildObjects } from "../lib/buildObjects";

const EditingPage = () => {
  const navigate = useNavigate();
  const {
    currentPDF,
    isLoading,
    pages,
    setPages,
    setPageCount,
    setIsLoading,
  } = usePDFStore();

  const [selectedTool, setSelectedTool] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [parseError, setParseError] = useState(null);

  // Live reference to the edited objects[] maintained by SinglePageView.
  // SinglePageView calls onObjectsChange(objs) on every model mutation so
  // this ref always holds the latest user-edited state for download.
  const editedObjectsRef = useRef([]);

  // ── Redirect if no PDF is in state ─────────────────────────────────────────
  useEffect(() => {
    if (!currentPDF && !isLoading) navigate("/upload");
  }, [currentPDF, isLoading, navigate]);

  // ── Run sdk pipeline when a new PDF is loaded ───────────────────────────────
  useEffect(() => {
    if (!currentPDF) return;

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setParseError(null);

      try {
        // Factory — load the PDF bytes from the File object
        const doc = await PdfDocument.fromFile(currentPDF);
        const count = doc.pageCount;
        const pagesArray = [];

        for (let n = 1; n <= count; n++) {
          const page = await doc.getPage(n);
          const result = await page.extract();

          // // --- ADDED: Print objects info to the terminal (browser console) ---
          // console.log(`\n=== PAGE ${n} OBJECTS INFO ===`);
          // console.log("1. Dimensions:", result.dimensions);
          // console.log(`2. Text Lines (${result.textElements?.length || 0} found):`, result.textElements);
          // console.log("3. Classification:");
          // console.log(`   Headers: ${result.classification?.headerCount ?? 0}`, result.classification?.headers);
          // console.log(`   Text lines: ${result.classification?.textCount ?? 0}`);
          // console.log(`   Paragraphs: ${result.classification?.paragraphCount ?? 0}`);
          // result.classification?.paragraphs?.forEach((para, id) => {
          //   console.log(`   Para ${id} (${para.lines.length} lines, x=${para.x}, y=${para.y}):`);
          //   para.lines.forEach(l => console.log(`     [${l.y.toFixed(1)}] ${l.text.substring(0, 60)}`));
          // });
          // console.log(`4. Images:`, result.images);
          // console.log("================================\n");

          if (result.textElements && result.classification?.headers) {
            result.textElements = result.textElements.map(el => {
              if (result.classification.headers.includes(el.text)) {
                return { ...el, isBold: true, isHeader: true };
              }
              return el;
            });
          }

          if (cancelled) return;
          pagesArray.push(result);
        }

        setPages(pagesArray);
        setPageCount(count);
      } catch (err) {
        if (!cancelled) {
          console.error("[EditingPage] PDF parse failed:", err);
          setParseError(err.message);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    // Cleanup — ignore stale results if the component unmounts mid-parse
    return () => { cancelled = true; };
  }, [currentPDF]);

  // ── Unified objects stream ─────────────────────────────────────────────────
  // Flatten pages[] into a single ordered list of typed objects (image,
  // paragraph, header, line). Paragraphs receive globally-incrementing ids
  // starting at 0. Logged on every change so the console matches what the
  // SinglePageView is rendering.
  const objects = useMemo(() => buildObjects(pages), [pages]);

  // Removed: logObjects(objects) — per-paragraph debug logs are now in
  // SinglePageView (touch any paragraph to see its diagnostics).

  // ── Download — builds PDF from the live edited objects[], not stale pages[] ──
  //
  // Architecture:
  //   objects[]      — edited blocks with current text (from SinglePageView)
  //   pages[]        — original parsed data, used only for page dimensions / images
  //
  // For each page we:
  //   1. Draw background + inline images from pages[n] (images are not editable).
  //   2. Walk text objects (paragraph/header/line) whose pageIdx === n.
  //   3. Greedy-wrap each block's text at the column width using a char-width
  //      estimate (Helvetica ≈ 0.55 × fontSize per character), then drawText
  //      one PDF line at a time starting from block.y (the topmost PDF y of
  //      the block's original first line), descending by lineHeight.
  //   4. If wrapped lines go past the bottom margin, overflow is clipped.
  //      (True page-overflow requires a more complex layout engine — v2.)
  const handleDownload = async () => {
    const editedObjects = editedObjectsRef.current;

    if (!pages || pages.length === 0) {
      if (currentPDF) {
        const url = URL.createObjectURL(currentPDF);
        const a = document.createElement("a");
        a.href = url;
        a.download = `original_${currentPDF.name}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      return;
    }

    setIsLoading(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Helper: greedy word-wrap in PDF points.
      // Returns an array of lines (strings).
      const wrapText = (text, fontSize, colWidthPt) => {
        const avgCharWidth = fontSize * 0.55; // Helvetica rough average
        const words = (text ?? "").split(/\s+/).filter(Boolean);
        const lines = [];
        let cur = "";
        for (const word of words) {
          const candidate = cur.length ? cur + " " + word : word;
          if (candidate.length * avgCharWidth > colWidthPt && cur.length) {
            lines.push(cur);
            cur = word;
          } else {
            cur = candidate;
          }
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [""];
      };

      const MARGIN_PT = 48;

      for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const pageData = pages[pageIdx];
        const { dimensions, images } = pageData;
        const pdfPage = pdfDoc.addPage([dimensions.width, dimensions.height]);

        // ── Background image ───────────────────────────────────────────────
        if (images?.background?.dataUrl) {
          const bgData = images.background.dataUrl;
          let embedded;
          if (bgData.includes("image/png")) embedded = await pdfDoc.embedPng(bgData);
          else if (bgData.includes("image/jpeg") || bgData.includes("image/jpg"))
            embedded = await pdfDoc.embedJpg(bgData);
          if (embedded)
            pdfPage.drawImage(embedded, {
              x: 0, y: 0, width: dimensions.width, height: dimensions.height,
            });
        }

        // ── Inline images ──────────────────────────────────────────────────
        const imgObjects = editedObjects.filter(
          (b) => b.type === "image" && b.role !== "background" && b.pageIdx === pageIdx
        );
        for (const imgObj of imgObjects) {
          if (!imgObj.dataUrl) continue;
          let embedded;
          if (imgObj.dataUrl.includes("image/png")) embedded = await pdfDoc.embedPng(imgObj.dataUrl);
          else if (imgObj.dataUrl.includes("image/jpeg") || imgObj.dataUrl.includes("image/jpg"))
            embedded = await pdfDoc.embedJpg(imgObj.dataUrl);
          if (embedded)
            pdfPage.drawImage(embedded, {
              x: imgObj.x ?? 0,
              y: imgObj.y ?? 0,
              width: imgObj.renderedWidth ?? 100,
              height: imgObj.renderedHeight ?? 100,
            });
        }

        // ── Shapes ─────────────────────────────────────────────────────────
        const shapeObjects = editedObjects.filter(
          (b) => b.type === "shape" && b.pageIdx === pageIdx
        );

        const getPdfLibColor = (c) => {
          if (!c) return undefined;
          return rgb(c.r ?? 0, c.g ?? 0, c.b ?? 0);
        };

        for (const shape of shapeObjects) {
          const strokeColor = getPdfLibColor(shape.strokeColor);
          const fillColor = getPdfLibColor(shape.fillColor);
          const lw = shape.lineWidth ?? 1;

          if (shape.shapeKind === 'line') {
            pdfPage.drawLine({
              start: { x: shape.x1, y: shape.y1 },
              end: { x: shape.x2, y: shape.y2 },
              thickness: lw,
              color: strokeColor ?? rgb(0, 0, 0),
            });
          } else if (shape.shapeKind === 'rect') {
            pdfPage.drawRectangle({
              x: shape.x,
              y: shape.y,
              width: shape.width,
              height: shape.height,
              borderWidth: strokeColor ? lw : undefined,
              borderColor: strokeColor,
              color: fillColor,
            });
          } else if (shape.shapeKind === 'path' && shape.points?.length) {
            for (let i = 1; i < shape.points.length; i++) {
              pdfPage.drawLine({
                start: { x: shape.points[i - 1].x, y: shape.points[i - 1].y },
                end: { x: shape.points[i].x, y: shape.points[i].y },
                thickness: lw,
                color: strokeColor ?? rgb(0, 0, 0),
              });
            }
          }
        }

        // ── Text blocks ────────────────────────────────────────────────────
        // Use edited objects for this page, preserving document order.
        const textObjects = editedObjects.filter(
          (b) =>
            (b.type === "paragraph" || b.type === "header" || b.type === "line") &&
            b.pageIdx === pageIdx
        );

        for (const block of textObjects) {
          const fontSize = block.fontSize ?? 12;
          const x = block.x ?? MARGIN_PT;
          let colWidth = Math.max(50, dimensions.width - x - MARGIN_PT);
          if (block.inTable && block.tableBounds) {
            colWidth = Math.max(50, block.tableBounds.x2 - x);
          }
          const lineHeight = fontSize * 1.2;

          // Starting y: first line of original block (PDF bottom-left origin).
          // For runtime blocks (Enter-split), fall back to estimating from
          // the previous line (lines[] is empty, y comes from original block).
          const startY = block.lines?.[0]?.y ?? block.y ?? dimensions.height - MARGIN_PT - fontSize;
          const wrappedLines = wrapText(block.text, fontSize, colWidth);

          let textColor = rgb(0, 0, 0);
          if (block.color === '#ff0000') {
            textColor = rgb(1, 0, 0);
          } else if (block.color && typeof block.color === 'object') {
            textColor = rgb(block.color.r ?? 0, block.color.g ?? 0, block.color.b ?? 0);
          }

          let pdfY = startY;
          for (const line of wrappedLines) {
            if (pdfY < MARGIN_PT) break; // clip at bottom margin
            if (block.inTable && block.tableBounds && pdfY < block.tableBounds.y1) break; // clip at table cell boundary!
            try {
              pdfPage.drawText(line, {
                x,
                y: pdfY,
                size: fontSize,
                font: helveticaFont,
                color: textColor,
              });
            } catch (_) { /* skip problematic glyphs */ }
            pdfY -= lineHeight;
          }
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = currentPDF ? `edited_${currentPDF.name}` : "edited_document.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      alert("Failed to generate PDF. Check console for details.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    setTimeout(() => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }, 500);
  };

  if (!currentPDF) return null;

  return (
    <div className="min-h-screen bg-base-100">
      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div className="bg-base-200 shadow-sm p-4 mb-6">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/upload")}
            className="btn btn-ghost btn-sm gap-2"
          >
            <ArrowLeft size={18} /> Back
          </button>

          <div className="flex-1">
            <h1 className="text-2xl font-bold">{currentPDF.name}</h1>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" />
              Parsing PDF…
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        <EditToolbar
          onTool={setSelectedTool}
          onDownload={handleDownload}
          onSave={handleSave}
          activeTool={selectedTool}
          isLoading={isLoading}
        />

        <div className="mt-6">
          {parseError ? (
            <div className="alert alert-error">
              <span>Failed to parse PDF: {parseError}</span>
            </div>
          ) : (
            <SinglePageView
              pages={pages}
              objects={objects}
              isLoading={isLoading}
              onObjectsChange={(objs) => { editedObjectsRef.current = objs; }}
            />
          )}
        </div>
      </div>

      {/* ── Save toast ──────────────────────────────────────────────────────── */}
      {saveSuccess && (
        <div className="alert alert-success fixed bottom-4 right-4 w-96 shadow-lg">
          <span>✓ Changes saved!</span>
        </div>
      )}
    </div>
  );
};

export default EditingPage;