/* eslint-disable react-hooks/rules-of-hooks -- `use` is Playwright's fixture callback, not a React hook */
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
}

const FAKE_AGENT_PATH = fileURLToPath(
  new URL('./fake-agent.mjs', import.meta.url)
);

/**
 * Returns a shell command (suitable for `kirbyConfig.aiCommand`) that
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
  return ['node', FAKE_AGENT_PATH, ...flags].join(' ');
}

export interface KirbyOptions {
  kirbyConfig?: Record<string, unknown>;
  kirbyEnv?: Record<string, string>;
  cols: number;
  rows: number;
  /**
   * Override the repo path Kirby runs against. If unset, the fixture
   * creates a fresh git-init'd tempdir per test and cleans it up on
   * teardown. If set, the fixture uses the given path as-is and leaves
   * it alone on teardown (caller owns the directory's lifecycle —
   * useful for module-scope clones of real test repos in
   * integration tests).
   */
  kirbyRepoPath?: string;
}

export interface KirbyTerm {
  page: Page;
  root: Locator;
  getByText: Page['getByText'];
  press(key: string): Promise<void>;
  type(text: string, opts?: { delay?: number }): Promise<void>;
  write(bytes: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
}

export interface KirbySession {
  term: KirbyTerm;
  repoPath: string;
  homeDir: string;
}

export const test = base.extend<KirbyOptions & { kirby: KirbySession }>({
  kirbyConfig: [undefined, { option: true }],
  kirbyEnv: [undefined, { option: true }],
  cols: [100, { option: true }],
  rows: [30, { option: true }],
  kirbyRepoPath: [undefined, { option: true }],

  kirby: async (
    { page, baseURL, kirbyConfig, kirbyEnv, cols, rows, kirbyRepoPath },
    use
  ) => {
    const host = baseURL ?? 'http://localhost:5174';
    const ownsRepo = !kirbyRepoPath;
    const repoPath = kirbyRepoPath ?? createTestRepo();
    const homeDir = mkdtempSync(join(tmpdir(), 'kirby-e2e-web-home-'));
    await mkdir(join(homeDir, '.kirby'), { recursive: true });
    if (kirbyConfig) {
      await writeFile(
        join(homeDir, '.kirby', 'config.json'),
        JSON.stringify(kirbyConfig, null, 2)
      );
    }

    const spawnRes = await fetch(`${host}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoPath,
        homeDir,
        cols,
        rows,
        env: kirbyEnv,
      }),
    });
    if (!spawnRes.ok) {
      throw new Error(
        `POST /spawn failed: ${spawnRes.status} ${await spawnRes.text()}`
      );
    }

    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      consoleMessages.push(`[browser:${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleMessages.push(`[browser:pageerror] ${err.message}`);
    });

    await page.goto('/');
    const root = page.locator('#wterm-root');

    // Wait for Kirby's first render. Cold-start + any WS reconnect cycles
    // can take several seconds on CI runners.
    // Using locator.waitFor() (not `expect`) keeps this out of the
    // `playwright/no-standalone-expect` eslint rule's scope — this is
    // readiness plumbing, not a test assertion.
    await page
      .getByText('Kirby')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    const term: KirbyTerm = {
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

    try {
      await use({ term, repoPath, homeDir });
    } catch (err) {
      if (consoleMessages.length) {
        console.error(
          `[kirby fixture] browser console while test failed:\n${consoleMessages.join(
            '\n'
          )}`
        );
      }
      throw err;
    } finally {
      try {
        await fetch(`${host}/kill`, { method: 'POST' });
      } catch {
        /* best effort */
      }
      if (ownsRepo) cleanupTestRepo(repoPath);
      try {
        await rm(homeDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  },
});

export { expect };
