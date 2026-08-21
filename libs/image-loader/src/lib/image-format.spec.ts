import { describe, it, expect } from 'vitest';
import { sniffImageFormat, imageDimensions } from './image-format.js';
import { PNG_1X1, GIF_1X1, WEBP_1X1, JPEG_1X1 } from './test-fixtures.js';

// Synthetic headers with non-trivial dimensions, built byte-by-byte
// from each format's spec so expected values are independent of the
// parser under test.

function pngHeader(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(26);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); // IHDR length
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function gifHeader(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0);
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function jpegWithSof0(width: number, height: number): Uint8Array {
  // SOI, APP0 (minimal), SOF0 with height/width, EOI
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof0 = Buffer.alloc(10);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(8, 2); // segment length
  sof0[4] = 8; // precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 1; // component count
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof0,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function webpVp8x(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0);
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8);
  b.write('VP8X', 12);
  b.writeUInt32LE(10, 16); // chunk size
  // canvas width/height are 24-bit little-endian, stored minus one
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

describe('sniffImageFormat', () => {
  it('recognizes png', () => expect(sniffImageFormat(PNG_1X1)).toBe('png'));
  it('recognizes gif', () => expect(sniffImageFormat(GIF_1X1)).toBe('gif'));
  it('recognizes webp', () => expect(sniffImageFormat(WEBP_1X1)).toBe('webp'));
  it('recognizes jpeg', () => expect(sniffImageFormat(JPEG_1X1)).toBe('jpeg'));
  it('returns null for other bytes', () =>
    expect(sniffImageFormat(Buffer.from('hello world'))).toBeNull());
  it('returns null for empty input', () =>
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull());
});

describe('imageDimensions', () => {
  it('parses PNG IHDR', () =>
    expect(imageDimensions(pngHeader(640, 480))).toEqual({
      width: 640,
      height: 480,
    }));

  it('parses GIF logical screen descriptor', () =>
    expect(imageDimensions(gifHeader(320, 200))).toEqual({
      width: 320,
      height: 200,
    }));

  it('parses JPEG SOF0', () =>
    expect(imageDimensions(jpegWithSof0(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    }));

  it('parses WebP VP8X canvas size', () =>
    expect(imageDimensions(webpVp8x(800, 600))).toEqual({
      width: 800,
      height: 600,
    }));

  it('parses the real 1x1 fixtures', () => {
    expect(imageDimensions(PNG_1X1)).toEqual({ width: 1, height: 1 });
    expect(imageDimensions(GIF_1X1)).toEqual({ width: 1, height: 1 });
    expect(imageDimensions(JPEG_1X1)).toEqual({ width: 1, height: 1 });
    expect(imageDimensions(WEBP_1X1)).toEqual({ width: 1, height: 1 });
  });

  it('returns null for unknown bytes', () =>
    expect(imageDimensions(Buffer.from('not an image'))).toBeNull());
});
