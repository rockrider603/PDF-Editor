import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import EditToolbar from "../components/EditToolbar";
import { usePDFStore } from "../store/usePDFStore";
import React from "react";
const EditingPage = () => {
  const { pdfId } = useParams();
  const navigate = useNavigate();
  const { currentPDF, getPDFById, isLoading, deletePDF } = usePDFStore();
  const [editedContent, setEditedContent] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    // Fetch PDF when page loads
    if (pdfId) {
      const fetchPDF = async () => {
        try {
          const pdf = await getPDFById(pdfId);
          setEditedContent(pdf);
        } catch (error) {
          console.error("Failed to fetch PDF:", error);
          navigate("/upload");
        }
      };
      fetchPDF();
    }
  }, [pdfId, getPDFById, navigate]);

  const handleToolSelection = (toolId) => {
    setSelectedTool(toolId);
    console.log("Selected tool:", toolId);
    // Tool logic would be implemented here
  };

  const handleDownload = async () => {
    try {
      // Download logic
      const response = await fetch(`/api/pdf/${pdfId}/download`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentPDF?.originalName || "document"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save logic
      console.log("Saving annotations:", annotations);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm("Are you sure you want to reset all changes?")) {
      setAnnotations([]);
      setEditedContent(currentPDF);
      setSelectedTool(null);
    }
  };

  const handleShare = async () => {
    try {
      const shareUrl = `${window.location.origin}/view/${pdfId}`;
      await navigator.clipboard.writeText(shareUrl);
      alert("Share link copied to clipboard!");
    } catch (error) {
      console.error("Share failed:", error);
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this PDF? This action cannot be undone.")) {
      try {
        await deletePDF(pdfId);
        navigate("/upload");
      } catch (error) {
        console.error("Delete failed:", error);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <span className="loading loading-lg"></span>
          <p className="mt-4 text-gray-600">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (!currentPDF) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <FileText size={48} className="mx-auto text-gray-400 mb-4" />
          <h2 className="text-2xl font-bold">PDF not found</h2>
          <p className="text-gray-600 mt-2">The PDF you're looking for doesn't exist.</p>
          <button
            onClick={() => navigate("/upload")}
            className="btn btn-primary mt-4"
          >
            Back to Upload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <div className="bg-base-200 shadow-sm p-4 mb-6">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/upload")}
            className="btn btn-ghost btn-sm gap-2"
          >
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <FileText size={24} className="text-primary" />
              <div>
                <h1 className="text-2xl font-bold">{currentPDF.originalName}</h1>
                <p className="text-sm text-gray-600">
                  {currentPDF.pageCount || "?"} pages
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        {/* Toolbar */}
        <EditToolbar
          onTool={handleToolSelection}
          onDownload={handleDownload}
          onSave={handleSave}
          onReset={handleReset}
          onShare={handleShare}
          onDelete={handleDelete}
          isLoading={isSaving}
        />

        {/* PDF Viewer and Editor */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Editor */}
          <div className="lg:col-span-3">
            <div className="card bg-base-100 shadow-xl p-6">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center bg-gray-50">
                <p className="text-gray-600 mb-4">
                  PDF Preview Area
                </p>
                <p className="text-sm text-gray-500">
                  Selected Tool: {selectedTool || "None"}
                </p>
                <div className="mt-6">
                  <span className="loading loading-ring"></span>
                </div>
                <p className="text-xs text-gray-400 mt-4">
                  PDF viewer component will render here
                </p>
              </div>

              {/* Annotations List */}
              {annotations.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-semibold mb-3">Annotations</h3>
                  <div className="space-y-2">
                    {annotations.map((annotation, index) => (
                      <div
                        key={index}
                        className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded flex justify-between items-start"
                      >
                        <div>
                          <p className="text-sm font-semibold">
                            {annotation.type}
                          </p>
                          <p className="text-sm text-gray-600">
                            {annotation.content}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setAnnotations(
                              annotations.filter((_, i) => i !== index)
                            );
                          }}
                          className="btn btn-ghost btn-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            {/* File Info */}
            <div className="card bg-base-100 shadow-xl p-4 mb-4">
              <h3 className="font-semibold text-sm mb-3">File Information</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-gray-600">File Name</p>
                  <p className="font-semibold truncate">
                    {currentPDF.originalName}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">File Size</p>
                  <p className="font-semibold">
                    {formatFileSize(currentPDF.fileSize)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Pages</p>
                  <p className="font-semibold">{currentPDF.pageCount || "?"}</p>
                </div>
                <div>
                  <p className="text-gray-600">Uploaded</p>
                  <p className="font-semibold text-xs">
                    {formatDate(currentPDF.createdAt)}
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="card bg-base-100 shadow-xl p-4">
              <h3 className="font-semibold text-sm mb-3">Actions</h3>
              <div className="space-y-2">
                <button className="btn btn-sm btn-outline w-full">
                  Print
                </button>
                <button
                  onClick={handleDownload}
                  className="btn btn-sm btn-primary w-full"
                >
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Success Message */}
        {saveSuccess && (
          <div className="alert alert-success fixed bottom-4 right-4 w-96 shadow-lg">
            <span>✓ Changes saved successfully!</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper functions
const formatFileSize = (bytes) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

const formatDate = (dateString) => {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default EditingPage;