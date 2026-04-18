const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Image Storage Module
//
// Handles all persistence concerns for extracted PDF images:
//   • File-system writes (with SHA-256 deduplication)
//   • Optional MongoDB upsert via a pre-connected collection
//
// Background images are stored with a "bg_" filename prefix so they can be
// identified visually in the uploads directory without opening the files.
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
 * Writes a single image to disk and optionally upserts its metadata into
 * MongoDB.
 *
 * Skips the file write if an identical file (same SHA-256) already exists,
 * making the operation idempotent for repeated runs against the same PDF.
 *
 * @param {Buffer}      bytes      - Raw image bytes ready to write.
 * @param {string}      fileName   - Destination file name (with extension).
 * @param {object}      metadata   - { width, height, filter } from the PDF object.
 * @param {number}      objNum     - PDF object number (for logging and DB record).
 * @param {object|null} collection - MongoDB collection, or null to skip DB.
 * @param {object}      [extra={}] - Additional fields merged into the DB document.
 */
async function persistImage(bytes, fileName, metadata, objNum, collection, extra = {}) {
    const uploadsPath = ensureUploadsDir();
    const filePath = path.join(uploadsPath, fileName);
    const hash = generateHash(bytes);

    // ── File System ──────────────────────────────────────────────────────────
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, bytes);
    }

    // ── MongoDB (optional) ───────────────────────────────────────────────────
    if (collection) {
        await collection.updateOne(
            { hash },
            {
                $setOnInsert: {
                    hash,
                    file_path: filePath,
                    width: metadata.width,
                    height: metadata.height,
                    filter_type: metadata.filter,
                    extracted_at: new Date(),
                    ...extra
                }
            },
            { upsert: true }
        );
    }

    return filePath;
}

/**
 * Stores an array of regular (non-background) page images.
 *
 * Each image is saved as `<sha256><ext>` in the uploads directory.
 * Logs a summary line per image.
 *
 * @param {{ bytes: Buffer, metadata: object, extension: string, objNum: number }[]} imageDataArray
 * @param {object|null} collection - MongoDB collection, or null.
 */
async function storeImages(imageDataArray, collection) {
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
            const filePath = await persistImage(
                data.bytes,
                fileName,
                data.metadata,
                data.objNum,
                collection
            );

            const storage = collection ? 'Mongo + FS' : 'FS only';
            console.log(` -> Stored (${storage}): ${path.basename(filePath)}`);
        } catch (err) {
            console.error(` -> Error storing obj ${data.objNum}:`, err.message);
        }
    }
}

/**
 * Stores a single background image identified by the background extractor.
 *
 * The file is prefixed with "bg_" so it stands out in the uploads directory.
 * Example: uploads/bg_<sha256>.jpg
 *
 * @param {{ bytes: Buffer, metadata: object, extension: string, objNum: number, role: string }} imageData
 * @param {object|null} collection - MongoDB collection, or null.
 * @returns {string|null} Absolute path to the stored file, or null on failure.
 */
async function storeBackgroundImage(imageData, collection) {
    if (!imageData) {
        console.log('[Storage] No background image to store.');
        return null;
    }

    console.log('\n--- BACKGROUND IMAGE STORAGE ---');
    console.log(`Object ${imageData.objNum}: ${imageData.metadata.width}x${imageData.metadata.height} [${imageData.metadata.filter}]`);

    const hash = generateHash(imageData.bytes);
    const fileName = `bg_${hash}${imageData.extension}`;

    try {
        const filePath = await persistImage(
            imageData.bytes,
            fileName,
            imageData.metadata,
            imageData.objNum,
            collection,
            { role: 'background' } // extra DB field to tag the record
        );

        const storage = collection ? 'Mongo + FS' : 'FS only';
        console.log(` -> Background stored (${storage}): ${path.basename(filePath)}`);
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
