import React, { useState, createContext, useContext } from 'react';
import Upload from './components/Upload';
import Editor from './components/Editor';
import './App.css';

// Theme Context
const ThemeContext = createContext();

export const useTheme = () => useContext(ThemeContext);

function App() {
  const [pdfData, setPdfData] = useState(null);
  const [theme, setTheme] = useState('light');

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const handleUpload = (file) => {
    // Simulate upload delay
    setTimeout(() => {
      // Mock PDF data
      const mockPdfData = {
        pages: [
          {
            width: 600,
            height: 800,
            elements: [
              { type: 'text', content: 'Sample Header', x: 50, y: 100, width: 200, height: 30, role: 'header', fontSize: 24, fontWeight: 'bold' },
              { type: 'text', content: 'This is a sample paragraph. You can edit this text.', x: 50, y: 150, width: 500, height: 50, role: 'paragraph', fontSize: 16 },
              { type: 'image', src: 'https://via.placeholder.com/200x150', x: 100, y: 250, width: 200, height: 150, role: 'image' },
            ]
          }
        ]
      };
      setPdfData(mockPdfData);
    }, 2000); // 2 second delay for animation
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className={`App ${theme}`}>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        {!pdfData ? (
          <Upload onUpload={handleUpload} />
        ) : (
          <Editor pdfData={pdfData} />
        )}
      </div>
    </ThemeContext.Provider>
  );
}

export default App;