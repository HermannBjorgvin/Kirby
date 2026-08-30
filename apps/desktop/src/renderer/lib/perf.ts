/**
 * Boot milestones, as `performance.mark`s on the renderer's timeline.
 *
 * Startup is the one thing a user feels before they can do anything
 * about it, and "it feels slow" is not a number. These marks give the
 * three moments that actually matter — the bundle finished evaluating,
 * the shell is on screen, the sidebar has real rows — timestamped from
 * `performance.timeOrigin`, so the perf harness
 * (`apps/desktop-e2e/perf/`) can read them out of a released build with
 * no instrumentation of its own, and so can anyone with devtools open.
 *
 * A mark is a few microseconds and never fires twice, so this costs
 * nothing to leave in.
 */

const seen = new Set<string>();

export const BOOT_MARKS = {
  /** Renderer entry module evaluated; React is about to mount. */
  boot: 'kirby:boot',
  /** The workspace shell (title bar, sidebar frame, editor area) mounted. */
  shell: 'kirby:shell',
  /** The sidebar painted its first real row from the host. */
  sidebar: 'kirby:sidebar',
} as const;

/** Mark `name` the first time it happens, and never again. */
export function markOnce(name: string): void {
  if (seen.has(name)) return;
  seen.add(name);
  try {
    performance.mark(name);
  } catch {
    // A host without the User Timing API still runs the app.
  }
}

/**
 * Time a host round trip onto the renderer's performance timeline as
 * `kirby:diff:<name>`, alongside the diff worker's own measures.
 *
 * The point is to be able to say which half of a slow tab open is
 * ours. Measured that way once already: opening a 40-file pull request
 * took 851 ms, of which the host — a whole-file `git diff` and the IPC
 * carrying a megabyte of patch back — was 42 ms. Everything else was
 * the renderer, and without this number it looked like git.
 */
export async function measured<T>(
  name: string,
  run: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    try {
      performance.measure(`kirby:diff:${name}`, {
        start,
        end: performance.now(),
      });
    } catch {
      // Timing must never break the thing being timed.
    }
  }
}
