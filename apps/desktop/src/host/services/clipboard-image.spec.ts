import { readFileSync, rmSync } from 'node:fs';
import { extname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clipboardImageExtension,
  saveClipboardImage,
} from './clipboard-image.js';

/**
 * The one place a sandboxed renderer hands the main process bytes and a
 * name for them.
 *
 * Everything else on the bridge passes values the host looks up itself;
 * here the renderer supplies a MIME type that decides a filename, so
 * the interesting cases are the ones where that string is hostile or
 * simply wrong rather than the happy path.
 */

const written: string[] = [];

function save(bytes: number[], type: string): string {
  const path = saveClipboardImage(new Uint8Array(bytes), type);
  written.push(path);
  return path;
}

afterEach(() => {
  for (const path of written) rmSync(path, { force: true });
  written.length = 0;
});

describe('clipboardImageExtension', () => {
  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/svg+xml', 'svg'],
  ])('maps %s to .%s', (type, ext) => {
    expect(clipboardImageExtension(type)).toBe(ext);
  });

  it('ignores the parameters browsers append to a clipboard type', () => {
    // Chromium hands over `image/png;charset=utf-8` from some sources.
    expect(clipboardImageExtension('image/png;charset=utf-8')).toBe('png');
    expect(clipboardImageExtension('IMAGE/PNG')).toBe('png');
  });

  it('refuses anything that is not a known image type', () => {
    expect(clipboardImageExtension('text/plain')).toBeNull();
    expect(clipboardImageExtension('application/x-sh')).toBeNull();
  });
});

describe('saveClipboardImage', () => {
  it('writes the bytes through unchanged', () => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a];
    const path = save(bytes, 'image/png');
    expect([...readFileSync(path)]).toEqual(bytes);
  });

  it('names the file from the type, so the agent can tell what it is', () => {
    expect(extname(save([1], 'image/jpeg'))).toBe('.jpg');
  });

  it('gives each paste its own file', () => {
    // Two screenshots pasted in a row must not overwrite one another —
    // the first may still be referenced earlier in the conversation.
    expect(save([1], 'image/png')).not.toBe(save([2], 'image/png'));
  });

  it('takes the suffix from its own table, never from the caller', () => {
    // The renderer is sandboxed, this is not: a type that tries to
    // steer the path must be refused outright rather than sanitised.
    expect(() => save([1], 'image/png/../../../.bashrc')).toThrow(
      /Unsupported image type/
    );
    expect(() => save([1], '../../evil')).toThrow(/Unsupported image type/);
  });

  it('refuses a non-image paste rather than writing an arbitrary file', () => {
    expect(() => save([1], 'application/x-sh')).toThrow(
      /Unsupported image type/
    );
  });

  it('refuses an empty paste', () => {
    expect(() => save([], 'image/png')).toThrow(/empty/);
  });

  it('refuses one too large to be a screenshot', () => {
    const huge = new Uint8Array(33 * 1024 * 1024);
    expect(() => saveClipboardImage(huge, 'image/png')).toThrow(/too large/);
  });
});
