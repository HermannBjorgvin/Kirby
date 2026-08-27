import { test, expect } from './fixtures/desktop.js';
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
