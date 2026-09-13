import jpeg from 'jpeg-js';
import { GifReader } from 'omggif';
import { sniffImageFormat, imageDimensions } from './image-format.js';

// @cwasm/webp reads its .wasm from disk at module load, so it's
// imported lazily and only when a WebP actually shows up — if the wasm
// file is missing (unusual bundling setups), WebP decoding degrades to
// null (markdown fallback) instead of crashing startup.
interface WebpModule {
  decode(buf: Uint8Array): {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };
}
let webpModule: Promise<WebpModule | null> | null = null;
function loadWebp(): Promise<WebpModule | null> {
  webpModule ??= import('@cwasm/webp').then(
    (m) => m as WebpModule,
    () => null
  );
  return webpModule;
}

// Normalized decode result. PNG passes through untouched — the kitty
// graphics protocol transmits PNG bytes natively (f=100); every other
// format decodes to raw RGBA (f=32).
export type DecodedImage =
  | { format: 'png'; width: number; height: number; png: Uint8Array }
  | {
      format: 'jpeg' | 'gif' | 'webp';
      width: number;
      height: number;
      rgba: Uint8Array;
    };

/**
 * Decode image bytes into a kitty-transmittable form. Animated GIFs
 * contribute their first frame only. Returns null for unknown formats
 * or corrupt data — callers fall back to plain markdown text.
 */
export async function decodeImage(
  bytes: Uint8Array
): Promise<DecodedImage | null> {
  const format = sniffImageFormat(bytes);
  if (!format) return null;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    switch (format) {
      case 'png': {
        const size = imageDimensions(bytes);
        if (!size) return null;
        return { format, ...size, png: bytes };
      }
      case 'jpeg': {
        const d = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 64 });
        return { format, width: d.width, height: d.height, rgba: d.data };
      }
      case 'gif': {
        const reader = new GifReader(buf);
        const rgba = new Uint8Array(reader.width * reader.height * 4);
        // Composite frames up to the middle of the animation and show
        // that as the static image. Frame 0 alone is often useless —
        // screen-capture GIFs tend to open on a bare background frame,
        // and later frames are partial deltas that need the frames
        // before them. Capped so pathological GIFs stay cheap.
        const frames = reader.numFrames();
        const target = Math.min(Math.floor(frames / 2), frames - 1, 60);
        for (let f = 0; f <= target; f++) {
          reader.decodeAndBlitFrameRGBA(f, rgba);
        }
        return { format, width: reader.width, height: reader.height, rgba };
      }
      case 'webp': {
        const webp = await loadWebp();
        if (!webp) return null;
        const d = webp.decode(buf);
        return {
          format,
          width: d.width,
          height: d.height,
          rgba: new Uint8Array(d.data.buffer, d.data.byteOffset, d.data.length),
        };
      }
    }
  } catch {
    return null;
  }
}
