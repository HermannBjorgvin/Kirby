import { useEffect } from 'react';
import { useStdin, useStdout } from 'ink';

const SCROLL_LINES = 3;

// SGR mouse mode escape sequences. ?1000 (button events) is enough for
// wheel reporting and avoids the drag-motion spam ?1002 would produce.
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1000l';

// SGR mouse event: ESC[<Btn;X;Y[Mm]. Global — terminals batch rapid
// wheel spins into one stdin chunk and every event must be consumed.
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /\x1b\[<(\d+);\d+;\d+[Mm]/g;

/**
 * Net wheel ticks in one stdin chunk: +1 per wheel-down (btn 65),
 * -1 per wheel-up (btn 64). Clicks, releases, and drags are ignored.
 */
export function parseWheelTicks(str: string): number {
  let ticks = 0;
  SGR_MOUSE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
    const btn = parseInt(match[1], 10);
    if (btn === 64) ticks -= 1;
    else if (btn === 65) ticks += 1;
  }
  return ticks;
}

/**
 * Scroll wheel support for the reviews panes.
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
      const ticks = parseWheelTicks(data.toString('utf8'));
      if (ticks !== 0) onScroll(ticks * SCROLL_LINES);
    };

    stdin.on('data', handler);

    return () => {
      stdin.off('data', handler);
      stdout.write(DISABLE_MOUSE);
    };
  }, [active, stdin, stdout, onScroll]);
}
