import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import {
  detectKittyGraphics,
  encodeTransmitPng,
  encodeTransmitRgba,
  placeholderText,
  deleteImage,
} from './kitty-graphics.js';

describe('detectKittyGraphics', () => {
  it('detects kitty via TERM', () => {
    expect(detectKittyGraphics({ TERM: 'xterm-kitty' })).toBe(true);
  });

  it('detects ghostty via TERM', () => {
    expect(detectKittyGraphics({ TERM: 'xterm-ghostty' })).toBe(true);
  });

  it('detects ghostty via TERM_PROGRAM', () => {
    expect(
      detectKittyGraphics({ TERM: 'xterm-256color', TERM_PROGRAM: 'ghostty' })
    ).toBe(true);
  });

  it('detects kitty via KITTY_WINDOW_ID', () => {
    expect(
      detectKittyGraphics({ TERM: 'xterm-256color', KITTY_WINDOW_ID: '1' })
    ).toBe(true);
  });

  it('rejects plain terminals', () => {
    expect(detectKittyGraphics({ TERM: 'xterm-256color' })).toBe(false);
    expect(detectKittyGraphics({})).toBe(false);
  });

  it('KIRBY_IMAGES=off force-disables', () => {
    expect(
      detectKittyGraphics({ TERM: 'xterm-kitty', KIRBY_IMAGES: 'off' })
    ).toBe(false);
  });

  it('KIRBY_IMAGES=kitty force-enables', () => {
    expect(
      detectKittyGraphics({ TERM: 'xterm-256color', KIRBY_IMAGES: 'kitty' })
    ).toBe(true);
  });
});

describe('encodeTransmitPng', () => {
  it('emits a single chunk with a virtual placement for small payloads', () => {
    const png = Buffer.from('fakepng');
    const b64 = png.toString('base64');
    expect(encodeTransmitPng(5, png, { rows: 4, cols: 10 })).toBe(
      `\x1b_Gq=2,f=100,i=5,t=d,a=T,U=1,c=10,r=4;${b64}\x1b\\`
    );
  });

  it('splits payloads into 4096-char base64 chunks with m markers', () => {
    // 3*2048 input bytes -> 8192 base64 chars -> 2 chunks
    const png = Buffer.alloc(3 * 2048, 1);
    const b64 = png.toString('base64');
    const out = encodeTransmitPng(7, png, { rows: 2, cols: 2 });
    expect(out).toBe(
      `\x1b_Gq=2,f=100,i=7,t=d,a=T,U=1,c=2,r=2,m=1;${b64.slice(
        0,
        4096
      )}\x1b\\` + `\x1b_Gm=0;${b64.slice(4096)}\x1b\\`
    );
  });
});

describe('encodeTransmitRgba', () => {
  it('deflates the pixels and declares f=32 with source dimensions', () => {
    const rgba = new Uint8Array([255, 0, 0, 255]);
    const out = encodeTransmitRgba(9, rgba, 1, 1, { rows: 1, cols: 2 });
    const m = out.match(
      // eslint-disable-next-line no-control-regex
      /^\x1b_Gq=2,f=32,o=z,s=1,v=1,i=9,t=d,a=T,U=1,c=2,r=1;([A-Za-z0-9+/=]+)\x1b\\$/
    );
    expect(m).not.toBeNull();
    const inflated = inflateSync(Buffer.from(m![1], 'base64'));
    expect([...inflated]).toEqual([255, 0, 0, 255]);
  });
});

describe('placeholderText', () => {
  it('renders rows x cols placeholder cells colored by image id', () => {
    // Row 0 diacritic = U+0305, col 0 = U+0305, col 1 = U+030D
    expect(placeholderText(42, 1, 2)).toEqual([
      '\x1b[38;5;42m\u{10EEEE}\u0305\u0305\u{10EEEE}\u0305\u030D\x1b[39m',
    ]);
  });

  it('varies the row diacritic per line', () => {
    const lines = placeholderText(1, 2, 1);
    expect(lines).toEqual([
      '\x1b[38;5;1m\u{10EEEE}\u0305\u0305\x1b[39m',
      '\x1b[38;5;1m\u{10EEEE}\u030D\u0305\x1b[39m',
    ]);
  });

  it('throws for ids outside 1..255', () => {
    expect(() => placeholderText(0, 1, 1)).toThrow();
    expect(() => placeholderText(256, 1, 1)).toThrow();
  });
});

describe('deleteImage', () => {
  it('deletes the image and its placements by id', () => {
    expect(deleteImage(42)).toBe('\x1b_Ga=d,d=I,i=42\x1b\\');
  });
});
