function parseCMap(cmapText) {
    const map = {};
    const lines = cmapText.split('\n');
    let inSection = null;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === 'beginbfchar' || trimmed.endsWith('beginbfchar')) {
            inSection = 'bfchar';
            continue;
        } else if (trimmed === 'endbfchar' || trimmed.endsWith('endbfchar')) {
            inSection = null;
            continue;
        } else if (trimmed === 'beginbfrange' || trimmed.endsWith('beginbfrange')) {
            inSection = 'bfrange';
            continue;
        } else if (trimmed === 'endbfrange' || trimmed.endsWith('endbfrange')) {
            inSection = null;
            continue;
        }

        if (inSection === 'bfchar') {
            const charMatch = trimmed.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
            if (charMatch) {
                const srcCode = charMatch[1].toUpperCase();
                const unicodeHex = charMatch[2];
                map[srcCode] = unicodeHex;
            }
        } else if (inSection === 'bfrange') {
            const rangeMatch = trimmed.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
            if (rangeMatch) {
                const srcWidth = rangeMatch[1].length;
                let startSrc = parseInt(rangeMatch[1], 16);
                const endSrc = parseInt(rangeMatch[2], 16);
                let startUni = parseInt(rangeMatch[3], 16);

                while (startSrc <= endSrc) {
                    const srcHex = startSrc.toString(16).toUpperCase().padStart(srcWidth, '0');
                    const uniHex = startUni.toString(16).toUpperCase().padStart(4, '0');
                    map[srcHex] = uniHex;
                    startSrc++;
                    startUni++;
                }
            }
        }
    }
    return map;
}

function decodeUnicodeHex(unicodeHex) {
    const normalized = (unicodeHex || '').toUpperCase();
    if (!normalized || normalized.length % 4 !== 0) {
        return '';
    }

    let out = '';
    for (let i = 0; i < normalized.length; i += 4) {
        const chunk = normalized.slice(i, i + 4);
        out += String.fromCharCode(parseInt(chunk, 16));
    }
    return out;
}

function buildCharMap(cmapMap) {
    const charMap = {};
    for (const [glyphId, unicodeHex] of Object.entries(cmapMap)) {
        const padded = glyphId.toUpperCase();
        const char = decodeUnicodeHex(unicodeHex);
        charMap[padded] = char;
    }
    return charMap;
}

function getCMapCodeLengths(cmapMap) {
    const lengths = new Set();
    for (const key of Object.keys(cmapMap)) {
        lengths.add(key.length);
    }
    return Array.from(lengths).sort((a, b) => b - a);
}

function translateText(cmapMap, hexString) {
    let result = '';
    const cleaned = hexString.replace(/[<>]/g, '').toUpperCase();
    const codeLengths = getCMapCodeLengths(cmapMap);
    const fallbackLength = codeLengths.length ? codeLengths[codeLengths.length - 1] : 2;

    let idx = 0;
    while (idx < cleaned.length) {
        let matched = false;

        for (const len of codeLengths) {
            if (idx + len > cleaned.length) continue;
            const code = cleaned.slice(idx, idx + len);
            if (cmapMap[code]) {
                result += decodeUnicodeHex(cmapMap[code]);
                idx += len;
                matched = true;
                break;
            }
        }

        if (!matched) {
            const next = cleaned.slice(idx, idx + fallbackLength);
            result += `[?${next}]`;
            idx += fallbackLength;
        }
    }
    return result;
}

module.exports = {
    parseCMap,
    buildCharMap,
    decodeUnicodeHex,
    getCMapCodeLengths,
    translateText
};
