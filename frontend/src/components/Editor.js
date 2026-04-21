import React, { useState } from 'react';
import { useTheme } from '../App';
import './Editor.css';

const Editor = ({ pdfData }) => {
  const { theme, toggleTheme } = useTheme(); // 👈 assume toggle exists

  const [selectedElement, setSelectedElement] = useState(null);
  const [fontSize, setFontSize] = useState(16);
  const [fontFamily, setFontFamily] = useState('Arial');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);

  const data = pdfData || {
    pages: [
      {
        width: 600,
        height: 800,
        elements: [
          {
            type: 'text',
            content: 'Sample Header',
            x: 50,
            y: 100,
            width: 200,
            height: 30,
            fontSize: 24,
            fontWeight: 'bold',
          },
          {
            type: 'text',
            content: 'This is a sample paragraph. You can edit this text.',
            x: 50,
            y: 150,
            width: 500,
            height: 50,
            fontSize: 16,
          },
          {
            type: 'image',
            src: 'https://via.placeholder.com/200x150',
            x: 100,
            y: 250,
            width: 200,
            height: 150,
          },
        ],
      },
    ],
  };

  const handleClick = (e, element) => {
    e.stopPropagation();
    setSelectedElement(element);
  };

  const applyFormatting = () => {
    if (selectedElement && selectedElement.type === 'text') {
      selectedElement.fontSize = fontSize;
      selectedElement.fontFamily = fontFamily;
      selectedElement.fontWeight = isBold ? 'bold' : 'normal';
      selectedElement.fontStyle = isItalic ? 'italic' : 'normal';
      setSelectedElement({ ...selectedElement });
    }
  };

  const renderElement = (element, index) => {
    const isSelected = selectedElement === element;

    const style = {
      position: 'absolute',
      left: element.x,
      top: element.y,
      width: element.width,
      minHeight: element.height,
      padding: element.type === 'text' ? '4px' : '0',
      border: isSelected
        ? '2px solid #4CAF50'
        : '1px dashed transparent',
      borderRadius: '6px',
      cursor: 'pointer',
      background:
        element.type === 'text'
          ? isSelected
            ? 'rgba(76,175,80,0.1)'
            : 'transparent'
          : '#eee',
      fontSize: element.fontSize || 16,
      fontFamily: element.fontFamily || 'Arial',
      fontWeight: element.fontWeight || 'normal',
      fontStyle: element.fontStyle || 'normal',
      color: theme === 'dark' ? '#fff' : '#000',
      transition: 'all 0.2s ease',
    };

    if (element.type === 'text') {
      return (
        <div
          key={index}
          style={style}
          onClick={(e) => handleClick(e, element)}
          contentEditable
          suppressContentEditableWarning
        >
          {element.content}
        </div>
      );
    }

    if (element.type === 'image') {
      return (
        <img
          key={index}
          src={element.src}
          alt=""
          style={style}
          onClick={(e) => handleClick(e, element)}
        />
      );
    }

    return null;
  };

  return (
    <div className={`editor ${theme}`}>
      
      {/* 🔥 Toolbar */}
      <div className="toolbar">
        <div className="toolbar-left">
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
          >
            <option>Arial</option>
            <option>Georgia</option>
            <option>Courier New</option>
            <option>Times New Roman</option>
          </select>

          <input
            type="number"
            value={fontSize}
            onChange={(e) => setFontSize(parseInt(e.target.value))}
          />

          <button
            onClick={() => setIsBold(!isBold)}
            className={isBold ? 'active' : ''}
          >
            B
          </button>

          <button
            onClick={() => setIsItalic(!isItalic)}
            className={isItalic ? 'active' : ''}
          >
            I
          </button>

          <button onClick={applyFormatting}>Apply</button>
        </div>

        {/* 🌙 Theme Toggle */}
        <div className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? '🌙' : '☀️'}
        </div>
      </div>

      {/* 📄 Page */}
      <div className="editor-content">
        {data.pages.map((page, i) => (
          <div key={i} className="page">
            {page.elements.map((el, idx) =>
              renderElement(el, idx)
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Editor;