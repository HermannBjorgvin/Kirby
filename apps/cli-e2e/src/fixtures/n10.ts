import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTestRepo, createTestRepo } from '../setup/git-repo.js';
import { killFixtureSessions, fixtureSessionScreens } from '../setup/tmux.js';

// ── fakeAgentCommand ───────────────────────────────────────────────

export interface FakeAgentOpts {
  banner?: string;
  bursts?: number | 'inf';
  burstMs?: number;
  burstBytes?: number;
  idleMs?: number;
  silent?: boolean;
  echo?: boolean;
  echoDelayMs?: number;
  exitAfterMs?: number;
  exitOnInput?: boolean;
}

const FAKE_AGENT_PATH = fileURLToPath(
  new URL('./fake-agent.mjs', import.meta.url)
);

/**
 * Returns a shell command (suitable for `n10Config.aiCommand`) that
 * spawns the fake-agent harness with the given scenario. See
 * `fake-agent.mjs` for the full flag reference.
 */
export function fakeAgentCommand(opts: FakeAgentOpts = {}): string {
  const flags: string[] = [];
  if (opts.banner != null) flags.push(`--banner=${opts.banner}`);
  if (opts.bursts != null) flags.push(`--bursts=${opts.bursts}`);
  if (opts.burstMs != null) flags.push(`--burst-ms=${opts.burstMs}`);
  if (opts.burstBytes != null) flags.push(`--burst-bytes=${opts.burstBytes}`);
  if (opts.idleMs != null) flags.push(`--idle-ms=${opts.idleMs}`);
  if (opts.silent) flags.push('--silent');
  if (opts.echo) flags.push('--echo');
  if (opts.echoDelayMs != null)
    flags.push(`--echo-delay-ms=${opts.echoDelayMs}`);
  if (opts.exitAfterMs != null)
    flags.push(`--exit-after-ms=${opts.exitAfterMs}`);
  if (opts.exitOnInput) flags.push('--exit-on-input');
  return ['node', FAKE_AGENT_PATH, ...flags].join(' ');
}

export interface N10Options {
  /** Config written to the isolated HOME before launching n10. */
  n10Config?: Record<string, unknown>;
  n10Env?: Record<string, string>;
  cols: number;
  rows: number;
  /**
   * Override the repo path n10 runs against. If unset, the fixture
   * creates a fresh git-init'd tempdir per test and cleans it up on
   * teardown. If set, the fixture uses the given path as-is and leaves
   * it alone on teardown (caller owns the directory's lifecycle —
   * useful for module-scope clones of real test repos in
   * integration tests).
   */
  n10RepoPath?: string;
}

export interface N10Term {
  page: Page;
  root: Locator;
  getByText: Page['getByText'];
  press(key: string): Promise<void>;
  type(text: string, opts?: { delay?: number }): Promise<void>;
  write(bytes: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
}

export interface N10Session {
  term: N10Term;
  repoPath: string;
  homeDir: string;
}

async function stopHost(host: string): Promise<void> {
  const stopped = await fetch(`${host}/kill`, { method: 'POST' });
  if (!stopped.ok) throw new Error(`POST /kill failed: ${stopped.status}`);
}

export const test = base.extend<
  N10Options & { n10: N10Session; fixtureHome: string }
>({
  fixtureHome: async ({ baseURL }, provide) => {
    const homeDir = mkdtempSync(join(tmpdir(), 'n10-e2e-web-home-'));
    try {
      await provide(homeDir);
    } finally {
      // HOME is safe to delete only after the host confirms process exit.
      const host = baseURL ?? 'http://localhost:5174';
      await stopHost(host);
      killFixtureSessions(homeDir);
      await rm(homeDir, { recursive: true, force: true });
    }
  },
  n10Config: [undefined, { option: true }],
  n10Env: [undefined, { option: true }],
  cols: [100, { option: true }],
  rows: [30, { option: true }],
  n10RepoPath: [undefined, { option: true }],

  n10: async (
    { page, baseURL, n10Config, n10Env, cols, rows, n10RepoPath, fixtureHome },
    // Playwright's fixture callback. Named `provide` rather than the
    // conventional `use` so it does not read as a React hook call to
    // the react-hooks rules, which run over this workspace.
    provide,
    testInfo
  ) => {
    const host = baseURL ?? 'http://localhost:5174';
    const ownsRepo = !n10RepoPath;
    const repoPath = n10RepoPath ?? createTestRepo();
    const homeDir = fixtureHome;
    await mkdir(join(homeDir, '.n10'), { recursive: true });
    await writeFile(
      join(homeDir, '.n10', 'config.json'),
      JSON.stringify(n10Config ?? {}, null, 2)
    );

    const consoleMessages: string[] = [];
    try {
      const spawnRes = await fetch(`${host}/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath,
          homeDir,
          cols,
          rows,
          // Isolate any tmux the test spawns onto a socket inside the
          // test's temp HOME. A tmux *server* keeps the environment it
          // was started with — a test-spawned server on the user's
          // default socket would outlive the run and poison every later
          // real session with this temp HOME (it did, once).
          //
          // Last, so a test's own env additions cannot override it. The
          // host pins the same value again for the same reason.
          env: { ...n10Env, TMUX_TMPDIR: homeDir },
        }),
      });
      if (!spawnRes.ok) {
        throw new Error(
          `POST /spawn failed: ${spawnRes.status} ${await spawnRes.text()}`
        );
      }

      page.on('console', (msg) => {
        consoleMessages.push(`[browser:${msg.type()}] ${msg.text()}`);
      });
      page.on('pageerror', (err) => {
        consoleMessages.push(`[browser:pageerror] ${err.message}`);
      });

      await page.goto('/');
      const root = page.locator('#wterm-root');

      // Wait for n10's first render. Cold-start + any WS reconnect cycles
      // can take several seconds on CI runners.
      // Using locator.waitFor() (not `expect`) keeps this out of the
      // `playwright/no-standalone-expect` eslint rule's scope — this is
      // readiness plumbing, not a test assertion.
      await page
        .getByText('n10')
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });

      const term: N10Term = {
        page,
        root,
        getByText: page.getByText.bind(page),
        press: (key) => page.keyboard.press(key),
        type: (text, opts) =>
          page.keyboard.type(text, { delay: opts?.delay ?? 80 }),
        write: async (bytes) => {
          await page.evaluate(
            (b) =>
              (
                window as unknown as {
                  __wterm: { send(s: string): void };
                }
              ).__wterm.send(b),
            bytes
          );
        },
        resize: async (c, r) => {
          await page.evaluate(
            ({ c, r }) =>
              (
                window as unknown as {
                  __wterm: { resize(c: number, r: number): void };
                }
              ).__wterm.resize(c, r),
            { c, r }
          );
        },
      };

      await provide({ term, repoPath, homeDir });
    } catch (err) {
      if (consoleMessages.length) {
        console.error(
          `[n10 fixture] browser console while test failed:\n${consoleMessages.join(
            '\n'
          )}`
        );
      }
      throw err;
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('tmux-state', {
          body: JSON.stringify(fixtureSessionScreens(homeDir), null, 2),
          contentType: 'application/json',
        });
      }
      try {
        await stopHost(host);
      } finally {
        if (ownsRepo) cleanupTestRepo(repoPath);
      }
    }
  },
});

export { expect };
