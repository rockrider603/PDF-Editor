import React, { useState } from "react";
import { Image as ImageIcon, Type } from "lucide-react";

const PDFViewer = ({ extractedContent, extractedImages, selectedTool, onTextSelect }) => {
  const [displayMode, setDisplayMode] = useState("content"); // 'content' or 'images'

  if (!extractedContent && !extractedImages) {
    return (
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center bg-gray-50 min-h-96">
        <p className="text-gray-600 mb-4">No extracted content available</p>
        <p className="text-sm text-gray-500">
          The PDF content is being processed. Please refresh the page in a moment.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Display Mode Tabs */}
      <div className="flex gap-2 border-b border-gray-200 p-4">
        {extractedContent && (
          <button
            onClick={() => setDisplayMode("content")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              displayMode === "content"
                ? "bg-primary text-white"
                : "bg-base-200 text-gray-700 hover:bg-base-300"
            }`}
          >
            <Type size={18} />
            <span>Text Content</span>
          </button>
        )}
        {extractedImages && (
          <button
            onClick={() => setDisplayMode("images")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              displayMode === "images"
                ? "bg-primary text-white"
                : "bg-base-200 text-gray-700 hover:bg-base-300"
            }`}
          >
            <ImageIcon size={18} />
            <span>
              Images ({extractedImages.pageImages?.length || 0})
            </span>
          </button>
        )}
      </div>

      {/* Content Display Area */}
      <div className="p-6 min-h-96 max-h-96 overflow-y-auto">
        {displayMode === "content" && extractedContent && (
          <ContentDisplay
            textElements={extractedContent.rawElements}
            classification={extractedContent.classification}
            selectedTool={selectedTool}
            onTextSelect={onTextSelect}
          />
        )}
        {displayMode === "images" && extractedImages && (
          <ImagesDisplay
            backgroundImage={extractedImages.background}
            pageImages={extractedImages.pageImages}
          />
        )}
      </div>
    </div>
  );
};

const ContentDisplay = ({ textElements, classification, selectedTool, onTextSelect }) => {
  if (!textElements || textElements.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No text content extracted from this PDF</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Headers Section */}
      {classification?.detailed?.headers?.length > 0 && (
        <div>
          <h3 className="font-bold text-lg mb-3 text-gray-700 flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-primary rounded-full"></span>
            Headers ({classification.detailed.headers.length})
          </h3>
          <div className="space-y-2 ml-4">
            {classification.detailed.headers.map((header, idx) => (
              <div
                key={idx}
                onClick={() => onTextSelect?.(header)}
                className={`p-3 rounded-lg cursor-pointer transition-all ${
                  selectedTool
                    ? "bg-blue-50 border border-blue-200 hover:bg-blue-100"
                    : "bg-gray-50 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                <p className="text-gray-900 font-semibold">{header.text}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Position: x={header.xPosition?.toFixed(2)}, Center={header.elementCenter?.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paragraphs Section */}
      {classification?.detailed?.paragraphs?.length > 0 && (
        <div>
          <h3 className="font-bold text-lg mb-3 text-gray-700 flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-success rounded-full"></span>
            Paragraphs ({classification.detailed.paragraphs.length})
          </h3>
          <div className="space-y-2 ml-4">
            {classification.detailed.paragraphs.map((para, idx) => (
              <div
                key={idx}
                onClick={() => onTextSelect?.(para)}
                className={`p-3 rounded-lg cursor-pointer transition-all ${
                  selectedTool
                    ? "bg-green-50 border border-green-200 hover:bg-green-100"
                    : "bg-gray-50 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                <p className="text-gray-900">{para.text}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Position: x={para.xPosition?.toFixed(2)}, Center={para.elementCenter?.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other Text Elements */}
      {textElements.length > 0 && (!classification || 
        (classification.detailed?.headers?.length === 0 && 
         classification.detailed?.paragraphs?.length === 0)) && (
        <div>
          <h3 className="font-bold text-lg mb-3 text-gray-700">Extracted Text Elements</h3>
          <div className="space-y-2">
            {textElements.map((element, idx) => (
              <div
                key={idx}
                onClick={() => onTextSelect?.(element)}
                className={`p-3 rounded-lg cursor-pointer transition-all ${
                  selectedTool
                    ? "bg-purple-50 border border-purple-200 hover:bg-purple-100"
                    : "bg-gray-50 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                <p className="text-gray-900">{element.text}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Position: x={element.x?.toFixed(2)}, y={element.y?.toFixed(2)}, width={element.width?.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ImagesDisplay = ({ backgroundImage, pageImages }) => {
  const images = [...(pageImages || [])];
  const hasImages = backgroundImage || (pageImages && pageImages.length > 0);

  if (!hasImages) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No images extracted from this PDF</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Background Image */}
      {backgroundImage && (
        <div className="border-2 border-primary rounded-lg p-4 bg-primary/5">
          <h4 className="font-semibold text-primary mb-2 flex items-center gap-2">
            <span className="badge badge-primary">BG</span>
            Background Image
          </h4>
          <div className="bg-gray-100 rounded p-4 text-center">
            <p className="text-sm text-gray-600 mb-2">
              {backgroundImage.metadata?.width} × {backgroundImage.metadata?.height} px
            </p>
            <p className="text-xs text-gray-500">
              Filter: {backgroundImage.metadata?.filter}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Object #{backgroundImage.objNum}
            </p>
          </div>
        </div>
      )}

      {/* Page Images */}
      {pageImages && pageImages.length > 0 && (
        <div>
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <span className="badge badge-info">{pageImages.length}</span>
            Page Images
          </h4>
          <div className="space-y-3">
            {pageImages.map((img, idx) => (
              <div key={idx} className="border border-gray-200 rounded-lg p-3 hover:border-gray-400 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">Image {idx + 1}</p>
                    <p className="text-xs text-gray-500">
                      Object #{img.objNum}
                    </p>
                  </div>
                  <span className="badge badge-ghost text-xs">
                    {img.metadata?.filter}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <div>
                    <p className="text-gray-500">Dimensions</p>
                    <p className="font-medium">
                      {img.metadata?.width} × {img.metadata?.height} px
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Format</p>
                    <p className="font-medium">{img.format?.toUpperCase()}</p>
                  </div>
                </div>
                {img.appearances && img.appearances.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Appearances:</p>
                    {img.appearances.map((app, appIdx) => (
                      <p key={appIdx} className="text-xs text-gray-600">
                        Position: ({app.x?.toFixed(1)}, {app.y?.toFixed(1)}), 
                        Size: {app.renderedWidth?.toFixed(1)} × {app.renderedHeight?.toFixed(1)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PDFViewer;
