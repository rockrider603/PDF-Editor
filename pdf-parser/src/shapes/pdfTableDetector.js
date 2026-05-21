/**
 * pdfTableDetector.js
 *
 * Detects table grids from a list of PDF shapes (lines and rectangles).
 * Modifies the shapes in-place to color the table lines red.
 */

const TOLERANCE = 3; // 3 points tolerance for alignment/intersection

function getSegments(shapes) {
    const segments = [];
    for (const shape of shapes) {
        if (shape.type === 'line') {
            const isHoriz = Math.abs(shape.y1 - shape.y2) <= TOLERANCE;
            const isVert = Math.abs(shape.x1 - shape.x2) <= TOLERANCE;
            if (isHoriz || isVert) {
                segments.push({
                    shape,
                    x1: Math.min(shape.x1, shape.x2),
                    x2: Math.max(shape.x1, shape.x2),
                    y1: Math.min(shape.y1, shape.y2),
                    y2: Math.max(shape.y1, shape.y2),
                    isHoriz,
                    isVert
                });
            }
        } else if (shape.type === 'rect') {
            // A thin rectangle can be a line.
            const isHoriz = shape.height <= 5 && shape.width > 10;
            const isVert = shape.width <= 5 && shape.height > 10;
            if (isHoriz || isVert) {
                segments.push({
                    shape,
                    x1: shape.x,
                    x2: shape.x + shape.width,
                    y1: shape.y,
                    y2: shape.y + shape.height,
                    isHoriz,
                    isVert
                });
            }
        }
    }
    return segments;
}

function intersectOrTouch(a, b) {
    // Orthogonal intersection
    if (a.isHoriz && b.isVert) {
        return a.x1 <= b.x1 + TOLERANCE && a.x2 >= b.x1 - TOLERANCE &&
               b.y1 <= a.y1 + TOLERANCE && b.y2 >= a.y1 - TOLERANCE;
    }
    if (a.isVert && b.isHoriz) {
        return b.x1 <= a.x1 + TOLERANCE && b.x2 >= a.x1 - TOLERANCE &&
               a.y1 <= b.y1 + TOLERANCE && a.y2 >= b.y1 - TOLERANCE;
    }
    
    // Parallel proximity/overlap
    if (a.isHoriz && b.isHoriz) {
        if (Math.abs(a.y1 - b.y1) <= TOLERANCE) {
            return a.x1 <= b.x2 + TOLERANCE && a.x2 >= b.x1 - TOLERANCE;
        }
    }
    if (a.isVert && b.isVert) {
        if (Math.abs(a.x1 - b.x1) <= TOLERANCE) {
            return a.y1 <= b.y2 + TOLERANCE && a.y2 >= b.y1 - TOLERANCE;
        }
    }
    
    return false;
}

export function detectTablesAndColorRed(shapes) {
    const segments = getSegments(shapes);
    
    // Build adjacency list for connected components
    const adj = Array.from({ length: segments.length }, () => []);
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            if (intersectOrTouch(segments[i], segments[j])) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }

    // Find connected components
    const visited = new Array(segments.length).fill(false);
    const components = [];

    for (let i = 0; i < segments.length; i++) {
        if (!visited[i]) {
            const comp = [];
            const queue = [i];
            visited[i] = true;
            
            while (queue.length > 0) {
                const curr = queue.shift();
                comp.push(curr);
                for (const neighbor of adj[curr]) {
                    if (!visited[neighbor]) {
                        visited[neighbor] = true;
                        queue.push(neighbor);
                    }
                }
            }
            components.push(comp);
        }
    }

    // A valid table grid usually has multiple horizontal and vertical lines intersecting.
    // Let's enforce at least 2 horizontal and 2 vertical lines.
    for (const compIndices of components) {
        let horizCount = 0;
        let vertCount = 0;
        for (const idx of compIndices) {
            if (segments[idx].isHoriz) horizCount++;
            if (segments[idx].isVert) vertCount++;
        }

        if (horizCount >= 2 && vertCount >= 2) {
            // It's a table! Color all its segments red.
            for (const idx of compIndices) {
                const shape = segments[idx].shape;
                // If it has a stroke, make it red
                if (shape.strokeColor !== null && shape.strokeColor !== undefined) {
                    shape.strokeColor = { r: 1, g: 0, b: 0 };
                }
                // If it has a fill (like thin rects), make it red
                if (shape.fillColor !== null && shape.fillColor !== undefined) {
                    shape.fillColor = { r: 1, g: 0, b: 0 };
                }
            }
        }
    }
}
