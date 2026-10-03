// Read dimensions before allocating decoded pixels. EXIF orientation remains browser-owned.
export function photoDimensions(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes[0] === 137 && bytes[1] === 80 && bytes.length >= 24)
        return { width: view.getUint32(16), height: view.getUint32(20) };
    if (bytes[0] !== 255 || bytes[1] !== 216)
        throw Error("unsupported");
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset++] !== 255)
            throw Error("invalid jpeg");
        while (bytes[offset] === 255)
            offset++;
        const marker = bytes[offset++];
        if (marker === 218 || marker === 217)
            break;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length)
            break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
            return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
        offset += length;
    }
    throw Error("missing dimensions");
}
export function decodeWidth(width: number, height: number) {
    if (!width || !height || width * height > 80000000 || Math.max(width, height) / Math.min(width, height) > 8)
        throw Error("too large");
    // Conservative for either EXIF axis order: the retained longest side stays <= 2160.
    return Math.max(1, Math.floor(Math.min(width, height, 2160 * Math.min(width, height) / Math.max(width, height))));
}
