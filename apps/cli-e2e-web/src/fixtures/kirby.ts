/* eslint-disable react-hooks/rules-of-hooks -- `use` is Playwright's fixture callback, not a React hook */
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTestRepo, createTestRepo } from '../setup/git-repo.js';

export interface KirbyOptions {
  kirbyConfig?: Record<string, unknown>;
  kirbyEnv?: Record<string, string>;
  cols: number;
  rows: number;
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
  sessionId: string;
  repoPath: string;
  homeDir: string;
}

export const test = base.extend<KirbyOptions & { kirby: KirbySession }>({
  kirbyConfig: [undefined, { option: true }],
  kirbyEnv: [undefined, { option: true }],
  cols: [100, { option: true }],
  rows: [30, { option: true }],

  kirby: async ({ page, baseURL, kirbyConfig, kirbyEnv, cols, rows }, use) => {
    const host = baseURL ?? 'http://localhost:5174';
    const sessionId = randomUUID();
    const repoPath = createTestRepo();
    const homeDir = mkdtempSync(join(tmpdir(), 'kirby-e2e-web-home-'));
    await mkdir(join(homeDir, '.kirby'), { recursive: true });
    if (kirbyConfig) {
      await writeFile(
        join(homeDir, '.kirby', 'config.json'),
        JSON.stringify(kirbyConfig, null, 2)
      );
    }

    const spawnRes = await fetch(`${host}/__spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        repoPath,
        homeDir,
        cols,
        rows,
        env: kirbyEnv,
      }),
    });
    if (!spawnRes.ok) {
      throw new Error(
        `POST /__spawn failed: ${spawnRes.status} ${await spawnRes.text()}`
      );
    }

    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      consoleMessages.push(`[browser:${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleMessages.push(`[browser:pageerror] ${err.message}`);
    });

    await page.goto(`/?session=${encodeURIComponent(sessionId)}`);
    const root = page.locator('#wterm-root');
    await root.click();

    // Wait for Kirby's initial render. CI cold-start can take several seconds
    // (fresh Node, wterm WASM init, Ink first paint) — per-assertion 5s default
    // is too tight. Fail loudly here with a big timeout so individual tests
    // don't have to worry about the cold start.
    await expect(page.getByText('Kirby').first()).toBeVisible({
      timeout: 30_000,
    });

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
      await use({ term, sessionId, repoPath, homeDir });
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
        await fetch(`${host}/__kill?session=${encodeURIComponent(sessionId)}`, {
          method: 'POST',
        });
      } catch {
        /* best effort */
      }
      cleanupTestRepo(repoPath);
      try {
        await rm(homeDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  },
});

export { expect };
