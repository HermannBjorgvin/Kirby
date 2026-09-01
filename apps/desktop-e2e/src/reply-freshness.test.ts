import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow, visibleText } from './setup/app.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';

/**
 * Opening a reply box re-reads the pull request first.
 *
 * The failure this guards against is quiet and expensive: the thread
 * query is cached, nothing polls it, and the reader answers a question
 * a colleague answered ten minutes ago — two people now hold different
 * versions of the same conversation. The only way to prove the app
 * actually goes and looks is to move the world underneath it, which is
 * what the fake `gh` scenario file is for: it is re-read on every
 * invocation, so rewriting it mid-test is a comment landing upstream.
 */

// Slash-free: git-repo.ts seeds a worktree at `.claude/worktrees/<branch>`
// verbatim while the app resolves its own sanitized directory name.
const BRANCH = 'undo-support';
const QUESTION = 'Should the undo stack be bounded?';
const ANSWER = 'Yes — cap it at fifty entries.';

const GITHUB: FakeGitHub = {
  username: 'kirby-tester',
  prs: [
    {
      number: 42,
      title: 'Add undo support',
      headRefName: BRANCH,
      body: 'Adds an undo stack.',
      rollup: 'SUCCESS',
      threads: [
        {
          id: 'T1',
          path: 'undo.c',
          line: 1,
          comments: [{ author: 'alice', body: QUESTION }],
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
});

async function openPr(page: Page) {
  await sidebarRow(page, /Add undo support|#42/)
    .first()
    .click();
  await expect(visibleText(page, QUESTION)).toBeVisible({ timeout: 30_000 });
}

/** The reply card's freshness line, by the kind it is reporting. */
function notice(page: Page, kind: 'checking' | 'arrived') {
  return page.locator(`[data-composer-notice="${kind}"]`);
}

/** The card's reply button. Exactly one thread in this scenario, so a
 *  second match would be a real duplicate and should fail loudly. */
function replyButton(page: Page) {
  return page.getByRole('button', { name: 'Reply…', exact: true });
}

test.describe('Refreshing a thread before replying', () => {
  test('a reply that landed while the tab was open shows before the box does', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await openPr(page);

    // Somebody answers the thread. Nothing polls it, so the app is now
    // showing a conversation that no longer exists upstream.
    updateFakeGh(homeDir, (scenario) => {
      scenario.prs[0].threads?.[0].comments.push({
        author: 'bob',
        body: ANSWER,
      });
    });
    await expect(visibleText(page, ANSWER)).toBeHidden();

    await replyButton(page).click();

    // The composer is open immediately — it never waits on the fetch.
    await expect(page.getByPlaceholder(/Write a reply/)).toBeVisible();

    // …and the answer arrives into it, announced rather than slipped in.
    await expect(notice(page, 'arrived')).toHaveText(/1 new comment arrived/, {
      timeout: 15_000,
    });
    await expect(visibleText(page, ANSWER)).toBeVisible();
  });

  // A provider that answers in a millisecond hides the state worth
  // asserting on here.
  test.describe('with a slow provider', () => {
    test.use({ fakeGitHub: { ...GITHUB, latencyMs: 400 } });

    test('the check is visibly run even when nothing has changed', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await openPr(page);

      await replyButton(page).click();
      await expect(page.getByPlaceholder(/Write a reply/)).toBeVisible();

      // The provider is slowed down (latencyMs above) so the in-flight
      // state is observable. Asserting only that it *clears* would pass
      // with the whole feature removed — there would simply never be a
      // notice at all — so the test has to see it appear first.
      await expect(notice(page, 'checking')).toBeVisible({ timeout: 15_000 });

      // Then it clears itself, and nothing replaces it: there is no news,
      // and a permanent banner would train the eye past it.
      await expect(notice(page, 'checking')).toBeHidden({ timeout: 15_000 });
      await expect(notice(page, 'arrived')).toHaveCount(0);
    });
  });
});
