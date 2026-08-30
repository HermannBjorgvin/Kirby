#!/usr/bin/env node
/**
 * Runs the desktop benchmarks headlessly, inside their own X server —
 * same reasoning as run-e2e.mjs, and more so here: anything the
 * developer does on a shared display lands in the numbers.
 *
 *   node run-perf.mjs                       # every scenario
 *   node run-perf.mjs --grep startup        # one of them
 *   KIRBY_PERF_LABEL=before node run-perf.mjs
 *
 * Results are written to perf-output/<label>.<scenario>.json; compare
 * two labels with `node perf/report.mjs before after`.
 */
import { spawnSync } from 'node:child_process';

const playwright = [
  'npx',
  'playwright',
  'test',
  '--config',
  'perf.config.ts',
  ...process.argv.slice(2),
];

const headed = process.env.KIRBY_E2E_HEADED === '1';
const wantsXvfb = process.platform === 'linux' && !headed;
const hasXvfb =
  wantsXvfb &&
  spawnSync('which', ['xvfb-run'], { stdio: 'ignore' }).status === 0;

if (wantsXvfb && !hasXvfb && !process.env.DISPLAY) {
  console.error(
    '[desktop-perf] No DISPLAY and no xvfb-run on PATH.\n' +
      '               Install xvfb (apt-get install -y xvfb).'
  );
  process.exit(1);
}

const [cmd, ...args] = hasXvfb
  ? ['xvfb-run', '-a', '-s', '-screen 0 1600x1000x24', ...playwright]
  : playwright;

const res = spawnSync(cmd, args, { stdio: 'inherit' });
process.exit(res.status ?? 1);
