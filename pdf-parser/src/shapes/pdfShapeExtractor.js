/**
 * pdfShapeExtractor.js
 *
 * Parses vector graphics operators from a decompressed PDF content stream and
 * returns an array of shape descriptors usable by the frontend renderer.
 *
 * Recognised operators
 * ──────────────────────────────────────────────────────────────────────────
 *  Path construction:
 *    x y m          — moveto (start a new subpath)
 *    x y l          — lineto
 *    x y w h re     — rectangle (append closed rect subpath)
 *
 *  Path painting:
 *    S              — stroke the path
 *    s              — close + stroke
 *    f / F          — fill
 *    B              — fill + stroke
 *    n              — end path (no paint — clipping only; we discard)
 *
 *  Graphics state:
 *    w              — line width
 *    RG r g b       — stroke colour (DeviceRGB)
 *    rg r g b       — fill colour   (DeviceRGB)
 *    q / Q          — save / restore graphics state
 *    cm a b c d e f — concat current transform matrix
 *
 * Returned shape types
 * ──────────────────────────────────────────────────────────────────────────
 *  { type:'line',   x1, y1, x2, y2, strokeColor, lineWidth }
 *  { type:'rect',   x,  y,  width, height, strokeColor, fillColor, lineWidth }
 *  { type:'path',   points:[{x,y}], strokeColor, fillColor, lineWidth }
 *
 * All coordinates are in PDF user-space (bottom-left origin, points).
 *
 * @param {string} contentStream — decompressed content stream text.
 * @returns {Array<{type:string, [key:string]:any}>}
 */
export function extractShapes(contentStream) {
    const shapes = [];

    // ── Graphics state stack ──────────────────────────────────────────────────
    const defaultState = () => ({
        lineWidth: 1,
        strokeColor: { r: 0, g: 0, b: 0 },
        fillColor:   { r: 0, g: 0, b: 0 },
    });

    let state = defaultState();
    const stateStack = [];

    // ── Current path accumulator ──────────────────────────────────────────────
    // Points collected since the last moveto / re
    let pathPoints = [];  // [{x,y}]
    let hasPath = false;

    // Convenience: make a deep clone of the current state.
    const cloneState = (s) => ({
        lineWidth:   s.lineWidth,
        strokeColor: { ...s.strokeColor },
        fillColor:   { ...s.fillColor },
    });

    // ── Emit helpers ──────────────────────────────────────────────────────────
    const strokeShape = () => {
        if (!hasPath || pathPoints.length < 2) return;
        if (pathPoints.length === 2) {
            const [p0, p1] = pathPoints;
            shapes.push({
                type: 'line',
                x1: p0.x, y1: p0.y,
                x2: p1.x, y2: p1.y,
                strokeColor: { ...state.strokeColor },
                lineWidth: state.lineWidth,
            });
        } else {
            shapes.push({
                type: 'path',
                points: [...pathPoints],
                strokeColor: { ...state.strokeColor },
                fillColor: null,
                lineWidth: state.lineWidth,
            });
        }
    };

    const fillShape = () => {
        if (!hasPath || pathPoints.length < 3) return;
        shapes.push({
            type: 'path',
            points: [...pathPoints],
            strokeColor: null,
            fillColor: { ...state.fillColor },
            lineWidth: state.lineWidth,
        });
    };

    const fillStrokeShape = () => {
        if (!hasPath || pathPoints.length < 2) return;
        shapes.push({
            type: 'path',
            points: [...pathPoints],
            strokeColor: { ...state.strokeColor },
            fillColor: { ...state.fillColor },
            lineWidth: state.lineWidth,
        });
    };

    const clearPath = () => {
        pathPoints = [];
        hasPath = false;
    };

    // ── Token scanner ─────────────────────────────────────────────────────────
    // We tokenise line-by-line first, then process each token stream.
    // PDF operands are always numeric; operators are one or two letters (+ *).
    //
    // Strategy: keep a small operand stack; when we hit a known operator string
    // consume the correct number of operands from the back of the stack.
    const NUM  = /^-?[\d]+(?:\.[\d]+)?(?:e[+-]?[\d]+)?$/i;
    const operandStack = [];  // strings/numbers from tokens before an operator

    const consume = (n) => operandStack.splice(operandStack.length - n, n).map(parseFloat);

    const lines = contentStream.split(/\r?\n/);
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('%')) continue;

        // Split on whitespace, but respect PDF strings (rare in graphics streams).
        const tokens = trimmed.split(/\s+/);

        for (const tok of tokens) {
            if (NUM.test(tok)) {
                operandStack.push(tok);
                continue;
            }

            switch (tok) {
                // ── Graphics state ────────────────────────────────────────────
                case 'q':
                    stateStack.push(cloneState(state));
                    break;
                case 'Q':
                    if (stateStack.length > 0) state = stateStack.pop();
                    break;
                case 'w': {
                    const [lw] = consume(1);
                    if (!isNaN(lw)) state.lineWidth = lw;
                    break;
                }
                case 'RG': {
                    const [r, g, b] = consume(3);
                    if (!isNaN(r)) state.strokeColor = { r, g, b };
                    break;
                }
                case 'rg': {
                    const [r, g, b] = consume(3);
                    if (!isNaN(r)) state.fillColor = { r, g, b };
                    break;
                }
                case 'G': {                       // grey stroke
                    const [gr] = consume(1);
                    if (!isNaN(gr)) state.strokeColor = { r: gr, g: gr, b: gr };
                    break;
                }
                case 'g': {                       // grey fill
                    const [gr] = consume(1);
                    if (!isNaN(gr)) state.fillColor = { r: gr, g: gr, b: gr };
                    break;
                }
                case 'cm': {                      // transform matrix — discard operands
                    consume(6);
                    break;
                }

                // ── Path construction ─────────────────────────────────────────
                case 'm': {                       // moveto
                    const [x, y] = consume(2);
                    if (!isNaN(x)) {
                        // A new "m" starts a new subpath; commit the old one.
                        clearPath();
                        pathPoints.push({ x, y });
                        hasPath = true;
                    }
                    break;
                }
                case 'l': {                       // lineto
                    const [x, y] = consume(2);
                    if (!isNaN(x) && hasPath) pathPoints.push({ x, y });
                    break;
                }
                case 're': {                      // rectangle shorthand
                    const [x, y, w, h] = consume(4);
                    if (!isNaN(x)) {
                        // rectangles are self-contained subpaths
                        clearPath();
                        pathPoints = [
                            { x, y },
                            { x: x + w, y },
                            { x: x + w, y: y + h },
                            { x, y: y + h },
                            { x, y },              // closed
                        ];
                        hasPath = true;
                    }
                    break;
                }
                case 'h':                         // closepath — just close, no paint
                    if (hasPath && pathPoints.length > 0) {
                        pathPoints.push({ ...pathPoints[0] });
                    }
                    break;

                // ── Path painting ─────────────────────────────────────────────
                case 'S':                         // stroke
                    strokeShape();
                    clearPath();
                    break;
                case 's':                         // close + stroke
                    if (hasPath && pathPoints.length > 0) pathPoints.push({ ...pathPoints[0] });
                    strokeShape();
                    clearPath();
                    break;
                case 'f':
                case 'F':
                case 'f*':                        // fill (even-odd)
                    fillShape();
                    clearPath();
                    break;
                case 'B':
                case 'B*':                        // fill + stroke
                    fillStrokeShape();
                    clearPath();
                    break;
                case 'b':
                case 'b*':                        // close + fill + stroke
                    if (hasPath && pathPoints.length > 0) pathPoints.push({ ...pathPoints[0] });
                    fillStrokeShape();
                    clearPath();
                    break;
                case 'n':                         // no paint (clip path only)
                    clearPath();
                    break;

                default:
                    // Unknown operator: clear operand stack so we don't
                    // corrupt subsequent coordinate parsing.
                    operandStack.length = 0;
                    break;
            }
        }
    }

    // ── Normalise shapes ──────────────────────────────────────────────────────
    // Convert closed 5-point rectangles (from `re`) into type:'rect'.
    return shapes.map(normalise).filter(Boolean);
}

