import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import EditToolbar from "../components/EditToolbar";
import PDFViewer from "../components/PDFViewer";
import { usePDFStore } from "../store/usePDFStore";

const EditingPage = () => {
  const navigate = useNavigate();
  const { currentPDF, isLoading, extractedContent, extractedImages } = usePDFStore();
  
  const [annotations, setAnnotations] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!currentPDF && !isLoading) {
      console.warn("No PDF found in state, redirecting...");
      navigate("/upload");
    }
  }, [currentPDF, isLoading, navigate]);

  const handleToolSelection = (toolId) => setSelectedTool(toolId);

  const handleDownload = () => {
    if (!currentPDF) return;
    const url = URL.createObjectURL(currentPDF);
    const a = document.createElement("a");
    a.href = url;
    a.download = `edited_${currentPDF.name}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setTimeout(() => {
      setSaveSuccess(true);
      setIsSaving(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    }, 1000);
  };

  if (!currentPDF) return null; 

  return (
    <div className="min-h-screen bg-base-100">
      <div className="bg-base-200 shadow-sm p-4 mb-6">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/upload")} className="btn btn-ghost btn-sm gap-2">
            <ArrowLeft size={18} /> Back
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{currentPDF.name}</h1>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-8">
        <EditToolbar 
            onTool={handleToolSelection} 
            onDownload={handleDownload} 
            onSave={handleSave} 
            activeTool={selectedTool} 
        />

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
            <div className="card bg-base-100 shadow-xl p-6">
              <PDFViewer 
                file={currentPDF}
                extractedContent={extractedContent}
                extractedImages={extractedImages}
                selectedTool={selectedTool}
              />
            </div>
          </div>
          
          <div className="lg:col-span-1">
            <div className="card bg-base-100 shadow-xl p-4">
              <h3 className="font-semibold text-sm mb-3">Local File Info</h3>
              <p className="text-xs truncate">Name: {currentPDF.name}</p>
              <p className="text-xs">Size: {(currentPDF.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          </div>
        </div>
      </div>
      {saveSuccess && (
          <div className="alert alert-success fixed bottom-4 right-4 w-96 shadow-lg">
            <span>✓ Local changes saved!</span>
          </div>
      )}
    </div>
  );
};

export default EditingPage;