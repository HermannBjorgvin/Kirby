import { describe, it, expect } from 'vitest';
import { decodeImage } from './decode-image.js';
import { PNG_1X1, GIF_1X1, WEBP_1X1, JPEG_1X1 } from './test-fixtures.js';

describe('decodeImage', () => {
  it('passes PNG bytes through untouched (kitty renders PNG natively)', () => {
    const d = decodeImage(PNG_1X1);
    expect(d).toMatchObject({ format: 'png', width: 1, height: 1 });
    expect(d && 'png' in d && Buffer.from(d.png).equals(PNG_1X1)).toBe(true);
  });

  it('decodes JPEG to RGBA', () => {
    const d = decodeImage(JPEG_1X1);
    expect(d).toMatchObject({ format: 'jpeg', width: 1, height: 1 });
    expect(d && 'rgba' in d && d.rgba.length).toBe(4);
  });

  it('decodes the first GIF frame to RGBA', () => {
    const d = decodeImage(GIF_1X1);
    expect(d).toMatchObject({ format: 'gif', width: 1, height: 1 });
    expect(d && 'rgba' in d && d.rgba.length).toBe(4);
  });

  it('decodes WebP to RGBA', () => {
    const d = decodeImage(WEBP_1X1);
    expect(d).toMatchObject({ format: 'webp', width: 1, height: 1 });
    expect(d && 'rgba' in d && d.rgba.length).toBe(4);
  });

  it('returns null for non-image bytes', () => {
    expect(decodeImage(Buffer.from('plain text'))).toBeNull();
  });

  it('returns null for corrupt image data', () => {
    const corrupt = Buffer.from(JPEG_1X1);
    corrupt.fill(0, 20);
    expect(decodeImage(corrupt)).toBeNull();
  });
});
