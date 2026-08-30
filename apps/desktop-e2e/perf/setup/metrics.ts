import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElectronApplication, Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = resolve(HERE, '..', '..', 'perf-output');

/**
 * Where a benchmark run's numbers go, and how they are compared.
 *
 * Every scenario writes one JSON file of samples per run; `report.mjs`
 * reads them back. A run is labelled (KIRBY_PERF_LABEL, defaulting to
 * the git description) so a before/after pair can sit side by side —
 * a single absolute number from one machine says nothing on its own.
 */
export type Samples = Record<string, number[]>;

export function label(): string {
  return process.env.KIRBY_PERF_LABEL ?? 'current';
}

export function saveSamples(scenario: string, samples: Samples): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `${label()}.${scenario}.json`);
  writeFileSync(file, JSON.stringify(samples, null, 2), 'utf8');
  console.log(`\n[perf] ${scenario} → ${file}`);
  console.log(formatSamples(samples));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function formatSamples(samples: Samples): string {
  const rows = Object.entries(samples).map(([k, v]) => {
    const sorted = [...v].sort((a, b) => a - b);
    return [
      k.padEnd(28),
      `median ${median(v).toFixed(1).padStart(9)}`,
      `min ${(sorted[0] ?? NaN).toFixed(1).padStart(9)}`,
      `max ${(sorted[sorted.length - 1] ?? NaN).toFixed(1).padStart(9)}`,
      `n=${v.length}`,
    ].join('  ');
  });
  return rows.join('\n');
}

/** Merge a scenario's per-iteration record into the accumulating samples. */
export function collect(into: Samples, one: Record<string, number>): void {
  for (const [k, v] of Object.entries(one)) {
    if (!Number.isFinite(v)) continue;
    (into[k] ??= []).push(v);
  }
}

export function readSamples(file: string): Samples {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Samples;
}

// ── In-page collectors ───────────────────────────────────────────

/**
 * Boot timings, all relative to `performance.timeOrigin` so they are
 * directly comparable: navigation start is zero for every one of them.
 *
 * Deliberately no resource or long-task figures here. The window loads
 * over `file://`, where Chromium records no resource timing at all, and
 * a long task can only be seen by an observer that was already running
 * when it happened — there is no way to install one before the page's
 * own first script. Both would report a confident zero. Bundle weight
 * is a build-time number (`nx build desktop` prints it); startup work
 * shows up here as the gap between `bootMark` and `shellMark`.
 */
export async function bootMetrics(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const at = (name: string, type: string): number =>
      performance.getEntriesByName(name, type)[0]?.startTime ?? NaN;
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      domContentLoaded: nav?.domContentLoadedEventEnd ?? NaN,
      fcp: at('first-contentful-paint', 'paint'),
      bootMark: at('kirby:boot', 'mark'),
      shellMark: at('kirby:shell', 'mark'),
      sidebarMark: at('kirby:sidebar', 'mark'),
    };
  });
}

/**
 * Wait until the window has finished booting *and* painted.
 *
 * Both halves are needed. The boot marks are recorded in effects, which
 * React runs after commit but before the browser paints — so waiting on
 * `kirby:sidebar` alone can win the race against first-contentful-paint
 * and read a timeline that has no paint entry in it yet. Waiting on the
 * paint alone would be worse: it happens long before the sidebar has
 * anything in it.
 */
export async function waitForBoot(page: Page, timeout: number): Promise<void> {
  await page.waitForFunction(
    () =>
      performance.getEntriesByName('kirby:sidebar', 'mark').length > 0 &&
      performance.getEntriesByName('first-contentful-paint', 'paint').length >
        0,
    undefined,
    { timeout }
  );
}

/**
 * Main-process boot milestones, timed from process start.
 *
 * This is the half the renderer cannot see: everything before there is
 * a window to navigate. Read out of the running app rather than
 * inferred from wall clock, so Playwright's own launch handshake stays
 * out of the numbers.
 */
export async function mainMetrics(
  app: ElectronApplication
): Promise<Record<string, number>> {
  return app.evaluate(() => {
    const at = (name: string): number =>
      performance.getEntriesByName(name, 'mark')[0]?.startTime ?? NaN;
    return {
      mainModule: at('kirby:main:module'),
      mainReady: at('kirby:main:ready'),
      mainRepo: at('kirby:main:repo'),
      mainWindow: at('kirby:main:window'),
    };
  });
}

