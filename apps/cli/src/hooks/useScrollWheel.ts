import { useEffect } from 'react';
import { useStdin, useStdout } from 'ink';

/** Rows a diff-style surface scrolls per wheel tick. */
export const SCROLL_LINES = 3;

// SGR mouse mode escape sequences. ?1000 (button events) is enough for
// wheel reporting and avoids the drag-motion spam ?1002 would produce.
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1000l';

// SGR mouse event: ESC[<Btn;X;Y[Mm]. Global — terminals batch rapid
// wheel spins into one stdin chunk and every event must be consumed.
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);\d+[Mm]/g;

/** Pointer-column region a wheel consumer listens to (1-based, inclusive). */
export interface WheelRegion {
  xMin?: number;
  xMax?: number;
}

/**
 * Net wheel ticks in one stdin chunk: +1 per wheel-down (btn 65),
 * -1 per wheel-up (btn 64). Clicks, releases, and drags are ignored.
 * With a region, only events whose pointer column falls inside it
 * count — that's how the sidebar and the main pane scroll separately.
 */
export function parseWheelTicks(str: string, region?: WheelRegion): number {
  let ticks = 0;
  SGR_MOUSE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
    const btn = parseInt(match[1], 10);
    if (btn !== 64 && btn !== 65) continue;
    const x = parseInt(match[2], 10);
    if (region?.xMin !== undefined && x < region.xMin) continue;
    if (region?.xMax !== undefined && x > region.xMax) continue;
    ticks += btn === 65 ? 1 : -1;
  }
  return ticks;
}

/** A left-button press with its 1-based terminal coordinates. */
export interface MouseClick {
  x: number;
  y: number;
}

/**
 * Left-button presses in one stdin chunk, optionally filtered to a
 * column region. Releases, wheel events, and other buttons are
 * ignored.
 */
export function parseMouseClicks(
  str: string,
  region?: WheelRegion
): MouseClick[] {
  const clicks: MouseClick[] = [];
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(str)) !== null) {
    if (match[1] !== '0' || match[4] !== 'M') continue;
    const x = parseInt(match[2], 10);
    if (region?.xMin !== undefined && x < region.xMin) continue;
    if (region?.xMax !== undefined && x > region.xMax) continue;
    clicks.push({ x, y: parseInt(match[3], 10) });
  }
  return clicks;
}

// Multiple wheel consumers can be active at once (sidebar + a reviews
// pane, split by region), so the DECSET enable/disable writes are
// refcounted — enable on the first active consumer, disable when the
// last one goes away.
let mouseUsers = 0;
function acquireMouse(stdout: NodeJS.WriteStream): void {
  if (mouseUsers++ === 0) stdout.write(ENABLE_MOUSE);
}
function releaseMouse(stdout: NodeJS.WriteStream): void {
  if (--mouseUsers === 0) stdout.write(DISABLE_MOUSE);
}

/**
 * Scroll wheel support. Enables SGR mouse tracking while active and
 * reports net wheel ticks per stdin chunk (positive = down). Consumers
 * scale ticks to their own scroll unit (rows, items, …).
 *
 * @param active Whether this consumer is listening
 * @param onWheel Callback with net wheel ticks
 * @param region Pointer-column region this consumer reacts to
 */
export function useScrollWheel(
  active: boolean,
  onWheel: (ticks: number) => void,
  region?: WheelRegion
) {
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const xMin = region?.xMin;
  const xMax = region?.xMax;

  useEffect(() => {
    if (!active || !stdin || !stdout) return;

    acquireMouse(stdout as NodeJS.WriteStream);

    const handler = (data: Buffer) => {
      const ticks = parseWheelTicks(data.toString('utf8'), { xMin, xMax });
      if (ticks !== 0) onWheel(ticks);
    };

    stdin.on('data', handler);

    return () => {
      stdin.off('data', handler);
      releaseMouse(stdout as NodeJS.WriteStream);
    };
  }, [active, stdin, stdout, onWheel, xMin, xMax]);
}

/**
 * Left-click support, sharing the wheel hook's refcounted mouse mode.
 * Used by the sidebar so clicks select items / open PR links even
 * though mouse reporting steals plain clicks from the terminal's own
 * link handling.
 */
export function useMouseClicks(
  active: boolean,
  onClick: (click: MouseClick) => void,
  region?: WheelRegion
) {
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const xMin = region?.xMin;
  const xMax = region?.xMax;

  useEffect(() => {
    if (!active || !stdin || !stdout) return;

    acquireMouse(stdout as NodeJS.WriteStream);

    const handler = (data: Buffer) => {
      for (const click of parseMouseClicks(data.toString('utf8'), {
        xMin,
        xMax,
      })) {
        onClick(click);
      }
    };

    stdin.on('data', handler);

    return () => {
      stdin.off('data', handler);
      releaseMouse(stdout as NodeJS.WriteStream);
    };
  }, [active, stdin, stdout, onClick, xMin, xMax]);
}
