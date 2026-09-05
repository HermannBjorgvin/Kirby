import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { sidebarRow, visibleText } from './setup/app.js';
import { armContextMenuChoice } from './setup/menu.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * Babysitting a pull request: the row's context menu starts a watcher
 * on the host, the row says so, and when the pull request needs work
 * the agent is told — here by being started with the update as its
 * prompt, since no agent is running in the worktree.
 *
 * The cadence is overridden through the environment: the real
 * debounce is ten minutes, which is right for a reviewer typing and
 * wrong for a test. The fake agent prints the seed prompt it was
 * handed, so the assertion is on what genuinely reached the process.
 */

const BRANCH = 'undo-support';
const NAMING = 'Rename this to something less generic.';

const GITHUB: FakeGitHub = {
  username: 'kirby-tester',
  prs: [
    {
      number: 42,
      title: 'Add undo support',
      headRefName: BRANCH,
      rollup: 'FAILURE',
      threads: [
        {
          id: 'T2',
          path: 'undo.c',
          line: 2,
          comments: [{ author: 'bob', body: NAMING }],
        },
      ],
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: {
    worktrees: [
      {
        branch: BRANCH,
        files: { 'undo.c': 'void undo(void) {}\nint depth;\n' },
      },
    ],
  },
  kirbyConfig: { aiCommand: fakeAgent({ printSeed: true }) },
  env: { KIRBY_BABYSIT_DEBOUNCE_MS: '500', KIRBY_BABYSIT_POLL_MS: '1000' },
});

test.describe('Babysitting a pull request', () => {
  test('the row menu starts and stops it, and the row wears the badge', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const row = sidebarRow(page, /Add undo support|#42/).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    await armContextMenuChoice(app, 'Babysit pull request');
    await row.click({ button: 'right' });
    await expect(row.getByText(/babysitting|update pending/)).toBeVisible();

    await armContextMenuChoice(app, 'Stop babysitting');
    await row.click({ button: 'right' });
    await expect(row.getByText(/babysitting|update pending/)).toHaveCount(0);
  });

  test('starts an agent with the update once the news has settled', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const row = sidebarRow(page, /Add undo support|#42/).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    await armContextMenuChoice(app, 'Babysit pull request');
    await row.click({ button: 'right' });

    // No agent was running, so the babysitter starts one in the
    // worktree with the update as its opening prompt: the failed build
    // and the unresolved thread, named by the id the provider uses.
    await expect(
      visibleText(page, /seed:Status update for PR #42/)
    ).toBeVisible({ timeout: 30_000 });
    await expect(visibleText(page, /seed:CI: failed/)).toBeVisible();
    // The fixture repo has no origin, so the merge check cannot run —
    // and the prompt must say so rather than claim there are none.
    await expect(
      visibleText(page, /seed:Conflicts: could not be checked/)
    ).toBeVisible();
    await expect(visibleText(page, /seed:.*\(thread T2\)/)).toBeVisible();
    await expect(
      visibleText(page, new RegExp(`seed:.*${NAMING}`))
    ).toBeVisible();
  });
});
