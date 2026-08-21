import { describe, it, expect } from 'vitest';
import { GifWriter } from 'omggif';
import { decodeGifAnimation } from './gif-animation.js';
import { PNG_1X1 } from './test-fixtures.js';

// Author fixtures with omggif's writer (independent of the reader path
// under test). Palette entries are 0xRRGGBB.
function makeGif(
  width: number,
  height: number,
  frames: { pixels: number[]; delayCs: number }[],
  palette: number[]
): Uint8Array {
  const buf = Buffer.alloc(4096);
  const writer = new GifWriter(buf, width, height, { loop: 0 });
  for (const f of frames) {
    writer.addFrame(0, 0, width, height, f.pixels, {
      palette,
      delay: f.delayCs,
    });
  }
  return buf.subarray(0, writer.end());
}

const RED_BLUE = [0xff0000, 0x0000ff];

describe('decodeGifAnimation', () => {
  it('decodes composited frames with millisecond delays', () => {
    const gif = makeGif(
      1,
      1,
      [
        { pixels: [0], delayCs: 10 },
        { pixels: [1], delayCs: 20 },
      ],
      RED_BLUE
    );
    const anim = decodeGifAnimation(gif);
    expect(anim).not.toBeNull();
    expect(anim!.width).toBe(1);
    expect(anim!.height).toBe(1);
    expect(anim!.frames).toHaveLength(2);
    expect(anim!.frames.map((f) => f.delayMs)).toEqual([100, 200]);
    expect([...anim!.frames[0]!.rgba.subarray(0, 3)]).toEqual([255, 0, 0]);
    expect([...anim!.frames[1]!.rgba.subarray(0, 3)]).toEqual([0, 0, 255]);
  });

  it('treats near-zero delays as the 100ms convention', () => {
    const gif = makeGif(
      1,
      1,
      [
        { pixels: [0], delayCs: 0 },
        { pixels: [1], delayCs: 1 },
      ],
      RED_BLUE
    );
    const anim = decodeGifAnimation(gif);
    expect(anim!.frames.map((f) => f.delayMs)).toEqual([100, 100]);
  });

  it('downscales frames to maxWidth with nearest-neighbor sampling', () => {
    // 4x1: red red blue blue -> at maxWidth 2: red blue
    const gif = makeGif(
      4,
      1,
      [
        { pixels: [0, 0, 1, 1], delayCs: 10 },
        { pixels: [1, 1, 0, 0], delayCs: 10 },
      ],
      RED_BLUE
    );
    const anim = decodeGifAnimation(gif, { maxWidth: 2 });
    expect(anim!.width).toBe(2);
    expect(anim!.height).toBe(1);
    expect([...anim!.frames[0]!.rgba]).toEqual([
      255, 0, 0, 255, 0, 0, 255, 255,
    ]);
  });

  it('keeps full resolution by default (no implicit downscale)', () => {
    // Wider than the old 640px animation cap — frames must come back
    // at native size unless a maxWidth is explicitly requested.
    const width = 700;
    const pixels = Array.from({ length: width }, (_, i) => i % 2);
    const gif = makeGif(
      width,
      1,
      [
        { pixels, delayCs: 10 },
        { pixels, delayCs: 10 },
      ],
      RED_BLUE
    );
    const anim = decodeGifAnimation(gif);
    expect(anim!.width).toBe(700);
    expect(anim!.frames[0]!.rgba.length).toBe(700 * 4);
  });

  it('caps the number of frames', () => {
    const frames = Array.from({ length: 6 }, (_, i) => ({
      pixels: [i % 2],
      delayCs: 10,
    }));
    const gif = makeGif(1, 1, frames, RED_BLUE);
    const anim = decodeGifAnimation(gif, { maxFrames: 4 });
    expect(anim!.frames).toHaveLength(4);
  });

  it('returns null for single-frame GIFs and non-GIFs', () => {
    const single = makeGif(1, 1, [{ pixels: [0], delayCs: 10 }], RED_BLUE);
    expect(decodeGifAnimation(single)).toBeNull();
    expect(decodeGifAnimation(PNG_1X1)).toBeNull();
  });
});
