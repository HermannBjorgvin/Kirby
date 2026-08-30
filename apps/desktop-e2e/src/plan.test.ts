import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { createWorktree, sidebarRow, tab, visibleText } from './setup/app.js';
import { armContextMenuChoice } from './setup/menu.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * Queueing review comments for an agent — the "add to cart" flow.
 *
 * These drive the real app against a fake `gh` on PATH (setup/fake-gh.ts),
 * so a whole pull request with review threads exists without a token.
 * The payoff is that the assertions can be end-to-end: the last one
 * reads the prompt *the agent process was actually started with*, which
 * is the only way to know the queue, the preview and the delivery agree.
 */

// Slash-free: git-repo.ts seeds a worktree at `.claude/worktrees/<branch>`
// verbatim, while the app resolves its own sanitized directory name, so a
// slashed branch would leave the two looking in different places.
const BRANCH = 'undo-support';
const UNBOUNDED = 'The undo stack is never bounded.';
const NAMING = 'Rename this to something less generic.';

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
          comments: [{ author: 'alice', body: UNBOUNDED }],
        },
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
});

/** Open the pull request's tab and wait for its review workspace. */
async function openPr(page: Page) {
  await sidebarRow(page, /Add undo support|#42/)
    .first()
    .click();
  await expect(page.getByText('Review').first()).toBeVisible({
    timeout: 30_000,
  });
}

/** The comment card whose body is `body`. */
function card(page: Page, body: string) {
  return page.locator('[data-thread]').filter({ hasText: body });
}

async function addToPlan(page: Page, body: string) {
  const target = card(page, body);
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await target
    .getByRole('button', { name: 'Add to plan', exact: true })
    .click();
}

/**
 * Bring the diff back into the content pane by jumping to a comment
 * from the rail. Launching an agent switches the pane to its terminal,
 * which hides the comment cards.
 */
async function jumpToComment(page: Page, body: string) {
  await page
    .getByRole('button', { name: new RegExp(body) })
    .filter({ visible: true })
    .first()
    .click();
}

/** The rail's comment-list row for `body`. */
function railComment(page: Page, body: string) {
  return page
    .getByRole('button', { name: new RegExp(body) })
    .filter({ visible: true })
    .first();
}

/** The rail's plan entry. */
function planEntry(page: Page) {
  return page.getByRole('button', { name: /^Plan\b/ });
}

test.describe('Adding comments to the plan', () => {
  test('a queued comment shows up in the rail and in the plan pane', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });

    // Nothing queued, nothing in the rail — an empty cart is not a
    // thing to look at.
    await expect(planEntry(page)).toHaveCount(0);

    await addToPlan(page, UNBOUNDED);

    // The card says so without needing a hover any more...
    await expect(
      card(page, UNBOUNDED).getByRole('button', { name: 'Remove from plan' })
    ).toBeVisible();
    // ...and so does the rail.
    await expect(planEntry(page)).toBeVisible();

    await planEntry(page).click();
    const queue = page.getByRole('list', { name: 'Queued comments' });
    await expect(queue.getByText(UNBOUNDED)).toBeVisible();
    await expect(queue.getByText('undo.c:1')).toBeVisible();
    // Numbered, because the number is what the prompt calls it.
    await expect(queue.getByRole('listitem')).toHaveCount(1);
  });

  test('the preview shows the exact prompt, in the order comments were added', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);
    await expect(visibleText(page, NAMING)).toBeVisible({ timeout: 30_000 });

    // Deliberately not document order: the plan is a queue, and the
    // prompt must follow the queue rather than the file.
    await addToPlan(page, NAMING);
    await addToPlan(page, UNBOUNDED);
    await planEntry(page).click();

    await page.getByRole('button', { name: /Prompt preview/ }).click();
    const preview = page.locator('pre');
    await expect(preview).toBeVisible();
    const text = (await preview.textContent())!;
    expect(text).toContain('Resolve these PR review comments:');
    expect(text.indexOf(NAMING)).toBeLessThan(text.indexOf(UNBOUNDED));
    expect(text).toContain('### 1. undo.c:2');
    expect(text).toContain('### 2. undo.c:1');
  });

  test('a note written on the card rides along in the prompt', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });

    const target = card(page, UNBOUNDED);
    await target.hover();
    await target
      .getByRole('button', { name: 'Add to plan with a note', exact: true })
      .click();

    // Opening the composer already queued the comment — the note is an
    // embellishment on an add that happened, not a second step that can
    // be abandoned.
    await expect(planEntry(page)).toBeVisible();

    await page
      .getByLabel('Your note to the agent')
      .fill('Cap it at 100 entries.');
    await page.getByRole('button', { name: 'Save note' }).click();

    await expect(target.getByText('Cap it at 100 entries.')).toBeVisible();

    await planEntry(page).click();
    await page.getByRole('button', { name: /Prompt preview/ }).click();
    await expect(page.locator('pre')).toContainText(
      'Your note: Cap it at 100 entries.'
    );
  });

  test('emptying the plan leaves the checkout pane rather than stranding it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });

    await addToPlan(page, UNBOUNDED);
    await planEntry(page).click();
    await expect(page.getByText('Prompt preview')).toBeVisible();

    await page.getByRole('button', { name: /^Remove .* from plan$/ }).click();

    // Back on the diff, with the rail entry gone.
    await expect(page.getByText('Prompt preview')).toHaveCount(0);
    await expect(planEntry(page)).toHaveCount(0);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible();
  });
});

