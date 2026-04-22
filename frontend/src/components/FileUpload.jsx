import React, { useState, useRef } from "react";
import { UploadCloud, Loader, Check, AlertCircle } from "lucide-react";
import { usePDFStore } from "../store/usePDFStore";
import { PDF_UPLOAD_LIMITS, NOTIFICATION_MESSAGES } from "../constants";

const FileUpload = ({ onUploadComplete }) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const { isUploading, uploadProgress, setCurrentPDF, error, clearError } = usePDFStore();

  const validateFile = (file) => {
    if (!file) return { valid: false, message: "No file selected" };
    if (file.size > PDF_UPLOAD_LIMITS.MAX_FILE_SIZE) {
      return { valid: false, message: NOTIFICATION_MESSAGES.FILE_TOO_LARGE };
    }
    if (!PDF_UPLOAD_LIMITS.ACCEPTED_FORMATS.includes(file.type)) {
      return { valid: false, message: NOTIFICATION_MESSAGES.INVALID_FORMAT };
    }
    return { valid: true };
  };

  const handleFile = async (file) => {
    clearError();
    const validation = validateFile(file);

    if (!validation.valid) {
      // You should trigger a toast or set a local error state here
      return;
    }

    try {
      // FRONTEND-ONLY CHANGE: 
      // Instead of calling uploadPDF (API), we save the file locally.
      setCurrentPDF(file);
      
      if (onUploadComplete) {
        onUploadComplete(file); 
      }
    } catch (err) {
      console.error("Local processing error:", err);
    }
  };

  // ... handleDrag, handleDrop, handleFileInput, handleClick remain the same ...
  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setIsDragActive(true);
    else if (e.type === "dragleave") setIsDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) handleFile(files[0]);
  };

  const handleFileInput = (e) => {
    const files = e.target.files;
    if (files && files[0]) handleFile(files[0]);
  };

  const handleClick = () => fileInputRef.current?.click();

  return (
    <div className="w-full">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
          isDragActive ? "border-primary bg-primary/10 scale-105" : "border-gray-300 hover:border-primary/50"
        }`}
      >
        <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileInput} className="hidden" />

        <div className="flex flex-col items-center gap-4">
          <UploadCloud size={48} className="text-gray-400" />
          <div>
            <p className="text-lg font-semibold text-gray-700">Drag & Drop your PDF here</p>
            <p className="text-sm text-gray-500 mt-2">or click to select a file</p>
          </div>
          <button className="btn btn-primary btn-sm mt-4">Select PDF</button>
        </div>
      </div>
      {/* ... Error and Progress UI remains same ... */}
    </div>
  );
};

export default FileUpload;