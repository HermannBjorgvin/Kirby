import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow, visibleText } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * How a Conventional Comment reads in the review workspace.
 *
 * The header (conventionalcomments.org) is a classification, not a
 * sentence, so it becomes badges and leaves the prose — and the agent
 * signature becomes an aside instead of a last paragraph. Both come
 * off bodies the provider hands over, which is why this drives the
 * real workspace against a fake `gh` rather than mounting a card:
 * what is being checked is that the split survives the whole trip
 * from the provider to the screen.
 */

const BRANCH = 'undo-support';
const SUBJECT = 'The undo stack is never bounded.';
const DISCUSSION = 'Every edit pushes onto it and nothing ever pops.';
const PLAIN = 'Looks good to me, shipping.';

const AGENT_BODY =
  `issue (blocking): ${SUBJECT}\n\n${DISCUSSION}\n\n---\n` +
  '_Posted via [Kirby](https://github.com/HermannBjorgvin/Kirby) by an agent_';

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
          comments: [{ author: 'kirby-tester', body: AGENT_BODY }],
        },
        {
          id: 'T2',
          path: 'undo.c',
          line: 2,
          comments: [{ author: 'alice', body: PLAIN }],
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
  await expect(visibleText(page, SUBJECT)).toBeVisible({ timeout: 30_000 });
}

/**
 * The thread card whose body contains `text`.
 *
 * `.first()` because a thread is mounted both inline in the diff and
 * in the comment list; they are the same card component, so asserting
 * on either proves the same thing.
 */
function card(page: Page, text: string) {
  return page.locator('[data-thread]').filter({ hasText: text }).first();
}

test.describe('Rendering Conventional Comments', () => {
  test('the header becomes badges and leaves the prose', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);

    const agent = card(page, SUBJECT);
    await expect(agent.getByText('issue', { exact: true })).toBeVisible();
    await expect(agent.getByText('blocking', { exact: true })).toBeVisible();

    // The subject survives as the comment's first line — it is the
    // finding, not part of the label.
    await expect(agent.getByText(SUBJECT)).toBeVisible();
    await expect(agent.getByText(DISCUSSION)).toBeVisible();

    // …and the raw header is gone from the body it was lifted out of,
    // and from the one-line preview a collapsed card shows.
    await expect(agent.getByText(`issue (blocking): ${SUBJECT}`)).toHaveCount(
      0
    );
  });

  test('the signature reads as an aside, not as the last paragraph', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);

    const agent = card(page, SUBJECT);
    await expect(agent.getByText(/Posted via/)).toBeVisible();
    // `exact` matters: role-name matching is substring-based, and the
    // comment's author is "kirby-tester".
    await expect(
      agent.getByRole('button', { name: 'Kirby', exact: true })
    ).toBeVisible();
    // The markdown it arrived as is never shown.
    await expect(agent.getByText(/_Posted via \[Kirby\]/)).toHaveCount(0);
  });

  /** Most comments on a pull request are people's, written however
   *  they like. A parser that guesses would eat their first line. */
  test('an ordinary comment is left exactly as written', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);

    const human = card(page, PLAIN);
    await expect(human.getByText(PLAIN)).toBeVisible();
    await expect(human.getByText('issue', { exact: true })).toHaveCount(0);
    await expect(human.getByText(/Posted via/)).toHaveCount(0);
  });
});
