const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

/**
 * Ensures the uploads directory exists, creating it if needed.
 * @returns {string} Absolute path to the uploads directory.
 */
function ensureUploadsDir() {
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    return UPLOADS_DIR;
}

/**
 * Computes a SHA-256 content hash to use as a deterministic, dedup-safe filename.
 * @param {Buffer} bytes
 * @returns {string}
 */
function hashBytes(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Writes raw image bytes and a companion JSON metadata file to the uploads directory.
 * Skips the write if the file already exists (content-addressable deduplication).
 *
 * @param {string}  fileName    - Final filename including extension (e.g. "abc123.jpg").
 * @param {Buffer}  bytes       - Raw image bytes.
 * @param {object}  metaDoc     - Metadata object to serialize as JSON.
 * @returns {string} Absolute path to the written image file.
 */
function writeImageToDisk(fileName, bytes, metaDoc) {
    ensureUploadsDir();
    const filePath = path.join(UPLOADS_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, bytes);
        fs.writeFileSync(`${filePath}.json`, JSON.stringify(metaDoc, null, 2));
    }

    return filePath;
}

module.exports = {
    hashBytes,
    writeImageToDisk
};
