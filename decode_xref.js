const fs = require('fs');
const zlib = require('zlib');

function decodeXrefStream(pdfPath, objNum) {
    const bytes = fs.readFileSync(pdfPath);
    const pdfString = bytes.toString('binary');
    
    // Find the object
    const objHeader = `${objNum} 0 obj`;
    const startIdx = pdfString.indexOf(objHeader);
    if (startIdx === -1) {
        console.error(`Object ${objNum} not found.`);
        return;
    }
    
    // Find stream data
    const streamStart = pdfString.indexOf('stream', startIdx) + 6;
    const offset = bytes[streamStart] === 0x0d ? 2 : 1; // \r\n or \n
    const actualStreamStart = streamStart + offset;
    
    const streamEnd = pdfString.indexOf('endstream', actualStreamStart);
    const streamBytes = bytes.subarray(actualStreamStart, streamEnd);
    
    // Decompress FlateDecode
    let decompressed;
    try {
        decompressed = zlib.unzipSync(streamBytes);
    } catch (e) {
        console.error("Failed to decompress:", e);
        return;
    }
    
    // Decode Predictor 12 (PNG UP)
    // W[1 3 1] means 5 bytes per row.
    const columns = 5;
    // Predictor 12 (PNG UP filter) usually prefixes each row with a filter byte.
    // For Predictor >= 10, PDF uses PNG predictors. A row length is columns + 1.
    const rowLength = columns + 1;
    
    const decoded = Buffer.alloc(decompressed.length - (decompressed.length / rowLength));
    let decodedIdx = 0;
    
    let prevRow = Buffer.alloc(columns);
    
    for (let i = 0; i < decompressed.length; i += rowLength) {
        const filter = decompressed[i]; // 2 means UP filter
        const rowData = decompressed.subarray(i + 1, i + rowLength);
        const decodedRow = Buffer.alloc(columns);
        
        for (let c = 0; c < columns; c++) {
            if (filter === 2) {
                // UP filter: x + prior_row_x
                decodedRow[c] = (rowData[c] + prevRow[c]) & 0xFF;
            } else if (filter === 0 || filter === 1 || filter === 3 || filter === 4) {
                 // Fallback for other standard PNG filters if mixed (usually it's 2 for PDF UP)
                 // Just a naive fallback for filter 0 (None)
                 decodedRow[c] = rowData[c];
            }
        }
        
        decodedRow.copy(decoded, decodedIdx);
        decodedIdx += columns;
        prevRow = decodedRow;
    }
    
    // Format the decoded XRef data for reading
    // W[1 3 1] means:
    // Byte 0: Type (0=free, 1=in use, 2=compressed)
    // Byte 1-3: Field 2 (Offset or Object number)
    // Byte 4: Field 3 (Generation or Index)
    let outputText = "Type | Offset/Obj | Gen/Idx\n";
    outputText += "----------------------------\n";
    
    for (let i = 0; i < decoded.length; i += 5) {
        if (i + 5 > decoded.length) break;
        const type = decoded[i];
        const field2 = (decoded[i+1] << 16) | (decoded[i+2] << 8) | decoded[i+3];
        const field3 = decoded[i+4];
        
        outputText += `${type.toString().padStart(4)} | ${field2.toString().padStart(10)} | ${field3.toString().padStart(7)}\n`;
    }
    
    fs.writeFileSync('decoded_xref.txt', outputText);
    console.log('Successfully decoded XRef stream and saved to decoded_xref.txt');
}

decodeXrefStream('p1_english.pdf', 221);
