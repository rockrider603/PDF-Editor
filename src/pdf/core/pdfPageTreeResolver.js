const { PDF_REGEX } = require('../utils/pdfRegex');

function findRootRef(data) {
    const trailerIdx = data.lastIndexOf('trailer');
    if (trailerIdx === -1) throw new Error('Trailer section not found');
    const trailerChunk = data.substring(trailerIdx, data.indexOf('>>', trailerIdx) + 2);
    const match = trailerChunk.match(PDF_REGEX.core.rootRef);
    if (!match) throw new Error('Root reference not found in trailer');
    return match[1];
}

function extractFirstKid(pagesObjStr, refId) {
    const kidsMatch = pagesObjStr.match(PDF_REGEX.core.kidsArray);
    if (!kidsMatch) throw new Error(`Failed to find /Kids array in Pages object ${refId}`);
    const refs = kidsMatch[1].trim().split(PDF_REGEX.common.whitespace);
    return `${refs[0]} ${refs[1]} ${refs[2]}`;
}

module.exports = {
    findRootRef,
    extractFirstKid
};
