import { deflateSync } from 'node:zlib';
import { ROW_COLUMN_DIACRITICS } from './rowcolumn-diacritics.js';

// Kitty graphics protocol, Unicode-placeholder flavor
// (https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders).
//
// Images are transmitted once out-of-band with a *virtual* placement
// (U=1) sized r×c cells; nothing is drawn at the cursor. The terminal
// then paints image cells wherever placeholder characters (U+10EEEE,
// carrying row/column diacritics and an fg color equal to the image
// id) appear on screen — which lets placeholders flow through Ink's
// layout and diffing as ordinary text.

const APC = '\x1b_G';
const ST = '\x1b\\';
const CHUNK = 4096; // max base64 chars per escape, per the protocol

/** Cell footprint of a virtual placement. */
export interface PlacementSize {
  rows: number;
  cols: number;
}

/**
 * Env-based capability detection. Placeholder placements need kitty
 * (≥ 0.28) or ghostty — terminals that merely parse the graphics
 * protocol (wezterm) don't render placeholders, so the allowlist is
 * deliberately narrow. KIRBY_IMAGES overrides: 'off' disables,
 * 'kitty' force-enables (used by tests and unsupported-TERM setups).
 */
export function detectKittyGraphics(
  env: Record<string, string | undefined>
): boolean {
  if (env['KIRBY_IMAGES'] === 'off') return false;
  if (env['KIRBY_IMAGES'] === 'kitty') return true;
  const term = env['TERM'] ?? '';
  if (term.includes('kitty') || term.includes('ghostty')) return true;
  if (env['KITTY_WINDOW_ID']) return true;
  if (env['TERM_PROGRAM'] === 'ghostty') return true;
  return false;
}

function assertId(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > 255) {
    throw new RangeError(`kitty image id must be 1..255, got ${id}`);
  }
}

function chunked(control: string, payload: string): string {
  if (payload.length <= CHUNK) {
    return `${APC}${control};${payload}${ST}`;
  }
  const parts: string[] = [];
  for (let off = 0; off < payload.length; off += CHUNK) {
    const chunk = payload.slice(off, off + CHUNK);
    const last = off + CHUNK >= payload.length;
    const keys = off === 0 ? `${control},m=1` : last ? 'm=0' : 'm=1';
    parts.push(`${APC}${keys};${chunk}${ST}`);
  }
  return parts.join('');
}

/**
 * Transmit PNG bytes (f=100 — no decode needed) and create a virtual
 * placement of `size` cells. q=2 suppresses terminal responses.
 */
export function encodeTransmitPng(
  id: number,
  png: Uint8Array,
  size: PlacementSize
): string {
  assertId(id);
  const control = `q=2,f=100,i=${id},t=d,a=T,U=1,c=${size.cols},r=${size.rows}`;
  return chunked(control, Buffer.from(png).toString('base64'));
}

/**
 * Transmit raw RGBA pixels (f=32), zlib-deflated (o=z), and create a
 * virtual placement of `size` cells.
 */
export function encodeTransmitRgba(
  id: number,
  rgba: Uint8Array,
  pxWidth: number,
  pxHeight: number,
  size: PlacementSize
): string {
  assertId(id);
  const control =
    `q=2,f=32,o=z,s=${pxWidth},v=${pxHeight},i=${id},t=d,a=T,U=1,` +
    `c=${size.cols},r=${size.rows}`;
  const payload = deflateSync(Buffer.from(rgba)).toString('base64');
  return chunked(control, payload);
}

const PLACEHOLDER = String.fromCodePoint(0x10eeee);

/**
 * Placeholder rows for a placed image: `rows` strings of `cols` cells,
 * each cell U+10EEEE + row diacritic + column diacritic, colored with
 * the 256-color fg equal to the image id (how the terminal links the
 * cell to the image). Each line is self-contained (SGR set + reset) so
 * viewport clipping can drop lines freely.
 */
export function placeholderText(
  id: number,
  rows: number,
  cols: number
): string[] {
  assertId(id);
  const max = ROW_COLUMN_DIACRITICS.length;
  if (rows > max || cols > max) {
    throw new RangeError(`placement exceeds ${max} placeholder cells`);
  }
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const rowMark = String.fromCodePoint(ROW_COLUMN_DIACRITICS[r]);
    let line = `\x1b[38;5;${id}m`;
    for (let c = 0; c < cols; c++) {
      line +=
        PLACEHOLDER + rowMark + String.fromCodePoint(ROW_COLUMN_DIACRITICS[c]);
    }
    line += '\x1b[39m';
    lines.push(line);
  }
  return lines;
}

/** Delete an image (and all its placements) by id. */
export function deleteImage(id: number): string {
  assertId(id);
  return `${APC}a=d,d=I,i=${id}${ST}`;
}

// ── Terminal-driven animation (kitty only — ghostty lacks a=f) ──────

/**
 * True when the terminal implements the animation sub-protocol
 * (a=f frames + a=a control). Kitty does; ghostty renders images but
 * has not implemented animation, so it needs client-driven playback.
 */
export function supportsNativeAnimation(
  env: Record<string, string | undefined>
): boolean {
  if ((env['TERM'] ?? '').includes('ghostty')) return false;
  if (env['TERM_PROGRAM'] === 'ghostty') return false;
  if ((env['TERM'] ?? '').includes('kitty')) return true;
  if (env['KITTY_WINDOW_ID']) return true;
  return false;
}

/**
 * Transmit one additional animation frame (full image area, raw RGBA,
 * zlib) with its display gap in milliseconds.
 */
export function encodeAnimationFrame(
  id: number,
  rgba: Uint8Array,
  pxWidth: number,
  pxHeight: number,
  gapMs: number
): string {
  assertId(id);
  const control = `q=2,a=f,f=32,o=z,s=${pxWidth},v=${pxHeight},i=${id},z=${gapMs}`;
  return chunked(control, deflateSync(Buffer.from(rgba)).toString('base64'));
}

/** Set the display gap of the root frame (frame 1) in milliseconds. */
export function setRootFrameGap(id: number, gapMs: number): string {
  assertId(id);
  return `${APC}q=2,a=a,i=${id},r=1,z=${gapMs}${ST}`;
}

/** Start the animation, looping forever, driven by the terminal. */
export function startAnimationLoop(id: number): string {
  assertId(id);
  return `${APC}q=2,a=a,i=${id},s=3,v=1${ST}`;
}
