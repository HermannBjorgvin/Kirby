/* eslint-disable react-hooks/rules-of-hooks -- `use` is Playwright's fixture callback, not a React hook */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base } from './fixtures/kirby.js';
import {
  beamHostUnavailableReason,
  startBeamHost,
  type BeamHost,
} from './setup/beam-host.js';

// ── Kirby ↔ beam against a dockerized host ─────────────────────────
//
// The container plays the desktop; Kirby runs under the normal wterm
// harness and reaches it through the real beam CLI and real ssh. Runs
// only via `nx e2e:beam cli-e2e` (tagged @beam) and skips itself when
// docker, bun or the beam checkout is missing.

const unavailable = beamHostUnavailableReason();

// Kirby's own debug log, dumped when an assertion fails: the spawn
// happens inside the app, so its errors are otherwise invisible here.
const kirbyLogPath = join(tmpdir(), `kirby-beam-e2e-${process.pid}.log`);

function dumpKirbyLog(): void {
  if (!existsSync(kirbyLogPath)) return;
  console.error(`[kirby log]\n${readFileSync(kirbyLogPath, 'utf8')}`);
}

let host: BeamHost | null = null;
function getHost(): BeamHost {
  if (!host) host = startBeamHost();
  return host;
}

const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  kirbyEnv: async ({}, use) => {
    await use({
      ...getHost().env,
      KIRBY_LOG: kirbyLogPath,
      KIRBY_LOG_LEVEL: 'debug',
    });
  },
  // eslint-disable-next-line no-empty-pattern
  kirbyProjectConfig: async ({}, use) => {
    await use({
      beamHost: getHost().remote,
      beamRepoPath: getHost().repoPath,
    });
  },
});

test.use({
  kirbyConfig: {
    // Vim preset: plain 'x' deletes. A Backspace keypress does not
    // survive the browser → PTY path the way a literal key does.
    keybindPreset: 'vim',
    // The command runs INSIDE the container (via beam), so it must not
    // reference anything from this machine. The unrecognized command
    // routes to Kirby's hidden test agent, which runs it via sh -c.
    aiCommand: 'echo REMOTE-AGENT-UP && exec sleep 600',
  },
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  dumpKirbyLog();
  const screen = await page
    .evaluate(() => document.querySelector('#wterm-root')?.textContent ?? '')
    .catch(() => '');
  console.error(`[terminal at failure]\n${screen}`);
});

test.afterAll(() => {
  host?.stop();
  host = null;
});

test.describe('@beam sessions on a dockerized beam host', () => {
  test.skip(unavailable !== null, unavailable ?? '');

  test('create on the host, survive a Kirby restart, delete', async ({
    kirby,
    page,
    baseURL,
    cols,
    rows,
  }) => {
    test.setTimeout(240_000);
    const { term } = kirby;
    const h = getHost();

    // ── Create: pick a branch, then pick the host ──
    await term.press('c');
    await expect(term.getByText('Branch Picker')).toBeVisible();
    await term.type('remote-x');
    await term.press('Enter');
    await expect(term.getByText('where?')).toBeVisible();
    await expect(term.getByText('desktop (beam host)')).toBeVisible();
    // Wait for the highlight to actually move onto the host row before
    // confirming: a keypress returns before the terminal has repainted,
    // and an early Enter silently opens the session locally instead.
    await term.press('ArrowDown');
    await expect(term.getByText('› desktop (beam host)')).toBeVisible();
    await term.press('Enter');

    // The sidebar row appears under its host-prefixed key, and the
    // agent's banner proves the command ran in the container worktree.
    await expect(term.getByText('desktop:remote-x').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(term.getByText('REMOTE-AGENT-UP').first()).toBeVisible({
      timeout: 60_000,
    });

    // ── The container really holds the session and the worktree ──
    // Nothing was checked out locally: the whole point of the host.
    expect(existsSync(join(kirby.repoPath, '.claude', 'worktrees'))).toBe(
      false
    );
    await expect(async () => {
      expect(h.sessions().some((s) => s.endsWith('-remote-x'))).toBe(true);
    }).toPass({ timeout: 30_000 });
    const worktrees = h.exec(`ls ${h.repoPath}/.beam/worktrees/`).trim();
    expect(worktrees).toContain('remote-x');
    const branch = h
      .exec(
        `git -C ${h.repoPath}/.beam/worktrees/$(ls ${h.repoPath}/.beam/worktrees/) branch --show-current`
      )
      .trim();
    expect(branch).toBe('remote-x');

    // ── Restart Kirby; the session lives on and reattaches ──
    await fetch(`${baseURL}/kill`, { method: 'POST' });
    const respawn = await fetch(`${baseURL}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoPath: kirby.repoPath,
        homeDir: kirby.homeDir,
        cols,
        rows,
        env: h.env,
      }),
    });
    expect(respawn.ok).toBe(true);
    await page.goto('/');
    await page
      .getByText('Kirby')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // The row is rebuilt purely from `beam ls --json` — this Kirby
    // never created it. Focus stays on the sidebar (no attach), so the
    // delete below is driven straight from there.
    await expect(term.getByText('desktop:remote-x').first()).toBeVisible({
      timeout: 30_000,
    });

    // ── Delete: always the typed-branch confirmation, then gone ──
    // Wait for the row to be *selected* (◎ = selected, not running),
    // not merely present: the sidebar's selection settles a tick after
    // the list arrives, and a delete keypress before then is dropped.
    await expect(term.getByText(/◎ desktop:remote-x/).first()).toBeVisible({
      timeout: 15_000,
    });
    await term.type('x');
    await expect(term.getByText('Confirm Delete').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(term.getByText(/remote session/i).first()).toBeVisible();
    await term.type('remote-x');
    await term.press('Enter');

    await expect(term.getByText('desktop:remote-x').first()).not.toBeVisible({
      timeout: 30_000,
    });
    await expect(async () => {
      expect(h.sessions().some((s) => s.endsWith('-remote-x'))).toBe(false);
    }).toPass({ timeout: 30_000 });
    const after = h.exec(`ls ${h.repoPath}/.beam/worktrees/ 2>/dev/null; true`);
    expect(after).not.toContain('remote-x');
  });
});
