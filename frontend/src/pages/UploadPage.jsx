import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, CheckCircle } from "lucide-react";
import FileUpload from "../components/FileUpload";
import { usePDFStore } from "../store/usePDFStore";
import React from "react";

const UploadPage = () => {
  const navigate = useNavigate();
  const { setCurrentPDF } = usePDFStore();
  const [localUploadedFile, setLocalUploadedFile] = useState(null);


  const handleUploadComplete = (file) => {
    setCurrentPDF(file);
    
    setLocalUploadedFile({
      name: file.name,
      size: file.size,
    });

    setTimeout(() => {
      navigate("/edit");
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-base-200 to-base-300 py-8 px-4">
      <div className="max-w-6xl mx-auto mb-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">📄 PDF Editor</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Select a PDF from your computer to start editing locally.
          </p>
        </div>

        {/* Upload Section */}
        <div className="card bg-base-100 shadow-xl p-8 mb-8">
          {/* Ensure your FileUpload component passes back the raw File object */}
          <FileUpload onUploadComplete={handleUploadComplete} />

          {/* Upload Status UI */}
          {localUploadedFile && (
            <div className="mt-6 alert alert-success flex gap-4">
              <CheckCircle size={24} className="flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold">Ready for Editing!</h3>
                <p className="text-sm mt-1">
                  {localUploadedFile.name} ({formatFileSize(localUploadedFile.size)}) loaded.
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Opening editor...
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="card bg-base-100 p-6 shadow">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              🔒 <span>Private & Local</span>
            </h3>
            <p className="text-sm text-gray-500">
              Your files never leave your browser. All processing happens locally.
            </p>
          </div>

          <div className="card bg-base-100 p-6 shadow">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              🎨 <span>Instantaneous Processing</span>
            </h3>
            <p className="text-sm text-gray-500">
              By eliminating network uploads, the transition from file selection to editing is immediate, regardless of your internet speed.
            </p>
          </div>

          <div className="card bg-base-100 p-6 shadow">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              ⚡ <span>Instant Save</span>
            </h3>
            <p className="text-sm text-gray-500">
              Download your edited PDF directly to your device.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const formatFileSize = (bytes) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

export default UploadPage;