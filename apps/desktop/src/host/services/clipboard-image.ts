import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Somewhere to put an image pasted into an agent terminal.
 *
 * A PTY carries text, so an image on the clipboard cannot be handed to
 * the agent the way a string can — wterm's own paste handler reads
 * `clipboardData.getData('text')` and drops anything else on the floor,
 * which is why pasting a screenshot into the terminal appears to do
 * nothing at all. Writing the bytes out and typing the path instead is
 * how a terminal agent takes an image: Claude Code reads a path in the
 * prompt and loads the file itself.
 *
 * The file is deliberately left behind. The agent may read it long
 * after the paste (it is a reference in the conversation, not a
 * transfer), so deleting it on a timer would break exactly the case
 * this exists for; the OS temp directory is the thing that cleans up.
 */

/** Image types worth accepting from a clipboard, mapped to a suffix. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

/** Big enough for a 5K screenshot, small enough to bound a bad paste. */
const MAX_BYTES = 32 * 1024 * 1024;

export function clipboardImageExtension(mimeType: string): string | null {
  return EXT_BY_TYPE[mimeType.toLowerCase().split(';')[0].trim()] ?? null;
}

/**
 * Write pasted image bytes to a temp file and return its absolute path.
 *
 * The suffix comes from our own table rather than from the caller, so a
 * renderer-supplied MIME type can never steer the filename — the
 * renderer is sandboxed but this runs in the main process with full
 * disk access, and a type like `png/../../.bashrc` would otherwise be
 * spliced straight into the path.
 */
export function saveClipboardImage(data: Uint8Array, mimeType: string): string {
  const ext = clipboardImageExtension(mimeType);
  if (!ext) throw new Error(`Unsupported image type: ${mimeType}`);
  if (data.byteLength === 0) throw new Error('Pasted image was empty');
  if (data.byteLength > MAX_BYTES) {
    throw new Error(
      `Pasted image is too large (${Math.round(
        data.byteLength / 1024 / 1024
      )}MB, limit ${MAX_BYTES / 1024 / 1024}MB)`
    );
  }
  const dir = join(tmpdir(), 'kirby-pasted-images');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `paste-${randomBytes(8).toString('hex')}.${ext}`);
  writeFileSync(path, data);
  return path;
}
