const { getObject } = require('../core/pdfObjectReader');
const { resolveDictOrRef } = require('../core/pdfDictionaryResolver');

function extractImageMetadata(imageObjStr) {
    try {
        const metadata = {};

        const widthMatch = imageObjStr.match(/\/Width\s+(\d+)/);
        if (widthMatch) metadata.width = parseInt(widthMatch[1]);

        const heightMatch = imageObjStr.match(/\/Height\s+(\d+)/);
        if (heightMatch) metadata.height = parseInt(heightMatch[1]);

        const colorSpaceMatch = imageObjStr.match(/\/ColorSpace\s+\/(\w+)/);
        if (colorSpaceMatch) metadata.colorSpace = colorSpaceMatch[1];

        const bitsPerComponentMatch = imageObjStr.match(/\/BitsPerComponent\s+(\d+)/);
        if (bitsPerComponentMatch) metadata.bitsPerComponent = parseInt(bitsPerComponentMatch[1]);

        const filterMatch = imageObjStr.match(/\/Filter\s+\/(\w+)/);
        if (filterMatch) metadata.filter = filterMatch[1];

        return metadata;
    } catch (err) {
        console.warn(`  [!] Warning: Failed to extract image metadata: ${err.message}`);
        return {};
    }
}

function findXObjects(buffer, pdfString, pageObjStr) {
    try {
        const resEntry = resolveDictOrRef(pageObjStr, '/Resources');
        if (!resEntry) {
            return {};
        }

        const resObj = resEntry.type === 'ref'
            ? getObject(buffer, pdfString, resEntry.value)
            : resEntry.value;

        const xobjectEntry = resolveDictOrRef(resObj, '/XObject');
        if (!xobjectEntry) {
            return {};
        }

        const xobjectDict = xobjectEntry.type === 'ref'
            ? getObject(buffer, pdfString, xobjectEntry.value)
            : xobjectEntry.value;

        const images = {};
        const xobjectMatches = xobjectDict.match(/\/(\w+)\s+(\d+\s+\d+\s+R)/g) || [];

        for (const match of xobjectMatches) {
            try {
                const parts = match.split(/\s+/);
                const objName = parts[0].replace('/', '');
                const objRef = parts.slice(1).join(' ');

                const xobjectObj = getObject(buffer, pdfString, objRef);

                if (xobjectObj.includes('/Subtype/Image') || xobjectObj.includes('/Subtype /Image')) {
                    const metadata = extractImageMetadata(xobjectObj);
                    images[objName] = {
                        ref: objRef,
                        type: 'Image',
                        metadata
                    };
                }
            } catch (err) {
                console.warn(`  [!] Warning: Failed to process XObject ${match}: ${err.message}`);
                continue;
            }
        }

        return images;
    } catch (err) {
        console.warn(`[!] Warning: Failed to find XObjects in page resources: ${err.message}`);
        return {};
    }
}

function processImages(images) {
    try {
        if (Object.keys(images).length === 0) {
            return;
        }

        console.log('\n--- IMAGES FOUND ---');
        for (const [name, imgData] of Object.entries(images)) {
            console.log(`\nImage ${name}:`);
            console.log(`  Type: ${imgData.type}`);
            console.log(`  Reference: ${imgData.ref}`);

            if (Object.keys(imgData.metadata).length > 0) {
                console.log('  Metadata:');
                for (const [key, value] of Object.entries(imgData.metadata)) {
                    console.log(`    ${key}: ${value}`);
                }
            } else {
                console.log('  Metadata: [Not extracted]');
            }
        }
    } catch (err) {
        console.warn(`[!] Warning: Failed to process images: ${err.message}`);
    }
}

module.exports = {
    extractImageMetadata,
    findXObjects,
    processImages
};
