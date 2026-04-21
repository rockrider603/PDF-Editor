import React, { useState } from 'react';
import { useTheme } from '../App';
import './Upload.css';

const Upload = ({ onUpload }) => {
  const { theme } = useTheme();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
    } else {
      alert('Please select a PDF file.');
    }
  };

  const handleUpload = () => {
    if (file) {
      setUploading(true);
      onUpload(file);
    }
  };

  return (
    <div className={`upload ${theme}`}>
      <div className="upload-container">
        <h1>📄 PDF Editor</h1>

        <div className="upload-area">
          <div className="arrow">⬆️</div>

          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            id="file-input"
            hidden
          />

          <label htmlFor="file-input" className="upload-label">
            {file ? `📄 ${file.name}` : 'Choose PDF file'}
          </label>

          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="upload-btn"
          >
            {uploading ? 'Uploading...' : 'Upload PDF'}
          </button>

          {uploading && <div className="spinner"></div>}
        </div>
      </div>
    </div>
  );
};

export default Upload;