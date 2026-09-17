import { sessionBranch, sessionKey } from './setup/session-keys.js';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, launchAgentFromRail } from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/** Repository switches preserve independent agents, even on the same branch. */

const BRANCH = 'shared-name';

test.describe('Switching repository with an agent running', () => {
  let otherRepo: string;

  test.beforeEach(() => {
    // A second repository that happens to use the same branch name.
    otherRepo = createTestRepo({ worktrees: [{ branch: BRANCH }] });
  });

  test.afterEach(() => {
    cleanupTestRepo(otherRepo);
  });

  test('the other repo cannot see, adopt or kill the running agent', async ({
    desktop,
  }) => {
    const { page } = desktop;

    // Start an agent on `shared-name` in the repo the app opened with.
    await createWorktree(page, BRANCH);
    await launchAgentFromRail(page);
    await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });
    const before = await page.evaluate(() => window.n10.listSessions());
    expect(before.map((s) => sessionBranch(s.name))).toContain(BRANCH);

    const firstKey = await sessionKey(page, BRANCH);

    // Switch to the other repository, which has the same branch name.
    await page.evaluate((cwd) => window.n10.openRepo(cwd), otherRepo);
    expect(await page.evaluate(() => window.n10.getRepo())).toMatchObject({
      cwd: otherRepo,
    });

    // The agent belongs to the first repo: invisible here…
    expect(await page.evaluate(() => window.n10.listSessions())).toEqual([]);
    expect(await page.evaluate(() => window.n10.getSessionActivity())).toEqual(
      {}
    );
    // …its scrollback is not handed over…
    const buffer = await page.evaluate(
      (name) => window.n10.getSessionBuffer(name),
      firstKey
    );
    expect(buffer.data).toBe('');

    const second = await page.evaluate(
      (branch) =>
        window.n10.launchAgent({ branch, intent: 'continue-or-blank' }),
      BRANCH
    );
    expect(second.name).not.toBe(firstKey);
    expect(
      (await page.evaluate(() => window.n10.listSessions())).map((s) => s.name)
    ).toEqual([second.name]);

    // …and neither does killing it.
    await expect(
      page.evaluate((name) => window.n10.killSession(name), firstKey)
    ).rejects.toThrow(/another repository/);
  });

  test('switching back restores the agent and its scrollback', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    await createWorktree(page, BRANCH);
    await launchAgentFromRail(page);
    await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });

    await page.evaluate((cwd) => window.n10.openRepo(cwd), otherRepo);
    expect(await page.evaluate(() => window.n10.listSessions())).toEqual([]);

    await page.evaluate((cwd) => window.n10.openRepo(cwd), repoPath);

    // The agent kept running the whole time — entries for other repos
    // stay in the map precisely so switching back reattaches.
    const sessions = await page.evaluate(() => window.n10.listSessions());
    expect(
      sessions.find((s) => sessionBranch(s.name) === BRANCH)?.running
    ).toBe(true);
    const buffer = await page.evaluate(
      (name) => window.n10.getSessionBuffer(name),
      await sessionKey(page, BRANCH)
    );
    expect(buffer.data).toContain('n10-fake-agent-ready');
  });
});
