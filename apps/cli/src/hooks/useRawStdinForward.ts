import { useEffect } from 'react';
import type { MouseTrackingMode } from '@kirby/terminal';

// Always use "any" tracking + SGR encoding so we receive all mouse events
const MOUSE_ENABLE = '\x1b[?1003h\x1b[?1006h';
const MOUSE_DISABLE_ALL =
  '\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?9l';

// SGR mouse sequence: \x1b[<btn;x;yM (press) or \x1b[<btn;x;ym (release)
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

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
      const str = data.toString('utf-8');
      if (str === '\x00') {
        // Ctrl+Space → return to sidebar
        onEscape();
        return;
      }

      if (mouseMode !== 'none') {
        // Child app wants mouse events — forward everything raw
        write(str);
        return;
      }

      // Child hasn't enabled mouse — handle scroll ourselves, drop other mouse events
      let match: RegExpExecArray | null;
      const parts: string[] = [];
      let lastIndex = 0;

      SGR_MOUSE_RE.lastIndex = 0;
      while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
        // Collect any non-mouse data before this match
        if (match.index > lastIndex) {
          parts.push(str.slice(lastIndex, match.index));
        }
        lastIndex = match.index + match[0].length;

        const btn = parseInt(match[1], 10);
        if (btn === 64) {
          onScrollUp();
        } else if (btn === 65) {
          onScrollDown();
        }
        // All other mouse events (clicks, drags) are dropped
      }

      // Collect any remaining non-mouse data after last match
      if (lastIndex < str.length) {
        parts.push(str.slice(lastIndex));
      }

      // Forward non-mouse data to PTY
      const nonMouse = parts.join('');
      if (nonMouse.length > 0) {
        write(nonMouse);
      }
    };
    process.stdin.on('data', handler);
    return () => {
      process.stdin.off('data', handler);
    };
  }, [active, write, onEscape, mouseMode, onScrollUp, onScrollDown]);
}
