/**
 * Boot milestones for the main process, as `performance.mark`s.
 *
 * The renderer's own marks (renderer/lib/perf.ts) only start counting
 * once the window exists, and on this app that is over half of startup
 * already spent: Electron has to boot, the main bundle has to evaluate,
 * and the last repository has to be reopened — resolving worktrees and
 * probing a provider — before there is a window to navigate. Without
 * these marks that whole stretch is one opaque number.
 *
 * Node exposes the same User Timing API as the browser, timed from
 * process start, so `perf/` reads main and renderer milestones the same
 * way and a benchmark can say which half moved.
 */
export const MAIN_MARKS = {
  /** Entry module evaluated — Electron is up, our bundle is loaded. */
  module: 'kirby:main:module',
  /** `app.whenReady()` resolved. */
  ready: 'kirby:main:ready',
  /** The startup repository is open (or there was none). */
  repo: 'kirby:main:repo',
  /** `new BrowserWindow` returned and the load has been kicked off. */
  window: 'kirby:main:window',
} as const;

export function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {
    // Timing is never a reason to fail a launch.
  }
}
