// Minimal typings for omggif (no upstream @types package). Only the
// surface decode-image.ts uses.
declare module 'omggif' {
  export class GifReader {
    constructor(buf: Uint8Array);
    readonly width: number;
    readonly height: number;
    numFrames(): number;
    decodeAndBlitFrameRGBA(frameNum: number, pixels: Uint8Array): void;
  }
}
