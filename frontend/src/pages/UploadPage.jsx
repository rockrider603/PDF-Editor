import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, CheckCircle, AlertCircle } from "lucide-react";
import FileUpload from "../components/FileUpload";
import { usePDFStore } from "../store/usePDFStore";
import React from "react";

const UploadPage = () => {
  const navigate = useNavigate();
  const { currentPDF, getPDFs, pdfs } = usePDFStore();
  const [uploadedFile, setUploadedFile] = useState(null);
  const [recentPDFs, setRecentPDFs] = useState([]);

  useEffect(() => {
    // Fetch list of PDFs on page load
    const fetchPDFs = async () => {
      try {
        await getPDFs();
      } catch (error) {
        console.error("Failed to fetch PDFs:", error);
      }
    };
    fetchPDFs();
  }, [getPDFs]);

  useEffect(() => {
    if (pdfs && pdfs.length > 0) {
      setRecentPDFs(pdfs.slice(0, 5));
    }
  }, [pdfs]);

  const handleUploadComplete = (uploadedPDF) => {
    setUploadedFile(uploadedPDF);
    // Auto-navigate to editing page after short delay
    setTimeout(() => {
      navigate(`/edit/${uploadedPDF._id}`);
    }, 1500);
  };

  const handleEditPDF = (pdfId) => {
    navigate(`/edit/${pdfId}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-base-200 to-base-300 py-8 px-4">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">📄 Upload Your PDF</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Upload a PDF file to start editing. Drag and drop or click to select.
          </p>
        </div>

        {/* Upload Section */}
        <div className="card bg-base-100 shadow-xl p-8 mb-8">
          <FileUpload onUploadComplete={handleUploadComplete} />

          {/* Upload Status */}
          {uploadedFile && (
            <div className="mt-6 alert alert-success flex gap-4">
              <CheckCircle size={24} className="flex-shrink-0" />
              <div>
                <h3 className="font-semibold">Upload Successful!</h3>
                <p className="text-sm mt-1">
                  {uploadedFile.originalName} has been uploaded successfully.
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Redirecting to editor...
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="card bg-base-100 p-6 shadow">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              ✅ <span>What's Allowed</span>
            </h3>
            <ul className="text-sm space-y-1">
              <li>✓ PDF files only</li>
              <li>✓ Max 50MB file size</li>
              <li>✓ Multiple uploads</li>
            </ul>
          </div>

          <div className="card bg-base-100 p-6 shadow">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              🎨 <span>Editing Features</span>
            </h3>
            <ul className="text-sm space-y-1">
              <li>✓ Highlight text</li>
              <li>✓ Add annotations</li>
              <li>✓ Crop pages</li>
            </ul>
          </div>

          <div className="card bg-base-100 p-6 shadow">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              💾 <span>Save & Share</span>
            </h3>
            <ul className="text-sm space-y-1">
              <li>✓ Download edited PDF</li>
              <li>✓ Share with others</li>
              <li>✓ Cloud storage</li>
            </ul>
          </div>
        </div>

        {/* Recent PDFs */}
        {recentPDFs && recentPDFs.length > 0 && (
          <div className="card bg-base-100 shadow-xl p-6">
            <h2 className="text-2xl font-bold mb-4">📚 Recent PDFs</h2>
            <div className="overflow-x-auto">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Size</th>
                    <th>Uploaded</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPDFs.map((pdf) => (
                    <tr key={pdf._id} className="hover">
                      <td className="flex items-center gap-2">
                        <FileText size={20} className="text-error" />
                        <span className="truncate">{pdf.originalName}</span>
                      </td>
                      <td>{formatFileSize(pdf.fileSize)}</td>
                      <td>{formatDate(pdf.createdAt)}</td>
                      <td>
                        <button
                          onClick={() => handleEditPDF(pdf._id)}
                          className="btn btn-sm btn-primary"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {recentPDFs.length >= 5 && (
              <div className="mt-4 text-center">
                <button className="btn btn-outline btn-sm">
                  View All PDFs
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {(!recentPDFs || recentPDFs.length === 0) && (
          <div className="card bg-base-100 shadow-xl p-12 text-center">
            <FileText size={48} className="mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold mb-2">No PDFs Yet</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Start by uploading your first PDF file to see it here.
            </p>
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
  });
};

export default UploadPage;