import React, { useState } from 'react';

const Upload = ({ onUpload }) => {
  const [file, setFile] = useState(null);

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
      onUpload(file);
    }
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>PDF Editor</h1>
      <input type="file" accept=".pdf" onChange={handleFileChange} />
      <br />
      <button onClick={handleUpload} disabled={!file}>Upload PDF</button>
    </div>
  );
};

export default Upload;