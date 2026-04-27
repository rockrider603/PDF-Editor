import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import EditToolbar from "../components/EditToolbar";
import PDFViewer from "../components/PDFViewer";
import { usePDFStore } from "../store/usePDFStore";
import { PdfDocument } from "pdf-parser";

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
  const [saveSuccess, setSaveSuccess]   = useState(false);
  const [parseError, setParseError]     = useState(null);

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
        const doc  = await PdfDocument.fromFile(currentPDF);
        const count = doc.pageCount;
        const pagesArray = [];

        for (let n = 1; n <= count; n++) {
            const page   = await doc.getPage(n);
            const result = await page.extract();
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

  // ── Download ────────────────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!currentPDF) return;
    const url = URL.createObjectURL(currentPDF);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `edited_${currentPDF.name}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
            <PDFViewer
              pages={pages}
              selectedTool={selectedTool}
              isLoading={isLoading}
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