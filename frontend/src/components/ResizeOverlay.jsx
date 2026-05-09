import React, { useState, useEffect, useRef } from "react";
import { Check, X } from "lucide-react";

const ResizeOverlay = ({ cssW, cssH, ap, onResize, onCancel }) => {
  const [size, setSize] = useState({ w: cssW, h: cssH });
  const dragging = useRef(null);
  const HANDLE = 10;

  const handles = [
    { id: 'nw', x: 0, y: 0, cur: 'nw-resize' },
    { id: 'n', x: size.w / 2, y: 0, cur: 'n-resize' },
    { id: 'ne', x: size.w, y: 0, cur: 'ne-resize' },
    { id: 'e', x: size.w, y: size.h / 2, cur: 'e-resize' },
    { id: 'se', x: size.w, y: size.h, cur: 'se-resize' },
    { id: 's', x: size.w / 2, y: size.h, cur: 's-resize' },
    { id: 'sw', x: 0, y: size.h, cur: 'sw-resize' },
    { id: 'w', x: 0, y: size.h / 2, cur: 'w-resize' },
  ];

  const onMouseDown = (e, handleId) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = { handleId, startX: e.clientX, startY: e.clientY, startSize: { ...size } };
  };

  useEffect(() => {
    const MIN = 20;
    const onMove = (e) => {
      if (!dragging.current) return;
      const { handleId, startX, startY, startSize } = dragging.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let { w, h } = startSize;
      if (handleId.includes('e')) w = Math.max(MIN, startSize.w + dx);
      if (handleId.includes('w')) w = Math.max(MIN, startSize.w - dx);
      if (handleId.includes('s')) h = Math.max(MIN, startSize.h + dy);
      if (handleId.includes('n')) h = Math.max(MIN, startSize.h - dy);
      setSize({ w, h });
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleApply = () => {
    const newRenderedWidth = ap.renderedWidth * (size.w / cssW);
    const newRenderedHeight = ap.renderedHeight * (size.h / cssH);
    onResize(newRenderedWidth, newRenderedHeight);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 10, overflow: 'visible' }}>
      {/* Resize border */}
      <div style={{
        position: 'absolute', left: 0, top: 0,
        width: size.w, height: size.h,
        border: '2px solid #3b82f6',
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }} />
      {/* Handles */}
      {handles.map(h => (
        <div
          key={h.id}
          onMouseDown={(e) => onMouseDown(e, h.id)}
          style={{
            position: 'absolute',
            left: h.x - HANDLE / 2,
            top: h.y - HANDLE / 2,
            width: HANDLE,
            height: HANDLE,
            background: '#3b82f6',
            border: '2px solid white',
            borderRadius: 2,
            cursor: h.cur,
            zIndex: 11,
          }}
        />
      ))}
      {/* Action buttons */}
      <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 4, zIndex: 12 }}>
        <button
          onClick={handleApply}
          style={{ background: '#22c55e', border: 'none', borderRadius: 4, color: 'white', padding: '2px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}
        >
          <Check size={12} /> Apply
        </button>
        <button
          onClick={onCancel}
          style={{ background: '#ef4444', border: 'none', borderRadius: 4, color: 'white', padding: '2px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}
        >
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  );
};

export default ResizeOverlay;
