const path = require('path');
const { hashBytes, writeImageToDisk } = require('../storage/fileStore');

/**
 * Builds the metadata document saved alongside each image file.
 *
 * @param {string} hash
 * @param {string} fileName
 * @param {number} objNum
 * @param {object} metadata  - { width, height, filter }
 * @param {object} extra     - { role, format, appearances }
 * @returns {object}
 */
function buildMetaDoc(hash, fileName, objNum, metadata, extra) {
    return {
        hash,
        file_name:        fileName,
        original_object:  objNum,
        width:            metadata.width,
        height:           metadata.height,
        filter_type:      metadata.filter,
        extracted_at:     new Date().toISOString(),
        ...extra
    };
}

/**
 * Persists a single image to disk and logs the result.
 *
 * @param {object} image     - Decoded image from imageScanner / backgroundDetector.
 * @param {string} [prefix]  - Optional filename prefix (e.g. "bg_").
 */
function persistImage(image, prefix = '') {
    const hash     = hashBytes(image.bytes);
    const fileName = `${prefix}${hash}${image.extension}`;
    const metaDoc  = buildMetaDoc(hash, fileName, image.objNum, image.metadata, {
        role:        image.role,
        format:      image.format,
        appearances: image.appearances || []
    });

    const filePath = writeImageToDisk(fileName, image.bytes, metaDoc);
    console.log(` -> Stored: ${path.basename(filePath)}`);
}

/**
 * Persists all regular (non-background) page images.
 *
 * @param {object[]} images
 */
function storePageImages(images) {
    if (images.length === 0) {
        console.log('[Storage] No regular images to store.');
        return;
    }

    console.log('\n--- IMAGE STORAGE REPORT ---');
    for (const image of images) {
        console.log(`Object ${image.objNum}: ${image.metadata.width}x${image.metadata.height} [${image.metadata.filter}]`);
        try {
            persistImage(image);
        } catch (err) {
            console.error(` -> Failed to store obj ${image.objNum}: ${err.message}`);
        }
    }
}

/**
 * Persists the background image with a "bg_" filename prefix.
 *
 * @param {object|null} image
 */
function storeBackgroundImage(image) {
    if (!image) {
        console.log('[Storage] No background image to store.');
        return;
    }

    console.log('\n--- BACKGROUND IMAGE STORAGE ---');
    console.log(`Object ${image.objNum}: ${image.metadata.width}x${image.metadata.height} [${image.metadata.filter}]`);

    try {
        persistImage(image, 'bg_');
    } catch (err) {
        console.error(` -> Failed to store background (obj ${image.objNum}): ${err.message}`);
    }
}

module.exports = {
    storePageImages,
    storeBackgroundImage
};
