/**
 * pdfTableDetector.js
 *
 * Detects table grids from a list of PDF shapes (lines and rectangles).
 * Modifies the shapes in-place to color the table lines red.
 *
 * Returns an array of tableRegion descriptors so that callers can determine
 * which text elements fall inside a table and which cell they belong to.
 *
 * tableRegion shape:
 *   {
 *     x1, y1, x2, y2,          // overall bounding box in PDF points (bottom-left origin)
 *     vertXPositions: number[], // sorted x-coordinates of all vertical line segments
 *     horizYPositions: number[] // sorted y-coordinates of all horizontal line segments
 *   }
 */

const TOLERANCE = 3; // 3 points tolerance for alignment/intersection

function getSegments(shapes) {
    const segments = [];
    for (const shape of shapes) {
        if (shape.type === 'line') {
            const isHoriz = Math.abs(shape.y1 - shape.y2) <= TOLERANCE;
            const isVert  = Math.abs(shape.x1 - shape.x2) <= TOLERANCE;
            if (isHoriz || isVert) {
                segments.push({
                    shape,
                    x1: Math.min(shape.x1, shape.x2),
                    x2: Math.max(shape.x1, shape.x2),
                    y1: Math.min(shape.y1, shape.y2),
                    y2: Math.max(shape.y1, shape.y2),
                    isHoriz,
                    isVert,
                });
            }
        } else if (shape.type === 'rect') {
            // A thin rectangle that acts as a rule line.
            const isHoriz = shape.height <= 5 && shape.width > 10;
            const isVert  = shape.width  <= 5 && shape.height > 10;
            if (isHoriz || isVert) {
                segments.push({
                    shape,
                    x1: shape.x,
                    x2: shape.x + shape.width,
                    y1: shape.y,
                    y2: shape.y + shape.height,
                    isHoriz,
                    isVert,
                });
            }
            // A normal (non-thin) rectangle contributes all four edges.
            if (!isHoriz && !isVert && shape.width > 10 && shape.height > 10) {
                // Bottom edge (horiz)
                segments.push({ shape, x1: shape.x, x2: shape.x + shape.width, y1: shape.y,               y2: shape.y,               isHoriz: true,  isVert: false });
                // Top edge (horiz)
                segments.push({ shape, x1: shape.x, x2: shape.x + shape.width, y1: shape.y + shape.height, y2: shape.y + shape.height, isHoriz: true,  isVert: false });
                // Left edge (vert)
                segments.push({ shape, x1: shape.x,               x2: shape.x,               y1: shape.y, y2: shape.y + shape.height, isHoriz: false, isVert: true  });
                // Right edge (vert)
                segments.push({ shape, x1: shape.x + shape.width,  x2: shape.x + shape.width,  y1: shape.y, y2: shape.y + shape.height, isHoriz: false, isVert: true  });
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

    // Parallel proximity / overlap
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

/**
 * Detects table grids, colors their border shapes red in-place, and returns
 * an array of table region descriptors for cell-level text classification.
 *
 * @param {Array<{type:string, [key:string]:any}>} shapes  Raw PDF shapes (mutated in place).
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,vertXPositions:number[],horizYPositions:number[]}>}
 */
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

    // Find connected components (BFS)
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

    // A valid table grid has ≥ 2 horizontal and ≥ 2 vertical lines.
    const tableRegions = [];

    for (const compIndices of components) {
        let horizCount = 0;
        let vertCount  = 0;
        for (const idx of compIndices) {
            if (segments[idx].isHoriz) horizCount++;
            if (segments[idx].isVert)  vertCount++;
        }

        if (horizCount >= 2 && vertCount >= 2) {
            // Color all border segments red.
            for (const idx of compIndices) {
                const shape = segments[idx].shape;
                if (shape.strokeColor !== null && shape.strokeColor !== undefined) {
                    shape.strokeColor = { r: 1, g: 0, b: 0 };
                }
                if (shape.fillColor !== null && shape.fillColor !== undefined) {
                    shape.fillColor = { r: 1, g: 0, b: 0 };
                }
            }

            // Collect bounding box and the sorted positions of each grid line
            // so the caller can do fast cell-level lookups.
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const vertXSet   = new Set();
            const horizYSet  = new Set();

            for (const idx of compIndices) {
                const s = segments[idx];
                minX = Math.min(minX, s.x1);
                minY = Math.min(minY, s.y1);
                maxX = Math.max(maxX, s.x2);
                maxY = Math.max(maxY, s.y2);

                // Round to nearest integer to merge near-duplicate lines.
                if (s.isVert)  vertXSet.add(Math.round((s.x1 + s.x2) / 2));
                if (s.isHoriz) horizYSet.add(Math.round((s.y1 + s.y2) / 2));
            }

            tableRegions.push({
                x1: minX,
                y1: minY,
                x2: maxX,
                y2: maxY,
                vertXPositions:  [...vertXSet].sort((a, b) => a - b),
                horizYPositions: [...horizYSet].sort((a, b) => a - b),
            });
        }
    }

    return tableRegions;
}

/**
 * Given a text element's coordinates and a table region, returns the
 * PDF-space cell bounding box `{ x1, y1, x2, y2 }` for that element.
 *
 * Uses the sorted vertical / horizontal line positions from the region
 * descriptor to find the nearest grid lines that surround the element.
 *
 * Returns null if the element does not fall inside the table.
 *
 * @param {{ x: number, y: number }} el    Text element (PDF bottom-left coords).
 * @param {object} region                  Table region from detectTablesAndColorRed.
 * @returns {{ x1:number, y1:number, x2:number, y2:number } | null}
 */
export function getCellBounds(el, region) {
    const CELL_PAD = TOLERANCE * 2;

    // Quick reject: element not inside this table region.
    if (el.x < region.x1 - CELL_PAD || el.x > region.x2 + CELL_PAD) return null;
    if (el.y < region.y1 - CELL_PAD || el.y > region.y2 + CELL_PAD) return null;

    const verts  = region.vertXPositions;
    const horizs = region.horizYPositions;

    // Find the largest vertical x ≤ el.x  (left cell wall)
    let cellX1 = region.x1;
    for (const vx of verts) {
        if (vx <= el.x + CELL_PAD) cellX1 = vx;
        else break;
    }

    // Find the smallest vertical x > el.x  (right cell wall)
    let cellX2 = region.x2;
    for (const vx of verts) {
        if (vx > el.x + CELL_PAD) { cellX2 = vx; break; }
    }

    // Find the largest horizontal y ≤ el.y  (bottom cell wall in PDF space)
    let cellY1 = region.y1;
    for (const hy of horizs) {
        if (hy <= el.y + CELL_PAD) cellY1 = hy;
        else break;
    }

    // Find the smallest horizontal y > el.y  (top cell wall in PDF space)
    let cellY2 = region.y2;
    for (const hy of horizs) {
        if (hy > el.y + CELL_PAD) { cellY2 = hy; break; }
    }

    return { x1: cellX1, y1: cellY1, x2: cellX2, y2: cellY2 };
}