/**
 * Normalise a raw shape into the canonical form consumed by the frontend.
 *
 * Converts 4-or-5-point closed paths that form an axis-aligned rectangle into
 * a `type:'rect'` descriptor. Everything else passes through unchanged.
 *
 * @param {object} shape
 * @returns {object|null}
 */
function normalise(shape) {
    if (shape.type !== 'path') return shape;

    const pts = shape.points.filter(
        (p, i) => i === 0 || p.x !== shape.points[i - 1].x || p.y !== shape.points[i - 1].y
    );

    // A rect subpath from `re` produces 5 pts (last === first, already closed).
    const core = pts[pts.length - 1] && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y
        ? pts.slice(0, -1)
        : pts;

    if (core.length === 4) {
        const xs = core.map(p => p.x);
        const ys = core.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const w = maxX - minX, h = maxY - minY;
        const isRect = core.every(p =>
            (p.x === minX || p.x === maxX) && (p.y === minY || p.y === maxY)
        );
        if (isRect && w > 0 && h > 0) {
            return {
                type: 'rect',
                x: minX, y: minY,
                width: w, height: h,
                strokeColor: shape.strokeColor,
                fillColor:   shape.fillColor,
                lineWidth:   shape.lineWidth,
            };
        }
    }

    // Check line (2-point path with no fill)
    if (core.length === 2) {
        return {
            type: 'line',
            x1: core[0].x, y1: core[0].y,
            x2: core[1].x, y2: core[1].y,
            strokeColor: shape.strokeColor,
            lineWidth: shape.lineWidth,
        };
    }

    return shape;
}