test.describe('Sending the plan', () => {
  test.use({
    kirbyConfig: { aiCommand: fakeAgent({ printSeed: true, echo: true }) },
  });

  test('starts an agent with the composed plan as its prompt', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });

    await addToPlan(page, UNBOUNDED);
    await addToPlan(page, NAMING);
    await planEntry(page).click();
    await page.getByRole('button', { name: 'Start agent with plan' }).click();

    // The fake agent prints the seed prompt the launcher handed it, so
    // this is the text that genuinely reached the process — not what
    // the pane said it would send.
    await expect(
      visibleText(page, /seed:Resolve these PR review comments:/)
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      visibleText(page, new RegExp(`seed:.*${UNBOUNDED}`))
    ).toBeVisible();
    await expect(visibleText(page, /seed:### 2\. undo\.c:2/)).toBeVisible();

    // Sent means sent: the queue is emptied, so the same comments are
    // not silently sent twice.
    await expect(planEntry(page)).toHaveCount(0);
  });

  test('injects into an agent that is already running', async ({ desktop }) => {
    const { page } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });

    // Launching on a pull request offers session-vs-review first.
    await page
      .getByRole('button', { name: /^(Re)?launch agent$/i })
      .filter({ visible: true })
      .first()
      .click();
    await page.getByText('Start / continue session').click();
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });

    await jumpToComment(page, UNBOUNDED);
    await addToPlan(page, UNBOUNDED);
    await planEntry(page).click();
    // With an agent live, injecting leads and restarting is the
    // explicit second choice.
    await expect(
      page.getByRole('button', { name: 'Restart with plan' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Send to agent' }).click();

    // Injected prompts are typed into the running REPL, which the echo
    // agent reflects back.
    await expect(
      visibleText(page, /echo:Resolve these PR review comments:/)
    ).toBeVisible({ timeout: 30_000 });
    await expect(planEntry(page)).toHaveCount(0);
  });
});

test.describe('Reaching the plan from elsewhere', () => {
  test('the tab carries the count once you have navigated away', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });
    await addToPlan(page, UNBOUNDED);

    // A queue you built and then walked away from should not go quiet.
    await createWorktree(page, 'elsewhere');
    await expect(tab(page, /elsewhere/)).toBeVisible();
    await expect(
      tab(page, /Add undo support|undo-support/).getByLabel(
        '1 comment in the plan'
      )
    ).toBeVisible();
  });

  test('right-clicking a comment in the rail queues it', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });

    await armContextMenuChoice(app, 'Add to plan');
    await page
      .getByRole('button', { name: new RegExp(NAMING) })
      .filter({ visible: true })
      .first()
      .click({ button: 'right' });

    await expect(planEntry(page)).toBeVisible();
    await planEntry(page).click();
    await expect(
      page.getByRole('list', { name: 'Queued comments' }).getByText(NAMING)
    ).toBeVisible();
  });

  test('asking for a note from the rail opens the plan on that comment', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });

    // The rail has nowhere to compose a note, so the request has to
    // land somewhere that does.
    await armContextMenuChoice(app, 'Add to plan with a note…');
    await page
      .getByRole('button', { name: new RegExp(NAMING) })
      .filter({ visible: true })
      .first()
      .click({ button: 'right' });

    const composer = page.getByLabel('Your note to the agent');
    await expect(composer).toBeVisible();
    await composer.fill('Pick a name that says what it holds.');
    await page.getByRole('button', { name: 'Save note' }).click();
    // Saved on the queued row, and on the card back in the diff.
    await expect(
      page
        .getByRole('list', { name: 'Queued comments' })
        .getByText('Pick a name that says what it holds.')
    ).toBeVisible();
    // And it is the same note back on the card in the diff — one value,
    // two places it can be read and edited.
    await jumpToComment(page, NAMING);
    await expect(
      card(page, NAMING).getByText('Pick a name that says what it holds.')
    ).toBeVisible();
  });

  /**
   * The rail stays on screen beside the plan pane, so a second request
   * for the same row arrives without the pane remounting. That is the
   * case the note request carries identity for: compare on the row's
   * key alone and the second ask looks identical to the first, so
   * nothing reopens.
   */
  test('asking twice for the same note reopens the composer', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await openPr(page);
    await expect(visibleText(page, UNBOUNDED)).toBeVisible({ timeout: 30_000 });

    await armContextMenuChoice(app, 'Add to plan with a note…');
    await railComment(page, NAMING).click({ button: 'right' });
    const composer = page.getByLabel('Your note to the agent');
    await expect(composer).toBeVisible();

    // Close it without saving — the comment stays queued.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(composer).toHaveCount(0);

    // Same row, same key, pane still mounted.
    await armContextMenuChoice(app, 'Edit note…');
    await railComment(page, NAMING).click({ button: 'right' });
    await expect(composer).toBeVisible();
  });
});
