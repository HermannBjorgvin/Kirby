#!/usr/bin/env node
/**
 * Runs the desktop e2e suite headlessly, inside its own X server.
 *
 * Electron has no usable headless mode of its own, so the tests need a
 * display. Using the developer's real one is a trap in both directions:
 * the app steals focus while the suite runs, and — worse — whatever the
 * developer does meanwhile (typing into the window, raising another one
 * over it) changes what the tests see. Screenshot comparisons and
 * Playwright's actionability checks are both sensitive to it.
 *
 * So: always run under xvfb on Linux, whether or not DISPLAY is set.
 * Set KIRBY_E2E_HEADED=1 to watch the run on your own display instead.
 */
import { spawnSync } from 'node:child_process';

const passthrough = process.argv.slice(2);

// The screenshot suite is meaningful only inside the pinned container
// (see run-visual.mjs), so a plain run leaves it out rather than
// failing it against baselines drawn by a different renderer. A caller
// that selects tests itself — run-visual.mjs does — is left alone.
const selectsTests = passthrough.some((a) => a.startsWith('--grep'));
const playwright = [
  'npx',
  'playwright',
  'test',
  ...(selectsTests ? [] : ['--grep-invert', '@visual']),
  ...passthrough,
];

const headed = process.env.KIRBY_E2E_HEADED === '1';
const wantsXvfb = process.platform === 'linux' && !headed;
const hasXvfb =
  wantsXvfb &&
  spawnSync('which', ['xvfb-run'], { stdio: 'ignore' }).status === 0;

if (wantsXvfb && !hasXvfb) {
  if (!process.env.DISPLAY) {
    console.error(
      '[desktop-e2e] No DISPLAY and no xvfb-run on PATH.\n' +
        '              Install xvfb (apt-get install -y xvfb) or run under a desktop session.'
    );
    process.exit(1);
  }
  console.warn(
    '[desktop-e2e] xvfb-run not found — falling back to DISPLAY=' +
      `${process.env.DISPLAY}. The run will use your real display, so\n` +
      '              interacting with your desktop can affect the results.'
  );
}

const [cmd, ...args] = hasXvfb
  ? ['xvfb-run', '-a', '-s', '-screen 0 1600x1000x24', ...playwright]
  : playwright;

const res = spawnSync(cmd, args, { stdio: 'inherit' });
process.exit(res.status ?? 1);
