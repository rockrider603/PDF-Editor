const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Image Storage Module
//
// Handles persistence for extracted PDF images:
//   • File-system writes to `uploads/` (with SHA-256 deduplication)
//   • Metadata for each image is saved as a companion .json file.
//
// Background images are stored with a "bg_" filename prefix so they can be
// identified visually.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a SHA-256 hex digest of a Buffer.
 * Used as a deterministic, content-addressable file name to avoid duplicates.
 *
 * @param {Buffer} buffer
 * @returns {string} 64-character hex string
 */
function generateHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Returns the absolute path to the `uploads/` directory, creating it if it
 * does not already exist.
 *
 * @returns {string} Absolute path to uploads directory.
 */
function ensureUploadsDir() {
    const uploadsPath = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsPath)) {
        fs.mkdirSync(uploadsPath, { recursive: true });
    }
    return uploadsPath;
}

/**
 * Writes a single image and its metadata JSON to disk.
 *
 * Skips the file write if an identical file (same SHA-256) already exists.
 *
 * @param {Buffer}      bytes      - Raw image bytes ready to write.
 * @param {string}      hash       - SHA-256 hash of the bytes.
 * @param {string}      fileName   - Destination file name (with extension).
 * @param {object}      metadata   - { width, height, filter, length } from the PDF object.
 * @param {number}      objNum     - PDF object number (for logging).
 * @param {object}      [extra={}] - Additional fields for the JSON metadata.
 */
function persistImage(bytes, hash, fileName, metadata, objNum, extra = {}) {
    const uploadsPath = ensureUploadsDir();
    const filePath = path.join(uploadsPath, fileName);
    const metaPath = path.join(uploadsPath, `${fileName}.json`);

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, bytes);
        
        // Save companion metadata JSON
        const metaDoc = {
            hash,
            file_name: fileName,
            original_object: objNum,
            width: metadata.width,
            height: metadata.height,
            filter_type: metadata.filter,
            extracted_at: new Date().toISOString(),
            ...extra
        };
        fs.writeFileSync(metaPath, JSON.stringify(metaDoc, null, 2));
    }

    return filePath;
}

/**
 * Stores an array of regular (non-background) page images.
 *
 * @param {{ bytes: Buffer, metadata: object, extension: string, objNum: number }[]} imageDataArray
 */
function storeImages(imageDataArray) {
    if (imageDataArray.length === 0) {
        console.log('[Storage] No regular images to store.');
        return;
    }

    console.log('\n--- IMAGE STORAGE REPORT ---');

    for (const data of imageDataArray) {
        const hash = generateHash(data.bytes);
        const fileName = `${hash}${data.extension}`;

        console.log(`Object ${data.objNum}: ${data.metadata.width}x${data.metadata.height} [${data.metadata.filter}]`);

        try {
            const filePath = persistImage(
                data.bytes,
                hash,
                fileName,
                data.metadata,
                data.objNum,
                {
                    role: data.role || 'image',
                    format: data.format,
                    appearances: data.appearances || []
                }
            );
            console.log(` -> Stored: ${path.basename(filePath)}`);
        } catch (err) {
            console.error(` -> Error storing obj ${data.objNum}:`, err.message);
        }
    }
}

/**
 * Stores a single background image.
 * The file is prefixed with "bg_".
 *
 * @param {{ bytes: Buffer, metadata: object, extension: string, objNum: number, role: string }} imageData
 * @returns {string|null} Absolute path to the stored file.
 */
function storeBackgroundImage(imageData) {
    if (!imageData) {
        console.log('[Storage] No background image to store.');
        return null;
    }

    console.log('\n--- BACKGROUND IMAGE STORAGE ---');
    console.log(`Object ${imageData.objNum}: ${imageData.metadata.width}x${imageData.metadata.height} [${imageData.metadata.filter}]`);

    const hash = generateHash(imageData.bytes);
    const fileName = `bg_${hash}${imageData.extension}`;

    try {
        const filePath = persistImage(
            imageData.bytes,
            hash,
            fileName,
            imageData.metadata,
            imageData.objNum,
            { 
                role: imageData.role || 'background',
                format: imageData.format,
                appearances: imageData.appearances || []
            }
        );
        console.log(` -> Background stored: ${path.basename(filePath)}`);
        return filePath;
    } catch (err) {
        console.error(` -> Error storing background (obj ${imageData.objNum}):`, err.message);
        return null;
    }
}

module.exports = {
    storeImages,
    storeBackgroundImage
};
