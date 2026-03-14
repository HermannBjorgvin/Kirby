import { useEffect } from 'react';
import { useStdin, useStdout } from 'ink';

const SCROLL_LINES = 3;

// SGR mouse mode escape sequences
const ENABLE_MOUSE = '\x1b[?1002h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1002l';

// SGR mouse event regex: ESC[<Btn;X;Y[Mm]
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /\x1b\[<(\d+);\d+;\d+[Mm]/;

/**
 * Experimental scroll wheel support for the diff viewer.
 * Enables SGR mouse mode and parses scroll events from raw stdin.
 *
 * @param active Whether to enable scroll wheel handling
 * @param onScroll Callback with scroll delta (positive = down, negative = up)
 */
export function useScrollWheel(
  active: boolean,
  onScroll: (delta: number) => void
) {
  const { stdin } = useStdin();
  const { stdout } = useStdout();

  useEffect(() => {
    if (!active || !stdin || !stdout) return;

    // Enable SGR mouse tracking
    stdout.write(ENABLE_MOUSE);

    const handler = (data: Buffer) => {
      const str = data.toString('utf8');
      const match = SGR_MOUSE_RE.exec(str);
      if (!match) return;

      const btn = parseInt(match[1], 10);
      if (btn === 64) {
        // Scroll up
        onScroll(-SCROLL_LINES);
      } else if (btn === 65) {
        // Scroll down
        onScroll(SCROLL_LINES);
      }
    };

    stdin.on('data', handler);

    return () => {
      stdin.off('data', handler);
      stdout.write(DISABLE_MOUSE);
    };
  }, [active, stdin, stdout, onScroll]);
}
