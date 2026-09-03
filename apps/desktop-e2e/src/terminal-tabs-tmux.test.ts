import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { tab, visibleText } from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalSessions,
  terminalTabs,
  tmuxSessionPath,
} from './setup/terminals.js';
import { killKirbySessions, tmuxAvailable } from './setup/tmux.js';

/**
 * Terminal tabs under tmux: the session is identified by nothing but
 * its name and the directory tmux holds for it — no state file — so a
 * terminal outlives the app and comes back as a tab, in its group,
 * whatever repository the app opens on.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

test.describe('Terminal tabs under tmux', () => {
  test.use({ kirbyConfig: { terminalBackend: 'tmux' } });

  test.afterEach(({ desktop }) => {
    killKirbySessions(desktop.homeDir);
  });

  test('a shell is a kirby-term session started in its directory, killed on close', async ({
    desktop,
  }) => {
    const { app, page, repoPath, homeDir } = desktop;
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Shell');
    await expect(terminalTabs(page)).toHaveCount(1);

    await expect
      .poll(() => terminalSessions(homeDir), { timeout: 15_000 })
      .toHaveLength(1);
    const [name] = terminalSessions(homeDir);
    expect(name).toMatch(/^kirby-term-shell-[0-9a-f]+$/);
    // The directory is tmux's own record, which is all a later launch
    // has to go on.
    expect(tmuxSessionPath(name, homeDir)).toBe(repoPath);

    // Closing the tab kills the session — a terminal is not detached
    // from the way an agent is on quit.
    await terminalTabs(page).getByLabel('Close tab').click();
    await page
      .getByRole('dialog')
      .filter({ hasText: 'Close terminal' })
      .getByRole('button', { name: /End session/ })
      .click();
    await expect
      .poll(() => terminalSessions(homeDir), { timeout: 15_000 })
      .toEqual([]);
  });
});

test.describe('Terminal tabs surviving a restart', () => {
  const folder = mkdtempSync(join(tmpdir(), 'kirby-plain-'));
  const other = createTestRepo({ name: 'survivor-repo' });
  const PLAIN = 'kirby-term-shell-0a0a0a';
  const IN_REPO = 'kirby-term-agent-0b0b0b';

  test.use({
    kirbyConfig: { terminalBackend: 'tmux' },
    liveTerminals: {
      [PLAIN]: {
        cwd: folder,
        command: `printf '%s\\n' plain-shell-was-here; sleep 300`,
      },
      [IN_REPO]: {
        cwd: other,
        command: `printf '%s\\n' repo-agent-was-here; sleep 300`,
      },
    },
  });

  test.afterEach(({ desktop }) => {
    killKirbySessions(desktop.homeDir);
  });

  test.afterAll(() => {
    cleanupTestRepo(other);
    rmSync(folder, { recursive: true, force: true });
  });

  test('every surviving terminal reopens as a tab in its group, without switching repository', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    // Both come back, whichever repository the app opened on.
    await expect(terminalTabs(page)).toHaveCount(2, { timeout: 30_000 });
    // …and nothing switched: a restored tab is opened without focus.
    expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
      cwd: repoPath,
    });

    // The plain folder's terminal sits in the repo-less group.
    const plain = tab(page, new RegExp(basename(folder)));
    await expect(plain).toHaveAttribute('title', folder);
    // The other repository's terminal is foreign here — prefixed with
    // that repository's name — and that repository is back on the list.
    const foreign = tab(page, /survivor-repo\s*\/\s*/);
    await expect(foreign).toBeVisible();
    const recents = await page.evaluate(() => window.kirby.listRecentRepos());
    expect(recents.map((r) => r.cwd)).toContain(other);

    // Activating the foreign one opens its repository, like any foreign
    // tab, and the pane shows the session that was already running.
    await foreign.click();
    await expect
      .poll(() => page.evaluate(() => window.kirby.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ cwd: other });
    await expect(visibleText(page, 'repo-agent-was-here')).toBeVisible({
      timeout: 30_000,
    });

    // The plain one switches nothing when activated.
    await plain.click();
    await expect(visibleText(page, 'plain-shell-was-here')).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
      cwd: other,
    });
  });
});
