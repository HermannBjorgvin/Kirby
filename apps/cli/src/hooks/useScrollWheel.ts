import { useEffect } from 'react';
import { useStdin, useStdout } from 'ink';
import {
  SGR_SCROLL_DOWN,
  SGR_SCROLL_UP,
  sgrMouseMatcher,
} from './sgr-mouse.js';

/** Rows a diff-style surface scrolls per wheel tick. */
export const SCROLL_LINES = 3;

// SGR mouse mode. ?1000 (button events) is enough for wheel + click
// reporting and avoids the drag-motion spam ?1002 / ?1003 produce.
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1000l';

/** Pointer-column region a consumer listens to (1-based, inclusive). */
export interface WheelRegion {
  xMin?: number;
  xMax?: number;
}

function inRegion(x: number, region?: WheelRegion): boolean {
  if (region?.xMin !== undefined && x < region.xMin) return false;
  if (region?.xMax !== undefined && x > region.xMax) return false;
  return true;
}

/**
 * Net wheel ticks in one stdin chunk: +1 per wheel-down, -1 per
 * wheel-up. Clicks, releases and drags are ignored. Terminals batch
 * rapid wheel spins into one chunk, so every event is consumed — not
 * just the first. With a region, only events whose pointer column
 * falls inside it count (how the sidebar and main pane scroll apart).
 */
export function parseWheelTicks(str: string, region?: WheelRegion): number {
  let ticks = 0;
  const re = sgrMouseMatcher();
  let match: RegExpExecArray | null;
  while ((match = re.exec(str)) !== null) {
    const btn = parseInt(match[1]!, 10);
    if (btn !== SGR_SCROLL_UP && btn !== SGR_SCROLL_DOWN) continue;
    if (!inRegion(parseInt(match[2]!, 10), region)) continue;
    ticks += btn === SGR_SCROLL_DOWN ? 1 : -1;
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
 * column region. Releases, wheel events and other buttons are dropped.
 */
export function parseMouseClicks(
  str: string,
  region?: WheelRegion
): MouseClick[] {
  const clicks: MouseClick[] = [];
  const re = sgrMouseMatcher();
  let match: RegExpExecArray | null;
  while ((match = re.exec(str)) !== null) {
    if (match[1] !== '0' || match[4] !== 'M') continue;
    const x = parseInt(match[2]!, 10);
    if (!inRegion(x, region)) continue;
    clicks.push({ x, y: parseInt(match[3]!, 10) });
  }
  return clicks;
}

// Several consumers can be active at once (sidebar + a reviews pane,
// split by region), so the DECSET enable/disable writes are
// refcounted — enable on the first, disable when the last leaves.
let mouseUsers = 0;
function acquireMouse(stdout: NodeJS.WriteStream): void {
  if (mouseUsers++ === 0) stdout.write(ENABLE_MOUSE);
}
function releaseMouse(stdout: NodeJS.WriteStream): void {
  if (--mouseUsers === 0) stdout.write(DISABLE_MOUSE);
}

/**
 * Scroll-wheel support. Enables SGR mouse tracking while active and
 * reports net wheel ticks per stdin chunk (positive = down). Consumers
 * scale ticks to their own unit (rows, items, …).
 */
export function useScrollWheel(
  active: boolean,
  onWheel: (ticks: number) => void,
  region?: WheelRegion
): void {
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const xMin = region?.xMin;
  const xMax = region?.xMax;

  useEffect(() => {
    if (!active || !stdin || !stdout) return;
    const out = stdout as NodeJS.WriteStream;
    acquireMouse(out);
    const handler = (data: Buffer) => {
      const ticks = parseWheelTicks(data.toString('utf8'), { xMin, xMax });
      if (ticks !== 0) onWheel(ticks);
    };
    stdin.on('data', handler);
    return () => {
      stdin.off('data', handler);
      releaseMouse(out);
    };
  }, [active, stdin, stdout, onWheel, xMin, xMax]);
}

/**
 * Left-click support, sharing the wheel hook's refcounted mouse mode.
 * Mouse reporting steals plain clicks from the terminal, so a consumer
 * that wants click behaviour (the sidebar: select a row / open a PR
 * link) has to handle the report itself.
 */
export function useMouseClicks(
  active: boolean,
  onClick: (click: MouseClick) => void,
  region?: WheelRegion
): void {
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const xMin = region?.xMin;
  const xMax = region?.xMax;

  useEffect(() => {
    if (!active || !stdin || !stdout) return;
    const out = stdout as NodeJS.WriteStream;
    acquireMouse(out);
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
      releaseMouse(out);
    };
  }, [active, stdin, stdout, onClick, xMin, xMax]);
}
