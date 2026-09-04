import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  focusTerminal,
  openPalette,
  visibleText,
} from './setup/app.js';
import { armFolderPick } from './setup/dialogs.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import {
  confirmNewTerminal,
  newTerminalDialog,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

/**
 * Terminal tabs on the PTY backend: opened from the native menu through
 * the where-then-what dialog, shown as a terminal and nothing else,
 * grouped by what their directory is, and ended when their tab closes.
 */

test.describe('Terminal tabs', () => {
  // A short repository name: the tab's label is cut from the front to
  // keep the tail readable, and a temp dir's random name is long enough
  // to be cut inside — which is the rule working, not the tab failing.
  test.use({ repo: { name: 'term-repo' } });

  test('a shell in the current repository: opened from the menu, closed with confirmation', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;

    const dialog = await openNewTerminalDialog(app, page);
    // The open repository is the default answer to "where".
    await expect(
      dialog.getByRole('button', { name: /Current repository/ })
    ).toHaveAttribute('aria-pressed', 'true');
    await confirmNewTerminal(page, 'Shell');

    const tab = terminalTabs(page);
    await expect(tab).toHaveCount(1);
    // Titled by its directory with the tail kept — the tab is narrow and
    // the repository's name is at the end of the path — and the whole
    // path on hover.
    await expect(tab).toContainText(basename(repoPath));
    await expect(tab).toHaveAttribute('title', repoPath);
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    // The host knows it as a shell at that repository's root.
    const listed = await page.evaluate(() => window.kirby.listTerminals());
    expect(listed).toEqual([
      expect.objectContaining({
        kind: 'shell',
        cwd: repoPath,
        repo: repoPath,
        running: true,
      }),
    ]);

    // It is a real shell: what is typed into it runs. The prompt has to
    // be up first — a keystroke sent while the shell is still starting
    // is read in cooked mode and lost.
    await expect(
      page.locator('[data-terminal-pane]').getByText(/\S/).first()
    ).toBeVisible({ timeout: 15_000 });
    await focusTerminal(page);
    await page.keyboard.type('echo kirby-shell-$((40+2))\n', { delay: 20 });
    await expect(visibleText(page, 'kirby-shell-42')).toBeVisible({
      timeout: 15_000,
    });

    // Closing asks first, then ends the session.
    await tab.getByLabel('Close tab').click();
    const confirm = page
      .getByRole('dialog')
      .filter({ hasText: 'Close terminal' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /End session/ }).click();
    await expect(terminalTabs(page)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.kirby.listTerminals()))
      .toEqual([]);
  });

  // The tab is the only handle on the shell, and when the shell is
  // gone there is nothing left to hold: the tab closes by itself, and
  // asks nothing — there is no session left to confirm ending.
  test('a shell tab closes itself when the shell exits', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Shell');
    const tab = terminalTabs(page);
    await expect(tab).toHaveCount(1);

    await expect(
      page.locator('[data-terminal-pane]').getByText(/\S/).first()
    ).toBeVisible({ timeout: 15_000 });
    await focusTerminal(page);
    await page.keyboard.type('exit\n', { delay: 20 });

    await expect(terminalTabs(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.kirby.listTerminals())).toEqual([]);
  });

  test('a plain folder gets a tab in the repo-less group and switches nothing', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    const folder = mkdtempSync(join(tmpdir(), 'kirby-plain-'));
    try {
      // Something of the repository's own on the strip, so the terminal
      // has a group to be apart from.
      await createWorktree(page, 'some-work');

      await openNewTerminalDialog(app, page);
      await armFolderPick(app, folder);
      await newTerminalDialog(page)
        .getByRole('button', { name: /Other folder/ })
        .click();
      await expect(
        newTerminalDialog(page).getByRole('button', { name: /Other folder/ })
      ).toContainText(folder);
      await confirmNewTerminal(page, 'Shell');

      const tab = terminalTabs(page);
      await expect(tab).toHaveAttribute('title', folder);
      // A group of its own: the strip draws a boundary before it.
      await expect(tab).toHaveAttribute('data-starts-group', 'true');
      // …and no repository prefix, because it belongs to none.
      await expect(tab).not.toContainText(basename(repoPath));

      // Nothing switched, and the host files it under no repository.
      expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
        cwd: repoPath,
      });
      const listed = await page.evaluate(() => window.kirby.listTerminals());
      expect(listed).toEqual([
        expect.objectContaining({ cwd: folder, repo: null }),
      ]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('a picked folder that is a repository root opens that repository', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    const other = createTestRepo({ name: 'picked-repo' });
    try {
      await openNewTerminalDialog(app, page);
      await armFolderPick(app, other);
      await newTerminalDialog(page)
        .getByRole('button', { name: /Other folder/ })
        .click();
      await confirmNewTerminal(page, 'Shell');

      // The terminal belongs to the picked repository, so the workspace
      // follows it there — the same path as activating a foreign tab.
      await expect
        .poll(() => page.evaluate(() => window.kirby.getRepo()), {
          timeout: 30_000,
        })
        .toMatchObject({ cwd: other });
      expect(repoPath).not.toBe(other);

      // …and that repository is now on the list, behind the scenes.
      const recents = await page.evaluate(() => window.kirby.listRecentRepos());
      expect(recents.map((r) => r.cwd)).toContain(other);

      // Once there, the tab is at home: no repository prefix.
      const tab = terminalTabs(page);
      await expect(tab).toHaveCount(1);
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(tab).not.toContainText('picked-repo/');
    } finally {
      cleanupTestRepo(other);
    }
  });

  // The dialog is two steps and two Enters from the keyboard: focus
  // opens on the first choice, the arrows walk every choice on screen
  // as one list, Enter on a "where" choice moves on to "what", and
  // Enter on a "what" choice opens the terminal as that kind.
  test('is driven from the keyboard alone', async ({ desktop }) => {
    const { app, page, repoPath } = desktop;
    const dialog = await openNewTerminalDialog(app, page);
    const choice = (name: RegExp) => dialog.getByRole('button', { name });

    await expect(choice(/^Current repository/)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(choice(/^Other repository/)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(choice(/^Shell /)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    // …round to the top again, where Enter takes the current repository
    // and moves on to the second step.
    await expect(choice(/^Current repository/)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(choice(/^Shell /)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    const tab = terminalTabs(page);
    await expect(tab).toHaveCount(1);
    await expect(tab).toHaveAttribute('title', repoPath);
    const listed = await page.evaluate(() => window.kirby.listTerminals());
    expect(listed).toEqual([
      expect.objectContaining({ kind: 'shell', cwd: repoPath, running: true }),
    ]);
  });

  test('is offered from the command palette too', async ({ desktop }) => {
    const { page } = desktop;
    await openPalette(page);
    await page.getByRole('option', { name: /New terminal/ }).click();
    await expect(newTerminalDialog(page)).toBeVisible();
  });
});

test.describe('Agent terminals', () => {
  // An agent that reports what it was seeded with, so "no prompt" is
  // provable rather than assumed.
  test.use({ kirbyConfig: { aiCommand: fakeAgent({ printSeed: true }) } });

  test('runs the configured agent in the directory, with no task', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Agent');

    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });
    const listed = await page.evaluate(() => window.kirby.listTerminals());
    expect(listed).toEqual([
      expect.objectContaining({ kind: 'agent', cwd: repoPath, running: true }),
    ]);

    // The session menu's plain launch: the agent reports its seed line,
    // and there is nothing on it. Read from the host's buffer, which is
    // the bytes rather than a rendering of them.
    const { data } = await page.evaluate(
      (name) => window.kirby.getSessionBuffer(name),
      listed[0].name
    );
    expect(data).toMatch(/seed:/);
    expect(data).not.toMatch(/seed:[^\r\n]*\S/);
  });
});
