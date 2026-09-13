// Format sniffing + header-only dimension parsing. Dimensions come
// straight from the container headers so callers can size placements
// before (or without) a full pixel decode.

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';

export interface ImageSize {
  width: number;
  height: number;
}

export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 8) {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (png.every((v, i) => bytes[i] === v)) return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'jpeg';
  }
  if (bytes.length >= 6) {
    const sig = String.fromCharCode(...bytes.subarray(0, 6));
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'gif';
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.subarray(0, 4));
    const webp = String.fromCharCode(...bytes.subarray(8, 12));
    if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  }
  return null;
}

export function imageDimensions(bytes: Uint8Array): ImageSize | null {
  const format = sniffImageFormat(bytes);
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    switch (format) {
      case 'png':
        return pngDimensions(b);
      case 'jpeg':
        return jpegDimensions(b);
      case 'gif':
        return gifDimensions(b);
      case 'webp':
        return webpDimensions(b);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function pngDimensions(b: Buffer): ImageSize | null {
  // 8-byte signature, then the IHDR chunk: length(4) type(4) width(4) height(4)
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegDimensions(b: Buffer): ImageSize | null {
  // Walk marker segments until a start-of-frame (SOF0/1/2) header.
  let off = 2;
  while (off + 9 <= b.length) {
    if (b[off] !== 0xff) return null;
    const marker = b[off + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      off += 2; // standalone marker, no length
      continue;
    }
    const len = b.readUInt16BE(off + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: b.readUInt16BE(off + 5),
        width: b.readUInt16BE(off + 7),
      };
    }
    off += 2 + len;
  }
  return null;
}

function gifDimensions(b: Buffer): ImageSize | null {
  if (b.length < 10) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webpDimensions(b: Buffer): ImageSize | null {
  if (b.length < 30) return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    // 24-bit little-endian canvas size, stored minus one
    return {
      width: b.readUIntLE(24, 3) + 1,
      height: b.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === 'VP8 ') {
    // Lossy: frame header at chunk payload; look for the sync code
    // 0x9d 0x01 0x2a followed by 14-bit width/height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature byte 0x2f then 14-bit fields, stored minus one
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}
