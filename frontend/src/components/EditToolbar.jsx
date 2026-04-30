import { useState } from "react";
import React from "react";
import { usePDFStore } from "../store/usePDFStore";
import {
  Highlighter,
  Bold,
  StickyNote,
  Italic,
  Underline,
  Download,
  Save,
  RotateCcw,
  Share2,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { EDITING_TOOLS } from "../constants";

const EditToolbar = ({
  onTool,
  onDownload,
  onSave,
  onReset,
  onShare,
  onDelete,
  isLoading = false,
  activeTool = null,
}) => {
  const [activeColor, setActiveColor] = useState("#FFFF00");
  const [localActiveTool, setLocalActiveTool] = useState(activeTool);

  const { activeCursor, pages, updateTextFontSize, updateTextColor, updateTextFormat } = usePDFStore();

  let activeSize = 12;
  let activeFormat = { isBold: false, isItalic: false };

  if (activeCursor?.pageIdx !== null && activeCursor?.elIdx !== null) {
    const el = pages[activeCursor.pageIdx]?.textElements[activeCursor.elIdx];
    if (el) {
      if (el.fontSize) activeSize = el.fontSize;
      if (el.isBold) activeFormat.isBold = true;
      if (el.isItalic) activeFormat.isItalic = true;
    }
  }

  const handleSizeChange = (e) => {
    const newSize = parseInt(e.target.value, 10);
    if (!isNaN(newSize) && activeCursor?.pageIdx !== null && activeCursor?.elIdx !== null) {
      updateTextFontSize(activeCursor.pageIdx, activeCursor.elIdx, newSize);
    }
  };

  const handleColorSelect = (colorValue) => {
    setActiveColor(colorValue);
    if (activeCursor?.pageIdx !== null && activeCursor?.elIdx !== null) {
      updateTextColor(activeCursor.pageIdx, activeCursor.elIdx, colorValue);
    }
  };

  const toolIcons = {
    highlight: Highlighter,
    bold: Bold,
    underline: Underline,
    notes: StickyNote,
    italic: Italic,
  };

  const colors = [
    { name: "black", value: "#000000", bg: "bg-black" },
    { name: "white", value: "#FFFFFF", bg: "bg-white" },
    { name: "red", value: "#FF0000", bg: "bg-red-500" },
    { name: "green", value: "#00FF00", bg: "bg-green-500" },
    { name: "blue", value: "#0000FF", bg: "bg-blue-500" },
  ];

  return (
    <div className="bg-base-200 shadow-lg rounded-lg p-4 sticky top-0 z-10">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        {/* Editing Tools */}
        <div className="flex flex-wrap gap-2">
          {EDITING_TOOLS.map((tool) => {
            const Icon = toolIcons[tool.id];
            const isFormatTool = tool.id === 'bold' || tool.id === 'italic';
            const isFormatActive = tool.id === 'bold' ? activeFormat.isBold : activeFormat.isItalic;
            const isActive = isFormatTool ? isFormatActive : (localActiveTool === tool.id);

            return (
              <button
                key={tool.id}
                onClick={() => {
                  if (isFormatTool) {
                    if (activeCursor?.pageIdx !== null && activeCursor?.elIdx !== null) {
                      const prop = tool.id === 'bold' ? 'isBold' : 'isItalic';
                      const el = pages[activeCursor.pageIdx]?.textElements[activeCursor.elIdx] || {};
                      updateTextFormat(activeCursor.pageIdx, activeCursor.elIdx, { [prop]: !el[prop] });
                    }
                  } else {
                    setLocalActiveTool(isActive ? null : tool.id);
                    onTool(isActive ? null : tool.id);
                  }
                }}
                className={`btn btn-sm gap-2 transition-all ${
                  isActive
                    ? "btn-primary"
                    : "btn-outline hover:btn-primary"
                }`}
                title={tool.label}
                disabled={isLoading || (isFormatTool && activeCursor?.pageIdx === null)}
              >
                {Icon && <Icon size={16} />}
                <span className="hidden sm:inline">{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Color Picker */}
        <div className="dropdown dropdown-end">
          <button className="btn btn-sm btn-outline gap-2">
            Color
            <div
              className="w-5 h-5 rounded border border-gray-300"
              style={{ backgroundColor: activeColor }}
            />
            <ChevronDown size={16} />
          </button>
          <ul className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box gap-2">
            {colors.map((color) => (
              <li key={color.name}>
                <button
                  onClick={() => handleColorSelect(color.value)}
                  className={`flex gap-2 items-center ${
                    activeColor === color.value ? "active" : ""
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded border-2 ${color.bg}`}
                    style={{ backgroundColor: color.value }}
                  />
                  <span className="capitalize">{color.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Size Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Size:</span>
          <input 
            type="number" 
            value={Math.round(activeSize)} 
            onChange={handleSizeChange} 
            className="input input-sm input-bordered w-20 px-2"
            min="4"
            max="144"
            disabled={activeCursor?.pageIdx === null}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 ml-auto">
          <button
            onClick={onReset}
            className="btn btn-sm btn-ghost gap-2"
            title="Reset all changes"
            disabled={isLoading}
          >
            <RotateCcw size={16} />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            onClick={onSave}
            className="btn btn-sm btn-info gap-2"
            title="Save changes"
            disabled={isLoading}
          >
            <Save size={16} />
            <span className="hidden sm:inline">Save</span>
          </button>

          <button
            onClick={onDownload}
            className="btn btn-sm btn-success gap-2"
            title="Download edited PDF"
            disabled={isLoading}
          >
            <Download size={16} />
            <span className="hidden sm:inline">Download</span>
          </button>

          <div className="dropdown dropdown-end">
            <button
              className="btn btn-sm btn-ghost gap-2"
              title="More options"
              disabled={isLoading}
            >
              ...
            </button>
            <ul className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
              <li>
                <button onClick={onShare} className="gap-2">
                  <Share2 size={16} />
                  Share
                </button>
              </li>
              <li>
                <button onClick={onDelete} className="gap-2 text-error">
                  <Trash2 size={16} />
                  Delete
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Status Info */}
      {isLoading && (
        <div className="mt-3 flex items-center gap-2">
          <span className="loading loading-sm"></span>
          <span className="text-sm text-gray-600">Processing...</span>
        </div>
      )}
    </div>
  );
};

export default EditToolbar;