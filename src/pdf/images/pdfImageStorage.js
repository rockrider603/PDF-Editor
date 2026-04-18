const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Ensures we don't store the same image twice.
 */
function generateHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Ensures the uploads directory exists relative to the project root.
 */
function ensureUploadsDir() {
    const uploadsPath = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsPath)) {
        fs.mkdirSync(uploadsPath, { recursive: true });
    }
    return uploadsPath;
}

/**
 * Neat Display and Storage (FS and MongoDB)
 */
async function storeImages(imageDataArray, collection) {
    if (imageDataArray.length === 0) {
        console.log("No images detected to store.");
        return;
    }

    const uploadsPath = ensureUploadsDir();
    console.log('\n--- IMAGE STORAGE REPORT ---');

    for (const data of imageDataArray) {
        const hash = generateHash(data.bytes);
        const fileName = `${hash}${data.extension}`;
        const filePath = path.join(uploadsPath, fileName);

        console.log(`Object ${data.objNum}: ${data.metadata.width}x${data.metadata.height} [${data.metadata.filter}]`);

        try {
            // 1. Save to File System
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, data.bytes);
            }

            // 2. Save to MongoDB
            if (collection) {
                await collection.updateOne(
                    { hash: hash },
                    {
                        $setOnInsert: {
                            hash: hash,
                            file_path: filePath,
                            width: data.metadata.width,
                            height: data.metadata.height,
                            filter_type: data.metadata.filter,
                            extracted_at: new Date()
                        }
                    },
                    { upsert: true }
                );
                console.log(` -> Stored in Mongo & FS: ${fileName}`);
            } else {
                console.log(` -> Stored in FS: ${fileName}`);
            }
        } catch (err) {
            console.error(` -> Error storing ${data.objNum}:`, err.message);
        }
    }
}

module.exports = {
    storeImages
};
