import {
  encodeTransmitPng,
  encodeTransmitRgba,
  encodeAnimationFrame,
  setRootFrameGap,
  startAnimationLoop,
  type PlacementSize,
} from '@kirby/kitty-graphics';
import {
  fetchImageBytes,
  decodeImage,
  decodeGifAnimation,
  type DecodedImage,
  type GifAnimation,
} from '@kirby/image-loader';
import { getGhToken } from '../utils/gh-token.js';

/** A decoded image ready to place, plus its animation if it has one. */
export interface LoadedImage {
  decoded: DecodedImage;
  /** Present for multi-frame GIFs when playback is not disabled. */
  animation: GifAnimation | null;
}

/**
 * Fetch (with provider auth), decode, and — for GIFs — decode the full
 * animation. Returns null for a failed download, an undecodable body,
 * or a format the terminal can't take.
 */
export async function loadCommentImage(
  url: string,
  vendorAuth: Record<string, string>
): Promise<LoadedImage | null> {
  const githubToken = (await getGhToken()) ?? undefined;
  const bytes = await fetchImageBytes(url, {
    githubToken,
    azurePat: vendorAuth['pat'],
  });
  const decoded = await decodeImage(bytes);
  if (!decoded) return null;

  const wantAnimation =
    decoded.format === 'gif' && process.env['KIRBY_GIF_ANIMATION'] !== 'off';
  const animation = wantAnimation ? decodeGifAnimation(bytes) : null;
  return { decoded, animation };
}

/** Transmit a still image and create its virtual placement. */
export function transmitStill(
  id: number,
  decoded: DecodedImage,
  placement: PlacementSize
): void {
  process.stdout.write(
    decoded.format === 'png'
      ? encodeTransmitPng(id, decoded.png, placement)
      : encodeTransmitRgba(
          id,
          decoded.rgba,
          decoded.width,
          decoded.height,
          placement
        )
  );
}

/**
 * Transmit every frame of an animation and start an infinite,
 * terminal-driven loop (kitty). Frame 1 is the base image; the rest
 * are `a=f` frames carrying their own gap.
 */
export function transmitTerminalAnimation(
  id: number,
  animation: GifAnimation,
  placement: PlacementSize
): void {
  const [first, ...rest] = animation.frames;
  if (!first) return;
  process.stdout.write(
    encodeTransmitRgba(
      id,
      first.rgba,
      animation.width,
      animation.height,
      placement
    )
  );
  for (const frame of rest) {
    process.stdout.write(
      encodeAnimationFrame(
        id,
        frame.rgba,
        animation.width,
        animation.height,
        frame.delayMs
      )
    );
  }
  process.stdout.write(setRootFrameGap(id, first.delayMs));
  process.stdout.write(startAnimationLoop(id));
}

/** Re-transmit one animation frame as a plain image replacement. */
export function transmitFrame(
  id: number,
  animation: GifAnimation,
  placement: PlacementSize,
  frameIndex: number
): void {
  const frame = animation.frames[frameIndex];
  if (!frame) return;
  process.stdout.write(
    encodeTransmitRgba(
      id,
      frame.rgba,
      animation.width,
      animation.height,
      placement
    )
  );
}
