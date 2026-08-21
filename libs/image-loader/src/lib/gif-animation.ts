import { GifReader } from 'omggif';
import { sniffImageFormat } from './image-format.js';

// Full animation decode for GIF playback. Frames are composited
// sequentially (each GIF frame is a delta over the previous canvas)
// and snapshotted as complete RGBA images, optionally downscaled —
// playback paths retransmit whole frames, so they must be
// self-contained and small.

export interface GifFrame {
  rgba: Uint8Array;
  delayMs: number;
}

export interface GifAnimation {
  width: number;
  height: number;
  frames: GifFrame[];
}

export interface GifAnimationOptions {
  /**
   * Downscale frames to at most this many pixels wide. Default: no
   * downscaling — frames keep the GIF's native resolution (the
   * terminal scales into the placement rectangle far better than
   * nearest-neighbor pre-scaling would).
   */
  maxWidth?: number;
  /** Keep at most this many frames (default 120). */
  maxFrames?: number;
}

const DEFAULT_MAX_FRAMES = 120;

// GIF delays are centiseconds; ≤1cs conventionally means "unspecified"
// and renderers substitute 100ms.
function frameDelayMs(delayCs: number): number {
  return delayCs <= 1 ? 100 : delayCs * 10;
}

function scaleRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number
): Uint8Array {
  const out = new Uint8Array(targetWidth * targetHeight * 4);
  for (let ty = 0; ty < targetHeight; ty++) {
    const sy = Math.min(height - 1, Math.floor((ty * height) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx++) {
      const sx = Math.min(width - 1, Math.floor((tx * width) / targetWidth));
      const si = (sy * width + sx) * 4;
      const ti = (ty * targetWidth + tx) * 4;
      out[ti] = rgba[si]!;
      out[ti + 1] = rgba[si + 1]!;
      out[ti + 2] = rgba[si + 2]!;
      out[ti + 3] = rgba[si + 3]!;
    }
  }
  return out;
}

/**
 * Decode an animated GIF into complete, optionally downscaled RGBA
 * frames with per-frame delays. Returns null for non-GIFs,
 * single-frame GIFs, or corrupt data — callers keep the static image.
 */
export function decodeGifAnimation(
  bytes: Uint8Array,
  opts: GifAnimationOptions = {}
): GifAnimation | null {
  if (sniffImageFormat(bytes) !== 'gif') return null;
  const maxWidth = opts.maxWidth;
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
  try {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const reader = new GifReader(buf);
    const count = Math.min(reader.numFrames(), maxFrames);
    if (count < 2) return null;

    const { width, height } = reader;
    const scale = maxWidth !== undefined && width > maxWidth;
    const outWidth = scale ? maxWidth : width;
    const outHeight = scale
      ? Math.max(1, Math.round((height * maxWidth) / width))
      : height;

    const canvas = new Uint8Array(width * height * 4);
    const frames: GifFrame[] = [];
    for (let f = 0; f < count; f++) {
      reader.decodeAndBlitFrameRGBA(f, canvas);
      frames.push({
        rgba: scale
          ? scaleRgba(canvas, width, height, outWidth, outHeight)
          : canvas.slice(),
        delayMs: frameDelayMs(reader.frameInfo(f).delay),
      });
    }
    return { width: outWidth, height: outHeight, frames };
  } catch {
    return null;
  }
}
