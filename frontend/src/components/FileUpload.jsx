import React from "react";
import { useState, useRef } from "react";
import { UploadCloud, Loader, Check, AlertCircle } from "lucide-react";
import { usePDFStore } from "../store/usePDFStore";
import { PDF_UPLOAD_LIMITS, NOTIFICATION_MESSAGES } from "../constants";

const FileUpload = ({ onUploadComplete }) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const { isUploading, uploadProgress, uploadPDF, error, clearError } = usePDFStore();

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
      return;
    }

    try {
      const result = await uploadPDF(file);
      if (onUploadComplete) {
        onUploadComplete(result);
      }
    } catch (err) {
      console.error("Upload error:", err);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const handleFileInput = (e) => {
    const files = e.target.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
          isDragActive
            ? "border-primary bg-primary/10 scale-105"
            : "border-gray-300 hover:border-primary/50"
        } ${isUploading ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileInput}
          className="hidden"
          disabled={isUploading}
        />

        {isUploading ? (
          <div className="flex flex-col items-center gap-4">
            <Loader className="animate-spin size-12 text-primary" />
            <div className="w-full max-w-xs">
              <p className="text-sm font-semibold mb-2">
                {NOTIFICATION_MESSAGES.PROCESSING}
              </p>
              <progress
                className="progress progress-primary w-full"
                value={uploadProgress}
                max="100"
              />
              <p className="text-xs text-gray-500 mt-2">{uploadProgress}%</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <UploadCloud size={48} className="text-gray-400" />
            <div>
              <p className="text-lg font-semibold text-gray-700">
                Drag & Drop your PDF here
              </p>
              <p className="text-sm text-gray-500 mt-2">
                or click to select a file
              </p>
              <p className="text-xs text-gray-400 mt-3">
                Max file size: 50MB
              </p>
            </div>
            <button className="btn btn-primary btn-sm mt-4">
              Select PDF
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-error mt-4 flex gap-3">
          <AlertCircle size={20} />
          <div>
            <p className="font-semibold">Upload Error</p>
            <p className="text-sm">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="btn btn-ghost btn-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {uploadProgress === 100 && !isUploading && (
        <div className="alert alert-success mt-4 flex gap-3">
          <Check size={20} />
          <span>{NOTIFICATION_MESSAGES.UPLOAD_SUCCESS}</span>
        </div>
      )}
    </div>
  );
};

export default FileUpload;