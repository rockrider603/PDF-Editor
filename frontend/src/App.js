import React, { useState } from 'react';
import Upload from './components/Upload';
import PdfViewer from './components/PdfViewer';
import './App.css';

function App() {
  const [pdfData, setPdfData] = useState(null);

  const handleUpload = (file) => {
    // Here, you would send the file to the backend and get the extracted data
    // For now, mock the data
    const mockPdfData = {
      // Mock data as in PdfViewer
    };
    setPdfData(mockPdfData);
  };

  return (
    <div className="App">
      {!pdfData ? (
        <Upload onUpload={handleUpload} />
      ) : (
        <PdfViewer pdfData={pdfData} />
      )}
    </div>
  );
}

export default App;