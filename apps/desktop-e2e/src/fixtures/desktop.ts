import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createHash } from 'node:crypto';
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
import {
  fakeGhProjectConfig,
  installFakeGh,
  type FakeGitHub,
} from '../setup/fake-gh.js';

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
  opts: {
    stream?: boolean;
    intervalMs?: number;
    exitAfterMs?: number;
    /** Echo stdin back, for testing the input round trip. */
    echo?: boolean;
    /** Stop streaming after this long, but stay alive. */
    streamMs?: number;
    /** Print the seed prompt the launcher handed it, `seed:`-prefixed. */
    printSeed?: boolean;
  } = {}
): string {
  const flags = [`--banner=kirby-fake-agent-ready`];
  if (opts.stream) flags.push('--stream');
  if (opts.echo) flags.push('--echo');
  if (opts.printSeed) flags.push('--print-seed');
  if (opts.streamMs != null) flags.push(`--stream-ms=${opts.streamMs}`);
  if (opts.intervalMs != null) flags.push(`--interval-ms=${opts.intervalMs}`);
  if (opts.exitAfterMs != null)
    flags.push(`--exit-after-ms=${opts.exitAfterMs}`);
  return ['node', FAKE_AGENT, ...flags].join(' ');
}

export interface DesktopOptions {
  /** Written to $HOME/.kirby/config.json before launch. */
  kirbyConfig?: Record<string, unknown>;
  /**
   * Per-project config (vendor, org, repo…), written to the cwd-hashed
   * path the config store reads it from. Needed for anything gated on a
   * configured provider — the settings page only lists a provider's
   * auth fields once one is selected.
   */
  projectConfig?: Record<string, unknown>;
  /** Written to $HOME/.kirby/desktop-prefs.json before launch. */
  desktopPrefs?: Record<string, unknown>;
  /** Seed options for the per-test git repo. */
  repo?: TestRepoOptions;
  /**
   * Start with no repo open (the repo picker screen) instead of
   * pointing KIRBY_START_DIR at the test repo.
   */
  startWithoutRepo?: boolean;
  /**
   * Open this path instead of a freshly created throwaway repo. The
   * caller owns its lifecycle — used by the integration tests, which
   * clone the shared sandbox repo once per file.
   */
  repoPathOverride?: string;
  /**
   * Agent-authored draft review comments, keyed by pull request id, as
   * `kirby util add-comment` would have left them.
   */
  drafts?: Record<number, unknown[]>;
  /**
   * Serve the app a pull request (and its review threads) from a fake
   * `gh` on PATH, with the matching project config written for it.
   * Lets the whole review workspace be driven offline; ignored when
   * `githubToken` is set, which is the real thing.
   */
  fakeGitHub?: FakeGitHub;
  /**
   * Hand the app a GitHub token. Its HOME is isolated, so the `gh` CLI
   * it authenticates through cannot see the developer's stored
   * credentials; without this it behaves as a repo with no provider.
   */
  githubToken?: string;
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

/**
 * Write the isolated `$HOME` a test runs against: global config, the
 * per-project config (cwd-hashed, as the config store keys it), any
 * agent-authored drafts, desktop prefs, and — when a scenario is given
 * — the fake `gh`. Returns the environment additions the app needs.
 *
 * Split out of the fixture body because it is the part that grows: one
 * more thing to seed is one more branch, and the fixture itself is
 * about launching and tearing down the app.
 */
function seedHome(
  homeDir: string,
  repoPath: string,
  opts: {
    kirbyConfig?: Record<string, unknown>;
    projectConfig?: Record<string, unknown>;
    desktopPrefs?: Record<string, unknown>;
    drafts?: Record<number, unknown[]>;
    fakeGitHub?: FakeGitHub;
  }
): Record<string, string> {
  const kirby = join(homeDir, '.kirby');
  mkdirSync(kirby, { recursive: true });
  writeFileSync(
    join(kirby, 'config.json'),
    JSON.stringify({ aiCommand: fakeAgent(), ...opts.kirbyConfig }, null, 2),
    'utf8'
  );

  const projectConfig =
    opts.projectConfig ??
    (opts.fakeGitHub ? fakeGhProjectConfig(opts.fakeGitHub) : undefined);
  if (projectConfig) {
    // Per-project config lives under a hash of the repo path — see
    // projectKey() in @kirby/vcs-core's config store.
    const key = createHash('sha256')
      .update(repoPath)
      .digest('hex')
      .slice(0, 16);
    const dir = join(kirby, 'projects', key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify(projectConfig, null, 2),
      'utf8'
    );
  }

  for (const [prId, comments] of Object.entries(opts.drafts ?? {})) {
    // Same layout the review agent writes to: ~/.kirby/reviews/pr-<id>.
    const dir = join(kirby, 'reviews', `pr-${prId}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'comments.json'),
      JSON.stringify({ prId: Number(prId), comments }, null, 2),
      'utf8'
    );
  }

  if (opts.desktopPrefs) {
    writeFileSync(
      join(kirby, 'desktop-prefs.json'),
      JSON.stringify(opts.desktopPrefs, null, 2),
      'utf8'
    );
  }

  return opts.fakeGitHub ? installFakeGh(homeDir, opts.fakeGitHub) : {};
}

export const test = base.extend<DesktopOptions & { desktop: DesktopApp }>({
  kirbyConfig: [undefined, { option: true }],
  projectConfig: [undefined, { option: true }],
  desktopPrefs: [undefined, { option: true }],
  repo: [undefined, { option: true }],
  startWithoutRepo: [false, { option: true }],
  repoPathOverride: [undefined, { option: true }],
  githubToken: [undefined, { option: true }],
  drafts: [undefined, { option: true }],
  fakeGitHub: [undefined, { option: true }],

  desktop: async (
    {
      kirbyConfig,
      projectConfig,
      desktopPrefs,
      repo,
      startWithoutRepo,
      repoPathOverride,
      githubToken,
      drafts,
      fakeGitHub,
    },
    // Playwright's fixture callback. Named `provide` rather than the
    // conventional `use` so it does not read as a React hook call to
    // the react-hooks rules, which run over this workspace.
    provide,
    testInfo
  ) => {
    const ownsRepo = !repoPathOverride;
    const repoPath = repoPathOverride ?? createTestRepo(repo ?? {});
    const homeDir = mkdtempSync(join(tmpdir(), 'kirby-desktop-e2e-home-'));
    const ghEnv = seedHome(homeDir, repoPath, {
      kirbyConfig,
      projectConfig,
      desktopPrefs,
      drafts,
      fakeGitHub,
    });

    // On a Wayland session Electron talks to the compositor through
    // WAYLAND_DISPLAY and ignores DISPLAY altogether — so xvfb hands it
    // a virtual X server it never looks at, and the window opens on the
    // developer's real desktop anyway. Dropping the variable (and
    // pinning ozone to x11) is what actually makes the run headless.
    const parentEnv = { ...process.env };
    delete parentEnv.WAYLAND_DISPLAY;
    // The app reads these as fallbacks when no editor is configured, so
    // inheriting whatever the developer happens to export makes the
    // "no editor" path pass here and fail on a colleague's machine (or
    // the reverse). Tests that want one set it through config.
    delete parentEnv.EDITOR;
    delete parentEnv.VISUAL;

    const app = await electron.launch({
      args: [
        APP_DIR,
        // CI runners have no user namespaces for the sandbox, and
        // software rendering is both available and deterministic.
        '--no-sandbox',
        '--disable-gpu',
        '--ozone-platform=x11',
      ],
      cwd: WORKSPACE_ROOT,
      env: {
        ...parentEnv,
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
        ...(githubToken ? { GH_TOKEN: githubToken } : {}),
        // Last, so the fake `gh` wins the PATH lookup.
        ...ghEnv,
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
      await provide({
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
      if (ownsRepo) cleanupTestRepo(repoPath);
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
