import { useState } from "react";
import React from "react";
import {
  Highlighter,
  Type,
  StickyNote,
  Crop,
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
}) => {
  const [activeColor, setActiveColor] = useState("#FFFF00");
  const [activeSize, setActiveSize] = useState("medium");

  const toolIcons = {
    highlight: Highlighter,
    strikethrough: Type,
    underline: Underline,
    notes: StickyNote,
    crop: Crop,
  };

  const colors = [
    { name: "yellow", value: "#FFFF00", bg: "bg-yellow-300" },
    { name: "green", value: "#00FF00", bg: "bg-green-300" },
    { name: "pink", value: "#FF00FF", bg: "bg-pink-300" },
    { name: "red", value: "#FF0000", bg: "bg-red-300" },
    { name: "blue", value: "#0000FF", bg: "bg-blue-300" },
  ];

  return (
    <div className="bg-base-200 shadow-lg rounded-lg p-4 sticky top-0 z-10">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        {/* Editing Tools */}
        <div className="flex flex-wrap gap-2">
          {EDITING_TOOLS.map((tool) => {
            const Icon = toolIcons[tool.id];
            return (
              <button
                key={tool.id}
                onClick={() => onTool(tool.id)}
                className="btn btn-sm btn-outline gap-2 hover:btn-primary"
                title={tool.label}
                disabled={isLoading}
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
                  onClick={() => setActiveColor(color.value)}
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
        <div className="dropdown dropdown-end">
          <button className="btn btn-sm btn-outline gap-2">
            Size: {activeSize}
            <ChevronDown size={16} />
          </button>
          <ul className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box">
            {["small", "medium", "large"].map((size) => (
              <li key={size}>
                <button
                  onClick={() => setActiveSize(size)}
                  className={activeSize === size ? "active" : ""}
                >
                  <span className="capitalize">{size}</span>
                </button>
              </li>
            ))}
          </ul>
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