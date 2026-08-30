import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { installFakeGh, type FakeGitHub } from '../../src/setup/fake-gh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, '..', '..', '..', 'desktop');
const WORKSPACE_ROOT = resolve(APP_DIR, '..', '..');

/**
 * A bare launch of the built app, for benchmarking.
 *
 * Deliberately not the e2e fixture: that one shows, focuses and
 * un-throttles the window *before* the first assertion, which is right
 * for a test (Playwright's actionability check needs stable frames) and
 * wrong for a measurement — it hides the window's own paint from the
 * numbers and adds a round trip in the middle of startup. Here the app
 * is launched and then left alone until it has painted.
 */
export interface PerfApp {
  app: ElectronApplication;
  page: Page;
  /** Wall-clock ms from `electron.launch()` to the first window object. */
  launchMs: number;
  close(): Promise<void>;
}

export interface LaunchOptions {
  repoPath: string;
  kirbyConfig?: Record<string, unknown>;
  projectConfig?: Record<string, unknown>;
  fakeGitHub?: FakeGitHub;
}

function seedHome(
  homeDir: string,
  opts: LaunchOptions
): Record<string, string> {
  const kirby = join(homeDir, '.kirby');
  mkdirSync(kirby, { recursive: true });
  writeFileSync(
    join(kirby, 'config.json'),
    JSON.stringify({ aiCommand: 'true', ...opts.kirbyConfig }, null, 2),
    'utf8'
  );
  if (opts.projectConfig) {
    const key = createHash('sha256')
      .update(opts.repoPath)
      .digest('hex')
      .slice(0, 16);
    const dir = join(kirby, 'projects', key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify(opts.projectConfig, null, 2),
      'utf8'
    );
  }
  return opts.fakeGitHub ? installFakeGh(homeDir, opts.fakeGitHub) : {};
}

export async function launchApp(opts: LaunchOptions): Promise<PerfApp> {
  const homeDir = mkdtempSync(join(tmpdir(), 'kirby-perf-home-'));
  const ghEnv = seedHome(homeDir, opts);

  const parentEnv = { ...process.env };
  delete parentEnv.WAYLAND_DISPLAY;
  delete parentEnv.EDITOR;
  delete parentEnv.VISUAL;

  const started = Date.now();
  const app = await electron.launch({
    args: [APP_DIR, '--no-sandbox', '--disable-gpu', '--ozone-platform=x11'],
    cwd: WORKSPACE_ROOT,
    env: {
      ...parentEnv,
      HOME: homeDir,
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      KIRBY_START_DIR: opts.repoPath,
      KIRBY_DESKTOP_VERSION: 'perf',
      TMUX_TMPDIR: homeDir,
      ...ghEnv,
    },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const launchMs = Date.now() - started;

  return {
    app,
    page,
    launchMs,
    close: async () => {
      try {
        await app.close();
      } catch {
        /* already gone */
      }
      await rm(homeDir, { recursive: true, force: true }).catch(
        () => undefined
      );
    },
  };
}

/**
 * Un-throttle the window. Chromium slows `requestAnimationFrame` in a
 * window it thinks is hidden, which under xvfb is always — so an
 * interaction benchmark that skipped this would measure the throttle
 * rather than the app. Startup measurements deliberately do NOT call
 * this; they read timings the browser recorded on its own.
 */
export async function unthrottle(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.webContents.setBackgroundThrottling(false);
    win.show();
    win.focus();
  });
}
