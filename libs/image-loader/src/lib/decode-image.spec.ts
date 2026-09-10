import { describe, it, expect } from 'vitest';
import { decodeImage } from './decode-image.js';
import { PNG_1X1, GIF_1X1, WEBP_1X1, JPEG_1X1 } from './test-fixtures.js';

describe('decodeImage', () => {
  it('passes PNG bytes through untouched (kitty renders PNG natively)', async () => {
    const d = await decodeImage(PNG_1X1);
    expect(d).toMatchObject({ format: 'png', width: 1, height: 1 });
    expect(d && 'png' in d && Buffer.from(d.png).equals(PNG_1X1)).toBe(true);
  });

  it('decodes JPEG to RGBA', async () => {
    const d = await decodeImage(JPEG_1X1);
    expect(d).toMatchObject({ format: 'jpeg', width: 1, height: 1 });
    expect(d && 'rgba' in d && d.rgba.length).toBe(4);
  });

  it('decodes the first GIF frame to RGBA', async () => {
    const d = await decodeImage(GIF_1X1);
    expect(d).toMatchObject({ format: 'gif', width: 1, height: 1 });
    expect(d && 'rgba' in d && d.rgba.length).toBe(4);
  });

  it('decodes WebP to RGBA', async () => {
    const d = await decodeImage(WEBP_1X1);
    expect(d).toMatchObject({ format: 'webp', width: 1, height: 1 });
    expect(d && 'rgba' in d && d.rgba.length).toBe(4);
  });

  it('returns null for non-image bytes', async () => {
    expect(await decodeImage(Buffer.from('plain text'))).toBeNull();
  });

  it('returns null for corrupt image data', async () => {
    const corrupt = Buffer.from(JPEG_1X1);
    corrupt.fill(0, 20);
    expect(await decodeImage(corrupt)).toBeNull();
  });
});

describe('animated GIF static frame', () => {
  it('composites frames and shows a mid-animation frame, not frame 0', async () => {
    // 1x1 GIF, 2 frames: red then blue. Screen-capture GIFs often open
    // on a bare background frame, so the static render must composite
    // into the animation instead of showing frame 0.
    const { GifWriter } = await import('omggif');
    const buf = Buffer.alloc(1024);
    const writer = new GifWriter(buf, 1, 1, { loop: 0 });
    const palette = [0xff0000, 0x0000ff];
    writer.addFrame(0, 0, 1, 1, [0], { palette, delay: 10 });
    writer.addFrame(0, 0, 1, 1, [1], { palette, delay: 10 });
    const gif = buf.subarray(0, writer.end());

    const d = await decodeImage(gif);
    expect(d).toMatchObject({ format: 'gif', width: 1, height: 1 });
    // Mid-frame of a 2-frame animation is frame 1 (blue).
    expect(d && 'rgba' in d && [...d.rgba.subarray(0, 3)]).toEqual([0, 0, 255]);
  });
});
