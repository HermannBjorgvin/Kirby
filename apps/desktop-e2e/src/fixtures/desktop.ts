/* eslint-disable react-hooks/rules-of-hooks -- `use` is Playwright's fixture callback, not a React hook */
import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupTestRepo,
  createTestRepo,
  type TestRepoOptions,
} from '../setup/git-repo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/desktop — Electron resolves `main` from its package.json. */
const APP_DIR = resolve(HERE, '..', '..', '..', 'desktop');
const WORKSPACE_ROOT = resolve(APP_DIR, '..', '..');
const FAKE_AGENT = join(HERE, 'fake-agent.mjs');

/**
 * `aiCommand` that spawns the fake agent.
 *
 *   fakeAgent()                 → alive but idle (no output after the banner)
 *   fakeAgent({ stream: true }) → continuously producing output
 */
export function fakeAgent(
  opts: { stream?: boolean; intervalMs?: number; exitAfterMs?: number } = {}
): string {
  const flags = [`--banner=kirby-fake-agent-ready`];
  if (opts.stream) flags.push('--stream');
  if (opts.intervalMs != null) flags.push(`--interval-ms=${opts.intervalMs}`);
  if (opts.exitAfterMs != null)
    flags.push(`--exit-after-ms=${opts.exitAfterMs}`);
  return ['node', FAKE_AGENT, ...flags].join(' ');
}

export interface DesktopOptions {
  /** Written to $HOME/.kirby/config.json before launch. */
  kirbyConfig?: Record<string, unknown>;
  /** Written to $HOME/.kirby/desktop-prefs.json before launch. */
  desktopPrefs?: Record<string, unknown>;
  /** Seed options for the per-test git repo. */
  repo?: TestRepoOptions;
  /**
   * Start with no repo open (the repo picker screen) instead of
   * pointing KIRBY_START_DIR at the test repo.
   */
  startWithoutRepo?: boolean;
}

export interface DesktopApp {
  app: ElectronApplication;
  page: Page;
  repoPath: string;
  homeDir: string;
  /** Renderer errors seen so far — the fixture fails the test on any. */
  pageErrors: string[];
  /** Evaluate in the main process (e.g. to inspect host services). */
  main: ElectronApplication['evaluate'];
}

export const test = base.extend<DesktopOptions & { desktop: DesktopApp }>({
  kirbyConfig: [undefined, { option: true }],
  desktopPrefs: [undefined, { option: true }],
  repo: [undefined, { option: true }],
  startWithoutRepo: [false, { option: true }],

  desktop: async (
    { kirbyConfig, desktopPrefs, repo, startWithoutRepo },
    use,
    testInfo
  ) => {
    const repoPath = createTestRepo(repo ?? {});
    const homeDir = mkdtempSync(join(tmpdir(), 'kirby-desktop-e2e-home-'));
    mkdirSync(join(homeDir, '.kirby'), { recursive: true });
    writeFileSync(
      join(homeDir, '.kirby', 'config.json'),
      JSON.stringify({ aiCommand: fakeAgent(), ...kirbyConfig }, null, 2),
      'utf8'
    );
    if (desktopPrefs) {
      writeFileSync(
        join(homeDir, '.kirby', 'desktop-prefs.json'),
        JSON.stringify(desktopPrefs, null, 2),
        'utf8'
      );
    }

    const app = await electron.launch({
      args: [
        APP_DIR,
        // CI runners have no user namespaces for the sandbox, and
        // software rendering is both available and deterministic.
        '--no-sandbox',
        '--disable-gpu',
      ],
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        // Isolates config.json, desktop-prefs.json, recents *and*
        // Electron's own userData dir (so the single-instance lock
        // never makes one test's launch quit against another's).
        HOME: homeDir,
        XDG_CONFIG_HOME: join(homeDir, '.config'),
        KIRBY_START_DIR: startWithoutRepo ? '' : repoPath,
        KIRBY_DESKTOP_VERSION: 'e2e',
        // A tmux server inherits the environment it was started with;
        // pinning the socket dir keeps a test-spawned server off the
        // developer's default socket.
        TMUX_TMPDIR: homeDir,
      },
      timeout: 60_000,
    });

    const page = await app.firstWindow();

    // Chromium throttles requestAnimationFrame in a window it considers
    // hidden or occluded, and under xvfb (or behind another window on a
    // developer's desktop) that is the normal state. Playwright's
    // actionability check waits for two consecutive stable animation
    // frames before it will click, so a throttled window makes every
    // click hang until the timeout even though the page is perfectly
    // idle. Show, focus and un-throttle before any test touches it.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      win.webContents.setBackgroundThrottling(false);
      win.show();
      win.focus();
    });

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.stack ?? err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.waitForLoadState('domcontentloaded');
    if (!startWithoutRepo) {
      // The workspace has rendered (not the repo picker, not a blank
      // window) once the sidebar's actions exist.
      await page
        .getByRole('button', { name: 'New worktree', exact: true })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    }

    let used = false;
    try {
      await use({
        app,
        page,
        repoPath,
        homeDir,
        pageErrors,
        main: app.evaluate.bind(app),
      });
      used = true;
    } finally {
      if (consoleErrors.length) {
        await testInfo.attach('renderer-console-errors', {
          body: consoleErrors.join('\n'),
          contentType: 'text/plain',
        });
      }
      try {
        await app.close();
      } catch {
        /* already gone */
      }
      cleanupTestRepo(repoPath);
      await rm(homeDir, { recursive: true, force: true }).catch(
        () => undefined
      );
    }

    // An uncaught renderer exception blanks a pane behind the
    // ErrorBoundary, which a passing assertion elsewhere would happily
    // ignore. Surface it as a failure of the test that provoked it —
    // but only when the test itself got that far, so a real assertion
    // failure keeps priority.
    if (used && pageErrors.length > 0) {
      throw new Error(
        `Renderer threw during the test:\n${pageErrors.join('\n---\n')}`
      );
    }
  },
});

export { expect };
