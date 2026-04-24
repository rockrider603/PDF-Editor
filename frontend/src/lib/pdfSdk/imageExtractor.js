/**
 * Extracts all images from a PDF page and returns them as positioned entries
 * with base64 data URLs ready for <img> rendering.
 *
 * Strategy:
 *  1. Get the operator list for the page
 *  2. Find all PAINT_IMAGE_X_OBJECT operators (op 82)
 *  3. For each, read the image object from page.objs
 *  4. Draw it to an offscreen <canvas> → toDataURL()
 *  5. Read the preceding Transform Matrix (cm) for position/size
 *
 * The current CTM is maintained by walking the operator list and
 * tracking every SET_TRANSFORM operator (op 92).
 *
 * Coordinate note: PDF origin is bottom-left, CSS is top-left.
 * The Y-flip is done in PDFViewer using:
 *   canvasY = (pageHeight - y - renderedHeight) * scale
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {number} pageHeight  PDF page height in points (for role detection)
 * @returns {Promise<Array<{
 *   dataUrl: string,
 *   x: number,
 *   y: number,
 *   renderedWidth: number,
 *   renderedHeight: number,
 *   role: 'background' | 'image'
 * }>>}
 */
export async function extractImages(page, pageHeight) {
  const opList = await page.getOperatorList();
  const { OPS } = await import('pdfjs-dist');

  const results = [];

  // Current Transform Matrix stack — 6-element affine [a,b,c,d,e,f]
  let currentMatrix = [1, 0, 0, 1, 0, 0];
  const matrixStack = [];

  const ops = opList.fnArray;
  const args = opList.argsArray;

  const imagePromises = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    // Save/Restore graphics state — maintain matrix stack
    if (op === OPS.save) {
      matrixStack.push([...currentMatrix]);
    } else if (op === OPS.restore) {
      if (matrixStack.length > 0) currentMatrix = matrixStack.pop();

    // Set Transform Matrix (cm operator) — multiply onto current
    } else if (op === OPS.transform) {
      const [a, b, c, d, e, f] = args[i];
      currentMatrix = multiplyMatrix(currentMatrix, [a, b, c, d, e, f]);

    // Paint image XObject (Do operator for images)
    } else if (op === OPS.paintImageXObject || op === OPS.paintImageXObjectRepeat) {
      const objId = args[i][0];
      const matrix = [...currentMatrix];

      // Images may not be ready yet — resolve asynchronously
      const promise = resolveImageObject(page, objId).then((imgData) => {
        if (!imgData) return null;

        const dataUrl = imageDataToDataUrl(imgData);
        if (!dataUrl) return null;

        // CTM components: [a,b,c,d,tx,ty]
        // Rendered size = |a| × |d|, position = (tx, ty)
        const renderedWidth  = Math.abs(matrix[0]);
        const renderedHeight = Math.abs(matrix[3]);
        const x = matrix[4];
        const y = matrix[5];

        const pageArea = renderedWidth * renderedHeight;
        const coverage = pageArea / (page.view[2] * page.view[3]);
        const role = coverage >= 0.8 ? 'background' : 'image';

        return { dataUrl, x, y, renderedWidth, renderedHeight, role };
      }).catch(() => null);

      imagePromises.push(promise);
    }
  }

  const resolved = await Promise.all(imagePromises);
  for (const entry of resolved) {
    if (entry) results.push(entry);
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Multiplies two 2D affine matrices (each 6-element [a,b,c,d,e,f]).
 * Returns the product matrix.
 */
function multiplyMatrix([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) {
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * Resolves a pdfjs image object by its ID.
 * Returns an ImageData-like object or null.
 */
function resolveImageObject(page, objId) {
  return new Promise((resolve) => {
    if (page.objs.has(objId)) {
      resolve(page.objs.get(objId));
    } else {
      page.objs.get(objId, (data) => resolve(data));
    }
  });
}

/**
 * Converts a pdfjs image data object to a base64 data URL via an offscreen canvas.
 * Returns null if the data cannot be rendered.
 */
function imageDataToDataUrl(imgData) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width  = imgData.width;
    canvas.height = imgData.height;
    const ctx = canvas.getContext('2d');

    // imgData.data is a Uint8ClampedArray of RGBA pixels
    const imageData = new ImageData(
      new Uint8ClampedArray(imgData.data),
      imgData.width,
      imgData.height
    );
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