/**
 * Install a long-task + frame recorder, run `body`, and report what the
 * main thread did meanwhile.
 *
 * `blockingMs` is the part of each long task over 50 ms, which is the
 * INP-style measure of "input would have waited this long" — a better
 * proxy for a janky scroll than raw duration, because a 51 ms task and
 * a 400 ms task are not the same kind of bad.
 */
export async function duringInteraction<T>(
  page: Page,
  body: () => Promise<T>
): Promise<{ result: T; metrics: Record<string, number> }> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __perf?: { tasks: number[]; frames: number[]; stop: () => void };
    };
    w.__perf?.stop();
    const tasks: number[] = [];
    const frames: number[] = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) tasks.push(e.duration);
    });
    obs.observe({ type: 'longtask', buffered: false });
    let last = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    w.__perf = {
      tasks,
      frames,
      stop: () => {
        obs.disconnect();
        cancelAnimationFrame(raf);
      },
    };
  });

  const result = await body();

  const metrics = await page.evaluate(() => {
    const w = window as unknown as {
      __perf: { tasks: number[]; frames: number[]; stop: () => void };
    };
    w.__perf.stop();
    const { tasks, frames } = w.__perf;
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return {
      taskMs: tasks.reduce((a, b) => a + b, 0),
      blockingMs: tasks.reduce((a, b) => a + Math.max(0, b - 50), 0),
      taskCount: tasks.length,
      longestTaskMs: tasks.reduce((a, b) => Math.max(a, b), 0),
      frameP95Ms: p95,
      framesOver32ms: frames.filter((f) => f > 32).length,
    };
  });

  return { result, metrics };
}

/**
 * What the diff workers were asked for and how long each answer took,
 * from `kirby:diff:*` measures the worker client records.
 *
 * Reported as the count and the worst case rather than a mean: the
 * number a reviewer notices is the one file that took a while, not the
 * average over twenty they never looked at.
 */
export async function workerPhases(
  page: Page
): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const of = (name: string) =>
      performance.getEntriesByName(`kirby:diff:${name}`, 'measure');
    const worst = (xs: PerformanceEntry[]) =>
      xs.reduce((a, e) => Math.max(a, e.duration), 0);
    const total = (xs: PerformanceEntry[]) =>
      xs.reduce((a, e) => a + e.duration, 0);
    const analyze = of('analyze');
    return {
      parseMs: worst(of('parse')),
      analyzeCount: analyze.length,
      analyzeWorstMs: worst(analyze),
      analyzeTotalMs: total(analyze),
    };
  });
}

/**
 * What the app costs while nobody is touching it.
 *
 * A window sitting open still polls the host for sessions, agent
 * activity, draft comments and the sidebar model, and each of those is
 * an IPC call that runs git or reads config on the other side and a
 * React render on this one. Left uncounted it is invisible; on a laptop
 * it is the fan.
 *
 * `idleCpuPct` is the number that matters, and it is Electron's own:
 * summed `percentCPUUsage` across every process in the app since the
 * previous call — hence the discarded first reading. It is the only one
 * that sees the git subprocesses and config reads happening on the
 * other side of the IPC.
 *
 * The renderer figures beside it are long tasks only, so they normally
 * read zero: a poll handler that blocks the main thread for over 50 ms
 * is a finding, not a baseline.
 */
export async function idleCost(
  page: Page,
  app: ElectronApplication,
  windowMs: number
): Promise<Record<string, number>> {
  await app.evaluate(({ app: a }) => a.getAppMetrics());
  const { metrics } = await duringInteraction(page, () =>
    page.evaluate(
      (ms: number) => new Promise((r) => setTimeout(r, ms)),
      windowMs
    )
  );
  const cpu = await app.evaluate(({ app: a }) =>
    a.getAppMetrics().reduce((sum, m) => sum + (m.cpu?.percentCPUUsage ?? 0), 0)
  );
  return {
    idleCpuPct: cpu,
    idleTaskMs: metrics.taskMs,
    idleTaskCount: metrics.taskCount,
    idleLongestTaskMs: metrics.longestTaskMs,
  };
}

/** Renderer heap, as the OS-visible cost of holding a diff open. */
export async function heapMb(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (
      performance as unknown as { memory?: { usedJSHeapSize: number } }
    ).memory;
    return m ? m.usedJSHeapSize / (1024 * 1024) : NaN;
  });
}
