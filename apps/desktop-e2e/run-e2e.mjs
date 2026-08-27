#!/usr/bin/env node
/**
 * Runs the desktop e2e suite, wrapping it in xvfb when there is no X
 * display.
 *
 * Electron always needs a display server — unlike Chromium it has no
 * usable headless mode — so a CI runner (or a bare SSH session) has to
 * supply one. Doing it here rather than in the nx target keeps the
 * command identical on a developer's desktop, where DISPLAY is already
 * set and xvfb never enters the picture.
 */
import { spawnSync } from 'node:child_process';

const passthrough = process.argv.slice(2);
const playwright = ['npx', 'playwright', 'test', ...passthrough];

const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const hasXvfb =
  needsXvfb &&
  spawnSync('which', ['xvfb-run'], { stdio: 'ignore' }).status === 0;

if (needsXvfb && !hasXvfb) {
  console.error(
    '[desktop-e2e] No DISPLAY and no xvfb-run on PATH.\n' +
      '              Install xvfb (apt-get install -y xvfb) or run under a desktop session.'
  );
  process.exit(1);
}

const [cmd, ...args] = hasXvfb
  ? ['xvfb-run', '-a', '-s', '-screen 0 1600x1000x24', ...playwright]
  : playwright;

const res = spawnSync(cmd, args, { stdio: 'inherit' });
process.exit(res.status ?? 1);
