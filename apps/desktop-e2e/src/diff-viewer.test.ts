import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';

const BRANCH = 'diff-work';

test.describe('Diff viewer (no changes)', () => {
  test.use({ repo: { worktrees: [{ branch: BRANCH }] } });

  test('an empty worktree reports no changes against the default branch', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, new RegExp(BRANCH)).click();

    await expect(page.getByText(/No changes between/)).toBeVisible();
    await expect(page.getByText('0 files changed')).toBeVisible();
  });
});

test.describe('Diff viewer', () => {
  test.use({
    repo: {
      worktrees: [
        {
          branch: BRANCH,
          files: {
            'greeting.txt': 'hello from the worktree\nsecond line\n',
          },
        },
      ],
    },
  });

  test('a committed file shows up with its added lines', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, new RegExp(BRANCH)).click();

    await expect(page.getByText('1 file changed')).toBeVisible({
      timeout: 30_000,
    });
    // In the rail's Files list…
    await expect(page.getByText('greeting.txt').first()).toBeVisible();
    // …and rendered in the diff itself.
    await expect(
      page.getByText('hello from the worktree').first()
    ).toBeVisible();
    await expect(page.getByText('second line').first()).toBeVisible();
  });

  test('the diff and the terminal swap in one pane without losing either', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, new RegExp(BRANCH)).click();
    await expect(page.getByText('hello from the worktree').first()).toBeVisible(
      { timeout: 30_000 }
    );

    // The rail only offers an Agent entry once a session exists, and
    // launching one auto-selects the terminal.
    await page.getByRole('button', { name: /(Re)?launch agent/i }).click();
    await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });
    // The diff pane stays mounted (hidden) rather than being torn down,
    // so assert on what the user sees rather than on the node count.
    await expect(
      page.getByText('hello from the worktree').first()
    ).toBeHidden();

    // Back to the diff…
    await page
      .getByRole('button', { name: /greeting\.txt/ })
      .first()
      .click();
    await expect(
      page.getByText('hello from the worktree').first()
    ).toBeVisible();

    // …and back to the terminal, whose scrollback survived because the
    // pane stays mounted.
    await page.getByRole('button', { name: /^Agent/ }).click();
    await expect(
      page.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible();
  });

  test('Split view renders the same content as Unified', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, new RegExp(BRANCH)).click();
    await expect(page.getByText('hello from the worktree').first()).toBeVisible(
      { timeout: 30_000 }
    );

    await page.getByRole('button', { name: 'Split' }).click();
    await expect(
      page.getByText('hello from the worktree').first()
    ).toBeVisible();

    await page.getByRole('button', { name: 'Unified' }).click();
    await expect(
      page.getByText('hello from the worktree').first()
    ).toBeVisible();
  });
});

test.describe('Live worktree diff', () => {
  const LIVE = 'live-work';
  test.use({
    repo: {
      worktrees: [{ branch: LIVE, files: { 'committed.txt': 'one\n' } }],
    },
    kirbyConfig: { aiCommand: fakeAgent({ stream: true }) },
  });

  /**
   * A worktree's diff has to show what the agent has *done*, not what it
   * has committed — an agent that has been editing for ten minutes and
   * has not committed yet would otherwise leave the pane looking empty,
   * which is the opposite of watching it work.
   */
  test('shows work the agent has not committed', async ({ desktop }) => {
    const { page, repoPath } = desktop;
    const worktree = join(repoPath, '.claude', 'worktrees', LIVE);

    // Edit a tracked file and add a brand new one, without committing.
    writeFileSync(join(worktree, 'committed.txt'), 'one\ntwo\n');
    writeFileSync(join(worktree, 'invented.txt'), 'written by the agent\n');

    await sidebarRow(page, new RegExp(LIVE)).click();

    await expect(page.getByText('invented.txt').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('written by the agent').first()).toBeVisible();
    // The uncommitted edit to the tracked file too.
    await expect(page.getByText('two').first()).toBeVisible();
  });

  test('picks up a change made while the pane is open', async ({ desktop }) => {
    const { page, repoPath } = desktop;
    const worktree = join(repoPath, '.claude', 'worktrees', LIVE);

    await sidebarRow(page, new RegExp(LIVE)).click();
    await expect(page.getByText('committed.txt').first()).toBeVisible({
      timeout: 30_000,
    });

    // Start the agent: the poll only runs while one is working, which is
    // the only time the tree changes underneath the viewer.
    await page
      .getByRole('button', { name: /(Re)?launch agent/i })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });

    writeFileSync(join(worktree, 'appeared-later.txt'), 'after the fact\n');

    // No click, no refresh — the pane catches up on its own.
    await expect(page.getByText('appeared-later.txt').first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
