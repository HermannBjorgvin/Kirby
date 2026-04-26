import { useEffect } from 'react';
import type { MouseTrackingMode } from '@kirby/terminal';

// Always use "any" tracking + SGR encoding so we receive all mouse events
const MOUSE_ENABLE = '\x1b[?1003h\x1b[?1006h';
const MOUSE_DISABLE_ALL =
  '\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?9l';

// SGR mouse sequence: \x1b[<btn;x;yM (press) or \x1b[<btn;x;ym (release)
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

export interface StdinChunkContext {
  write: (data: string) => void;
  onEscape: () => void;
  mouseMode: MouseTrackingMode;
  onScrollUp: () => void;
  onScrollDown: () => void;
}

/**
 * Pure handler for one stdin chunk. Exported so the spec can drive it
 * without touching `process.stdin`.
 *
 * `\x00` (Ctrl+Space) is the escape-to-sidebar key. It can land inside
 * a multi-byte chunk under load (PTY readahead, rapid keystrokes), so
 * we look for it anywhere in the buffer. Bytes before the NUL are
 * forwarded normally; bytes after are dropped — focus is moving away
 * from the terminal, so subsequent bytes belong to the next context.
 */
export function processStdinChunk(str: string, ctx: StdinChunkContext): void {
  const escIdx = str.indexOf('\x00');
  const payload = escIdx === -1 ? str : str.slice(0, escIdx);
  if (payload.length > 0) forwardToPty(payload, ctx);
  if (escIdx !== -1) ctx.onEscape();
}

function forwardToPty(str: string, ctx: StdinChunkContext): void {
  if (ctx.mouseMode !== 'none') {
    // Child app wants mouse events — forward everything raw
    ctx.write(str);
    return;
  }

  // Child hasn't enabled mouse — handle scroll ourselves, drop other mouse events
  let match: RegExpExecArray | null;
  const parts: string[] = [];
  let lastIndex = 0;

  SGR_MOUSE_RE.lastIndex = 0;
  while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
    if (match.index > lastIndex) parts.push(str.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;

    const btn = parseInt(match[1], 10);
    if (btn === 64) ctx.onScrollUp();
    else if (btn === 65) ctx.onScrollDown();
    // All other mouse events (clicks, drags) are dropped
  }

  if (lastIndex < str.length) parts.push(str.slice(lastIndex));

  const nonMouse = parts.join('');
  if (nonMouse.length > 0) ctx.write(nonMouse);
}

export function useRawStdinForward(
  active: boolean,
  write: (data: string) => void,
  onEscape: () => void,
  mouseMode: MouseTrackingMode,
  onScrollUp: () => void,
  onScrollDown: () => void
) {
  // Always enable mouse on outer terminal when active
  useEffect(() => {
    if (!active) return;
    process.stdout.write(MOUSE_ENABLE);
    return () => {
      process.stdout.write(MOUSE_DISABLE_ALL);
    };
  }, [active]);

  // Forward raw stdin bytes to the PTY
  useEffect(() => {
    if (!active) return;

    const handler = (data: Buffer) => {
      processStdinChunk(data.toString('utf-8'), {
        write,
        onEscape,
        mouseMode,
        onScrollUp,
        onScrollDown,
      });
    };
    process.stdin.on('data', handler);
    return () => {
      process.stdin.off('data', handler);
    };
  }, [active, write, onEscape, mouseMode, onScrollUp, onScrollDown]);
}
