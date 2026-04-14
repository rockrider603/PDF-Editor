function extractInlineDictionary(str, startIdx) {
    let depth = 0;
    let i = startIdx;

    while (i < str.length - 1) {
        const two = str.slice(i, i + 2);
        if (two === '<<') {
            depth++;
            i += 2;
            continue;
        }
        if (two === '>>') {
            depth--;
            i += 2;
            if (depth === 0) {
                return str.slice(startIdx, i);
            }
            continue;
        }
        i++;
    }
    throw new Error('Unterminated inline dictionary');
}

function resolveDictOrRef(objStr, key) {
    const keyIdx = objStr.indexOf(key);
    if (keyIdx === -1) return null;

    const afterKey = objStr.slice(keyIdx + key.length).trimStart();
    const refMatch = afterKey.match(/^(\d+\s+\d+\s+R)/);
    if (refMatch) {
        return { type: 'ref', value: refMatch[1] };
    }

    if (afterKey.startsWith('<<')) {
        const dictStart = keyIdx + key.length + (objStr.slice(keyIdx + key.length).length - afterKey.length);
        const dict = extractInlineDictionary(objStr, dictStart);
        return { type: 'dict', value: dict };
    }

    return null;
}

module.exports = {
    extractInlineDictionary,
    resolveDictOrRef
};
