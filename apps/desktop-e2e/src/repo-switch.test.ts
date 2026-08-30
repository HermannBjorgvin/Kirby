import { test, expect } from './fixtures/desktop.js';
import { createWorktree } from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * The desktop lets you switch repository with agents still running,
 * which the TUI never had to consider. The PTY registry keys sessions
 * by bare branch name — the same name that names the worktree
 * directory — so two repositories with a branch of the same name land
 * on one key, and without an ownership check the second repo's UI would
 * happily adopt, write to, and kill the first repo's agent.
 *
 * Repository switching runs through the bridge here rather than the UI
 * because picking a folder is a native OS dialog. Everything asserted
 * below still crosses real IPC into the real host.
 */

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
    await page.getByRole('button', { name: /(Re)?launch agent/i }).click();
    await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });
    const before = await page.evaluate(() => window.kirby.listSessions());
    expect(before.map((s) => s.name)).toContain(BRANCH);

    // Switch to the other repository, which has the same branch name.
    await page.evaluate((cwd) => window.kirby.openRepo(cwd), otherRepo);
    expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
      cwd: otherRepo,
    });

    // The agent belongs to the first repo: invisible here…
    expect(await page.evaluate(() => window.kirby.listSessions())).toEqual([]);
    expect(
      await page.evaluate(() => window.kirby.getSessionActivity())
    ).toEqual({});
    // …its scrollback is not handed over…
    const buffer = await page.evaluate(
      (name) => window.kirby.getSessionBuffer(name),
      BRANCH
    );
    expect(buffer.data).toBe('');

    // …launching the same branch name here refuses rather than
    // silently adopting the other repo's agent…
    await expect(
      page.evaluate(
        (branch) =>
          window.kirby.launchAgent({ branch, intent: 'continue-or-blank' }),
        BRANCH
      )
    ).rejects.toThrow(/another repository/);

    // …and neither does killing it.
    await expect(
      page.evaluate((name) => window.kirby.killSession(name), BRANCH)
    ).rejects.toThrow(/another repository/);
  });

  test('switching back restores the agent and its scrollback', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    await createWorktree(page, BRANCH);
    await page.getByRole('button', { name: /(Re)?launch agent/i }).click();
    await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });

    await page.evaluate((cwd) => window.kirby.openRepo(cwd), otherRepo);
    expect(await page.evaluate(() => window.kirby.listSessions())).toEqual([]);

    await page.evaluate((cwd) => window.kirby.openRepo(cwd), repoPath);

    // The agent kept running the whole time — entries for other repos
    // stay in the map precisely so switching back reattaches.
    const sessions = await page.evaluate(() => window.kirby.listSessions());
    expect(sessions.find((s) => s.name === BRANCH)?.running).toBe(true);
    const buffer = await page.evaluate(
      (name) => window.kirby.getSessionBuffer(name),
      BRANCH
    );
    expect(buffer.data).toContain('kirby-fake-agent-ready');
  });
});
